from __future__ import annotations

import csv
from pathlib import Path

from .models import ScrapeTarget


def load_master_targets(db, account_code: str, limit: int | None = None) -> list[ScrapeTarget]:
    q = (
        db.table("v_scraper_master_targets")
        .select("account_code,account_sku,basepack_id,basepack_name,brand,business_group,category,sub_category")
        .eq("account_code", account_code)
        .order("account_sku")
    )
    if limit:
        q = q.limit(limit)
    rows = q.execute().data or []
    return [
        ScrapeTarget(
            account_code=r["account_code"],
            account_sku=str(r["account_sku"]),
            product_name=r.get("basepack_name") or "",
            basepack_id=str(r.get("basepack_id") or ""),
            basepack_name=r.get("basepack_name") or "",
            brand=r.get("brand") or "",
            category=r.get("category") or "",
            metadata={
                "business_group": r.get("business_group"),
                "sub_category": r.get("sub_category"),
                "target_source": "master",
            },
        )
        for r in rows
    ]


def load_csv_targets(path: Path, account_code: str | None = None) -> list[ScrapeTarget]:
    targets: list[ScrapeTarget] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            code = (r.get("account_code") or account_code or "").strip().lower()
            sku = (r.get("account_sku") or r.get("sku") or "").strip()
            if not code or not sku:
                continue
            targets.append(ScrapeTarget(
                account_code=code,
                account_sku=sku,
                product_name=(r.get("product_name") or r.get("basepack") or "").strip(),
                product_url=(r.get("product_url") or r.get("url") or "").strip(),
                branch_code=(r.get("branch_code") or "").strip(),
                branch_name=(r.get("branch_name") or r.get("branch") or "").strip(),
                brand=(r.get("brand") or "").strip(),
                category=(r.get("category") or "").strip(),
                metadata={"target_source": "csv"},
            ))
    return targets


def load_cpp_targets(db, account_code: str, limit: int | None = None) -> list[ScrapeTarget]:
    q = (
        db.table("v_cpp_scrapable_targets")
        .select("reference_set_id,account_code,account_sku,basepack_id,basepack_name,product_name,brand,category,expected_price,mrp,tolerance_pct,mapping_status")
        .eq("account_code", account_code)
        .order("account_sku")
    )
    if limit:
        q = q.limit(limit)
    rows = q.execute().data or []
    return [
        ScrapeTarget(
            account_code=r["account_code"],
            account_sku=str(r["account_sku"]),
            product_name=r.get("product_name") or r.get("basepack_name") or "",
            basepack_id=str(r.get("basepack_id") or ""),
            basepack_name=r.get("basepack_name") or "",
            brand=r.get("brand") or "",
            category=r.get("category") or "",
            metadata={
                "target_source": "cpp",
                "reference_set_id": r.get("reference_set_id"),
                "expected_price": r.get("expected_price"),
                "mrp": r.get("mrp"),
                "tolerance_pct": r.get("tolerance_pct"),
                "mapping_status": r.get("mapping_status"),
            },
        )
        for r in rows
    ]
