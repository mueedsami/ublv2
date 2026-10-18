from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import requests

from .base import ScraperAdapter, now_local, num, norm
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings


class ShajgojAdapter(ScraperAdapter):
    code = "shajgoj"
    base_url = "https://shop.shajgoj.com"
    search_url = "https://khoj.shajgoj.com/products"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://shop.shajgoj.com/",
    }

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(self.headers)
        self.cache_path = Path(__file__).resolve().parent.parent / "shajgoj_slug_map.json"
        self.slug_map = self._load_slug_map()
        self.build_id: str | None = None

    def _load_slug_map(self) -> dict[str, str]:
        try:
            if self.cache_path.exists():
                data = json.loads(self.cache_path.read_text(encoding="utf-8"))
                return {str(k): str(v) for k, v in data.items() if str(v).strip()}
        except Exception:
            pass
        return {}

    def _save_slug_map(self) -> None:
        try:
            self.cache_path.write_text(json.dumps(dict(sorted(self.slug_map.items())), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except Exception:
            pass

    def _search(self, query: str) -> list[dict]:
        resp = self.session.get(
            self.search_url,
            params={"s": query, "facet": "true", "per_page": 50},
            timeout=settings.request_timeout,
        )
        resp.raise_for_status()
        return resp.json().get("hits", []) or []

    def _from_hit(self, target: ScrapeTarget, hit: dict, strategy: str) -> PriceObservation:
        regular = num(hit.get("price"))
        sale = num(hit.get("sale_price"))
        live = sale if hit.get("has_sale") and sale is not None else regular
        slug = str(hit.get("slug") or "")
        stock = num(hit.get("stock"))
        if slug:
            self.slug_map[target.account_sku] = slug
            self._save_slug_map()
        return PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            live_price=live,
            original_price=regular or live,
            in_stock=(stock > 0) if stock is not None else None,
            scrape_status="ok" if live is not None else "price_missing",
            product_name=str(hit.get("name") or target.product_name),
            product_url=f"{self.base_url}/product/{slug}" if slug else target.product_url,
            raw={"strategy": strategy, "source": hit},
        )

    def _get_build_id(self) -> str | None:
        if self.build_id:
            return self.build_id
        try:
            resp = self.session.get(self.base_url, timeout=settings.request_timeout)
            match = re.search(r'"buildId"\s*:\s*"([^"]+)"', resp.text)
            if match:
                self.build_id = match.group(1)
        except Exception:
            pass
        return self.build_id

    @staticmethod
    def _slugify(value: str) -> str:
        text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
        text = text.replace("&", " ").replace("+", " ")
        text = re.sub(r"^\s*\[?\d+\]?\s*", "", text)
        text = re.sub(r"[^A-Za-z0-9]+", "-", text)
        return re.sub(r"-+", "-", text).strip("-").lower()

    def _slug_candidates(self, target: ScrapeTarget) -> list[str]:
        out: list[str] = []
        def add(v: str):
            v = str(v or "").strip().strip("/")
            if v and v not in out:
                out.append(v)
        add(self.slug_map.get(target.account_sku, ""))
        base = self._slugify(target.product_name or target.basepack_name)
        add(base)
        if base:
            add(base + "-2")
        return out

    def _next_product(self, slug: str) -> dict | None:
        build_id = self._get_build_id()
        if not build_id:
            return None
        url = f"{self.base_url}/_next/data/{build_id}/product/{slug}.json?productId={slug}"
        try:
            resp = self.session.get(url, timeout=settings.request_timeout)
            if resp.status_code != 200:
                return None
            return (resp.json().get("pageProps") or {}).get("product") or None
        except Exception:
            return None

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        queries = [q for q in [target.account_sku, target.product_name] if q]
        seen = set()
        for query in queries:
            if query in seen:
                continue
            seen.add(query)
            try:
                hits = self._search(query)
            except Exception:
                hits = []
            match = next((h for h in hits if str(h.get("product_sku") or h.get("sku") or "").strip() == target.account_sku), None)
            if match:
                return [self._from_hit(target, match, "khoj_exact_sku")]

        for slug in self._slug_candidates(target):
            product = self._next_product(slug)
            if not product:
                continue
            product_skus = {str(product.get("product_sku") or "").strip(), str(product.get("sku") or "").strip()}
            for group in product.get("product_groups", []) or []:
                for row in group.get("skus", []) or []:
                    product_skus.add(str(row.get("sku") or "").strip())
            if target.account_sku not in product_skus:
                if target.product_name and norm(target.product_name) not in norm(product.get("name")) and norm(product.get("name")) not in norm(target.product_name):
                    continue
            regular = num(product.get("price"))
            sale = num(product.get("sale_price"))
            live = sale if product.get("has_sale") and sale is not None else regular
            stock = num(product.get("stock"))
            if slug:
                self.slug_map[target.account_sku] = slug
                self._save_slug_map()
            return [PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                live_price=live,
                original_price=regular or live,
                in_stock=(stock > 0) if stock is not None else None,
                scrape_status="ok" if live is not None else "price_missing",
                product_name=str(product.get("name") or target.product_name),
                product_url=f"{self.base_url}/product/{slug}",
                raw={"strategy": "next_data_slug", "slug": slug, "source": product},
            )]

        return [PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            scrape_status="missing",
            product_name=target.product_name,
            product_url=target.product_url,
            raw={"queries": queries, "slug_candidates": self._slug_candidates(target)},
        )]
