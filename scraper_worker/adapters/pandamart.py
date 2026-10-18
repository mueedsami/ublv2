from __future__ import annotations

import requests

from .base import ScraperAdapter, now_local, num
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings

BRANCHES = {
    "Bashundhara": ("h5rj", "pandamart-bashundhara", "Bashundhara"),
    "Dhanmondi": ("ta7z", "pandamart-dhanmondi", "Dhanmondi"),
    "Gulshan_1": ("vbpl", "pandamart-gulshan-banani", "Gulshan 1"),
    "Gulshan_2": ("w2lx", "pandamart-gulshan-niketon", "Gulshan 2"),
    "Mirpur_02": ("kx59", "pandamart-mirpur-zoo-road", "Mirpur 02"),
    "Mogbazar": ("v1ts", "pandamart-mogbazar", "Mogbazar"),
    "Mohammadpur": ("bbus", "pandamart-mohammadpur", "Mohammadpur"),
    "Rampura": ("mfg7", "pandamart-rampura", "Rampura"),
    "Uttara": ("n7ph", "pandamart-uttara", "Uttara"),
    "Wari": ("zj9s", "pandamart-wari", "Wari"),
}

GRAPHQL_URL = "https://bd.fd-api.com/api/v5/graphql"
UNILEVER_CATEGORY_ID = "2fba527b-09e7-4f1b-9249-d5ac328aabae"
HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Origin": "https://www.foodpanda.com.bd",
    "Referer": "https://www.foodpanda.com.bd/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36",
    "x-fp-api-key": "volo",
    "x-pd-language-id": "6",
}
GQL_QUERY = """
fragment ProductFields on Product {
  attributes(keys: ["sku", "baseUnit"]) { key value }
  activeCampaigns { discountType discountValue endTime name type }
  isAvailable
  name
  originalPrice
  price
  productID
  stockAmount
  urls
  vendorID
}
query getProductsByCategoryList($categoryId: String!, $globalEntityId: String!, $isDarkstore: Boolean!, $locale: String!, $vendorID: String!) {
  categoryProductList(input: {categoryID: $categoryId, globalEntityID: $globalEntityId, isDarkstore: $isDarkstore, locale: $locale, platform: "web", vendorID: $vendorID}) {
    categoryProducts { id name items { ...ProductFields } }
  }
}
"""


def _attr(product: dict, key: str) -> str:
    for attr in product.get("attributes", []) or []:
        if attr.get("key") == key:
            return str(attr.get("value") or "")
    return ""


class PandamartAdapter(ScraperAdapter):
    code = "pandamart"

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self._branch_cache: dict[str, dict[str, dict]] = {}
        self._branch_errors: dict[str, str] = {}

    def _load_branch(self, branch_code: str) -> dict[str, dict]:
        if branch_code in self._branch_cache:
            return self._branch_cache[branch_code]
        if branch_code in self._branch_errors:
            return {}
        config = BRANCHES[branch_code]
        vendor_id = config[0]
        branch_name = config[2]
        print(f"[pandamart] loading branch catalog: {branch_name} ({vendor_id})...", flush=True)
        try:
            resp = self.session.post(
                GRAPHQL_URL,
                json={"query": GQL_QUERY, "variables": {
                    "categoryId": UNILEVER_CATEGORY_ID,
                    "globalEntityId": "FP_BD",
                    "isDarkstore": True,
                    "locale": "en_BD",
                    "vendorID": vendor_id,
                }},
                timeout=max(20, settings.request_timeout),
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("errors"):
                raise RuntimeError(str(data["errors"]))
            categories = (((data.get("data") or {}).get("categoryProductList") or {}).get("categoryProducts") or [])
            products = [p for cat in categories for p in (cat.get("items") or [])]
            cache = {_attr(p, "sku").strip(): p for p in products if _attr(p, "sku").strip()}
            self._branch_cache[branch_code] = cache
            print(f"[pandamart] branch ready: {branch_name} | {len(cache)} SKU(s)", flush=True)
            return cache
        except Exception as exc:
            self._branch_errors[branch_code] = str(exc)
            print(f"[pandamart] branch FAILED: {branch_name} | {exc}", flush=True)
            return {}

    def _one_branch(self, target: ScrapeTarget, branch_code: str) -> PriceObservation:
        vendor_id, vendor_slug, branch_name = BRANCHES[branch_code]
        cache = self._load_branch(branch_code)
        if branch_code in self._branch_errors and not cache:
            obs = self.error_observation(target, self._branch_errors[branch_code])
            obs.branch_code = branch_code
            obs.branch_name = branch_name
            return obs
        p = cache.get(str(target.account_sku).strip())
        if not p:
            return PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                scrape_status="missing",
                product_name=target.product_name,
                branch_code=branch_code,
                branch_name=branch_name,
                raw={"strategy": "unilever_category_catalog", "vendor_id": vendor_id, "catalog_size": len(cache)},
            )
        live = num(p.get("price"))
        original = num(p.get("originalPrice")) or live
        stock = num(p.get("stockAmount"))
        available = bool(p.get("isAvailable", False)) and (stock is None or stock > 0)
        product_id = str(p.get("productID") or "")
        url = f"https://www.foodpanda.com.bd/darkstore/{vendor_id}/{vendor_slug}/product/{product_id}" if product_id else ""
        return PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            live_price=live,
            original_price=original,
            in_stock=available,
            scrape_status="ok" if live is not None else "price_missing",
            product_name=str(p.get("name") or target.product_name),
            product_url=url,
            branch_code=branch_code,
            branch_name=branch_name,
            raw={"strategy": "unilever_category_catalog", "vendor_id": vendor_id, "stock_amount": stock, "source": p},
        )

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        if target.branch_code:
            if target.branch_code not in BRANCHES:
                return [self.error_observation(target, f"Pandamart vendor ID not configured for {target.branch_code}")]
            return [self._one_branch(target, target.branch_code)]
        return [self._one_branch(target, branch_code) for branch_code in BRANCHES]
