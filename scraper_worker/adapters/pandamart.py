from __future__ import annotations

import requests

from .base import ScraperAdapter, now_local, num
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings

# Recovered legacy Foodpanda/Pandamart vendor IDs. Current V2 has additional
# branches; their vendor IDs must be recaptured before those branches are enabled.
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

PENDING_BRANCHES = ["Mirpur_03", "Chittagong_1", "Sylhet_2", "Khulna", "Rajshahi", "Lalbagh", "DC"]
API_URL = "https://bd.fd-api.com/api/v5/graphql"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    "Referer": "https://www.foodpanda.com.bd/",
    "Origin": "https://www.foodpanda.com.bd",
    "apollographql-client-name": "web",
    "platform": "web",
    "x-pd-language-id": "1",
    "x-requested-with": "XMLHttpRequest",
}
GRAPHQL_QUERY = """
fragment ProductFields on Product {
  attributes(keys: $attributes) { key value }
  isAvailable
  name
  originalPrice
  price
  productID
  stockAmount
  vendorID
}
query getSearchProducts($attributes:[String!],$brand:String!,$config:String,$userCode:String,$globalEntityId:String,$languageCode:String!,$limit:Int!,$locale:String!,$offset:Int!,$query:String!,$vendors:[VendorInformation!]!,$verticalTypes:[String!]!) {
  searchProducts(input:{brand:$brand,config:$config,customerID:$userCode,globalEntityID:$globalEntityId,languageCode:$languageCode,limit:$limit,locale:$locale,offset:$offset,query:$query,vendors:$vendors,verticalTypes:$verticalTypes}) {
    itemCounts { total }
    products { items { payload { ...ProductFields } } }
  }
}
"""


def attr_map(payload: dict) -> dict[str, str]:
    return {str(x.get("key")): str(x.get("value") or "") for x in payload.get("attributes", []) if x.get("key")}


class PandamartAdapter(ScraperAdapter):
    code = "pandamart"

    def _search_branch(self, query: str, vendor_id: str) -> list[dict]:
        variables = {
            "attributes": ["baseContentValue", "baseUnit", "freshnessGuaranteeInDays", "maximumSalesQuantity", "minPriceLastMonth", "pricePerBaseUnit", "sku", "nutri_grade", "sugar_level"],
            "brand": "fp",
            "config": None,
            "globalEntityId": "FP_BD",
            "languageCode": "en",
            "limit": 50,
            "locale": "en_BD",
            "offset": 0,
            "query": query,
            "vendors": [{"id": vendor_id}],
            "verticalTypes": ["darkstores"],
        }
        r = requests.post(API_URL, json={"query": GRAPHQL_QUERY, "variables": variables}, headers=HEADERS, timeout=settings.request_timeout)
        r.raise_for_status()
        data = r.json()
        if data.get("errors"):
            raise RuntimeError(str(data["errors"][0].get("message") or data["errors"]))
        return (((data.get("data") or {}).get("searchProducts") or {}).get("products") or {}).get("items", [])

    def _one_branch(self, target: ScrapeTarget, branch_code: str, config: tuple[str, str, str]) -> PriceObservation:
        vendor_id, vendor_slug, branch_name = config
        query = target.product_name or target.account_sku
        items = self._search_branch(query, vendor_id)
        match = None
        for item in items:
            payload = item.get("payload") or {}
            attrs = attr_map(payload)
            keys = {str(payload.get("productID") or "").strip(), str(attrs.get("sku") or "").strip()}
            if target.account_sku in keys:
                match = payload
                break
        if not match:
            return PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                scrape_status="missing",
                product_name=target.product_name,
                branch_code=branch_code,
                branch_name=branch_name,
                raw={"query": query, "vendor_id": vendor_id, "vendor_slug": vendor_slug, "candidate_count": len(items)},
            )
        attrs = attr_map(match)
        live = num(match.get("price"))
        original = num(match.get("originalPrice")) or live
        return PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            live_price=live,
            original_price=original,
            in_stock=bool(match.get("isAvailable")),
            scrape_status="ok" if live is not None else "price_missing",
            product_name=str(match.get("name") or target.product_name),
            branch_code=branch_code,
            branch_name=branch_name,
            raw={**match, "attributes_map": attrs, "vendor_id": vendor_id, "vendor_slug": vendor_slug},
        )

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        if target.branch_code:
            config = BRANCHES.get(target.branch_code)
            if not config:
                return [self.error_observation(target, f"Pandamart vendor ID is not configured for branch {target.branch_code}")]
            return [self._one_branch(target, target.branch_code, config)]
        return [self._one_branch(target, code, config) for code, config in BRANCHES.items()]
