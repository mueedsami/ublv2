from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from zoneinfo import ZoneInfo
import re
from typing import Any

from ..models import PriceObservation, ScrapeTarget
from ..settings import settings


def now_local() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


def num(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[^0-9.\-]", "", str(value).replace(",", ""))
    if text in {"", ".", "-"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


class ScraperAdapter(ABC):
    code: str
    ready: bool = True

    @abstractmethod
    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        raise NotImplementedError

    def error_observation(self, target: ScrapeTarget, message: str) -> PriceObservation:
        return PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            scrape_status="error",
            product_name=target.product_name,
            product_url=target.product_url,
            branch_code=target.branch_code,
            branch_name=target.branch_name,
            raw={"error": message},
        )
