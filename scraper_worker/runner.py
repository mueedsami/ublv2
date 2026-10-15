from __future__ import annotations

from collections import Counter
from pathlib import Path
import time

from .adapters import ADAPTERS
from .db import client, finish_run, get_account, save_observations, start_run
from .export import export_csv
from .models import PriceObservation, ScrapeTarget
from .settings import settings
from .targets import load_cpp_targets, load_csv_targets, load_master_targets

SUPPORTED_ACCOUNTS = ["daraz", "pandamart", "shajgoj", "foodi", "othoba"]


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

    # Master targets are read from Supabase even when --no-db is selected.
    db = client() if (write_db or target_source in {"master", "cpp"}) else None
    account = get_account(db, code) if write_db else None
    targets = _targets_for(db, code, target_source, csv_path, limit)
    adapter = ADAPTERS[code]()

    multiplier = 10 if code == "pandamart" and target_source in {"master", "cpp"} else 1
    run = start_run(db, account, checkpoint, len(targets) * multiplier) if write_db else None
    observations: list[PriceObservation] = []
    errors = 0
    counts = Counter()

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
                counts[row.scrape_status] += 1
                if row.scrape_status == "error":
                    errors += 1
                observations.append(row)
            if index < len(targets) - 1 and settings.delay_seconds > 0:
                time.sleep(settings.delay_seconds)

        output_csv = None
        if export_dir is not None:
            output_csv = export_csv(code, checkpoint, observations, export_dir)

        saved = len(observations)
        if write_db:
            saved = save_observations(db, run["id"], account["id"], observations)
            status = "success" if errors == 0 else ("partial" if saved > errors else "failed")
            message = f"{code} {checkpoint}: {saved} observations from {len(targets)} targets; statuses={dict(counts)}"
            finish_run(db, run["id"], status=status, observed=saved, errors=errors, message=message)
        else:
            status = "success" if errors == 0 else ("partial" if saved > errors else "failed")

        return {
            "account": code,
            "checkpoint": checkpoint,
            "run_id": run["id"] if run else None,
            "revision": run["revision"] if run else None,
            "status": status,
            "targets": len(targets),
            "observations": saved,
            "statuses": dict(counts),
            "adapter_ready": adapter.ready,
            "db_write": write_db,
            "output_csv": str(output_csv) if output_csv else None,
        }
    except Exception as exc:
        if write_db and run:
            finish_run(db, run["id"], status="failed", observed=0, errors=max(1, errors), message=str(exc))
        raise


def run_many(
    accounts: list[str] | None = None,
    checkpoint: str = "manual",
    *,
    target_source: str = "master",
    csv_path: Path | None = None,
    limit: int | None = None,
    write_db: bool = True,
    export_dir: Path | None = None,
) -> dict:
    selected = accounts or SUPPORTED_ACCOUNTS
    return {
        "checkpoint": checkpoint,
        "target_source": target_source,
        "db_write": write_db,
        "accounts": [
            run_account(
                code,
                checkpoint,
                target_source=target_source,
                csv_path=csv_path,
                limit=limit,
                write_db=write_db,
                export_dir=export_dir,
            )
            for code in selected
        ],
    }
