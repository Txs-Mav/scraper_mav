"""
ShopifySearchAdapter — recherche universelle sur n'importe quelle boutique Shopify.

Approche : Shopify expose `/search/suggest.json` (ou `/search/suggest.json?q=…`)
sur **toutes** les boutiques par défaut. C'est l'endpoint qui alimente la barre
de recherche. Réponse JSON propre, ni anti-bot, ni clé d'API.

En fallback, `/products.json?limit=250` liste tous les produits (sans filtre
serveur) si suggest est désactivé.

Un seul ShopifySearchAdapter cible UNE boutique. `build_shopify_adapters_for(domains)`
en construit plusieurs en batch.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

from ..models import SearchHit, SearchQuery
from ..scoring import select_hits
from .base import AdapterError, SearchAdapter

try:
    from scraper_ai.scraper_usine.stealth import stealth_headers
except Exception:
    def stealth_headers(*args, **kwargs):
        return {"User-Agent": "Mozilla/5.0", "Accept-Language": "fr-CA,fr;q=0.9"}


class ShopifySearchAdapter(SearchAdapter):
    """Adapter pour UNE boutique Shopify donnée (par domaine)."""

    supported_types: List[str] = []  # accepte toutes les requêtes (legacy)
    # Par défaut on assume tout (la boutique elle-même peut être hyper-spécialisée
    # mais on n'en sait rien — c'est le scoring qui filtrera). Si tu connais la
    # boutique, passe `serves_categories=['mode.chaussures']` au constructeur.
    serves_categories: List[str] = ["*"]

    def __init__(self, domain: str, *, timeout: int = 12,
                 site_name: Optional[str] = None,
                 max_per_query: int = 30,
                 serves_categories: Optional[List[str]] = None):
        """
        Args:
            domain: 'example-shop.myshopify.com' OU 'www.shop.com'
            timeout: timeout HTTP par requête (s)
            site_name: nom affiché (sinon dérivé du domaine)
            max_per_query: nb max de résultats demandés à Shopify par requête
            serves_categories: catégories taxonomie servies (override). Ex:
                pour allbirds.com (chaussures) → ['mode.chaussures'].
        """
        d = self._normalize_domain(domain)
        self.domain = d
        self.site_url = f"https://{d}"
        self.name = site_name or d
        self.timeout = timeout
        self.max_per_query = max_per_query
        if serves_categories is not None:
            self.serves_categories = serves_categories
        self.session = requests.Session()
        self.session.headers.update(stealth_headers())
        self.session.headers["Accept"] = "application/json, text/plain, */*"

    @staticmethod
    def _normalize_domain(domain: str) -> str:
        d = domain.strip().lower()
        if d.startswith("http://") or d.startswith("https://"):
            d = urlparse(d).netloc
        return d.strip("/")

    # ------------------------------------------------------------------
    # search()
    # ------------------------------------------------------------------

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        text = query.search_text()
        if not text:
            return []

        # 1) /search/suggest.json — endpoint recherche officiel (rapide, ciblé)
        products = self._suggest(text)

        # 2) Fallback /products.json si suggest désactivé / vide pour cette boutique
        if not products:
            products = self._products_json_filter(text)

        if not products:
            self.last_products_scanned = 0
            self.last_approximate_count = 0
            return []

        hits, scanned, approx = select_hits(
            query, products,
            max_results=max_results,
            source_site=self.domain,
            source_slug=f"shopify:{self.domain}",
        )
        self.last_products_scanned = scanned
        self.last_approximate_count = approx
        return hits

    # ------------------------------------------------------------------
    # /search/suggest.json
    # ------------------------------------------------------------------

    def _suggest(self, text: str) -> List[Dict[str, Any]]:
        url = f"{self.site_url}/search/suggest.json"
        params = {
            "q": text,
            "resources[type]": "product",
            "resources[limit]": str(self.max_per_query),
            "resources[options][unavailable_products]": "last",
            "resources[options][fields]": "title,product_type,variants.title,vendor,body",
        }
        try:
            resp = self.session.get(url, params=params, timeout=self.timeout)
        except requests.RequestException as e:
            raise AdapterError(f"Shopify suggest fetch error ({self.domain}): {e}")
        if resp.status_code == 404:
            return []  # boutique avec suggest désactivé → fallback /products.json
        if resp.status_code != 200:
            raise AdapterError(f"Shopify suggest HTTP {resp.status_code} ({self.domain})")

        try:
            data = resp.json()
        except ValueError:
            return []

        results = (((data.get("resources") or {}).get("results") or {}).get("products")) or []
        return [self._normalize_suggest(p) for p in results if isinstance(p, dict)]

    def _normalize_suggest(self, p: Dict[str, Any]) -> Dict[str, Any]:
        """Convertit le payload suggest.json en dict produit normalisé."""
        price_raw = p.get("price")
        try:
            price = float(price_raw) if price_raw not in (None, "") else None
        except (TypeError, ValueError):
            price = None

        url = p.get("url") or ""
        if url and not url.startswith("http"):
            url = f"{self.site_url}{url}"

        image = p.get("image") or ""
        if image and image.startswith("//"):
            image = f"https:{image}"

        return {
            "name": (p.get("title") or "").strip(),
            "prix": price,
            "currency": "CAD",  # Shopify renvoie en devise de la boutique ; on suppose CAD pour QC
            "marque": (p.get("vendor") or "").strip() or None,
            "categorie": (p.get("product_type") or "").strip() or None,
            "image": image,
            "description": (p.get("body") or "").strip()[:500],
            "sku": p.get("handle") or None,
            "sourceUrl": url,
            "etat": "neuf",  # Shopify = quasi exclusivement neuf (sites e-commerce)
        }

    # ------------------------------------------------------------------
    # /products.json fallback
    # ------------------------------------------------------------------

    def _products_json_filter(self, text: str) -> List[Dict[str, Any]]:
        """Récupère les premiers produits via /products.json et filtre côté client.
        Limité à 250 produits/page (cap Shopify). Pour de gros catalogues, ce n'est
        pas exhaustif — mais c'est mieux que rien si suggest est désactivé."""
        url = f"{self.site_url}/products.json"
        try:
            resp = self.session.get(url, params={"limit": 250}, timeout=self.timeout)
        except requests.RequestException as e:
            raise AdapterError(f"Shopify products.json error ({self.domain}): {e}")
        if resp.status_code != 200:
            return []
        try:
            data = resp.json()
        except ValueError:
            return []
        items = data.get("products") or []
        text_lower = text.lower()
        out: List[Dict[str, Any]] = []
        for p in items:
            blob = " ".join([
                str(p.get("title", "")),
                str(p.get("vendor", "")),
                str(p.get("product_type", "")),
                str(p.get("body_html", ""))[:500],
            ]).lower()
            if text_lower not in blob and not all(t in blob for t in text_lower.split()):
                continue
            variants = p.get("variants") or [{}]
            v0 = variants[0] if variants else {}
            try:
                price = float(v0.get("price")) if v0.get("price") else None
            except (TypeError, ValueError):
                price = None
            handle = p.get("handle") or ""
            images = p.get("images") or []
            img = images[0].get("src") if images else ""
            out.append({
                "name": p.get("title", ""),
                "prix": price,
                "marque": p.get("vendor") or None,
                "categorie": p.get("product_type") or None,
                "image": img,
                "description": (p.get("body_html") or "")[:500],
                "sku": v0.get("sku") or handle,
                "sourceUrl": f"{self.site_url}/products/{handle}" if handle else "",
                "etat": "neuf",
            })
            if len(out) >= self.max_per_query:
                break
        return out


# ---------------------------------------------------------------------------
# Détection d'une boutique Shopify (à partir d'un domaine)
# ---------------------------------------------------------------------------

def is_shopify_store(domain: str, *, timeout: int = 8) -> bool:
    """Vérifie qu'un domaine est bien une boutique Shopify.

    Stratégie : GET /products.json renvoie 200 + JSON valide sur Shopify, 404
    ailleurs. Pas parfait (certaines boutiques le bloquent) mais bonne heuristique
    rapide."""
    d = ShopifySearchAdapter._normalize_domain(domain)
    try:
        resp = requests.head(
            f"https://{d}/products.json",
            headers=stealth_headers(),
            timeout=timeout, allow_redirects=True,
        )
        if resp.status_code == 405:  # certaines boutiques refusent HEAD
            resp = requests.get(
                f"https://{d}/products.json?limit=1",
                headers=stealth_headers(), timeout=timeout,
            )
        if resp.status_code != 200:
            return False
        if "application/json" not in resp.headers.get("Content-Type", ""):
            return False
        return True
    except requests.RequestException:
        return False


def build_shopify_adapters_for(domains: List[str], *,
                                check_first: bool = False,
                                timeout: int = 12,
                                serves_categories: Optional[List[str]] = None) \
        -> List[ShopifySearchAdapter]:
    """Construit un ShopifySearchAdapter pour chaque domaine fourni.

    Si `check_first=True`, vérifie que c'est bien une boutique Shopify avant
    de l'inclure (lent : 1 HEAD par domaine). Par défaut on fait confiance à
    l'appelant pour ne fournir que des domaines Shopify connus."""
    adapters: List[ShopifySearchAdapter] = []
    for domain in domains:
        if not domain or not domain.strip():
            continue
        d = domain.strip()
        if check_first and not is_shopify_store(d, timeout=timeout):
            continue
        adapters.append(ShopifySearchAdapter(
            d, timeout=timeout, serves_categories=serves_categories,
        ))
    return adapters
