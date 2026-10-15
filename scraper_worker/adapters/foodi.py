from __future__ import annotations

from .base import ScraperAdapter
from ..models import PriceObservation, ScrapeTarget


class FoodiAdapter(ScraperAdapter):
    code = "foodi"
    ready = False

    def scrape(self, target: ScrapeTarget) -> list[PriceObservation]:
        return [self.error_observation(
            target,
            "Foodi/Foodimart scraper endpoint was not present in the recovered legacy bundle. "
            "The worker slot is ready, but the live Mart API/request must be captured before enabling automation.",
        )]
