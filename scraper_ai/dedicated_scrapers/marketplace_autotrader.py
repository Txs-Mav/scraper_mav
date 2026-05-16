"""
Snapshot AutoTrader.ca — marketplace véhicules au Canada.

Note : l'adaptateur existant cible principalement la branche `/cars/`.
Pour les usages moto/powersports, l'utilité dépend du modèle. On garde
l'intégration pour les utilisateurs qui surveillent l'auto.
"""
from __future__ import annotations

from .marketplace_base import MarketplaceSnapshotScraper

# Seeds de fallback (auto majoritaire) — utilisées seulement si aucun
# utilisateur n'a coché AutoTrader, ou si aucune référence n'est disponible.
AUTOTRADER_DEFAULT_SEEDS = [
    "toyota",
    "honda",
    "ford",
    "chevrolet",
    "hyundai",
    "kia",
    "nissan",
    "mazda",
    "volkswagen",
    "subaru",
]


class AutoTraderMarketplaceScraper(MarketplaceSnapshotScraper):
    SITE_NAME = "AutoTrader.ca"
    SITE_SLUG = "marketplace-autotrader-ca"
    SITE_URL = "https://www.autotrader.ca"
    SITE_DOMAIN = "autotrader.ca"
    DEFAULT_SEEDS = AUTOTRADER_DEFAULT_SEEDS

    def _build_adapter(self):
        from scraper_ai.scraper_search.adapters.autotrader import AutoTraderAdapter
        return AutoTraderAdapter()
