from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Iterable

from .models import PriceObservation, ScrapeTarget
from .settings import settings


def compare_cpp(target: ScrapeTarget, observation: PriceObservation) -> dict:
    meta = target.metadata or {}
    expected = float(meta.get("expected_price"))
    tolerance = float(meta.get("tolerance_pct") or 0)
    actual = observation.live_price
    scraper_status = str(observation.scrape_status or "").strip().lower()

    difference = None
    over_pct = None
    if actual is not None:
        difference = round(float(actual) - expected, 2)
        if expected:
            over_pct = round(((float(actual) / expected) - 1) * 100, 4)

    if scraper_status == "error":
        status, compliant = "error", None
    elif scraper_status in {"missing", "ambiguous", "price_missing"} or actual is None:
        status, compliant = "missing", None
    elif observation.in_stock is False:
        status, compliant = "unavailable", None
    elif float(actual) <= expected:
        status, compliant = "ok", True
    elif float(actual) <= expected * (1 + tolerance):
        status, compliant = "half_issue", True
    else:
        status, compliant = "issue", False

    return {
        "target_id": meta.get("target_id"),
        "account_id": meta.get("account_id"),
        "branch_code": observation.branch_code or "",
        "branch_name": observation.branch_name or None,
        "checked_at": observation.observed_at.isoformat(),
        "checked_date": observation.observed_at.date().isoformat(),
        "account_sku": target.account_sku,
        "product_name": observation.product_name or target.product_name or None,
        "expected_price": expected,
        "actual_price": actual,
        "original_price": observation.original_price,
        "price_difference": difference,
        "over_expected_pct": over_pct,
        "in_stock": observation.in_stock,
        "status": status,
        "compliant": compliant,
        "scraper_status": observation.scrape_status,
        "product_url": observation.product_url or None,
        "evidence": {
            "target": meta,
            "scraper": observation.raw or {},
        },
    }


def start_cpp_run(db, account: dict, reference_set_id: str, checkpoint: str, expected: int) -> dict:
    from .db import now_local

    stamp = now_local()
    run_date = stamp.date().isoformat()
    current = (
        db.table("cpp_price_runs")
        .select("id,revision")
        .eq("account_id", account["id"])
        .eq("run_date", run_date)
        .eq("checkpoint", checkpoint)
        .eq("is_current", True)
        .order("revision", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    revision = int(current[0]["revision"]) + 1 if current else 1
    supersedes = current[0]["id"] if current else None
    if supersedes:
        db.table("cpp_price_runs").update({"is_current": False}).eq("id", supersedes).execute()

    return db.table("cpp_price_runs").insert({
        "account_id": account["id"],
        "reference_set_id": reference_set_id,
        "run_date": run_date,
        "checkpoint": checkpoint,
        "revision": revision,
        "is_current": True,
        "supersedes_run_id": supersedes,
        "started_at": stamp.isoformat(),
        "status": "running",
        "rows_expected": expected,
        "worker_version": settings.worker_version,
    }).execute().data[0]


def save_cpp_checks(db, run_id: str, checks: Iterable[dict]) -> int:
    rows = []
    for check in checks:
        row = dict(check)
        row["run_id"] = run_id
        if not row.get("target_id"):
            raise RuntimeError("CPP check target_id is missing")
        if not row.get("account_id"):
            raise RuntimeError("CPP check account_id is missing")
        rows.append(row)
    for i in range(0, len(rows), 250):
        db.table("cpp_price_checks").insert(rows[i:i + 250]).execute()
    return len(rows)


def finish_cpp_run(db, run_id: str, checks: list[dict], *, run_status: str, message: str) -> None:
    from .db import now_local

    counts = Counter(str(x.get("status") or "") for x in checks)
    valid = counts["ok"] + counts["half_issue"] + counts["issue"]
    db.table("cpp_price_runs").update({
        "finished_at": now_local().isoformat(),
        "status": run_status,
        "rows_observed": len(checks),
        "rows_checked": valid,
        "ok_count": counts["ok"],
        "half_issue_count": counts["half_issue"],
        "issue_count": counts["issue"],
        "missing_count": counts["missing"],
        "unavailable_count": counts["unavailable"],
        "error_count": counts["error"],
        "message": message,
    }).eq("id", run_id).execute()
