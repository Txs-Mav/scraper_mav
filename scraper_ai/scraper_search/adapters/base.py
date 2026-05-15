"""
Contrat des adapters de recherche.

Chaque source (concessionnaire, marketplace) implémente SearchAdapter.search()
qui retourne une liste de SearchHit déjà scorés et filtrés.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional

from ..categories import category_matches
from ..models import SearchHit, SearchQuery


class AdapterError(Exception):
    """Erreur récupérable d'un adapter (timeout, parse fail, etc.).
    Doit être raise par les implémentations pour signaler un échec contrôlé."""


class SearchAdapter(ABC):
    """Adapter abstrait : interroge UNE source pour une SearchQuery donnée."""

    name: str = "<unnamed>"
    site_url: str = ""

    # Catégories produits historiques (legacy) :
    # ('moto', 'auto', 'vtt', 'motoneige', 'ecommerce', …). Si vide →
    # l'adapter accepte toutes les requêtes.
    supported_types: List[str] = []

    # Catégories de la TAXONOMIE (cf. categories.py) que cet adapter sert.
    # Format : path complet ('vehicule.moto') ou racine ('vehicule' = toute
    # la branche). '*' = wildcard (tout).
    # Exemples :
    #   - Concessionnaire moto : ['vehicule.moto',
    #                              'accessoire.accessoire-moto',
    #                              'piece.piece-moto']
    #   - Amazon / eBay : ['*'] (généralistes)
    #   - Shopify : ['*'] (dépend de la boutique, mais on assume tout par défaut)
    # Si vide → l'adapter accepte toutes les requêtes (pas de routing par catégorie).
    serves_categories: List[str] = []

    @abstractmethod
    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        """Retourne une liste de SearchHit (déjà scorés, triés par pertinence décroissante).

        Doit raise AdapterError en cas d'échec récupérable.
        Les exceptions inattendues sont catch par le FederatedSearch."""

    def applies_to(self, query: SearchQuery) -> bool:
        """True si cet adapter est pertinent pour cette requête.

        Logique :
          1. Si l'utilisateur a pré-sélectionné une catégorie (`query.category_path`),
             on filtre strictement via `serves_categories`.
          2. Sinon, on retombe sur `supported_types` (legacy) pour les requêtes
             véhicules typées.
          3. Sinon → on accepte (pas de raison de skipper sans info).

        Note : on n'utilise PAS `is_generic_product` pour skipper les adapters.
        Un concessionnaire moto reste pertinent pour "casque Bell" même sans
        catégorie pré-sélectionnée — on laisse le scoring décider (un concessionnaire
        moto vend casques, gants, vestes, pièces, en plus des motos elles-mêmes).
        """
        # 1) Routing strict par catégorie (si fournie)
        if query.category_path and self.serves_categories:
            return category_matches(query.category_path, self.serves_categories)

        # 2) Routing legacy par type de véhicule
        if not self.supported_types:
            return True
        if query.type_vehicule and query.type_vehicule in self.supported_types:
            return True
        # Si la requête ne précise pas de type, on essaie quand même.
        return query.type_vehicule is None
