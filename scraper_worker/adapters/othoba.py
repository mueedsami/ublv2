from __future__ import annotations

import re
import time

import requests
from bs4 import BeautifulSoup

from .base import ScraperAdapter, now_local, num
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings


def normalize_othoba_key(value) -> str:
    text = str(value or "").upper().strip()
    digits = re.sub(r"\D+", "", text)
    if digits:
        return digits.lstrip("0") or "0"
    return re.sub(r"[^A-Z0-9]+", "", text)


class OthobaAdapter(ScraperAdapter):
    code = "othoba"
    base_url = "https://othoba.com"
    store_url = "https://othoba.com/unilever-flagship-store"
    page_size = 80
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://othoba.com/",
    }

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(self.headers)
        self._catalog_loaded = False
        self._catalog: dict[str, dict] = {}
        self._catalog_error: str | None = None

    def _load_catalog(self) -> None:
        if self._catalog_loaded:
            return
        self._catalog_loaded = True
        try:
            print("[othoba] loading Unilever flagship-store catalog...", flush=True)
            page = 1
            while True:
                resp = self.session.get(
                    self.store_url,
                    params={"pagesize": self.page_size, "pagenumber": page},
                    timeout=max(20, settings.request_timeout),
                )
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")
                items = []
                for a in soup.select("h4 a[href]"):
                    href = str(a.get("href") or "")
                    name = a.get_text(" ", strip=True)
                    match = re.search(r"-(\d+)$", href.strip("/"))
                    if not match:
                        continue
                    product_id = match.group(1)
                    url = self.base_url + href if href.startswith("/") else href
                    items.append((product_id, name, url))
                if not items:
                    break
                print(f"[othoba] catalog page {page}: {len(items)} product(s)", flush=True)
                for product_id, name, url in items:
                    self._catalog[normalize_othoba_key(product_id)] = {"product_id": product_id, "name": name, "url": url}
                next_btn = soup.select_one("a.next-page, li.next a, .pager .next a")
                if not next_btn and len(items) < self.page_size:
                    break
                page += 1
                time.sleep(0.35)
            print(f"[othoba] catalog ready: {len(self._catalog)} product(s)", flush=True)
        except Exception as exc:
            self._catalog_error = str(exc)
            print(f"[othoba] catalog FAILED: {exc}", flush=True)

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        self._load_catalog()
        if self._catalog_error and not self._catalog:
            return [self.error_observation(target, self._catalog_error)]
        key = normalize_othoba_key(target.account_sku)
        product = self._catalog.get(key)
        if not product:
            return [PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                scrape_status="missing",
                product_name=target.product_name,
                raw={"strategy": "flagship_store_numeric_id", "match_key": key, "catalog_size": len(self._catalog)},
            )]
        try:
            resp = self.session.get(product["url"], timeout=max(20, settings.request_timeout))
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            price_el = soup.select_one("span.price.actual-price") or soup.select_one('[itemprop="price"]') or soup.select_one("span.product-price") or soup.select_one(".price-value")
            old_el = soup.select_one("span.old-product-price") or soup.select_one("span.non-discounted-price") or soup.select_one(".old-price")
            live = num(price_el.get_text(" ", strip=True) if price_el else None)
            original = num(old_el.get_text(" ", strip=True) if old_el else None) or live
            sold_out = False
            sold_out_tag = soup.select_one(".sold-out-tag, .soldout-tag, [class*='sold-out']")
            if sold_out_tag is not None:
                style = str(sold_out_tag.get("style") or "").lower().replace(" ", "")
                sold_out = not ("visibility:hidden" in style or "display:none" in style)
            if not sold_out:
                for selector in [".stock", '[itemprop="availability"]', ".availability", ".stock-availability"]:
                    el = soup.select_one(selector)
                    if el and any(x in el.get_text(" ", strip=True).casefold() for x in ["out of stock", "sold out", "unavailable"]):
                        sold_out = True
                        break
            if not sold_out:
                add_btn = soup.select_one("button#add-to-cart-button, .add-to-cart button")
                if add_btn is not None and add_btn.get("disabled"):
                    sold_out = True
            return [PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                live_price=live,
                original_price=original,
                in_stock=not sold_out,
                scrape_status="ok" if live is not None else "price_missing",
                product_name=product["name"] or target.product_name,
                product_url=product["url"],
                raw={"strategy": "flagship_store_numeric_id", "match_key": key, "product_id": product["product_id"]},
            )]
        except Exception as exc:
            return [self.error_observation(target, str(exc))]
