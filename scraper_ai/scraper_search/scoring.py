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
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .categories import children_of, get_category, get_path
from .models import SearchHit, SearchQuery


# Seuil de similarité pour le fuzzy match (0..1). 0.85 = très tolérant aux
# typos mineurs (skidoo↔ski-doo, iphone↔ipone) mais rejette "honda"↔"yamaha".
_FUZZY_THRESHOLD = 0.85


def score_product(query: SearchQuery, product: Dict[str, Any]) -> Tuple[float, str]:
    """Score un produit (dict scrapé) contre une requête.
    Retourne (score, raison_humaine_pour_debug).

    Mode véhicule (par défaut) : applique les vetos durs sur marque/année.
    Mode générique (`query.is_generic_product`) : pas de veto, scoring additif souple
    qui mise sur les keywords et le SKU pour les sites e-commerce."""
    if not _product_fits_selected_category(query, product):
        return 0.0, ""

    if query.is_generic_product:
        return _score_generic(query, product)

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
    p_year = _product_year(product)
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
        if _is_precise_model_query(query.modele) and m_score < 1.0:
            return 0.0, ""
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


def _score_generic(query: SearchQuery, product: Dict[str, Any]) -> Tuple[float, str]:
    """Scoring pour produits e-commerce génériques (Amazon/eBay/Shopify/Kijiji…).

    Pondération :
      - SKU exact match           : +0.50  (jackpot)
      - Marque match              : +0.20
      - Tous les keywords trouvés : +0.40 (proportionnel)
      - Catégorie match           : +0.10
      - Prix dans range           : +0.10
      - État match (neuf/occasion): +0.05

    Pas de veto dur : un produit avec juste les keywords obtient déjà ~0.4 → suffisant
    pour passer le seuil par défaut. Cela permet à des marques inconnues de ne pas
    être filtrées (ex: une recherche "casque moto bluetooth" matchera des marques
    obscures sur Amazon).
    """
    score = 0.0
    reasons: List[str] = []
    text_blob = " ".join(str(product.get(k, "")) for k in
                         ("name", "description", "categorie", "marque", "sku")).lower()

    # --- SKU exact (50 pts) ---
    if query.sku:
        product_sku = str(product.get("sku", "") or "")
        if _normalize(query.sku) and _normalize(query.sku) == _normalize(product_sku):
            score += 0.50
            reasons.append(f"sku={query.sku}")
        elif query.sku.lower() in text_blob:
            score += 0.30
            reasons.append(f"sku~{query.sku}")

    # --- Marque (20 pts) ---
    if query.marque:
        if _string_match(query.marque, product.get("marque", "")) or \
           _string_in_text(query.marque, product.get("name", "")):
            score += 0.20
            reasons.append(f"marque={query.marque}")

    # --- Keywords (40 pts proportionnels) ---
    # On combine modele + keywords car en mode générique modele = "iPhone 15 Pro"
    # est juste une suite de keywords. On tokenise intelligemment pour que
    # "256GB" matche "256 GB" et inversement.
    all_keywords: List[str] = []
    if query.modele:
        all_keywords.extend(_tokenize_model(query.modele))
    for kw in query.keywords:
        all_keywords.extend(_tokenize_model(kw))
    all_keywords = [k for k in all_keywords if k]
    if all_keywords:
        # Normaliser le blob aussi pour que "256GB" → "256 gb" matche "256 GB"
        blob_normalized = re.sub(r"([A-Za-z])(\d)", r"\1 \2", text_blob)
        blob_normalized = re.sub(r"(\d)([A-Za-z])", r"\1 \2", blob_normalized)
        blob_normalized = _normalize(blob_normalized)
        matched = 0
        for kw in all_keywords:
            norm = _normalize(kw)
            if not norm:
                continue
            if norm.isdigit():
                if re.search(rf"(?<!\d){re.escape(norm)}(?!\d)", blob_normalized):
                    matched += 1
            elif norm in blob_normalized:
                matched += 1
            elif len(norm) >= 4 and _fuzzy_contains(norm, blob_normalized):
                matched += 1
        if query.modele and _is_precise_model_query(query.modele) and matched < len(all_keywords):
            return 0.0, ""
        ratio = matched / len(all_keywords)
        if ratio > 0:
            score += 0.40 * ratio
            reasons.append(f"kw={matched}/{len(all_keywords)}")

    # --- Catégorie (10 pts) ---
    if query.categorie and _string_in_text(query.categorie, str(product.get("categorie", ""))):
        score += 0.10
        reasons.append(f"cat={query.categorie}")

    # --- Prix (10 pts) ---
    p_price = product.get("prix")
    if isinstance(p_price, (int, float)) and (query.prix_min or query.prix_max):
        lo = query.prix_min or 0
        hi = query.prix_max or float("inf")
        if lo <= p_price <= hi:
            score += 0.10
            reasons.append(f"prix={int(p_price)}")
        elif query.prix_max and p_price > query.prix_max * 1.2:
            score *= 0.5
            reasons.append("prix-trop-haut")

    # --- État (5 pts) ---
    if query.etat and product.get("etat"):
        if query.etat.lower() == str(product["etat"]).lower():
            score += 0.05
            reasons.append(f"etat={query.etat}")

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
    """Match exact (tolérant à la ponctuation et aux typos mineurs)."""
    if not a or not b:
        return False
    na, nb = _normalize(a), _normalize(b)
    if na == nb:
        return True
    # Fuzzy fallback : tolère "skidoo"↔"ski doo", "iphone"↔"i phone", typos.
    if len(na) >= 4 and len(nb) >= 4:
        return SequenceMatcher(None, na, nb).ratio() >= _FUZZY_THRESHOLD
    return False


def _product_fits_selected_category(query: SearchQuery, product: Dict[str, Any]) -> bool:
    """Filtre de catégorie conservateur.

    Le routing des adapters évite d'interroger les mauvaises sources, mais ne
    garantit pas que chaque produit retourné appartient à la sous-catégorie
    choisie. Ce filtre ne doit toutefois jamais cacher un produit qui matche
    clairement la requête : les caches ont souvent des URLs ou libellés
    historiques imparfaits (`/vtt/` pour des SxS, catégories absentes, etc.).
    """
    path = (query.category_path or "").strip().lower()
    if not path or path.count(".") < 1:
        return True

    # Les catégories racines ou trop génériques restent permissives.
    selected = get_category(path)
    if not selected:
        return True

    text = _normalize(" ".join(str(product.get(k, "") or "") for k in (
        "name", "description", "categorie", "marque", "modele", "sourceUrl", "url",
    )))

    selected_terms = _category_terms(path)
    if selected_terms and any(_term_in_text(term, text) for term in selected_terms):
        return True

    # Si le produit correspond fortement à la requête, la taxonomie ne doit pas
    # devenir un veto. Elle est moins fiable que les données produit exactes.
    if _query_identity_matches_product(query, product):
        return True

    # Si une catégorie soeur est clairement présente, on rejette.
    parent_path = ".".join(path.split(".")[:-1])
    sibling_terms: List[str] = []
    for sibling in children_of(parent_path):
        sibling_path = get_path(sibling.slug) or sibling.slug
        if sibling_path != path:
            sibling_terms.extend(_category_terms(sibling_path))
    if sibling_terms and any(_term_in_text(term, text) for term in sibling_terms):
        return False

    # Incertain : on laisse le scoring marque/modèle/année décider.
    return True


def _query_identity_matches_product(query: SearchQuery, product: Dict[str, Any]) -> bool:
    """True si marque/année/modèle donnent une correspondance forte.

    Utilisé seulement pour éviter les faux négatifs du filtre de catégorie.
    """
    checks = 0
    passed = 0

    if query.marque:
        checks += 1
        if _string_match(query.marque, product.get("marque", "")) or \
           _string_in_text(query.marque, product.get("name", "")):
            passed += 1

    if query.annee:
        checks += 1
        p_year = _product_year(product)
        if isinstance(p_year, (int, float)) and int(p_year) == query.annee:
            passed += 1
    elif query.annee_min or query.annee_max:
        checks += 1
        p_year = _product_year(product)
        if isinstance(p_year, (int, float)):
            lo = query.annee_min or 1900
            hi = query.annee_max or 2100
            if lo <= int(p_year) <= hi:
                passed += 1

    if query.modele:
        checks += 1
        m_score, _ = _model_score(query.modele, product)
        if m_score >= 0.8:
            passed += 1

    return checks > 0 and passed == checks


def _product_year(product: Dict[str, Any]) -> Optional[int]:
    value = product.get("annee")
    if isinstance(value, (int, float)):
        return int(value)
    text = " ".join(str(product.get(k, "") or "") for k in (
        "annee", "name", "modele", "description", "sourceUrl", "url",
    ))
    m = re.search(r"\b(19|20)\d{2}\b", text)
    return int(m.group(0)) if m else None


def _category_terms(path: str) -> List[str]:
    cat = get_category(path)
    if not cat:
        return []
    raw_terms = [cat.name, cat.slug.replace("-", " "), *cat.aliases]
    # Retire les mots trop génériques qui feraient matcher n'importe quoi.
    stop = {
        "accessoire", "accessoires", "accessory", "piece", "pieces", "parts",
        "vehicule", "vehicle", "mode", "sport", "manteau", "jacket",
    }
    terms = []
    for term in raw_terms:
        norm = _normalize(term)
        if not norm or norm in stop:
            continue
        terms.append(norm)
    return sorted(set(terms), key=len, reverse=True)


def _term_in_text(term: str, text: str) -> bool:
    if not term or not text:
        return False
    if " " in term:
        return term in text
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text))


def _string_in_text(needle: str, haystack: str) -> bool:
    """Recherche d'aiguille dans une botte de foin, tolérante à la ponctuation
    et aux typos mineurs (1-2 caractères différents pour les mots ≥ 5 chars)."""
    if not needle or not haystack:
        return False
    nn, nh = _normalize(needle), _normalize(haystack)
    if not nn:
        return False
    if nn in nh:
        return True
    # Fuzzy : on glisse une fenêtre de la taille de l'aiguille sur la botte
    # de foin et on cherche le meilleur match. Utile pour "skidoo" qui doit
    # matcher "ski doo" même après normalisation (les espaces sont conservés).
    return _fuzzy_contains(nn, nh)


def _fuzzy_contains(needle: str, haystack: str) -> bool:
    """True si `needle` apparaît approximativement dans `haystack`.

    Utilise un seuil de SequenceMatcher.ratio() sur des fenêtres glissantes
    de la taille de l'aiguille. Limité aux aiguilles ≥ 5 caractères pour
    éviter les faux positifs sur les mots courts.
    """
    if len(needle) < 5 or not haystack:
        return False
    n_len = len(needle)
    # Pour les mots, on compare aussi token par token (plus précis qu'une
    # fenêtre glissante naïve).
    for token in haystack.split():
        if len(token) < 3:
            continue
        if SequenceMatcher(None, needle, token).ratio() >= _FUZZY_THRESHOLD:
            return True
    # Fenêtre glissante (couvre les cas "ski doo" → "skidoo")
    h_compact = haystack.replace(" ", "")
    n_compact = needle.replace(" ", "")
    if n_compact in h_compact:
        return True
    if len(n_compact) >= 5 and len(h_compact) >= len(n_compact):
        for i in range(0, len(h_compact) - n_compact.__len__() + 1):
            chunk = h_compact[i:i + len(n_compact)]
            if SequenceMatcher(None, n_compact, chunk).ratio() >= _FUZZY_THRESHOLD:
                return True
    # Suppression de la ponctuation comme dernier recours
    n_alpha = re.sub(r"[^a-z0-9]", "", needle)
    h_alpha = re.sub(r"[^a-z0-9]", "", haystack)
    if n_alpha and n_alpha in h_alpha:
        return True
    return False


def _normalize(s: str) -> str:
    """Normalise une chaîne : minuscules, sans accent, ponctuation → espace,
    espaces compactés. La ponctuation (tirets, apostrophes, points) devient
    un séparateur — ainsi 'Ski-Doo' et 'Ski Doo' produisent le même résultat
    'ski doo'."""
    s = s.lower().strip()
    for a, b in (("é", "e"), ("è", "e"), ("ê", "e"), ("ë", "e"),
                 ("à", "a"), ("â", "a"), ("ä", "a"),
                 ("î", "i"), ("ï", "i"),
                 ("ô", "o"), ("ö", "o"),
                 ("ù", "u"), ("û", "u"), ("ü", "u"),
                 ("ç", "c"), ("ñ", "n")):
        s = s.replace(a, b)
    # Convertit toute ponctuation en espace (tirets, apostrophes, points,
    # underscores, slashes…) — Ski-Doo ≡ Ski Doo ≡ skidoo après nettoyage.
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
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
        if norm_tok.isdigit():
            # Match strict (boundary) pour les tokens numériques (150, 250, 600)
            if re.search(rf"(?<!\d){re.escape(norm_tok)}(?!\d)", blob):
                matched.append(tok)
        elif norm_tok in blob:
            matched.append(tok)
        elif len(norm_tok) >= 4 and _fuzzy_contains(norm_tok, blob):
            # Tolérance typo pour les mots ≥ 4 caractères
            matched.append(tok)
    if not matched:
        return 0.0, ""
    ratio = len(matched) / len(qtokens)
    return ratio, " ".join(matched)


def _is_precise_model_query(model: str) -> bool:
    """True pour les modèles courts où une partie numérique identifie le produit.

    Exemples : "TC 85", "150 SX", "YZ250F", "Summit 850".
    Dans ces cas, accepter seulement "TC" ou seulement "SX" crée de faux positifs
    (TC 65, TC 300, 250 SX). On exige donc tous les tokens du modèle.
    """
    tokens = _tokenize_model(model)
    if len(tokens) < 2 or len(tokens) > 4:
        return False
    has_digit = any(_normalize(t).isdigit() for t in tokens)
    has_letters = any(re.search(r"[A-Za-z]", t) for t in tokens)
    return has_digit and has_letters


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
