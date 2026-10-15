from __future__ import annotations

from urllib.parse import quote_plus
import requests
from bs4 import BeautifulSoup

from .base import ScraperAdapter, now_local, num, norm
from ..models import PriceObservation, ScrapeTarget
from ..settings import settings


class OthobaAdapter(ScraperAdapter):
    code = "othoba"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    def _parse_card(self, card, target: ScrapeTarget) -> PriceObservation:
        title = card.select_one("h4.product-name a") or card.select_one(".product-name a")
        name = title.get_text(" ", strip=True) if title else target.product_name
        href = title.get("href", "") if title else target.product_url
        if href.startswith("/"):
            href = "https://othoba.com" + href
        price_el = card.select_one(".actual-price")
        old_el = card.select_one(".old-price")
        live = num(price_el.get_text(" ", strip=True) if price_el else None)
        original = num(old_el.get_text(" ", strip=True) if old_el else None) or live
        text = norm(card.get_text(" ", strip=True))
        out_of_stock = "out of stock" in text or "sold out" in text
        return PriceObservation(
            account_code=self.code,
            account_sku=target.account_sku,
            observed_at=now_local(),
            live_price=live,
            original_price=original,
            in_stock=not out_of_stock,
            scrape_status="ok" if live is not None else "price_missing",
            product_name=name,
            product_url=href,
            raw={"match_strategy": "othoba_search_card", "card_text": card.get_text(" ", strip=True)[:1200]},
        )

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        query = target.product_name or target.account_sku
        url = f"https://othoba.com/ts/search/{quote_plus(query)}?t=t&q={quote_plus(query)}"
        r = self.session.get(url, timeout=settings.request_timeout)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        cards = []
        for h4 in soup.select("h4.product-name"):
            card = h4.find_parent(class_="item-box") or h4.find_parent(class_="product-item") or h4.parent
            if card:
                cards.append(card)
        if not cards:
            return [PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                scrape_status="missing",
                product_name=target.product_name,
                product_url=target.product_url,
                raw={"query": query},
            )]

        wanted = norm(target.product_name)
        card = next((c for c in cards if wanted and wanted in norm(c.get_text(" ", strip=True))), cards[0] if len(cards) == 1 else None)
        if card is None:
            return [PriceObservation(
                account_code=self.code,
                account_sku=target.account_sku,
                observed_at=now_local(),
                scrape_status="ambiguous",
                product_name=target.product_name,
                product_url=target.product_url,
                raw={"query": query, "candidate_count": len(cards)},
            )]
        return [self._parse_card(card, target)]
