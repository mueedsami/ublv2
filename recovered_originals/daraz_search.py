"""
Daraz.com.bd Multi-Keyword Product Scraper  (v2 – matches what you see)
=======================================================================
Opens the REAL search page in a browser, intercepts the XHR/fetch that
Daraz fires internally, and parses the JSON from that — so the results
match exactly what appears on screen (sale prices, ranking, badges, etc.)

Requirements:
    pip install playwright
    playwright install chromium

Usage:
    python daraz_scraper.py
    python daraz_scraper.py --keywords "toothpaste,shampoo,soap"
    python daraz_scraper.py --keywords-file keywords.txt
    python daraz_scraper.py --keywords "shampoo" --count 8 --no-headless
"""

import argparse
import csv
import json
import sys
import time
import threading
from pathlib import Path
from urllib.parse import quote_plus

# ── CONFIG ────────────────────────────────────────────────────────────────────
DEFAULT_KEYWORDS     = ["toothpaste", "shampoo", "face wash", "soap"]
PRODUCTS_PER_KEYWORD = 4
HEADLESS             = True
OUTPUT_DIR           = Path("daraz_results")
DELAY_BETWEEN_KW     = 3       # seconds between keywords
PAGE_LOAD_TIMEOUT    = 30_000  # ms
NETWORK_WAIT         = 8       # seconds to wait for XHR
# ─────────────────────────────────────────────────────────────────────────────

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _parse_items(raw_items: list, n: int, keyword: str) -> list[dict]:
    products = []
    for item in raw_items[:n]:
        url = item.get("productUrl") or item.get("itemUrl") or ""
        if url and not url.startswith("http"):
            url = "https://www.daraz.com.bd" + url
        products.append({
            "keyword":        keyword,
            "name":           (item.get("name") or "").strip(),
            "price":          item.get("price", ""),
            "original_price": item.get("originalPrice", ""),
            "discount":       item.get("discount", ""),
            "rating":         item.get("ratingScore", ""),
            "review_count":   item.get("review", ""),
            "sold":           item.get("sold", ""),
            "seller":         item.get("sellerName", ""),
            "location":       item.get("location", ""),
            "url":            url,
            "image":          item.get("image", ""),
        })
    return products


def _find_list_items(obj):
    """Recursively find the first 'listItems' list in a nested JSON blob."""
    if isinstance(obj, dict):
        if "listItems" in obj and isinstance(obj["listItems"], list):
            return obj["listItems"]
        for v in obj.values():
            r = _find_list_items(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_list_items(v)
            if r:
                return r
    return []


def scrape_keyword(page, keyword: str, n: int) -> list[dict]:
    captured: list[dict] = []
    event = threading.Event()

    # ── Strategy 1: intercept the XHR Daraz fires when the page loads ────────
    def handle_response(response):
        if event.is_set():
            return
        url = response.url
        if ("catalog" in url or "search" in url) and "ajax=true" in url:
            try:
                body = response.json()
                items = _find_list_items(body)
                if items:
                    captured.extend(_parse_items(items, n, keyword))
                    event.set()
            except Exception:
                pass

    page.on("response", handle_response)

    search_url = f"https://www.daraz.com.bd/catalog/?q={quote_plus(keyword)}"
    page.goto(search_url, timeout=PAGE_LOAD_TIMEOUT, wait_until="domcontentloaded")
    event.wait(timeout=NETWORK_WAIT)
    page.remove_listener("response", handle_response)

    if captured:
        print(f"   ✅  {len(captured)} products via XHR intercept")
        return captured

    # ── Strategy 2: __NEXT_DATA__ / window globals ────────────────────────────
    print("   ⚠️  XHR not captured, trying embedded page data …")
    time.sleep(2)
    try:
        nd = page.evaluate("() => window.__NEXT_DATA__ || null")
        if nd:
            items = _find_list_items(nd)
            if items:
                products = _parse_items(items, n, keyword)
                print(f"   ✅  {len(products)} products via __NEXT_DATA__")
                return products

        for varname in ("__pageData__", "pageData", "g_page_config"):
            try:
                pd = page.evaluate(f"() => window['{varname}'] || null")
                if pd:
                    items = _find_list_items(pd)
                    if items:
                        products = _parse_items(items, n, keyword)
                        print(f"   ✅  {len(products)} products via window.{varname}")
                        return products
            except Exception:
                pass
    except Exception as e:
        print(f"   ⚠️  Embedded data error: {e}")

    # ── Strategy 3: DOM scraping ──────────────────────────────────────────────
    print("   ⚠️  Falling back to DOM scraping …")
    try:
        page.wait_for_selector('[data-qa-locator="product-item"]', timeout=10_000)
    except Exception:
        pass

    cards = page.query_selector_all('[data-qa-locator="product-item"]') or \
            page.query_selector_all(".Bm3ON")

    products = []
    for card in cards[:n]:
        try:
            def txt(sel):
                el = card.query_selector(sel)
                return el.inner_text().strip() if el else ""
            def attr(sel, a):
                el = card.query_selector(sel)
                return el.get_attribute(a) if el else ""

            name   = txt(".RfADt") or txt("[class*='title']") or txt("h2") or txt("h3")
            price  = txt(".aBrP0") or txt("[class*='price']")
            orig   = txt(".WNoq3") or txt("[class*='original']")
            disc   = txt(".IcOsH") or txt("[class*='discount']")
            rating = txt(".WClC0") or txt("[class*='rating']")
            sold   = txt("[class*='sold']")
            link   = attr("a", "href") or ""
            img    = attr("img", "src") or attr("img", "data-src") or ""
            if link and not link.startswith("http"):
                link = "https://www.daraz.com.bd" + link

            products.append({
                "keyword": keyword, "name": name,
                "price": price, "original_price": orig, "discount": disc,
                "rating": rating, "review_count": "", "sold": sold,
                "seller": "", "location": "", "url": link, "image": img,
            })
        except Exception as e:
            print(f"   ⚠️  Card error: {e}")

    print(f"   {'✅' if products else '❌'}  {len(products)} products via DOM")
    return products


def scrape_daraz(keywords: list[str], n: int, headless: bool) -> dict[str, list[dict]]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("❌  Playwright not installed.\n    pip install playwright && playwright install chromium")
        sys.exit(1)

    results: dict[str, list[dict]] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 900}, locale="en-US")
        page = context.new_page()

        for i, keyword in enumerate(keywords):
            print(f"\n🔍  [{i+1}/{len(keywords)}]  '{keyword}'")
            results[keyword] = scrape_keyword(page, keyword, n)
            if i < len(keywords) - 1:
                time.sleep(DELAY_BETWEEN_KW)

        page.close()
        browser.close()

    return results


def save_results(results: dict[str, list[dict]], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    json_path = output_dir / "results.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n💾  JSON → {json_path}")

    all_products = [p for prods in results.values() for p in prods]
    if all_products:
        csv_path = output_dir / "results.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(all_products[0].keys()))
            writer.writeheader()
            writer.writerows(all_products)
        print(f"💾  CSV  → {csv_path}")

    print("\n" + "═" * 64)
    for keyword, products in results.items():
        print(f"\n📦  {keyword.upper()}  ({len(products)} products)")
        for i, p in enumerate(products, 1):
            disc = f"  [{p['discount']}]" if p.get("discount") else ""
            orig = f"  (was {p['original_price']})" if p.get("original_price") else ""
            print(f"  {i}. {p['name'][:65]}")
            print(f"     ৳{p['price']}{orig}{disc}  |  ⭐ {p['rating']}  |  Sold: {p['sold']}")
            print(f"     {p['url'][:75]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Daraz.com.bd scraper – matches what you see on screen")
    parser.add_argument("--keywords",      "-k", default="")
    parser.add_argument("--keywords-file", "-f", default="")
    parser.add_argument("--output",        "-o", default=str(OUTPUT_DIR))
    parser.add_argument("--count",         "-n", type=int, default=PRODUCTS_PER_KEYWORD)
    parser.add_argument("--no-headless", action="store_true")
    args = parser.parse_args()

    if args.keywords_file:
        p = Path(args.keywords_file)
        if not p.exists():
            print(f"❌  File not found: {p}"); sys.exit(1)
        keywords = [l.strip() for l in p.read_text().splitlines() if l.strip()]
    elif args.keywords:
        keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    else:
        keywords = DEFAULT_KEYWORDS

    headless = HEADLESS and not args.no_headless
    print(f"🛒  Daraz Scraper v2  |  {len(keywords)} keyword(s)  |  {args.count} products each")
    print(f"   Keywords : {', '.join(keywords)}")
    print(f"   Headless : {headless}")

    results = scrape_daraz(keywords, n=args.count, headless=headless)
    save_results(results, Path(args.output))
    print("\n✅  Done!")


if __name__ == "__main__":
    main()
