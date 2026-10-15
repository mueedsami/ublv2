"""
Othoba.com Multi-Keyword Product Scraper
========================================
Requirements:
    pip install requests beautifulsoup4 brotli

Usage:
    python othoba_scraper.py
    python othoba_scraper.py --keywords "toothpaste,shampoo,soap,lotion"
    python othoba_scraper.py --keywords-file keywords.txt --count 4
"""

import argparse
import csv
import io
import json
import re
import sys
import time
import zlib
from pathlib import Path
from urllib.parse import quote_plus

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("❌  Run: pip install requests beautifulsoup4 brotli")
    sys.exit(1)

# ── CONFIG ────────────────────────────────────────────────────────────────────
DEFAULT_KEYWORDS     = ["toothpaste", "shampoo", "face wash", "soap"]
PRODUCTS_PER_KEYWORD = 4
OUTPUT_DIR           = Path("othoba_results")
DELAY_BETWEEN_KW     = 2
# ─────────────────────────────────────────────────────────────────────────────

# No Accept-Encoding — let requests/urllib3 handle decompression automatically
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
}


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get("https://othoba.com/", timeout=15)
    except Exception:
        pass
    return s


def decode_response(resp: requests.Response) -> str:
    """Safely decode response — handles gzip/brotli/plain automatically."""
    # Try resp.text first (urllib3 usually decompresses correctly)
    try:
        text = resp.text
        if text.strip().startswith("<"):
            return text
    except Exception:
        pass

    # Manual fallback: decompress raw bytes
    raw = resp.content
    encoding = resp.headers.get("Content-Encoding", "").lower()

    if "br" in encoding:
        try:
            import brotli
            return brotli.decompress(raw).decode("utf-8", errors="replace")
        except Exception:
            pass

    if "gzip" in encoding:
        try:
            import gzip
            return gzip.decompress(raw).decode("utf-8", errors="replace")
        except Exception:
            pass

    if "deflate" in encoding:
        try:
            return zlib.decompress(raw).decode("utf-8", errors="replace")
        except Exception:
            try:
                return zlib.decompress(raw, -zlib.MAX_WBITS).decode("utf-8", errors="replace")
            except Exception:
                pass

    # Last resort: try to decode as-is
    return raw.decode("utf-8", errors="replace")


def clean_price(text: str) -> str:
    return re.sub(r"[^\d.,]", "", text).strip()


def scrape_keyword(session: requests.Session, keyword: str, n: int) -> list[dict]:
    url = f"https://othoba.com/ts/search/{quote_plus(keyword)}?t=t&q={quote_plus(keyword)}"
    print(f"   URL: {url}")

    try:
        resp = session.get(url, timeout=20, headers={"Referer": "https://othoba.com/"})
        resp.raise_for_status()
    except Exception as e:
        print(f"   ❌  Request failed: {e}")
        return []

    html = decode_response(resp)

    if "<html" not in html[:500] and "<!DOCTYPE" not in html[:500]:
        print(f"   ❌  Not valid HTML. Encoding: {resp.headers.get('Content-Encoding')} | Start: {repr(html[:80])}")
        return []

    soup = BeautifulSoup(html, "html.parser")

    products = []

    # ── The definitive selector ───────────────────────────────────────────────
    # Product cards:   <div class="item-box"> ... <h4 class="product-name"><a href="/slug">Name</a></h4>
    # Nav menu items:  <h4><a href="/slug">Category</a></h4>  ← NO class on h4
    #
    # So: ONLY select h4 tags that have class="product-name" — this skips nav entirely.

    for h4 in soup.select("h4.product-name"):
        a = h4.find("a")
        if not a:
            continue

        href = a.get("href", "")
        name = a.get_text(strip=True)
        url_full = ("https://othoba.com" + href) if href.startswith("/") else href

        # Walk up to .item-box for price/rating
        card = h4.find_parent(class_="item-box") or h4.find_parent(class_="product-item") or h4.parent

        price = old_price = rating = reviews = free_delivery = ""
        if card:
            pe  = card.select_one(".actual-price")
            oe  = card.select_one(".old-price")
            re_ = card.select_one(".rating-wrapper .rating")
            rv  = card.select_one(".rating-review")
            fd  = card.select_one(".free-shipping, [class*='free']")

            price        = clean_price(pe.get_text()) if pe else ""
            old_price    = clean_price(oe.get_text()) if oe else ""
            # rating stored as CSS width% e.g. style="width:80%" → 4.0/5
            if re_:
                style = re_.get("style", "")
                m = re.search(r"width\s*:\s*([\d.]+)%", style)
                rating = f"{float(m.group(1))/20:.1f}" if m else ""
            reviews      = rv.get_text(strip=True).strip("()") if rv else ""
            free_delivery = "Yes" if fd else ""

        if name:
            products.append({
                "keyword":        keyword,
                "name":           name,
                "price":          price,
                "original_price": old_price,
                "rating":         rating,
                "review_count":   reviews,
                "free_delivery":  free_delivery,
                "url":            url_full,
            })

        if len(products) >= n:
            break

    if products:
        print(f"   ✅  {len(products)} products")
    else:
        print(f"   ❌  0 products")
        print(f"        h4.product-name found : {len(soup.select('h4.product-name'))}")
        print(f"        item-box found         : {len(soup.select('.item-box'))}")
        print(f"        page title             : {soup.title.string if soup.title else 'N/A'}")
        body = soup.body
        print(f"        body text snippet      : {body.get_text()[:200].strip() if body else 'no body'}")

    return products


def scrape_othoba(keywords: list[str], n: int) -> dict[str, list[dict]]:
    session = make_session()
    results = {}
    for i, keyword in enumerate(keywords):
        print(f"\n🔍  [{i+1}/{len(keywords)}]  '{keyword}'")
        results[keyword] = scrape_keyword(session, keyword, n)
        if i < len(keywords) - 1:
            time.sleep(DELAY_BETWEEN_KW)
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
            orig = f"  (was ৳{p['original_price']})" if p.get("original_price") else ""
            fd   = "  🚚 Free delivery" if p.get("free_delivery") else ""
            print(f"  {i}. {p['name'][:65]}")
            print(f"     ৳{p['price']}{orig}  |  ⭐ {p['rating']}  |  Reviews: {p['review_count']}{fd}")
            print(f"     {p['url'][:80]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Othoba.com multi-keyword scraper")
    parser.add_argument("--keywords",      "-k", default="")
    parser.add_argument("--keywords-file", "-f", default="")
    parser.add_argument("--output",        "-o", default=str(OUTPUT_DIR))
    parser.add_argument("--count",         "-n", type=int, default=PRODUCTS_PER_KEYWORD)
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

    print(f"🛒  Othoba Scraper  |  {len(keywords)} keyword(s)  |  {args.count} products each")
    print(f"   Keywords: {', '.join(keywords)}")

    results = scrape_othoba(keywords, n=args.count)
    save_results(results, Path(args.output))
    print("\n✅  Done!")


if __name__ == "__main__":
    main()
