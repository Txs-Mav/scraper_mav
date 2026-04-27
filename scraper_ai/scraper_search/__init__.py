"""
scraper_search — Recherche fédérée multi-sites.

Diffère de `scraper_usine` (qui télécharge un inventaire complet) :
ici on prend une requête utilisateur (ex: "KTM SX 150 2026") et on
interroge tous les sites accessibles en parallèle pour ne retourner que
les correspondances.

Architecture :
  - SearchQuery        → requête normalisée (marque, modèle, année, prix…)
  - SearchAdapter      → contrat pour interroger une source
  - SearchCache        → cache TTL des inventaires (évite re-scraping)
  - FederatedSearch    → orchestrateur parallèle avec timeout par adapter
  - SearchResult       → réponse agrégée + scoring de pertinence

Usage CLI :
  python -m scraper_ai.scraper_search.main "KTM SX 150 2026"
  python -m scraper_ai.scraper_search.main "Honda Civic 2022 < 25000$"
  python -m scraper_ai.scraper_search.main "Yamaha YZ250F" --max-age 3600
"""

from .models import (  # noqa: F401
    SearchQuery, SearchHit, SearchResult,
)
from .query_parser import parse_query  # noqa: F401
from .federation import FederatedSearch  # noqa: F401
