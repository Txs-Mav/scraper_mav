"""
DedicatedScraperAdapter — wrappe les scrapers dédiés existants.

Stratégie :
  1. Vérifier le cache d'inventaire (TTL 6h par défaut).
  2. Si miss → exécuter le scraper dédié (qui télécharge tout l'inventaire).
  3. Filtrer + scorer les produits contre la SearchQuery.
  4. Retourner les SearchHit triés.

Coût initial élevé (1er run scrape tout), mais les recherches suivantes sont
quasi-instantanées tant que le cache est valide.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..cache import SearchCache, DEFAULT_TTL_SECONDS
from ..models import SearchHit, SearchQuery
from ..scoring import select_hits
from .base import AdapterError, SearchAdapter


class DedicatedScraperAdapter(SearchAdapter):
    """Adapter pour un DedicatedScraper donné (par slug).

    Conçu pour les concessionnaires véhicules. Ces concessionnaires vendent :
      - Des véhicules (motos, vtt, motoneiges, autos, sxs).
      - Des accessoires (casques, gants, vestes, bottes, intercoms).
      - Des pièces détachées (filtres, bougies, chaînes, pignons).

    Donc on les déclare comme servant les 3 grandes branches : véhicule,
    accessoire, pièce. Le sous-type (moto/vtt/auto) est résolu par le scraper
    individuel via `serves_categories` que tu peux override par scraper.

    Si l'utilisateur cherche une catégorie spécifique (ex: 'electronique.cellulaire'),
    cet adapter sera skipé via la taxonomie. Si l'utilisateur ne précise pas de
    catégorie, on l'interroge — c'est le scoring qui filtrera."""

    # Par défaut, un concessionnaire couvre véhicule + accessoire + pièce.
    # Override possible via le constructeur (`serves_categories=...`) pour
    # restreindre à 'vehicule.moto' par exemple.
    serves_categories: List[str] = ["vehicule", "accessoire", "piece"]

    def __init__(self, slug: str, *, cache: Optional[SearchCache] = None,
                 cache_ttl: int = DEFAULT_TTL_SECONDS,
                 cache_only: bool = False,
                 supported_types: Optional[List[str]] = None,
                 serves_categories: Optional[List[str]] = None):
        self.slug = slug
        self.name = slug  # remplacé par SITE_NAME après _resolve()
        self.cache = cache or SearchCache(ttl_seconds=cache_ttl)
        self.cache_ttl = cache_ttl
        self.cache_only = cache_only
        if supported_types is not None:
            self.supported_types = supported_types
        if serves_categories is not None:
            self.serves_categories = serves_categories

        # Résolution paresseuse de la classe / instance pour ne pas tout charger
        self._scraper = None
        self._site_name = ""
        self._site_url = ""
        self._site_domain = ""

        # Pré-charger les métadonnées (sans instancier le scraper) pour avoir
        # un nom propre dans les logs même si on hit le cache.
        try:
            from scraper_ai.dedicated_scrapers.registry import _SCRAPERS
            cls = _SCRAPERS.get(slug)
            if cls:
                self.name = getattr(cls, "SITE_NAME", slug) or slug
                self.site_url = getattr(cls, "SITE_URL", "")
                self._site_domain = getattr(cls, "SITE_DOMAIN", "") or ""
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Métadonnées paresseuses
    # ------------------------------------------------------------------

    def _resolve(self) -> None:
        if self._scraper is not None:
            return
        try:
            from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry
        except Exception as e:
            raise AdapterError(f"Registry indisponible: {e}")
        instance = DedicatedScraperRegistry.get_by_slug(self.slug)
        if not instance:
            raise AdapterError(f"Scraper '{self.slug}' introuvable")
        self._scraper = instance
        self._site_name = getattr(instance, "SITE_NAME", self.slug)
        self._site_url = getattr(instance, "SITE_URL", "")
        self._site_domain = getattr(instance, "SITE_DOMAIN", "") or self._site_domain
        self.name = self._site_name
        self.site_url = self._site_url

    # ------------------------------------------------------------------
    # Recherche
    # ------------------------------------------------------------------

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        # Optimisation : si cache valide, on évite d'instancier le scraper
        cached = self.cache.get(
            self.slug,
            max_age_seconds=self.cache_ttl,
            aliases=self._cache_aliases(),
        )
        if cached is not None:
            products = cached
        elif self.cache_only:
            raise AdapterError("Inventaire non disponible en cache")
        else:
            self._resolve()
            products = self._get_inventory()
        if not products:
            self.last_products_scanned = 0
            self.last_approximate_count = 0
            return []

        site = (self._site_url or self.site_url
                or self._site_name or self.name)
        hits, scanned, approx = select_hits(
            query, products,
            max_results=max_results,
            source_site=site, source_slug=self.slug,
        )
        self.last_products_scanned = scanned
        self.last_approximate_count = approx
        return hits

    # ------------------------------------------------------------------
    # Inventaire (avec cache)
    # ------------------------------------------------------------------

    def _get_inventory(self) -> List[Dict[str, Any]]:
        """Retourne la liste de produits scrapés (avec cache TTL)."""
        cached = self.cache.get(
            self.slug,
            max_age_seconds=self.cache_ttl,
            aliases=self._cache_aliases(),
        )
        if cached is not None:
            return cached

        if self._scraper is None:
            return []
        try:
            result = self._scraper.scrape()
        except Exception as e:
            raise AdapterError(f"Scrape failed: {type(e).__name__}: {e}")

        products = result.get("products", []) if isinstance(result, dict) else []
        # Persister en cache (même si liste vide pour éviter re-tentatives en boucle)
        self.cache.set(self.slug, products)
        return products

    # ------------------------------------------------------------------
    # Stats utilitaires
    # ------------------------------------------------------------------

    def cached_age_seconds(self) -> Optional[float]:
        age = self.cache.age_seconds(self.slug, aliases=self._cache_aliases())
        if age is None or age > self.cache_ttl:
            return None
        return age

    def force_refresh(self) -> None:
        """Invalide le cache pour ce slug (le prochain search() refera un scrape)."""
        self.cache.invalidate(self.slug)

    def _cache_aliases(self) -> List[str]:
        aliases = []
        if self._site_domain:
            aliases.append(self._site_domain)
        if self.site_url:
            try:
                from urllib.parse import urlparse
                domain = urlparse(self.site_url).netloc.replace("www.", "")
                if domain:
                    aliases.append(domain)
            except Exception:
                pass
        return aliases


def build_all_dedicated_adapters(
    *, cache_ttl: int = DEFAULT_TTL_SECONDS,
    cache_only: bool = False,
    supported_types: Optional[List[str]] = None,
    only_slugs: Optional[List[str]] = None,
    exclude_slugs: Optional[List[str]] = None,
) -> List[DedicatedScraperAdapter]:
    """Construit un adapter pour chaque DedicatedScraper enregistré.
    Filtres optionnels par slug."""
    try:
        from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry
        all_info = DedicatedScraperRegistry.list_all()
    except Exception:
        return []

    cache = SearchCache(ttl_seconds=cache_ttl)
    adapters: List[DedicatedScraperAdapter] = []
    excluded = set(exclude_slugs or [])
    only = set(only_slugs) if only_slugs else None

    for info in all_info:
        slug = info.get("slug") if isinstance(info, dict) else getattr(info, "slug", None)
        if not slug or slug in excluded:
            continue
        if only is not None and slug not in only:
            continue
        adapters.append(DedicatedScraperAdapter(
            slug=slug, cache=cache, cache_ttl=cache_ttl,
            cache_only=cache_only,
            supported_types=supported_types,
        ))
    return adapters
