"""
Calcul du score de pertinence d'un produit par rapport à une requête.

Score 0..1 :
  - 0.0 = aucun match
  - 1.0 = match parfait sur tous les critères structurés
  - >0.3 = considéré pertinent (seuil par défaut)

Pondération :
  - marque match           : +0.30
  - année exacte           : +0.20  (ou range : +0.15)
  - modèle (token a token) : +0.30  (proportionnel au % de tokens trouvés)
  - prix dans range        : +0.10
  - couleur match          : +0.05
  - keywords supplémentaires (bonus) : +0.05
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .models import SearchHit, SearchQuery


def score_product(query: SearchQuery, product: Dict[str, Any]) -> Tuple[float, str]:
    """Score un produit (dict scrapé) contre une requête.
    Retourne (score, raison_humaine_pour_debug)."""
    score = 0.0
    reasons: List[str] = []

    # --- Marque (30 pts) ---
    if query.marque:
        if _string_match(query.marque, product.get("marque", "")) or \
           _string_in_text(query.marque, product.get("name", "")):
            score += 0.30
            reasons.append(f"marque={query.marque}")
        else:
            # Pas de marque → veto léger sur ce hit (pertinence faible)
            return 0.0, ""

    # --- Année (20 pts si exacte, 15 si range) ---
    p_year = product.get("annee")
    if isinstance(p_year, str):
        m = re.search(r"(19|20)\d{2}", p_year)
        p_year = int(m.group(0)) if m else None
    if isinstance(p_year, (int, float)):
        p_year = int(p_year)
        if query.annee:
            if p_year == query.annee:
                score += 0.20
                reasons.append(f"annee={p_year}")
            elif abs(p_year - query.annee) <= 1:
                score += 0.10
                reasons.append(f"annee~{p_year}")
            else:
                # Année très différente : veto si query précise
                return 0.0, ""
        elif query.annee_min or query.annee_max:
            lo = query.annee_min or 1900
            hi = query.annee_max or 2100
            if lo <= p_year <= hi:
                score += 0.15
                reasons.append(f"annee={p_year}∈[{lo},{hi}]")
            else:
                return 0.0, ""

    # --- Modèle (30 pts, proportionnel) ---
    if query.modele:
        m_score, m_matched = _model_score(query.modele, product)
        if m_score > 0:
            score += 0.30 * m_score
            reasons.append(f"modele≈{m_matched}({m_score:.0%})")
        elif query.marque is None:
            # Si même la marque n'est pas trouvée et le modèle non plus → 0
            return 0.0, ""

    # --- Prix (10 pts) ---
    p_price = product.get("prix")
    if isinstance(p_price, (int, float)) and (query.prix_min or query.prix_max):
        lo = query.prix_min or 0
        hi = query.prix_max or float("inf")
        if lo <= p_price <= hi:
            score += 0.10
            reasons.append(f"prix={int(p_price)}$")
        elif query.prix_max and p_price > query.prix_max * 1.1:
            score *= 0.5  # pénalité forte hors range max
            reasons.append("prix-trop-haut")

    # --- Couleur (5 pts) ---
    if query.couleur:
        if _string_in_text(query.couleur, product.get("couleur", "")) or \
           _string_in_text(query.couleur, product.get("name", "")):
            score += 0.05
            reasons.append(f"couleur={query.couleur}")

    # --- État (neuf/occasion) ---
    if query.etat and product.get("etat"):
        if query.etat.lower() == str(product["etat"]).lower():
            score += 0.05
            reasons.append(f"etat={query.etat}")
        else:
            score *= 0.7

    # --- Keywords additionnels (5 pts max) ---
    if query.keywords:
        text_blob = " ".join(str(product.get(k, "")) for k in
                             ("name", "description", "modele")).lower()
        hits = sum(1 for kw in query.keywords if kw.lower() in text_blob)
        if hits:
            score += min(0.05, hits / max(1, len(query.keywords)) * 0.05)
            reasons.append(f"+{hits}kw")

    return min(1.0, score), " · ".join(reasons)


def make_hit(product: Dict[str, Any], score: float, reason: str,
             source_site: str, source_slug: str) -> SearchHit:
    """Construit un SearchHit à partir d'un produit scrapé."""
    return SearchHit(
        name=str(product.get("name", "")),
        prix=_safe_float(product.get("prix")),
        annee=_safe_int(product.get("annee")),
        marque=product.get("marque") or None,
        modele=product.get("modele") or None,
        kilometrage=_safe_int(product.get("kilometrage")),
        couleur=product.get("couleur") or None,
        image=str(product.get("image", "")),
        description=str(product.get("description", ""))[:500],
        etat=product.get("etat") or None,
        source_site=source_site,
        source_slug=source_slug,
        source_url=str(product.get("sourceUrl") or product.get("url") or ""),
        score=score,
        match_reason=reason,
        raw=product,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _string_match(a: str, b: str) -> bool:
    """Match exact insensible casse/espaces/accents simples."""
    if not a or not b:
        return False
    return _normalize(a) == _normalize(b)


def _string_in_text(needle: str, haystack: str) -> bool:
    if not needle or not haystack:
        return False
    return _normalize(needle) in _normalize(haystack)


def _normalize(s: str) -> str:
    s = s.lower().strip()
    # Suppression accents simples
    for a, b in (("é", "e"), ("è", "e"), ("ê", "e"), ("à", "a"),
                 ("â", "a"), ("î", "i"), ("ô", "o"), ("ù", "u"),
                 ("ç", "c")):
        s = s.replace(a, b)
    s = re.sub(r"\s+", " ", s)
    return s


def _model_score(query_model: str, product: Dict[str, Any]) -> Tuple[float, str]:
    """Calcule la proportion de tokens du modèle requête trouvés dans le produit.
    Renvoie (ratio 0..1, version normalisée des tokens matchés)."""
    qtokens = _tokenize_model(query_model)
    if not qtokens:
        return 0.0, ""

    blob = _normalize(" ".join(str(product.get(k, ""))
                                for k in ("name", "modele", "marque", "description")))
    matched = []
    for tok in qtokens:
        norm_tok = _normalize(tok)
        if not norm_tok:
            continue
        # Match strict (boundary) pour les tokens courts numériques (150, 250, 600)
        if norm_tok.isdigit():
            if re.search(rf"(?<!\d){re.escape(norm_tok)}(?!\d)", blob):
                matched.append(tok)
        else:
            if norm_tok in blob:
                matched.append(tok)
    if not matched:
        return 0.0, ""
    ratio = len(matched) / len(qtokens)
    return ratio, " ".join(matched)


def _tokenize_model(model: str) -> List[str]:
    """Split intelligemment 'YZ250F' en ['yz', '250', 'f'] et 'SX 150' en ['sx', '150']."""
    out: List[str] = []
    for token in model.split():
        # Splitter alpha/digit dans un token soudé (YZ250F → YZ 250 F)
        parts = re.findall(r"[A-Za-z]+|\d+", token)
        out.extend(p for p in parts if p)
    return out


def _safe_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _safe_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None
