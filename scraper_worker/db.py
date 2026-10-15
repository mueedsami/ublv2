from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Iterable

from .models import PriceObservation
from .settings import settings


def client():
    settings.validate_supabase()
    try:
        from supabase import create_client
    except ImportError as exc:
        raise RuntimeError("Supabase Python client is not installed correctly. Run: pip install -r scraper_worker/requirements.txt") from exc
    return create_client(settings.supabase_url, settings.service_key)


def now_local() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


def get_account(db, code: str) -> dict:
    rows = (
        db.table("accounts")
        .select("id,code,name,active")
        .eq("code", code)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise RuntimeError(f"Account not found in Supabase: {code}")
    if not rows[0].get("active", True):
        raise RuntimeError(f"Account is inactive: {code}")
    return rows[0]


def start_run(db, account: dict, checkpoint: str, rows_expected: int) -> dict:
    stamp = now_local()
    run_date = stamp.date().isoformat()
    current = (
        db.table("scraper_runs")
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
        db.table("scraper_runs").update({"is_current": False}).eq("id", supersedes).execute()

    return db.table("scraper_runs").insert({
        "account_id": account["id"],
        "run_date": run_date,
        "checkpoint": checkpoint,
        "revision": revision,
        "is_current": True,
        "supersedes_run_id": supersedes,
        "started_at": stamp.isoformat(),
        "status": "running",
        "rows_expected": rows_expected,
        "worker_version": settings.worker_version,
    }).execute().data[0]


def save_observations(db, run_id: str, account_id: str, observations: Iterable[PriceObservation]) -> int:
    rows = []
    for o in observations:
        rows.append({
            "run_id": run_id,
            "account_id": account_id,
            "observed_at": o.observed_at.isoformat(),
            "account_sku": o.account_sku,
            "branch_code": o.branch_code or "",
            "branch_name": o.branch_name or None,
            "product_name": o.product_name or None,
            "live_price": o.live_price,
            "original_price": o.original_price,
            "in_stock": o.in_stock,
            "scrape_status": o.scrape_status,
            "product_url": o.product_url or None,
            "raw": o.raw or {},
        })
    for i in range(0, len(rows), 250):
        db.table("scraper_price_observations").insert(rows[i:i + 250]).execute()
    return len(rows)


def finish_run(db, run_id: str, *, status: str, observed: int, errors: int, message: str) -> None:
    db.table("scraper_runs").update({
        "finished_at": now_local().isoformat(),
        "status": status,
        "rows_observed": observed,
        "error_count": errors,
        "message": message,
    }).eq("id", run_id).execute()
