"""
Contrat des adapters de recherche.

Chaque source (concessionnaire, marketplace) implémente SearchAdapter.search()
qui retourne une liste de SearchHit déjà scorés et filtrés.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional

from ..models import SearchHit, SearchQuery


class AdapterError(Exception):
    """Erreur récupérable d'un adapter (timeout, parse fail, etc.).
    Doit être raise par les implémentations pour signaler un échec contrôlé."""


class SearchAdapter(ABC):
    """Adapter abstrait : interroge UNE source pour une SearchQuery donnée."""

    name: str = "<unnamed>"
    site_url: str = ""

    # Catégories de produits que cet adapter peut servir
    # ('moto', 'auto', 'vtt', 'motoneige', 'ecommerce', 'real_estate', 'jobs')
    # Si vide → l'adapter accepte toutes les requêtes.
    supported_types: List[str] = []

    @abstractmethod
    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        """Retourne une liste de SearchHit (déjà scorés, triés par pertinence décroissante).

        Doit raise AdapterError en cas d'échec récupérable.
        Les exceptions inattendues sont catch par le FederatedSearch."""

    def applies_to(self, query: SearchQuery) -> bool:
        """True si cet adapter est pertinent pour cette requête.
        Permet de skipper un adapter immobilier pour une requête moto."""
        if not self.supported_types:
            return True
        if query.type_vehicule and query.type_vehicule in self.supported_types:
            return True
        # Si la requête ne précise pas de type, on essaie quand même.
        return query.type_vehicule is None
