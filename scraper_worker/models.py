from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class ScrapeTarget:
    account_code: str
    account_sku: str
    product_name: str = ""
    product_url: str = ""
    branch_code: str = ""
    branch_name: str = ""
    basepack_id: str = ""
    basepack_name: str = ""
    brand: str = ""
    category: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PriceObservation:
    account_code: str
    account_sku: str
    observed_at: datetime
    live_price: float | None = None
    original_price: float | None = None
    in_stock: bool | None = None
    scrape_status: str = "ok"
    product_name: str = ""
    product_url: str = ""
    branch_code: str = ""
    branch_name: str = ""
    raw: dict[str, Any] = field(default_factory=dict)
