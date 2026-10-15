from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .models import PriceObservation
from .settings import settings

COLUMNS = [
    "account",
    "account_sku",
    "product_name",
    "expected_cpp",
    "cpp_mrp",
    "cpp_tolerance_pct",
    "cpp_mapping_status",
    "live_price",
    "original_price",
    "in_stock",
    "scrape_status",
    "branch_code",
    "branch_name",
    "product_url",
    "scraped_at",
    "raw_json",
]


def export_csv(
    account_code: str,
    checkpoint: str,
    observations: list[PriceObservation],
    output_dir: Path,
) -> Path:
    now = datetime.now(ZoneInfo(settings.timezone))
    day_dir = output_dir / now.date().isoformat()
    day_dir.mkdir(parents=True, exist_ok=True)
    path = day_dir / f"{account_code}_{checkpoint}_{now.strftime('%Y-%m-%d_%H%M%S')}.csv"

    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        for o in observations:
            target_meta = (o.raw or {}).get("_target", {}) if isinstance(o.raw, dict) else {}
            writer.writerow({
                "account": o.account_code,
                "account_sku": o.account_sku,
                "product_name": o.product_name,
                "expected_cpp": target_meta.get("expected_price", ""),
                "cpp_mrp": target_meta.get("mrp", ""),
                "cpp_tolerance_pct": target_meta.get("tolerance_pct", ""),
                "cpp_mapping_status": target_meta.get("mapping_status", ""),
                "live_price": "" if o.live_price is None else o.live_price,
                "original_price": "" if o.original_price is None else o.original_price,
                "in_stock": "" if o.in_stock is None else ("1" if o.in_stock else "0"),
                "scrape_status": o.scrape_status,
                "branch_code": o.branch_code,
                "branch_name": o.branch_name,
                "product_url": o.product_url,
                "scraped_at": o.observed_at.isoformat(),
                "raw_json": json.dumps(o.raw or {}, ensure_ascii=False, separators=(",", ":")),
            })
    return path
