"""
Snapshot Kijiji.ca — petites annonces multi-vendeurs au Canada.

Réutilise le KijijiAdapter de scraper_search (Playwright stealth + DataDome).
"""
from __future__ import annotations

from .marketplace_base import MarketplaceSnapshotScraper


class KijijiMarketplaceScraper(MarketplaceSnapshotScraper):
    SITE_NAME = "Kijiji"
    SITE_SLUG = "marketplace-kijiji-ca"
    SITE_URL = "https://www.kijiji.ca"
    SITE_DOMAIN = "kijiji.ca"

    def _build_adapter(self):
        from scraper_ai.scraper_search.adapters.kijiji import KijijiAdapter
        return KijijiAdapter()
