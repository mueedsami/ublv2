from __future__ import annotations

import math
import random
import re
import threading
import time
from urllib.parse import quote_plus

import requests

from .base import ScraperAdapter, now_local, num
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings


def canonical_daraz(product_id, sku_id) -> str:
    if product_id is None or sku_id is None:
        return ""
    return f"{str(product_id).strip()}_BD-{str(sku_id).strip()}"


def target_norm(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").replace("_BD_", "_BD-").replace(" BD ", "_BD-"))


def parse_target_ids(value: str) -> tuple[str, str]:
    m = re.fullmatch(r"\s*(\d+)\s*_BD[-_](\d+)\s*", str(value or ""), flags=re.I)
    return (m.group(1), m.group(2)) if m else ("", "")


def find_list_items(obj):
    if isinstance(obj, dict):
        if isinstance(obj.get("listItems"), list):
            return obj["listItems"]
        for v in obj.values():
            r = find_list_items(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_list_items(v)
            if r:
                return r
    return []


def item_ids(item: dict) -> tuple[str, str]:
    product_id = item.get("itemId") or item.get("productId") or item.get("product_id") or ""
    sku_id = item.get("skuId") or item.get("sku_id") or ""
    return str(product_id).strip(), str(sku_id).strip()


def choose_item(items: list[dict], wanted_product_id: str, wanted_sku_id: str, wanted_full: str):
    for item in items:
        pid, sid = item_ids(item)
        if target_norm(canonical_daraz(pid, sid)) == wanted_full:
            return item, "exact_item_sku"
    if wanted_product_id:
        for item in items:
            pid, _ = item_ids(item)
            if pid == wanted_product_id:
                return item, "item_id"
    return None, ""


def slugify_product_name(value: str) -> str:
    text = str(value or "").casefold().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:140]




BASE_URL = "https://www.daraz.com.bd"
SELLER_SLUG = "unilever-bangladesh"
SHOP_URL = f"{BASE_URL}/shop/{SELLER_SLUG}/"
SELLER_API_URL = BASE_URL + "/{seller}/?ajax=true&from=wangpu&isFirstRequest={is_first}&page={page}&q=All-Products"
PRODUCTS_PER_PAGE = 40
BULK_DELAY = (1.5, 3.0)
BULK_RETRIES = 3
BULK_RETRY_BACKOFF = (2.0, 4.0)
BULK_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": SHOP_URL,
    "X-Requested-With": "XMLHttpRequest",
}


def normalize_item_url(value: str | None) -> str:
    value = str(value or "").strip()
    if value.startswith("//"):
        return "https:" + value
    if value.startswith("/"):
        return BASE_URL + value
    return value


def bulk_item_key(item: dict) -> str:
    item_id = item.get("nid") or item.get("itemId") or item.get("productId") or ""
    sku_id = item.get("skuId") or item.get("sku_id") or ""
    return target_norm(canonical_daraz(item_id, sku_id))


def normalize_href(href: str | None) -> str:
    href = str(href or "").strip()
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return "https://www.daraz.com.bd" + href
    return href


def text_first(page, selectors: list[str]) -> str:
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el:
                txt = (el.inner_text() or "").strip()
                if txt:
                    return txt
        except Exception:
            pass
    return ""


def extract_pdp(page, fallback_name: str, fallback_url: str) -> dict:
    name = text_first(page, [
        "h1.pdp-mod-product-badge-title",
        "h1[data-spm-anchor-id]",
        "h1",
    ]) or fallback_name

    live_text = text_first(page, [
        ".pdp-price_type_normal",
        ".pdp-product-price .pdp-price",
        "[class*='pdp-price_type_normal']",
        "[class*='pdp-price']",
    ])
    original_text = text_first(page, [
        ".pdp-price_type_deleted",
        "[class*='pdp-price_type_deleted']",
        "[class*='original-price']",
    ])

    body = ""
    try:
        body = page.locator("body").inner_text(timeout=2500)
    except Exception:
        pass

    if num(live_text) is None and body:
        prices = re.findall(r"(?:৳|Tk\.?|BDT)\s*([0-9][0-9,]*(?:\.\d+)?)", body, flags=re.I)
        if prices:
            live_text = prices[0]
            if len(prices) > 1:
                original_text = original_text or prices[1]

    lower_body = body.casefold()
    if "out of stock" in lower_body or "sold out" in lower_body:
        in_stock = False
    elif "add to cart" in lower_body or "buy now" in lower_body:
        in_stock = True
    else:
        in_stock = None

    return {
        "name": name,
        "live_price": num(live_text),
        "original_price": num(original_text),
        "in_stock": in_stock,
        "url": page.url or fallback_url,
        "live_text": live_text,
        "original_text": original_text,
    }


class DarazAdapter(ScraperAdapter):
    code = "daraz"

    def __init__(self):
        self._pw = None
        self._browser = None
        self._context = None
        self._page = None
        self._bulk_session = None
        self._bulk_catalog_loaded = False
        self._bulk_by_key = {}
        self._bulk_by_item_id = {}
        self._bulk_load_error = None

    def _make_bulk_session(self):
        if self._bulk_session is None:
            session = requests.Session()
            session.headers.update(BULK_HEADERS)
            try:
                session.get(SHOP_URL, timeout=settings.request_timeout)
            except Exception as exc:
                print(f"[daraz] seller-page warm-up failed; continuing: {exc}", flush=True)
            self._bulk_session = session
        return self._bulk_session

    def _fetch_bulk_page(self, page_no: int) -> dict | None:
        session = self._make_bulk_session()
        is_first = "true" if page_no == 1 else "false"
        url = SELLER_API_URL.format(seller=SELLER_SLUG, is_first=is_first, page=page_no)
        last_exc = None
        for attempt in range(1, BULK_RETRIES + 1):
            try:
                resp = session.get(url, timeout=settings.request_timeout)
                resp.raise_for_status()
                data = resp.json()
                items = data.get("mods", {}).get("listItems")
                if items is None:
                    raise ValueError("Daraz response did not contain mods.listItems")
                return data
            except Exception as exc:
                last_exc = exc
                if attempt < BULK_RETRIES:
                    wait = random.uniform(*BULK_RETRY_BACKOFF) * attempt
                    print(f"[daraz] seller page {page_no} attempt {attempt}/{BULK_RETRIES} failed: {exc}; retrying in {wait:.1f}s", flush=True)
                    time.sleep(wait)
        print(f"[daraz] seller page {page_no} failed after {BULK_RETRIES} attempts: {last_exc}", flush=True)
        return None

    def _load_bulk_catalog(self):
        if self._bulk_catalog_loaded:
            return
        self._bulk_catalog_loaded = True
        try:
            print("[daraz] loading Unilever seller catalog once via Daraz AJAX API...", flush=True)
            first = self._fetch_bulk_page(1)
            if not first:
                raise RuntimeError("could not fetch seller catalog page 1")
            total_raw = first.get("mods", {}).get("filter", {}).get("filteredQuatity", "0")
            total_products = int(total_raw) if str(total_raw).isdigit() else 0
            total_pages = math.ceil(total_products / PRODUCTS_PER_PAGE) if total_products else 1
            all_items = list(first.get("mods", {}).get("listItems", []) or [])
            print(f"[daraz] seller catalog reports {total_products or 'unknown'} products across {total_pages} page(s)", flush=True)
            failed_pages = []
            for page_no in range(2, total_pages + 1):
                time.sleep(random.uniform(*BULK_DELAY))
                data = self._fetch_bulk_page(page_no)
                if not data:
                    failed_pages.append(page_no)
                    continue
                all_items.extend(data.get("mods", {}).get("listItems", []) or [])
            for item in all_items:
                key = bulk_item_key(item)
                if key:
                    self._bulk_by_key.setdefault(key, item)
                item_id = str(item.get("nid") or item.get("itemId") or item.get("productId") or "").strip()
                if item_id:
                    self._bulk_by_item_id.setdefault(item_id, item)
            print(f"[daraz] bulk catalog ready: {len(all_items)} rows, {len(self._bulk_by_key)} exact item+SKU keys" + (f"; failed pages={failed_pages}" if failed_pages else ""), flush=True)
        except Exception as exc:
            self._bulk_load_error = str(exc)
            print(f"[daraz] bulk catalog unavailable; browser fallback will be used: {exc}", flush=True)

    def _bulk_observation(self, target: ScrapeTarget) -> PriceObservation | None:
        self._load_bulk_catalog()
        wanted = target_norm(target.account_sku)
        product_id, _ = parse_target_ids(target.account_sku)
        item = self._bulk_by_key.get(wanted)
        method = "seller_ajax_exact_item_sku"
        if item is None and product_id:
            item = self._bulk_by_item_id.get(product_id)
            method = "seller_ajax_item_id"
        if item is None:
            return None
        live = num(item.get("price"))
        original = num(item.get("originalPrice")) or live
        if live is None:
            return None
        return PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            live_price=live,
            original_price=original,
            in_stock=bool(item.get("inStock")),
            scrape_status="ok",
            product_name=str(item.get("name") or target.product_name),
            product_url=normalize_item_url(item.get("itemUrl") or item.get("productUrl")),
            raw={**item, "_resolution": {"method": method, "bulk_catalog_error": self._bulk_load_error}},
        )

    def _ensure_session(self):
        if self._page is not None:
            return self._page
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise RuntimeError("Playwright is required for Daraz: pip install playwright && playwright install chromium") from e

        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=settings.daraz_headless)
        self._context = self._browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )

        # Images/fonts/media are irrelevant for price extraction and are expensive over 341 PDPs.
        def route_handler(route):
            try:
                if route.request.resource_type in {"image", "media", "font"}:
                    route.abort()
                else:
                    route.continue_()
            except Exception:
                try:
                    route.continue_()
                except Exception:
                    pass

        self._context.route("**/*", route_handler)
        self._page = self._context.new_page()
        self._page.set_default_timeout(5000)
        self._page.set_default_navigation_timeout(max(10_000, settings.request_timeout * 1000))
        return self._page

    def close(self):
        for obj, method in (
            (self._page, "close"),
            (self._context, "close"),
            (self._browser, "close"),
        ):
            if obj is not None:
                try:
                    getattr(obj, method)()
                except Exception:
                    pass
        self._page = None
        self._context = None
        self._browser = None
        if self._bulk_session is not None:
            try:
                self._bulk_session.close()
            except Exception:
                pass
        self._bulk_session = None
        if self._pw is not None:
            try:
                self._pw.stop()
            except Exception:
                pass
        self._pw = None

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        # Fast path copied from the proven standalone scraper: fetch the seller catalog once,
        # then match all CPP targets locally. Playwright is only used for unresolved targets.
        bulk = self._bulk_observation(target)
        if bulk is not None:
            return [bulk]

        page = self._ensure_session()
        product_id, sku_id = parse_target_ids(target.account_sku)
        wanted = target_norm(target.account_sku)
        queries = []
        for q in (product_id, target.product_name, target.account_sku):
            q = str(q or "").strip()
            if q and q not in queries:
                queries.append(q)

        debug = {"target_product_id": product_id, "target_sku_id": sku_id, "queries": queries, "attempts": []}
        matched_item = None
        match_method = ""
        matched_url = ""

        # Fast path: direct PDP. Smoke testing showed this is reliable for current CPP targets.
        if product_id and target.product_name:
            direct_url = f"https://www.daraz.com.bd/products/{slugify_product_name(target.product_name)}-i{product_id}.html"
            try:
                page.goto(direct_url, timeout=max(10_000, settings.request_timeout * 1000), wait_until="domcontentloaded")
                # Wait only until a price node appears; unlike a fixed sleep this returns immediately when ready.
                try:
                    page.wait_for_selector(
                        ".pdp-price_type_normal, .pdp-product-price .pdp-price, [class*='pdp-price_type_normal'], [class*='pdp-price']",
                        state="attached",
                        timeout=2500,
                    )
                except Exception:
                    pass
                pdp = extract_pdp(page, target.product_name, direct_url)
                debug["attempts"].append({"stage": "direct_pdp", "url": page.url, "price": pdp["live_price"]})
                if pdp["live_price"] is not None:
                    return [PriceObservation(
                        account_code=self.code,
                        account_sku=target.account_sku,
                        observed_at=now_local(),
                        live_price=pdp["live_price"],
                        original_price=pdp["original_price"] or pdp["live_price"],
                        in_stock=pdp["in_stock"],
                        scrape_status="ok",
                        product_name=pdp["name"],
                        product_url=pdp["url"],
                        raw={"_resolution": {"method": "direct_item_pdp", **debug}, "pdp": pdp},
                    )]
            except Exception as exc:
                debug["attempts"].append({"stage": "direct_pdp", "error": str(exc)})

        # Fallback only when direct PDP did not expose a usable price.
        for query in queries[:3]:
            captured: list[dict] = []
            event = threading.Event()

            def handle_response(response):
                if event.is_set():
                    return
                url = response.url.lower()
                if "catalog" in url or "search" in url:
                    try:
                        body = response.json()
                        items = find_list_items(body)
                        if items:
                            captured.extend(items)
                            event.set()
                    except Exception:
                        pass

            page.on("response", handle_response)
            search_url = f"https://www.daraz.com.bd/catalog/?q={quote_plus(query)}"
            try:
                page.goto(search_url, timeout=max(10_000, settings.request_timeout * 1000), wait_until="domcontentloaded")
                event.wait(timeout=3)
            except Exception as exc:
                debug["attempts"].append({"query": query, "stage": "goto", "error": str(exc)})
            finally:
                try:
                    page.remove_listener("response", handle_response)
                except Exception:
                    pass

            item, method = choose_item(captured, product_id, sku_id, wanted)
            debug["attempts"].append({"query": query, "captured_items": len(captured), "xhr_match": method or None})
            if item:
                matched_item = item
                match_method = "xhr_" + method
                matched_url = normalize_href(item.get("productUrl") or item.get("itemUrl"))
                break

            for varname in ("__NEXT_DATA__", "g_page_config", "__pageData__", "pageData"):
                try:
                    embedded = page.evaluate(f"() => window['{varname}'] || null")
                    items = find_list_items(embedded) if embedded else []
                    item, method = choose_item(items, product_id, sku_id, wanted)
                    if item:
                        matched_item = item
                        match_method = f"embedded_{varname}_{method}"
                        matched_url = normalize_href(item.get("productUrl") or item.get("itemUrl"))
                        break
                except Exception:
                    pass
            if matched_item:
                break

            if product_id:
                try:
                    links = page.query_selector_all('a[href*="-i"]')
                    for link in links:
                        href = normalize_href(link.get_attribute("href"))
                        if re.search(rf"-i{re.escape(product_id)}(?:-|\.|\?|$)", href):
                            matched_url = href
                            match_method = "dom_item_id"
                            break
                except Exception:
                    pass
            if matched_url:
                break

        if matched_item:
            live = num(matched_item.get("price"))
            original = num(matched_item.get("originalPrice")) or live
            href = matched_url or normalize_href(matched_item.get("productUrl") or matched_item.get("itemUrl"))
            if live is not None:
                raw = dict(matched_item)
                raw["_resolution"] = {"method": match_method, **debug}
                return [PriceObservation(
                    account_code=self.code,
                    account_sku=target.account_sku,
                    observed_at=now_local(),
                    live_price=live,
                    original_price=original,
                    in_stock=True,
                    scrape_status="ok",
                    product_name=str(matched_item.get("name") or target.product_name),
                    product_url=href or "",
                    raw=raw,
                )]

        if matched_url:
            try:
                page.goto(matched_url, timeout=max(10_000, settings.request_timeout * 1000), wait_until="domcontentloaded")
                try:
                    page.wait_for_selector(
                        ".pdp-price_type_normal, .pdp-product-price .pdp-price, [class*='pdp-price_type_normal'], [class*='pdp-price']",
                        state="attached",
                        timeout=2500,
                    )
                except Exception:
                    pass
                pdp = extract_pdp(page, target.product_name, matched_url)
                debug["pdp_url"] = pdp["url"]
                if pdp["live_price"] is not None:
                    return [PriceObservation(
                        account_code=self.code,
                        account_sku=target.account_sku,
                        observed_at=now_local(),
                        live_price=pdp["live_price"],
                        original_price=pdp["original_price"] or pdp["live_price"],
                        in_stock=pdp["in_stock"],
                        scrape_status="ok",
                        product_name=pdp["name"],
                        product_url=pdp["url"],
                        raw={"_resolution": {"method": match_method + "_pdp", **debug}, "pdp": pdp},
                    )]
            except Exception as exc:
                debug["pdp_error"] = str(exc)

        return [PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            scrape_status="missing",
            product_name=target.product_name,
            product_url=target.product_url,
            raw={"_resolution": debug},
        )]
