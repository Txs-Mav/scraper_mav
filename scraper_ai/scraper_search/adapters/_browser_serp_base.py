"""
BrowserSerpAdapter — base réutilisable pour les marketplaces SERP rendus.

La plupart des marketplaces (Best Buy, Walmart, Costco, AutoTrader, CycleTrader,
LesPAC, Facebook Marketplace…) sont protégés par anti-bot (Akamai, Incapsula,
DataDome) et nécessitent un rendu navigateur réel.

Cette classe abstrait le pattern commun :
    1. Build l'URL de search à partir de la SearchQuery.
    2. Rend la page via BrowserAgent (Playwright stealth).
    3. Détecte CAPTCHA / blocage anti-bot.
    4. Extrait les produits via GenericProductExtractor (JSON-LD/microdata/OG)
       ou via des sélecteurs DOM custom.
    5. Score, déduplique, retourne.

Sous-classes concrètes : BestBuyAdapter, WalmartAdapter, CostcoAdapter,
LesPacAdapter, AutoTraderAdapter, CycleTraderAdapter, FacebookMarketplaceAdapter.
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple

from ..extractors import GenericProductExtractor, extract_products_from_listing
from ..models import SearchHit, SearchQuery
from ..scoring import make_hit, score_product
from .base import AdapterError, SearchAdapter


# Marqueurs textuels qui indiquent un blocage anti-bot
_ANTIBOT_MARKERS = (
    "captcha",
    "type the characters",
    "robot check",
    "incapsula_resource",
    "_incapsula",
    "datadome",
    "are you a human",
    "vérification",
    "access denied",
    "request unsuccessful",
    "too many requests",
    "/errors/validatecaptcha",
)


class BrowserSerpAdapter(SearchAdapter):
    """Base abstraite. Override `_build_url()` et éventuellement
    `_parse_listing()` / `_item_selector` selon le site."""

    # Sélecteur CSS des cards de produits (override par sous-classe). Si vide,
    # on retombe sur la détection auto via JSON-LD ItemList ou microdata Product.
    item_selector: str = ""

    # Hint passé à GenericProductExtractor pour appliquer ses heuristiques DOM.
    marketplace_hint: str = ""

    # Timeout par défaut
    default_timeout_ms: int = 18000

    # Best-effort networkidle après DCL. Augmenter pour les sites anti-bot
    # (Incapsula/DataDome) qui ajoutent un challenge JS de 3-6s.
    networkidle_ms: int = 2500

    # Wait fixe après load (cookies + hydratation React). Augmenter pour
    # les SERP React qui hydratent leurs cards en delta.
    post_load_wait_ms: int = 1500

    # Si True, scrolle la page après load pour déclencher lazy-loading.
    scroll_on_load: bool = True
    max_scrolls: int = 2

    # Si True, garde uniquement les produits qui ont un sourceUrl valide
    # (filtre les bouts de DOM parasites).
    require_url: bool = True

    # Site-specific : utilisé pour les badges UI / tracking
    name = "<override>"
    site_url = ""

    def __init__(self, *, timeout_ms: Optional[int] = None,
                 max_pages: int = 1,
                 use_proxy_env: Optional[str] = None):
        """
        Args:
            timeout_ms: timeout par page rendue
            max_pages: nb de pages SERP à rendre
            use_proxy_env: nom de la variable d'env du proxy résidentiel à utiliser
                (ex: 'WALMART_PROXY_URL'). Si la var n'est pas définie, pas de proxy.
        """
        self.timeout_ms = timeout_ms or self.default_timeout_ms
        self.max_pages = max_pages
        self.proxy_env = use_proxy_env

    # ------------------------------------------------------------------
    # API publique (search)
    # ------------------------------------------------------------------

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        text = query.search_text()
        if not text:
            return []

        urls = self._build_urls(query, text)
        if not urls:
            return []

        try:
            from scraper_ai.scraper_usine.browser_agent import BrowserAgent
        except ImportError as e:
            raise AdapterError(f"BrowserAgent indisponible: {e}")

        proxy_dict = self._proxy_dict()
        all_products: List[Dict[str, Any]] = []

        try:
            with BrowserAgent(block_assets=True, locale="fr-CA",
                              proxy=proxy_dict) as agent:
                for url in urls:
                    try:
                        result = agent.render(
                            url,
                            timeout_ms=self.timeout_ms,
                            networkidle_ms=self.networkidle_ms,
                            scroll=self.scroll_on_load,
                            max_scrolls=self.max_scrolls,
                            dismiss_cookies=True,
                            post_load_wait_ms=self.post_load_wait_ms,
                        )
                    except Exception as e:
                        raise AdapterError(f"{self.name} render error {url}: {e}")

                    html = result.html or ""
                    if self._looks_blocked(html):
                        raise AdapterError(
                            f"{self.name} : anti-bot détecté "
                            f"(configure {self.proxy_env or 'un proxy résidentiel'} pour contourner)."
                        )
                    if len(html) < 1000:
                        continue

                    products = self._parse_listing(html, base_url=url)
                    all_products.extend(products)
                    if len(all_products) >= max_results * 2:
                        break
        except AdapterError:
            raise
        except Exception as e:
            raise AdapterError(f"{self.name} session error: {e}")

        return self._score_and_filter(query, all_products, max_results)

    # ------------------------------------------------------------------
    # Hooks à override par sous-classe
    # ------------------------------------------------------------------

    def _build_urls(self, query: SearchQuery, text: str) -> List[str]:
        """Renvoie la liste des URLs de search à rendre. Par défaut : 1 URL via _build_url()."""
        first = self._build_url(query, text, page=1)
        urls = [first] if first else []
        for page in range(2, self.max_pages + 1):
            u = self._build_url(query, text, page=page)
            if u and u != first:
                urls.append(u)
        return urls

    def _build_url(self, query: SearchQuery, text: str, *, page: int = 1) -> str:
        """À override : retourne l'URL de la page SERP `page` pour cette query."""
        raise NotImplementedError

    def _parse_listing(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        """À override pour parsing custom. Par défaut : extract_products_from_listing()."""
        products = extract_products_from_listing(
            html, base_url=base_url,
            item_selector=self.item_selector or None,
            max_items=80,
        )
        if products:
            return self._post_process(products, base_url=base_url)

        # Fallback : 1 seul extract (= la page entière vue comme 1 produit)
        single = GenericProductExtractor(
            html, base_url=base_url,
            marketplace_hint=self.marketplace_hint or None,
        ).extract()
        if single.get("name"):
            return self._post_process([single], base_url=base_url)
        return []

    def _post_process(self, products: List[Dict[str, Any]], *,
                       base_url: str) -> List[Dict[str, Any]]:
        """Hook de normalisation post-extraction. Par défaut : filtre les produits
        sans nom OU sans URL si require_url=True."""
        out: List[Dict[str, Any]] = []
        for p in products:
            if not p.get("name"):
                continue
            if self.require_url and not p.get("sourceUrl"):
                continue
            # Tag source pour traçabilité
            p.setdefault("_source", self.name)
            out.append(p)
        return out

    # ------------------------------------------------------------------
    # Helpers internes
    # ------------------------------------------------------------------

    def _proxy_dict(self) -> Optional[Dict[str, str]]:
        """Construit le dict proxy Playwright depuis les variables d'env."""
        if not self.proxy_env:
            return None
        import os
        url = os.getenv(self.proxy_env, "").strip()
        if not url:
            return None
        proxy: Dict[str, str] = {"server": url}
        prefix = self.proxy_env.removesuffix("_URL") if self.proxy_env.endswith("_URL") else self.proxy_env
        user = os.getenv(f"{prefix}_USERNAME", "").strip()
        pwd = os.getenv(f"{prefix}_PASSWORD", "").strip()
        if user:
            proxy["username"] = user
        if pwd:
            proxy["password"] = pwd
        return proxy

    @staticmethod
    def _looks_blocked(html: str) -> bool:
        if not html or len(html) < 200:
            return True
        haystack = html[:8000].lower()
        return any(marker in haystack for marker in _ANTIBOT_MARKERS)

    def _score_and_filter(self, query: SearchQuery,
                           products: List[Dict[str, Any]],
                           max_results: int) -> List[SearchHit]:
        hits: List[SearchHit] = []
        seen = set()
        for p in products:
            url = p.get("sourceUrl", "")
            sku = p.get("sku") or ""
            key = sku or url or p.get("name", "")
            if key in seen:
                continue
            seen.add(key)
            sc, reason = score_product(query, p)
            if sc < query.min_score:
                continue
            hits.append(make_hit(
                p, sc, reason,
                source_site=self._source_site_label(),
                source_slug=self._source_slug(),
            ))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:max_results]

    def _source_site_label(self) -> str:
        from urllib.parse import urlparse
        if self.site_url:
            netloc = urlparse(self.site_url).netloc
            return netloc or self.name
        return self.name

    def _source_slug(self) -> str:
        return re.sub(r"[^a-z0-9]+", "-", self.name.lower()).strip("-")
