"""
Modèles de données pour la recherche fédérée.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class SearchQuery:
    """Requête utilisateur normalisée.

    Supporte deux modes de produits :
      - Véhicule : marque + modèle + année (pour concessionnaires moto/auto/powersport).
      - Générique : marque libre + categorie + keywords (pour Amazon, eBay, Shopify, …).
    Les deux modes peuvent coexister sur la même requête.
    """
    raw_text: str = ""

    # --- Critères structurés véhicules ---
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

    # --- Critères produits génériques (e-commerce) ---
    categorie: Optional[str] = None         # libellé libre ('électronique', 'mode'…)
    sku: Optional[str] = None               # numéro de pièce / EAN si fourni
    is_generic_product: bool = False        # True si la requête ne ressemble pas à un véhicule
                                            # → autorise les marques inconnues + désactive les vetos

    # --- Pré-tri par catégorie (taxonomie) ---
    # Path complet dans l'arbre de catégories (cf. categories.py), ex:
    # 'vehicule.moto', 'electronique.cellulaire', 'accessoire.accessoire-moto'.
    # Quand défini, route les adapters via SearchAdapter.applies_to().
    category_path: Optional[str] = None

    # --- Limites de recherche ---
    max_results: int = 50
    min_score: float = 0.3                  # rejeter les hits sous ce score

    def signature(self) -> str:
        """Signature courte pour cache / logs."""
        parts = [self.raw_text or "?",
                 f"y={self.annee or self.annee_min or '?'}",
                 f"px={self.prix_min or 0}-{self.prix_max or '∞'}"]
        return " | ".join(parts)

    def search_text(self) -> str:
        """Retourne la meilleure forme textuelle de la requête à envoyer à
        une API marketplace (eBay, Shopify, …).

        En mode générique : on retourne le raw_text débarrassé des marqueurs
        prix/année (qui pollueraient la recherche full-text). L'utilisateur a
        écrit sa requête dans un ordre qui a du sens — on le préserve.

        En mode véhicule : on reconstruit "marque modele" qui est le format
        attendu par les marketplaces véhicule (AutoTrader, etc.).
        """
        if self.is_generic_product and self.raw_text:
            text = self.raw_text
            # Retire les marqueurs prix : "<", "max:", "$1234"...
            import re as _re
            text = _re.sub(r"<\s*\d[\d,.\s]*\$?", " ", text)
            text = _re.sub(r"\b(max|maximum|min|minimum|moins de|under|over|plus de|above|below)\s*[:.]\s*\d[\d,.\s]*\$?",
                           " ", text, flags=_re.IGNORECASE)
            text = _re.sub(r"\d[\d,.\s]*\$", " ", text)
            text = _re.sub(r"\s+", " ", text).strip()
            return text or self.raw_text.strip()

        bits: List[str] = []
        if self.marque:
            bits.append(self.marque)
        if self.modele:
            bits.append(self.modele)
        for kw in self.keywords:
            if kw and kw not in bits:
                bits.append(kw)
        text = " ".join(bits).strip()
        return text or self.raw_text.strip()


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
    # True si ce hit vient du 2e pass relaxé (un veto strict aurait été
    # appliqué). Sert au frontend pour afficher un badge "approximatif" et
    # à l'orchestrateur pour ne pas mélanger strict + relaxé quand des
    # hits stricts existent.
    is_approximate: bool = False
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
            "is_approximate": self.is_approximate,
        }


@dataclass
class AdapterRunStats:
    """Stats d'un adapter individuel après un run."""
    name: str = ""
    site: str = ""
    duration_seconds: float = 0.0
    products_scanned: int = 0           # nb de produits passés au filtre
    hits_returned: int = 0              # nb de produits matchant
    approximate_returned: int = 0       # parmi hits_returned, nb venant du 2e pass relaxé
    cache_hit: bool = False             # données venaient du cache
    error: str = ""                     # message si l'adapter a échoué


@dataclass
class SearchResult:
    """Résultat agrégé d'une recherche fédérée."""
    query: SearchQuery = field(default_factory=SearchQuery)
    hits: List[SearchHit] = field(default_factory=list)
    total: int = 0
    # True si l'agrégat global ne contient QUE des hits approximatifs (le
    # 1er pass strict a tout rejeté). Le frontend affiche alors une bannière
    # explicative au-dessus de la grille.
    is_approximate: bool = False

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

    @property
    def total_products_scanned(self) -> int:
        return sum(a.products_scanned for a in self.adapters_run)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query": asdict(self.query),
            "total": self.total,
            "is_approximate": self.is_approximate,
            "elapsed_seconds": round(self.elapsed_seconds, 2),
            "adapters_succeeded": self.adapters_succeeded,
            "adapters_failed": self.adapters_failed,
            "cache_hits": self.cache_hits,
            "products_scanned": self.total_products_scanned,
            "adapters_run": [asdict(a) for a in self.adapters_run],
            "hits": [h.to_display_dict() for h in self.hits],
        }
