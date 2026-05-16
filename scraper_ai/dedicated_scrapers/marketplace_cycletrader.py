"""
Snapshot CycleTrader.com — marketplace powersports (US, mais accessible CA).

Réutilise le CycleTraderAdapter de scraper_search.
"""
from __future__ import annotations

from .marketplace_base import MarketplaceSnapshotScraper

# Seeds de fallback (powersport US) — utilisées seulement si aucun
# utilisateur n'a coché CycleTrader, ou si aucune référence n'est disponible.
CYCLETRADER_DEFAULT_SEEDS = [
    "honda",
    "yamaha",
    "kawasaki",
    "suzuki",
    "ktm",
    "harley-davidson",
    "bmw",
    "ducati",
    "can-am",
    "polaris",
]


class CycleTraderMarketplaceScraper(MarketplaceSnapshotScraper):
    SITE_NAME = "CycleTrader.com"
    SITE_SLUG = "marketplace-cycletrader"
    SITE_URL = "https://www.cycletrader.com"
    SITE_DOMAIN = "cycletrader.com"
    DEFAULT_SEEDS = CYCLETRADER_DEFAULT_SEEDS

    def _build_adapter(self):
        from scraper_ai.scraper_search.adapters.cycletrader import CycleTraderAdapter
        return CycleTraderAdapter()
