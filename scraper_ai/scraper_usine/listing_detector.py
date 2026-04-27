"""
Détecteur statistique de listings.

Trouve automatiquement les "grappes" d'éléments répétés (cards produit, items de
liste, vignettes…) sans dépendre d'une liste hardcodée de sélecteurs. Algorithme :

  1. Pour chaque conteneur (parent), compter ses enfants directs qui partagent
     le même tag + signature de classes.
  2. Garder les groupes ≥ 4 éléments.
  3. Scorer chaque groupe sur :
        - nombre d'éléments
        - homogénéité (variance de la taille HTML, % avec lien interne, % avec image)
        - densité de signaux produit (prix, image, lien, prix/numérique)
        - alignement avec hints du DomainProfile
  4. Retourner le meilleur sélecteur CSS représentant les items.

Inspiré de l'approche de Trafilatura / autoscraper / Diffbot.
"""
from __future__ import annotations

import re
import statistics
from collections import Counter
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Tag


PRICE_PATTERN = re.compile(r"(\$\s?[\d,.]+|\d[\d\s,.]*\$|€\s?[\d,.]+)")
INT_PATTERN = re.compile(r"\d{2,}")


class ListingCandidate:
    """Un candidat groupe d'items répétés."""

    def __init__(self, parent: Tag, signature: str, items: List[Tag]):
        self.parent = parent
        self.signature = signature
        self.items = items
        self.score: float = 0.0
        self.metrics: Dict[str, float] = {}

    @property
    def selector(self) -> str:
        """Construit un sélecteur CSS pour les items de ce candidat."""
        first = self.items[0]
        tag = first.name
        classes = [c for c in first.get("class", []) if c and not _looks_random(c)]
        if classes:
            return f"{tag}." + ".".join(classes[:3])
        if first.get("id") and not _looks_random(first.get("id", "")):
            return f"{tag}#{first['id']}"
        # fallback parent + tag
        parent_sel = _parent_selector(self.parent)
        return f"{parent_sel} > {tag}" if parent_sel else tag


def detect_listings(
    html: str,
    *,
    min_items: int = 4,
    item_hints: Optional[List[str]] = None,
    base_url: str = "",
) -> List[ListingCandidate]:
    """
    Trouve tous les groupes d'items répétés dans une page HTML, triés par score.

    Args:
        html : HTML brut de la page
        min_items : nombre minimum d'éléments pour considérer un groupe (défaut 4)
        item_hints : sélecteurs CSS du DomainProfile à favoriser
        base_url : URL de la page (pour normaliser les liens)

    Returns:
        Liste de ListingCandidate triée par score décroissant.
    """
    soup = BeautifulSoup(html, "lxml")
    domain = urlparse(base_url).netloc.replace("www.", "") if base_url else ""

    # 1. Trouver tous les groupes d'enfants frères-frères répétés
    candidates: List[ListingCandidate] = []
    seen_signatures = set()

    for parent in soup.find_all(True):
        children = [c for c in parent.children if isinstance(c, Tag)]
        if len(children) < min_items:
            continue
        # Grouper par signature (tag + premières classes)
        groups: Dict[str, List[Tag]] = {}
        for child in children:
            sig = _signature(child)
            groups.setdefault(sig, []).append(child)
        for sig, items in groups.items():
            if len(items) < min_items:
                continue
            full_sig = f"{id(parent)}:{sig}"
            if full_sig in seen_signatures:
                continue
            seen_signatures.add(full_sig)
            candidates.append(ListingCandidate(parent, sig, items))

    # 2. Scorer chaque candidat
    for cand in candidates:
        cand.score = _score_candidate(cand, item_hints or [], domain)

    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates


def best_listing(
    html: str,
    *,
    item_hints: Optional[List[str]] = None,
    base_url: str = "",
    min_items: int = 4,
) -> Optional[ListingCandidate]:
    """Retourne le meilleur candidat ou None si rien de pertinent."""
    candidates = detect_listings(html, item_hints=item_hints, base_url=base_url,
                                 min_items=min_items)
    if not candidates:
        return None
    best = candidates[0]
    if best.score < 0.25:
        return None
    return best


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

_RANDOM_HASH = re.compile(r"^[a-z0-9_-]{16,}$|^[A-Za-z]+__[A-Za-z0-9]{6,}$")


def _looks_random(s: str) -> bool:
    """Détecte les classes hashées style CSS-in-JS (ex: 'css-1k2j3h', 'Card__sc-1abc')."""
    if not s:
        return True
    return bool(_RANDOM_HASH.match(s)) or s.startswith("css-")


def _signature(tag: Tag) -> str:
    """Signature stable d'un élément : tag + jusqu'à 3 classes non-aléatoires."""
    classes = [c for c in tag.get("class", []) if c and not _looks_random(c)]
    classes.sort()
    return f"{tag.name}|" + ",".join(classes[:3])


def _parent_selector(parent: Tag) -> str:
    if not parent or parent.name in ("[document]", "html"):
        return ""
    if parent.get("id") and not _looks_random(parent["id"]):
        return f"#{parent['id']}"
    classes = [c for c in parent.get("class", []) if not _looks_random(c)]
    if classes:
        return f"{parent.name}." + ".".join(classes[:2])
    return parent.name


def _score_candidate(cand: ListingCandidate, hints: List[str], domain: str) -> float:
    items = cand.items
    n = len(items)

    # --- Volume (0.0 → 0.3) ---
    volume_score = min(1.0, n / 20.0) * 0.3

    # --- Homogénéité de la taille HTML (0.0 → 0.15) ---
    sizes = [len(str(it)) for it in items]
    if len(sizes) > 1:
        mean_size = statistics.mean(sizes)
        stdev = statistics.stdev(sizes)
        cv = stdev / mean_size if mean_size > 0 else 1.0
        homogeneity = max(0.0, 1.0 - cv) * 0.15
    else:
        homogeneity = 0.0

    # --- Présence de signaux produit (0.0 → 0.35) ---
    with_link = 0
    with_image = 0
    with_price = 0
    with_internal_link = 0
    text_lengths = []

    for it in items[:30]:  # cap pour perf
        text = it.get_text(separator=" ", strip=True)
        text_lengths.append(len(text))
        link = it.find("a", href=True)
        if link:
            with_link += 1
            href = link["href"]
            if href.startswith("/") or (domain and domain in href):
                with_internal_link += 1
        if it.find("img"):
            with_image += 1
        if PRICE_PATTERN.search(text):
            with_price += 1

    sample_n = min(len(items), 30)
    if sample_n == 0:
        return 0.0

    link_ratio = with_link / sample_n
    image_ratio = with_image / sample_n
    price_ratio = with_price / sample_n
    internal_ratio = with_internal_link / sample_n

    signals = (
        link_ratio * 0.10 +
        image_ratio * 0.10 +
        price_ratio * 0.10 +
        internal_ratio * 0.05
    )

    # --- Alignement avec hints du DomainProfile (0.0 → 0.15) ---
    hint_score = 0.0
    first = items[0]
    classes_text = " ".join(first.get("class", [])).lower()
    tag_name = first.name
    for hint in hints:
        h = hint.lower().lstrip(".#")
        if h in classes_text or h == tag_name:
            hint_score = 0.15
            break

    # --- Pénalité éléments trop petits (juste icônes / liens nav) ---
    avg_text = statistics.mean(text_lengths) if text_lengths else 0
    if avg_text < 20:
        return 0.0  # rejet : trop court pour être un produit
    if avg_text < 40:
        signals *= 0.5

    # --- Bonus markup data-* product (Shopify, Wix…) ---
    bonus = 0.0
    if first.get("data-product-id") or first.get("data-product-handle") or \
       first.get("data-vehicle-id") or first.get("data-listing-id"):
        bonus = 0.05

    return volume_score + homogeneity + signals + hint_score + bonus


def measure_completeness(html: str, item_selector: str) -> float:
    """Mesure quelle proportion de signaux produit (lien, image, prix, name) est présente
    dans les items capturés par item_selector. 0.0 à 1.0."""
    soup = BeautifulSoup(html, "lxml")
    items = soup.select(item_selector)
    if not items:
        return 0.0
    sample = items[:10]
    fields = {"name": 0, "link": 0, "image": 0, "price": 0}
    for it in sample:
        text = it.get_text(separator=" ", strip=True)
        if len(text) > 10:
            fields["name"] += 1
        if it.find("a", href=True):
            fields["link"] += 1
        if it.find("img"):
            fields["image"] += 1
        if PRICE_PATTERN.search(text):
            fields["price"] += 1
    return sum(v / len(sample) for v in fields.values()) / len(fields)
