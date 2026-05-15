"""
CycleTraderAdapter — CycleTrader.com (US) pour véhicules powersport (moto, vtt,
motoneige, sxs).

Anti-bot : Cloudflare → 403 sur HTTP direct. Playwright stealth requis.
Stratégie : URL search, parser les cards d'inventaire dans le DOM rendu.
"""
from __future__ import annotations

from typing import List
from urllib.parse import quote_plus

from ..models import SearchQuery
from ._browser_serp_base import BrowserSerpAdapter


_CATEGORY_MAP = {
    "moto": "motorcycles-for-sale",
    "vtt": "atvs-for-sale",
    "motoneige": "snowmobiles-for-sale",
    "sxs": "side-by-sides-for-sale",
    "nautique": "personal-watercraft-for-sale",
}


class CycleTraderAdapter(BrowserSerpAdapter):
    name = "CycleTrader.com"
    site_url = "https://www.cycletrader.com"
    serves_categories: List[str] = [
        "vehicule.moto", "vehicule.vtt", "vehicule.motoneige", "vehicule.sxs",
    ]

    item_selector = ("div.listing-card, div[data-testid='listing-card'], "
                     "article.listing")
    marketplace_hint = ""
    default_timeout_ms = 22000

    def __init__(self, **kwargs):
        super().__init__(use_proxy_env="CYCLETRADER_PROXY_URL", **kwargs)

    def _build_url(self, query: SearchQuery, text: str, *, page: int = 1) -> str:
        # Détecte la catégorie (powersport)
        cat = "motorcycles-for-sale"
        if query.category_path:
            leaf = query.category_path.split(".")[-1]
            cat = _CATEGORY_MAP.get(leaf, cat)
        elif query.type_vehicule:
            cat = _CATEGORY_MAP.get(query.type_vehicule, cat)

        params: List[str] = []
        if query.marque:
            params.append(f"make={quote_plus(query.marque.lower())}")
        if query.modele:
            params.append(f"model={quote_plus(query.modele.lower())}")
        if query.annee:
            params.append(f"year-range={query.annee}-{query.annee}")
        if query.prix_max:
            params.append(f"price-range=0-{int(query.prix_max)}")
        if not params and text:
            params.append(f"keywords={quote_plus(text)}")
        if page > 1:
            params.append(f"page={page}")
        suffix = f"?{'&'.join(params)}" if params else ""
        return f"https://www.cycletrader.com/{cat}{suffix}"
