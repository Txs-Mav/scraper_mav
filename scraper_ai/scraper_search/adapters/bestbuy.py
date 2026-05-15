"""
BestBuyAdapter — Best Buy Canada (.ca) via SERP rendue.

Best Buy a une API JSON publique (`/api/v2/json/search`) mais elle est protégée
par Akamai Bot Manager qui retourne 403 sans cookies de session valides.
Stratégie : rendre la page de search avec Playwright stealth puis extraire les
produits via JSON-LD (Best Buy embed un JSON-LD ItemList complet).
"""
from __future__ import annotations

from typing import List
from urllib.parse import quote_plus

from ..models import SearchQuery
from ._browser_serp_base import BrowserSerpAdapter


class BestBuyAdapter(BrowserSerpAdapter):
    name = "Best Buy.ca"
    site_url = "https://www.bestbuy.ca"
    serves_categories: List[str] = ["electronique", "maison.electromenager",
                                     "maison.petit-electromenager", "outils"]

    marketplace_hint = ""  # pas d'heuristiques DOM dédiées
    item_selector = "div.x-productListItem, div[data-automation='listItem']"
    default_timeout_ms = 18000

    def __init__(self, *, lang: str = "fr-ca", **kwargs):
        super().__init__(use_proxy_env="BESTBUY_PROXY_URL", **kwargs)
        self.lang = lang

    def _build_url(self, query: SearchQuery, text: str, *, page: int = 1) -> str:
        # Format réel observé : https://www.bestbuy.ca/fr-ca/search?search=airpods
        path = "fr-ca" if self.lang.lower().startswith("fr") else "en-ca"
        suffix = f"&page={page}" if page > 1 else ""
        return f"https://www.bestbuy.ca/{path}/search?search={quote_plus(text)}{suffix}"
