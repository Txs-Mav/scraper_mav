"""
Snapshot LesPAC.com — petites annonces québécoises.

Réutilise le LesPacAdapter de scraper_search.
"""
from __future__ import annotations

from .marketplace_base import MarketplaceSnapshotScraper


class LesPacMarketplaceScraper(MarketplaceSnapshotScraper):
    SITE_NAME = "LesPAC"
    SITE_SLUG = "marketplace-lespac"
    SITE_URL = "https://www.lespac.com"
    SITE_DOMAIN = "lespac.com"

    def _build_adapter(self):
        from scraper_ai.scraper_search.adapters.lespac import LesPacAdapter
        return LesPacAdapter()
