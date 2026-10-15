"""
Shajgoj Search Visibility Scraper
===================================
For each keyword, fetches search results from khoj.shajgoj.com
and records which products appear and at what rank position.

Output: One Excel with:
  - Summary sheet: keyword × result count
  - One sheet per keyword: Rank | Name | SKU | Brand | Price | Stock | URL

Install:  pip install requests openpyxl
Run:      python shajgoj_search_scraper.py
"""

import argparse
from pathlib import Path

import requests
import time
import random
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ── KEYWORDS ──────────────────────────────────────────────────────────────────
# Default keywords are generated from search_keywords.csv.
# You can also pass a keyword file at runtime:
#   python script.py --keywords-file keywords_flat.txt --count 4
DEFAULT_KEYWORDS = [
    'soap',
    'bar soap',
    'barsoap',
    'bar',
    'body wash',
    'bodywash',
    'shower gel',
    'conditioner',
    'condi',
    'detergent',
    'detergent powder',
    'washing powder',
    'detergent liquid',
    'detergent bar',
    'dishwash bar',
    'dishwasher bar',
    'dishwash liquid',
    'dishwash powder',
    'facewash',
    'face wash',
    'face cream',
    'moisturizer',
    'moisturiser',
    'lotion',
    'handwash',
    'hand wash',
    'shampoo',
    'hair mask',
    'hair serum',
    'sunscreen',
    'toilet cleaner',
    'toothpaste',
    'tooth paste',
    'toothpowder',
    'tooth powder',
    'petroleum jelly',
    'vaseline'
]


def load_keywords(keywords_file: str = "keywords_flat.txt", keywords_arg: str = "") -> list[str]:
    if keywords_arg:
        return [k.strip() for k in keywords_arg.split(",") if k.strip()]

    if keywords_file:
        p = Path(keywords_file)
        if p.exists():
            return [line.strip() for line in p.read_text(encoding="utf-8-sig").splitlines() if line.strip()]

    return DEFAULT_KEYWORDS

# ── Config ────────────────────────────────────────────────────────────────────
SEARCH_URL  = "https://khoj.shajgoj.com/products"
RESULTS_PER = 40
DELAY       = (0.3, 0.6)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept":     "application/json",
    "Referer":    "https://shop.shajgoj.com/",
}

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
XLSX_FILE = f"shajgoj_search_{timestamp}.xlsx"

# ── STYLES ────────────────────────────────────────────────────────────────────
HDR_FILL  = PatternFill("solid", fgColor="1F3864")
HDR_FONT  = Font(bold=True, color="FFFFFF", size=10, name="Arial")
GREY_FILL = PatternFill("solid", fgColor="F2F2F2")
NO_FILL   = PatternFill(fill_type=None)
GRN_FILL  = PatternFill("solid", fgColor="C6EFCE")
RED_FILL  = PatternFill("solid", fgColor="FFC7CE")
STD_FONT  = Font(size=10, name="Arial")
CTR       = Alignment(horizontal="center", vertical="center")
MID       = Alignment(vertical="center")
thin      = Side(style="thin", color="CCCCCC")
BORDER    = Border(left=thin, right=thin, top=thin, bottom=thin)

# ── SEARCH ────────────────────────────────────────────────────────────────────
def search_keyword(keyword):
    params = {"s": keyword, "facet": "true", "per_page": RESULTS_PER}
    try:
        r = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return [], f"HTTP {r.status_code}"
        data  = r.json()
        hits  = data.get("hits", [])
        total = data.get("numFound", 0)
        results = []
        for rank, hit in enumerate(hits[:RESULTS_PER], 1):
            slug  = hit.get("slug", "")
            stock = hit.get("stock", 0) or 0
            # Brand from brand_id list (just the id, no name available in search)
            brand_ids = hit.get("brand_id", [])
            brand = brand_ids[0] if brand_ids else ""
            results.append({
                "rank":   rank,
                "name":   hit.get("name", ""),
                "sku":    str(hit.get("product_sku", "")),
                "size":   hit.get("size", ""),
                "price":  hit.get("price", ""),
                "sale_price": hit.get("sale_price", ""),
                "has_sale":   hit.get("has_sale", False),
                "stock":  stock,
                "ola":    1 if stock > 0 else 0,
                "rating": hit.get("average_rating", ""),
                "url":    f"https://shop.shajgoj.com/product/{slug}" if slug else "",
            })
        return results, total
    except Exception as e:
        return [], str(e)

# ── WRITE SHEET ───────────────────────────────────────────────────────────────
def write_sheet(wb, keyword, results, total):
    ws = wb.create_sheet(title=keyword[:31])

    # Title
    ws.merge_cells("A1:I1")
    t = ws.cell(row=1, column=1,
        value=f'Search: "{keyword}"  —  Showing top {len(results)} of {total} results  |  {datetime.now().strftime("%Y-%m-%d")}')
    t.font = Font(bold=True, size=11, name="Arial", color="1F3864")
    t.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 24

    # Headers
    cols = [
        ("Rank",       6),
        ("Product Name", 45),
        ("SKU",        12),
        ("Size",       12),
        ("Price",      10),
        ("Sale Price", 10),
        ("Stock",      8),
        ("OLA",        7),
        ("Product URL", 60),
    ]
    for ci, (name, width) in enumerate(cols, 1):
        c = ws.cell(row=2, column=ci, value=name)
        c.fill = HDR_FILL; c.font = HDR_FONT
        c.alignment = CTR; c.border = BORDER
        ws.column_dimensions[get_column_letter(ci)].width = width
    ws.row_dimensions[2].height = 22
    ws.freeze_panes = "A3"

    if not results:
        ws.cell(row=3, column=1, value="No results found").font = Font(italic=True, name="Arial", size=10)
        return

    for ri, item in enumerate(results, 3):
        fill = GREY_FILL if ri % 2 == 0 else NO_FILL
        vals = [
            item["rank"], item["name"], item["sku"], item["size"],
            item["price"], item["sale_price"] if item["has_sale"] else "",
            item["stock"], item["ola"], item["url"],
        ]
        for ci, val in enumerate(vals, 1):
            c = ws.cell(row=ri, column=ci, value=val)
            c.border = BORDER; c.fill = fill

            if ci == 1:  # Rank
                c.font = Font(bold=True, size=10, name="Arial"); c.alignment = CTR
            elif ci == 8:  # OLA
                c.fill = GRN_FILL if val == 1 else RED_FILL
                c.font = Font(bold=True, size=10, name="Arial"); c.alignment = CTR
            elif ci == 9:  # URL
                if val:
                    c.hyperlink = val
                    c.font = Font(color="0070C0", underline="single", size=10, name="Arial")
                c.alignment = MID
            else:
                c.font = STD_FONT; c.alignment = MID

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    global RESULTS_PER

    parser = argparse.ArgumentParser(description="Shajgoj search visibility scraper")
    parser.add_argument("--keywords-file", "-f", default="keywords_flat.txt")
    parser.add_argument("--keywords", "-k", default="")
    parser.add_argument("--count", "-n", type=int, default=RESULTS_PER)
    args = parser.parse_args()

    keywords = load_keywords(args.keywords_file, args.keywords)
    RESULTS_PER = args.count

    print("=" * 55)
    print("  Shajgoj Search Visibility Scraper")
    print(f"  Date     : {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Keywords : {len(keywords)}")
    print(f"  Top N    : {RESULTS_PER}")
    print("=" * 55)
    print()

    wb = Workbook()
    wb.remove(wb.active)

    # Summary sheet
    ws_sum = wb.create_sheet("Summary", 0)
    ws_sum.merge_cells("A1:C1")
    t = ws_sum.cell(row=1, column=1, value="Shajgoj Search Visibility Report")
    t.font = Font(bold=True, size=13, name="Arial", color="1F3864")
    t.alignment = Alignment(horizontal="center", vertical="center")
    ws_sum.row_dimensions[1].height = 28
    for ci, (name, width) in enumerate([("Keyword", 20), ("Total Found", 14), ("Showing Top", 12)], 1):
        c = ws_sum.cell(row=2, column=ci, value=name)
        c.fill = HDR_FILL; c.font = HDR_FONT; c.alignment = CTR; c.border = BORDER
        ws_sum.column_dimensions[get_column_letter(ci)].width = width
    ws_sum.freeze_panes = "A3"

    print(f"Searching {len(keywords)} keywords...\n")

    for i, keyword in enumerate(keywords, 1):
        print(f"  [{i:>2}/{len(keywords)}] '{keyword}'", end=" → ")
        results, total = search_keyword(keyword)

        if isinstance(total, str):  # error string
            print(f"✗ {total}")
            results, total = [], 0
        else:
            print(f"✓ {len(results)} shown / {total} total")

        write_sheet(wb, keyword, results, total)

        sr   = i + 2
        fill = GREY_FILL if sr % 2 == 0 else NO_FILL
        for ci, val in enumerate([keyword, total, len(results)], 1):
            c = ws_sum.cell(row=sr, column=ci, value=val)
            c.font = STD_FONT; c.fill = fill; c.alignment = CTR; c.border = BORDER

        time.sleep(random.uniform(*DELAY))

    wb.save(XLSX_FILE)
    print(f"\n{'='*55}")
    print(f"  Done! Saved to: {XLSX_FILE}")
    print(f"{'='*55}")

if __name__ == "__main__":
    main()