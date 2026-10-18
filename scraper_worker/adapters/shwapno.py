from __future__ import annotations

import time

import requests

from .base import ScraperAdapter, now_local, num
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings


class ShwapnoAdapter(ScraperAdapter):
    code = "shwapno"
    tag_id = "691993df43654a47ccc4a168"
    base_url = "https://www.shwapno.com"
    api_url = f"{base_url}/api/tag/products"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.shwapno.com/",
        "Origin": "https://www.shwapno.com",
    }

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(self.headers)
        self._loaded = False
        self._by_sku: dict[str, dict] = {}
        self._load_error: str | None = None

    def _fetch_page(self, page: int) -> dict:
        resp = self.session.get(
            self.api_url,
            params={"id": self.tag_id, "pageNumber": page},
            timeout=max(20, settings.request_timeout),
        )
        resp.raise_for_status()
        return resp.json()

    def _load_catalog(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            print("[shwapno] loading Unilever tag catalog...", flush=True)
            page = 1
            while True:
                data = self._fetch_page(page)
                products = data.get("products", []) or []
                print(f"[shwapno] catalog page {page}: {len(products)} product(s)", flush=True)
                for p in products:
                    sku = str(p.get("sku") or "").strip()
                    if sku:
                        self._by_sku[sku] = p
                if not data.get("hasNextPage", False):
                    break
                page += 1
                time.sleep(0.35)
            print(f"[shwapno] catalog ready: {len(self._by_sku)} SKU(s)", flush=True)
        except Exception as exc:
            self._load_error = str(exc)
            print(f"[shwapno] catalog FAILED: {exc}", flush=True)

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        self._load_catalog()
        if self._load_error and not self._by_sku:
            return [self.error_observation(target, self._load_error)]
        p = self._by_sku.get(str(target.account_sku).strip())
        if not p:
            return [PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                scrape_status="missing",
                product_name=target.product_name,
                raw={"strategy": "unilever_tag_catalog", "catalog_size": len(self._by_sku)},
            )]
        price_block = p.get("price", {}) or {}
        original = num(price_block.get("priceValue"))
        discount = num(price_block.get("discountAmountValue")) or 0.0
        live = (original - discount) if original is not None else None
        se_name = str(p.get("seName") or "")
        return [PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            live_price=live,
            original_price=original,
            in_stock=bool(p.get("allowAddToCart", False)),
            scrape_status="ok" if live is not None else "price_missing",
            product_name=str(p.get("name") or target.product_name),
            product_url=f"{self.base_url}/{se_name}" if se_name else target.product_url,
            raw={"strategy": "unilever_tag_catalog", "discount_amount": discount, "source": p},
        )]
