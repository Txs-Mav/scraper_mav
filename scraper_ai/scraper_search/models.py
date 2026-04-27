"""
Modèles de données pour la recherche fédérée.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class SearchQuery:
    """Requête utilisateur normalisée."""
    raw_text: str = ""

    # --- Critères structurés ---
    marque: Optional[str] = None
    modele: Optional[str] = None
    annee: Optional[int] = None             # année exacte si donnée
    annee_min: Optional[int] = None
    annee_max: Optional[int] = None
    prix_min: Optional[float] = None
    prix_max: Optional[float] = None
    type_vehicule: Optional[str] = None     # 'moto' | 'vtt' | 'motoneige' | 'auto' | 'sxs' | None
    etat: Optional[str] = None              # 'neuf' | 'occasion' | None
    couleur: Optional[str] = None
    keywords: List[str] = field(default_factory=list)  # mots restants (modèle composé, options…)

    # --- Limites de recherche ---
    max_results: int = 50
    min_score: float = 0.3                  # rejeter les hits sous ce score

    def signature(self) -> str:
        """Signature courte pour cache / logs."""
        parts = [self.raw_text or "?",
                 f"y={self.annee or self.annee_min or '?'}",
                 f"px={self.prix_min or 0}-{self.prix_max or '∞'}"]
        return " | ".join(parts)


@dataclass
class SearchHit:
    """Un produit trouvé, normalisé."""
    name: str = ""
    prix: Optional[float] = None
    annee: Optional[int] = None
    marque: Optional[str] = None
    modele: Optional[str] = None
    kilometrage: Optional[int] = None
    couleur: Optional[str] = None
    image: str = ""
    description: str = ""
    etat: Optional[str] = None              # 'neuf' | 'occasion'

    source_site: str = ""                   # ex: 'moto-ducharme.com'
    source_slug: str = ""                   # ex: 'moto-ducharme'
    source_url: str = ""                    # URL canonique du produit

    score: float = 0.0                      # pertinence (0..1)
    match_reason: str = ""                  # debug : pourquoi ce hit matche
    raw: Dict[str, Any] = field(default_factory=dict)  # données brutes du scraper

    def to_display_dict(self) -> Dict[str, Any]:
        """Version pour affichage CLI / API JSON (sans `raw`)."""
        return {
            "name": self.name,
            "prix": self.prix,
            "annee": self.annee,
            "marque": self.marque,
            "modele": self.modele,
            "kilometrage": self.kilometrage,
            "etat": self.etat,
            "image": self.image,
            "source_site": self.source_site,
            "source_url": self.source_url,
            "score": round(self.score, 3),
            "match_reason": self.match_reason,
        }


@dataclass
class AdapterRunStats:
    """Stats d'un adapter individuel après un run."""
    name: str = ""
    site: str = ""
    duration_seconds: float = 0.0
    products_scanned: int = 0           # nb de produits passés au filtre
    hits_returned: int = 0              # nb de produits matchant
    cache_hit: bool = False             # données venaient du cache
    error: str = ""                     # message si l'adapter a échoué


@dataclass
class SearchResult:
    """Résultat agrégé d'une recherche fédérée."""
    query: SearchQuery = field(default_factory=SearchQuery)
    hits: List[SearchHit] = field(default_factory=list)
    total: int = 0

    elapsed_seconds: float = 0.0
    adapters_run: List[AdapterRunStats] = field(default_factory=list)

    @property
    def adapters_succeeded(self) -> int:
        return sum(1 for a in self.adapters_run if not a.error)

    @property
    def adapters_failed(self) -> List[str]:
        return [a.name for a in self.adapters_run if a.error]

    @property
    def cache_hits(self) -> int:
        return sum(1 for a in self.adapters_run if a.cache_hit)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query": asdict(self.query),
            "total": self.total,
            "elapsed_seconds": round(self.elapsed_seconds, 2),
            "adapters_succeeded": self.adapters_succeeded,
            "adapters_failed": self.adapters_failed,
            "cache_hits": self.cache_hits,
            "adapters_run": [asdict(a) for a in self.adapters_run],
            "hits": [h.to_display_dict() for h in self.hits],
        }
