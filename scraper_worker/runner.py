from __future__ import annotations

from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import time

from .adapters import ADAPTERS
from .cpp_runtime import compare_cpp, finish_cpp_run, save_cpp_checks, start_cpp_run
from .db import client, finish_run, get_account, save_observations, start_run
from .export import export_csv
from .models import PriceObservation, ScrapeTarget
from .settings import settings
from .targets import load_cpp_targets, load_csv_targets, load_master_targets

SUPPORTED_ACCOUNTS = ["arogga", "daraz", "pandamart", "shajgoj", "foodi", "othoba", "shwapno"]
CPP_SUPPORTED_ACCOUNTS = ["arogga", "daraz", "othoba", "pandamart", "shajgoj", "shwapno"]


def _targets_for(db, code: str, source: str, csv_path: Path | None, limit: int | None) -> list[ScrapeTarget]:
    if source == "master":
        if db is None:
            raise RuntimeError("Supabase credentials are required for --target-source master")
        return load_master_targets(db, code, limit=limit)
    if source == "cpp":
        if db is None:
            raise RuntimeError("Supabase credentials are required for --target-source cpp")
        return load_cpp_targets(db, code, limit=limit)
    if source == "csv":
        if not csv_path:
            raise ValueError("--targets-csv is required when --target-source=csv")
        rows = [x for x in load_csv_targets(csv_path, account_code=code) if x.account_code == code]
        return rows[:limit] if limit else rows
    raise ValueError("target_source must be master, cpp or csv")


def _progress_every(total: int) -> int:
    if total <= 10:
        return 1
    if total <= 50:
        return 5
    if total <= 200:
        return 10
    return 25


def _progress_line(code: str, current: int, total: int, observations: int, cpp_checks: list[dict]) -> None:
    pct = (current / total * 100.0) if total else 100.0
    if cpp_checks:
        counts = Counter(str(x.get("status") or "") for x in cpp_checks)
        compact = ", ".join(
            f"{name}={counts[name]}"
            for name in ("ok", "half_issue", "issue", "unavailable", "missing", "error")
            if counts[name]
        )
        suffix = f" | {compact}" if compact else ""
    else:
        suffix = ""
    print(
        f"[{code}] progress {current}/{total} targets ({pct:.1f}%) | "
        f"observations={observations}{suffix}",
        flush=True,
    )


def run_account(
    code: str,
    checkpoint: str = "manual",
    *,
    target_source: str = "master",
    csv_path: Path | None = None,
    limit: int | None = None,
    write_db: bool = True,
    export_dir: Path | None = None,
) -> dict:
    if code not in ADAPTERS:
        raise ValueError(f"Unsupported account: {code}")
    if target_source == "cpp" and code not in CPP_SUPPORTED_ACCOUNTS:
        return {"account": code, "checkpoint": checkpoint, "status": "skipped", "message": "CPP adapter not enabled for this account."}

    print(f"[{code}] loading {target_source.upper()} targets...", flush=True)
    db = client() if (write_db or target_source in {"master", "cpp"}) else None
    account = get_account(db, code) if write_db else None
    targets = _targets_for(db, code, target_source, csv_path, limit)
    print(f"[{code}] targets ready: {len(targets)}", flush=True)
    if target_source == "cpp" and not targets:
        print(f"[{code}] skipped: no active scrapable CPP targets", flush=True)
        return {
            "account": code,
            "checkpoint": checkpoint,
            "status": "skipped",
            "targets": 0,
            "observations": 0,
            "message": "No active scrapable CPP targets for this account.",
        }

    adapter = ADAPTERS[code]()
    branch_multiplier = 10 if code == "pandamart" and target_source == "cpp" else 1
    generic_run = None
    cpp_run = None
    observations: list[PriceObservation] = []
    cpp_checks: list[dict] = []
    errors = 0
    scrape_counts = Counter()

    if write_db:
        if target_source == "cpp":
            refs = {str(t.metadata.get("reference_set_id") or "") for t in targets if t.metadata.get("reference_set_id")}
            if len(refs) != 1:
                raise RuntimeError(f"CPP run requires exactly one live reference set for {code}; found {sorted(refs)}")
            cpp_run = start_cpp_run(db, account, next(iter(refs)), checkpoint, len(targets) * branch_multiplier)
            print(
                f"[{code}] CPP run opened: revision={cpp_run['revision']} run_id={cpp_run['id']}",
                flush=True,
            )
        else:
            generic_run = start_run(db, account, checkpoint, len(targets) * branch_multiplier)

    total_targets = len(targets)
    progress_every = _progress_every(total_targets)
    print(
        f"[{code}] scraping started | targets={total_targets}"
        + (f" | expected branch checks≈{total_targets * branch_multiplier}" if branch_multiplier > 1 else ""),
        flush=True,
    )

    try:
        for index, target in enumerate(targets):
            try:
                rows = adapter.scrape(target)
            except Exception as exc:
                rows = [adapter.error_observation(target, str(exc))]
            for row in rows:
                if target.metadata:
                    raw = dict(row.raw or {})
                    raw.setdefault("_target", target.metadata)
                    row.raw = raw
                scrape_counts[row.scrape_status] += 1
                if row.scrape_status == "error":
                    errors += 1
                observations.append(row)
                if target_source == "cpp":
                    cpp_checks.append(compare_cpp(target, row))

            current = index + 1
            if current == 1 or current == total_targets or current % progress_every == 0:
                _progress_line(code, current, total_targets, len(observations), cpp_checks)

            if index < len(targets) - 1 and settings.delay_seconds > 0 and code not in {"daraz", "pandamart", "shwapno"}:
                time.sleep(settings.delay_seconds)

        output_csv = None
        if export_dir is not None:
            print(f"[{code}] exporting CSV...", flush=True)
            output_csv = export_csv(code, checkpoint, observations, export_dir)
            print(f"[{code}] CSV saved: {output_csv}", flush=True)

        if target_source == "cpp":
            status_counts = Counter(str(c["status"]) for c in cpp_checks)
            saved = len(cpp_checks)
            run_status = "success" if status_counts["error"] == 0 else ("partial" if saved > status_counts["error"] else "failed")
            if write_db:
                print(f"[{code}] saving {len(cpp_checks)} CPP checks to Supabase...", flush=True)
                saved = save_cpp_checks(db, cpp_run["id"], cpp_checks)
                message = (
                    f"{code} CPP {checkpoint}: {saved} checks from {len(targets)} targets; "
                    f"status={dict(status_counts)}"
                )
                finish_cpp_run(db, cpp_run["id"], cpp_checks, run_status=run_status, message=message)
                print(f"[{code}] Supabase saved: {saved} checks | run status={run_status}", flush=True)
            print(f"[{code}] completed", flush=True)
            return {
                "account": code,
                "checkpoint": checkpoint,
                "run_id": cpp_run["id"] if cpp_run else None,
                "revision": cpp_run["revision"] if cpp_run else None,
                "status": run_status,
                "targets": len(targets),
                "observations": saved,
                "cpp_statuses": dict(status_counts),
                "scrape_statuses": dict(scrape_counts),
                "adapter_ready": adapter.ready,
                "db_write": write_db,
                "output_csv": str(output_csv) if output_csv else None,
            }

        saved = len(observations)
        if write_db:
            print(f"[{code}] saving {len(observations)} observations to Supabase...", flush=True)
            saved = save_observations(db, generic_run["id"], account["id"], observations)
            status = "success" if errors == 0 else ("partial" if saved > errors else "failed")
            message = f"{code} {checkpoint}: {saved} observations from {len(targets)} targets; statuses={dict(scrape_counts)}"
            finish_run(db, generic_run["id"], status=status, observed=saved, errors=errors, message=message)
            print(f"[{code}] Supabase saved: {saved} observations | run status={status}", flush=True)
        else:
            status = "success" if errors == 0 else ("partial" if saved > errors else "failed")

        print(f"[{code}] completed", flush=True)
        return {
            "account": code,
            "checkpoint": checkpoint,
            "run_id": generic_run["id"] if generic_run else None,
            "revision": generic_run["revision"] if generic_run else None,
            "status": status,
            "targets": len(targets),
            "observations": saved,
            "statuses": dict(scrape_counts),
            "adapter_ready": adapter.ready,
            "db_write": write_db,
            "output_csv": str(output_csv) if output_csv else None,
        }
    except Exception as exc:
        print(f"[{code}] FAILED: {exc}", flush=True)
        if write_db and target_source == "cpp" and cpp_run:
            try:
                finish_cpp_run(db, cpp_run["id"], cpp_checks, run_status="failed", message=str(exc))
            except Exception:
                pass
        elif write_db and generic_run:
            finish_run(db, generic_run["id"], status="failed", observed=0, errors=max(1, errors), message=str(exc))
        raise
    finally:
        close = getattr(adapter, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass


def run_many(
    accounts: list[str] | None = None,
    checkpoint: str = "manual",
    *,
    target_source: str = "master",
    csv_path: Path | None = None,
    limit: int | None = None,
    write_db: bool = True,
    export_dir: Path | None = None,
    parallel: bool = False,
    max_workers: int | None = None,
) -> dict:
    selected = accounts or (CPP_SUPPORTED_ACCOUNTS if target_source == "cpp" else SUPPORTED_ACCOUNTS)

    def _run(code: str) -> dict:
        try:
            return run_account(
                code,
                checkpoint,
                target_source=target_source,
                csv_path=csv_path,
                limit=limit,
                write_db=write_db,
                export_dir=export_dir,
            )
        except Exception as exc:
            return {
                "account": code,
                "checkpoint": checkpoint,
                "status": "failed",
                "targets": None,
                "observations": 0,
                "db_write": write_db,
                "message": str(exc),
            }

    if parallel and len(selected) > 1:
        workers = max(1, min(int(max_workers or settings.cpp_max_workers), len(selected)))
        print(
            f"[cpp] parallel mode enabled | accounts={','.join(selected)} | workers={workers}",
            flush=True,
        )
        by_code: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="cpp") as pool:
            futures = {pool.submit(_run, code): code for code in selected}
            for future in as_completed(futures):
                code = futures[future]
                try:
                    by_code[code] = future.result()
                except Exception as exc:
                    by_code[code] = {
                        "account": code,
                        "checkpoint": checkpoint,
                        "status": "failed",
                        "observations": 0,
                        "db_write": write_db,
                        "message": str(exc),
                    }
        results = [by_code[code] for code in selected]
    else:
        if len(selected) > 1:
            print(f"[cpp] sequential mode | accounts={','.join(selected)}", flush=True)
        results = [_run(code) for code in selected]

    return {
        "checkpoint": checkpoint,
        "target_source": target_source,
        "db_write": write_db,
        "parallel": parallel,
        "accounts": results,
    }
