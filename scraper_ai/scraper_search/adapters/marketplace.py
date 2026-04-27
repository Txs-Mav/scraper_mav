"""
Adapters marketplace : sites avec une vraie API/URL de recherche.

Contrairement à DedicatedScraperAdapter (qui télécharge tout l'inventaire d'un
concessionnaire et filtre), ces adapters traduisent la SearchQuery en URL/payload
de recherche native du site → résultats ciblés directement.

NOTE : ces adapters sont des SKELETONS prêts à être complétés. Chaque marketplace
a son propre format de réponse et ses propres protections anti-bot. Les structures
ci-dessous expliquent où implémenter quoi.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urljoin

import requests
from bs4 import BeautifulSoup

from ..models import SearchHit, SearchQuery
from ..scoring import make_hit, score_product
from .base import AdapterError, SearchAdapter

try:
    from scraper_ai.scraper_usine.stealth import stealth_headers
except Exception:
    def stealth_headers(*args, **kwargs):
        return {"User-Agent": "Mozilla/5.0", "Accept-Language": "fr-CA,fr;q=0.9"}


# ---------------------------------------------------------------------------
# AutoTrader.ca — exemple complet (HTML scraping de la page de recherche)
# ---------------------------------------------------------------------------

class AutoTraderAdapter(SearchAdapter):
    """AutoTrader.ca — recherche par marque/modèle/année.
    Skeleton : à valider/affiner contre la structure HTML réelle d'AutoTrader."""

    name = "AutoTrader.ca"
    site_url = "https://www.autotrader.ca"
    supported_types = ["auto"]

    BASE_SEARCH = "https://www.autotrader.ca/cars/"

    def __init__(self, *, timeout: int = 15):
        self.session = requests.Session()
        self.session.headers.update(stealth_headers())
        self.timeout = timeout

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        url = self._build_search_url(query)
        try:
            resp = self.session.get(url, timeout=self.timeout)
        except requests.RequestException as e:
            raise AdapterError(f"AutoTrader fetch error: {e}")
        if resp.status_code != 200:
            raise AdapterError(f"AutoTrader HTTP {resp.status_code}")

        # AutoTrader peut servir de l'HTML statique ou hydrater côté client.
        # Stratégie : parser les cards d'inventaire dans le HTML.
        soup = BeautifulSoup(resp.text, "lxml")
        items = soup.select(
            "div.result-item, .inventory-listing, [data-testid='vehicle-listing']"
        )

        hits: List[SearchHit] = []
        for item in items[:max_results * 2]:
            product = self._parse_card(item, base_url=resp.url)
            if not product:
                continue
            sc, reason = score_product(query, product)
            if sc < query.min_score:
                continue
            hits.append(make_hit(
                product, sc, reason,
                source_site="autotrader.ca",
                source_slug="autotrader",
            ))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:max_results]

    def _build_search_url(self, query: SearchQuery) -> str:
        """Traduit la requête en URL AutoTrader.
        Format réel à confirmer en prod ; ce template suit le pattern observé
        sur autotrader.ca à date d'écriture."""
        params: List[str] = []
        if query.marque:
            params.append(f"mak={quote_plus(query.marque)}")
        if query.modele:
            params.append(f"mdl={quote_plus(query.modele)}")
        if query.annee:
            params.append(f"yRng={query.annee}%2C{query.annee}")
        elif query.annee_min or query.annee_max:
            lo = query.annee_min or 1900
            hi = query.annee_max or 2100
            params.append(f"yRng={lo}%2C{hi}")
        if query.prix_max:
            params.append(f"prx={int(query.prix_max)}")
        if query.prix_min:
            params.append(f"prMn={int(query.prix_min)}")
        suffix = "?" + "&".join(params) if params else ""
        return f"{self.BASE_SEARCH}{suffix}"

    def _parse_card(self, item, base_url: str) -> Optional[Dict[str, Any]]:
        """Extrait un produit depuis une card AutoTrader.
        À CALIBRER selon la structure HTML réelle (les sélecteurs ci-dessous
        sont indicatifs)."""
        try:
            link = item.find("a", href=True)
            if not link:
                return None
            href = urljoin(base_url, link["href"])

            name_el = item.select_one("h2, h3, .vehicle-title, [data-testid='listing-title']")
            name = name_el.get_text(strip=True) if name_el else ""
            if not name:
                return None

            price_el = item.select_one(".price, .listing-price, [data-testid='listing-price']")
            price = None
            if price_el:
                m = re.search(r"[\d,]+", price_el.get_text())
                if m:
                    try:
                        price = float(m.group(0).replace(",", ""))
                    except ValueError:
                        pass

            year = None
            ymatch = re.search(r"\b(19|20)\d{2}\b", name)
            if ymatch:
                year = int(ymatch.group(0))

            img_el = item.find("img")
            img = ""
            if img_el:
                img = img_el.get("data-src") or img_el.get("src", "")

            return {
                "name": name,
                "prix": price,
                "annee": year,
                "image": img,
                "sourceUrl": href,
            }
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Kijiji.ca — skeleton
# ---------------------------------------------------------------------------

class KijijiAdapter(SearchAdapter):
    """Kijiji.ca — recherche petites annonces.
    Skeleton : Kijiji a un fort anti-bot (DataDome). Recommandé : Playwright stealth."""

    name = "Kijiji.ca"
    site_url = "https://www.kijiji.ca"
    supported_types = ["auto", "moto", "vtt", "motoneige"]

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        # TODO : implémenter avec Playwright + stealth (cf. scraper_usine.stealth)
        # Format URL Kijiji : /b-cars-trucks/canada/<marque>-<modele>/k0c174l0
        raise AdapterError("KijijiAdapter non implémenté — utiliser Playwright stealth")


# ---------------------------------------------------------------------------
# Cycle Trader — skeleton powersport
# ---------------------------------------------------------------------------

class CycleTraderAdapter(SearchAdapter):
    """CycleTrader.com (US) / motoneige.com — petites annonces powersport."""

    name = "CycleTrader"
    site_url = "https://www.cycletrader.com"
    supported_types = ["moto", "vtt", "motoneige", "sxs"]

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        raise AdapterError("CycleTraderAdapter non implémenté")
