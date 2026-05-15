"""
scraper_search — Recherche fédérée multi-sites.

Diffère de `scraper_usine` (qui télécharge un inventaire complet) :
ici on prend une requête utilisateur (ex: "KTM SX 150 2026" ou "iPhone 15 Pro")
et on interroge tous les sites accessibles en parallèle pour ne retourner que
les correspondances.

Deux modes :
  - Véhicule : marque + modèle + année (concessionnaires moto/auto/powersport).
  - Générique : produits e-commerce (Amazon, eBay, Shopify, Kijiji, …).
    Détection automatique via le query_parser.

Architecture :
  - SearchQuery               → requête normalisée (marque, modèle, année, prix…)
  - SearchAdapter             → contrat pour interroger une source
  - SearchCache               → cache TTL des inventaires (évite re-scraping)
  - FederatedSearch           → orchestrateur parallèle avec timeout par adapter
  - SearchResult              → réponse agrégée + scoring de pertinence
  - GenericProductExtractor   → JSON-LD/microdata/OG/heuristiques pour
                                 extraire un produit depuis n'importe quel HTML

Adapters disponibles :
  - DedicatedScraperAdapter   → wrappe les scrapers dédiés (concessionnaires)
  - ShopifySearchAdapter      → /search/suggest.json sur n'importe quelle boutique
  - EbayBrowseAdapter         → API Browse officielle (requiert OAuth)
  - AmazonAdapter             → autocomplete + SERP (Playwright stealth)
  - KijijiAdapter             → SERP rendu via Playwright (anti DataDome)
  - AutoTraderAdapter         → skeleton (à valider en prod)

Usage CLI :
  python -m scraper_ai.scraper_search.main "KTM SX 150 2026"
  python -m scraper_ai.scraper_search.main "Honda Civic 2022 < 25000$"
  python -m scraper_ai.scraper_search.main "Sony WH-1000XM5" --amazon --ebay
  python -m scraper_ai.scraper_search.main "iPhone 15" --shopify allbirds.com
  python -m scraper_ai.scraper_search.main "Yamaha YZ250F" --kijiji
"""

from .models import (  # noqa: F401
    SearchQuery, SearchHit, SearchResult,
)
from .query_parser import parse_query  # noqa: F401
from .federation import FederatedSearch  # noqa: F401
from .extractors import GenericProductExtractor, extract_product  # noqa: F401
from .categories import (  # noqa: F401
    Category, get_category, get_path, all_paths, root_categories,
    children_of, is_under, category_matches, detect_category_from_text,
    render_tree,
)
