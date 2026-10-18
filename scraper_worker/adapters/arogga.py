from __future__ import annotations

import json
import re

import requests

from .base import ScraperAdapter, now_local, num
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings


class AroggaAdapter(ScraperAdapter):
    code = "arogga"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Referer": "https://www.arogga.com/",
    }

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        url = target.product_url or f"https://www.arogga.com/product/{target.account_sku}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=settings.request_timeout, allow_redirects=True)
            if resp.status_code == 404:
                return [PriceObservation(
                    account_code=self.code,
                    account_sku=target.account_sku,
                    observed_at=now_local(),
                    scrape_status="missing",
                    product_name=target.product_name,
                    product_url=url,
                    raw={"status_code": 404, "strategy": "direct_product_id"},
                )]
            resp.raise_for_status()
            match = re.search(
                r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
                resp.text,
                re.DOTALL | re.IGNORECASE,
            )
            if not match:
                return [PriceObservation(
                    account_code=self.code,
                    account_sku=target.account_sku,
                    observed_at=now_local(),
                    scrape_status="price_missing",
                    product_name=target.product_name,
                    product_url=resp.url,
                    raw={"strategy": "direct_product_id", "reason": "JSON-LD product block missing"},
                )]
            data = json.loads(match.group(1).strip())
            if isinstance(data, list):
                data = next((x for x in data if isinstance(x, dict) and x.get("offers")), data[0] if data else {})
            offers = data.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            live = num(offers.get("price"))
            availability = str(offers.get("availability") or "")
            in_stock = True if "InStock" in availability else (False if availability else None)
            return [PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                live_price=live,
                original_price=live,
                in_stock=in_stock,
                scrape_status="ok" if live is not None else "price_missing",
                product_name=str(data.get("name") or target.product_name),
                product_url=str(data.get("url") or resp.url or url),
                raw={"strategy": "direct_product_id", "offers": offers},
            )]
        except Exception as exc:
            return [self.error_observation(target, str(exc))]
