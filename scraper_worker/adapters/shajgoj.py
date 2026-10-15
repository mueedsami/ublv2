from __future__ import annotations

import requests

from .base import ScraperAdapter, now_local, num, norm
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings


class ShajgojAdapter(ScraperAdapter):
    code = "shajgoj"
    search_url = "https://khoj.shajgoj.com/products"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://shop.shajgoj.com/",
    }

    def _search(self, query: str) -> list[dict]:
        r = requests.get(
            self.search_url,
            params={"s": query, "facet": "true", "per_page": 50},
            headers=self.headers,
            timeout=settings.request_timeout,
        )
        r.raise_for_status()
        return r.json().get("hits", [])

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        queries = [q for q in [target.product_name, target.account_sku] if q]
        seen = set()
        hits: list[dict] = []
        for query in queries:
            if query in seen:
                continue
            seen.add(query)
            hits = self._search(query)
            match = next((h for h in hits if str(h.get("product_sku", "")).strip() == target.account_sku), None)
            if match:
                break
        else:
            match = None

        if not match:
            return [PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                scrape_status="missing",
                product_name=target.product_name,
                product_url=target.product_url,
                raw={"queries": queries, "hits_seen": len(hits)},
            )]

        regular = num(match.get("price"))
        sale = num(match.get("sale_price"))
        live = sale if match.get("has_sale") and sale is not None else regular
        slug = match.get("slug") or ""
        return [PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            live_price=live,
            original_price=regular,
            in_stock=(num(match.get("stock")) or 0) > 0,
            scrape_status="ok" if live is not None else "price_missing",
            product_name=str(match.get("name") or target.product_name),
            product_url=(f"https://shop.shajgoj.com/product/{slug}" if slug else target.product_url),
            raw=match,
        )]
