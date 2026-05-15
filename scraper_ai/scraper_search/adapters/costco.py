"""
CostcoAdapter — Costco Canada (.ca) via SERP rendue.

Anti-bot : Akamai Bot Manager → 403 sur HTTP direct. Playwright stealth requis.
Costco affiche les produits dans un grid avec des cards `[automation-id="productList"]`.
Beaucoup de produits Costco nécessitent un compte pour voir le prix → on aura
"member-only" sur certains. On extrait quand même nom/image/url.
"""
from __future__ import annotations

from typing import List
from urllib.parse import quote_plus

from ..models import SearchQuery
from ._browser_serp_base import BrowserSerpAdapter


class CostcoAdapter(BrowserSerpAdapter):
    name = "Costco.ca"
    site_url = "https://www.costco.ca"
    serves_categories: List[str] = ["*"]

    item_selector = (
        "div.product-tile-set, div[automation-id='productList'] > div, "
        "div.product-list > div, article.product-tile"
    )
    marketplace_hint = ""
    default_timeout_ms = 22000
    scroll_on_load = True
    max_scrolls = 3

    def __init__(self, **kwargs):
        super().__init__(use_proxy_env="COSTCO_PROXY_URL", **kwargs)

    def _build_url(self, query: SearchQuery, text: str, *, page: int = 1) -> str:
        suffix = f"&currentPage={page}" if page > 1 else ""
        return f"https://www.costco.ca/CatalogSearch?dept=All&keyword={quote_plus(text)}{suffix}"
