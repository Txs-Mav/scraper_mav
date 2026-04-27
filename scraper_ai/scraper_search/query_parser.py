"""
Parseur de requête langage naturel → SearchQuery structurée.

Exemples d'entrée :
  "KTM SX 150 2026"               → marque=KTM, modele='SX 150', annee=2026
  "Honda Civic 2022 < 25000$"     → marque=Honda, modele=Civic, annee=2022, prix_max=25000
  "Yamaha YZ250F neuf"            → marque=Yamaha, modele=YZ250F, etat=neuf
  "moto sport 2023-2025 5000-15000$"
                                  → type=moto, annee_min=2023, annee_max=2025,
                                    prix_min=5000, prix_max=15000

Approche : règles regex robustes en cascade. Pas de dépendance NLP lourde —
les requêtes vehicules/produits sont assez stéréotypées pour s'en passer.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from .models import SearchQuery


# ---------------------------------------------------------------------------
# Vocabulaires
# ---------------------------------------------------------------------------

# Marques courantes (motos, autos, powersport, side-by-side). Liste ouverte —
# le parser conserve TOUJOURS la 1re token capitalisée comme candidat marque.
KNOWN_BRANDS = {
    # Motos / powersport
    "honda", "yamaha", "kawasaki", "suzuki", "ktm", "husqvarna", "gas gas",
    "gasgas", "beta", "bmw", "ducati", "aprilia", "triumph", "harley", "harley-davidson",
    "indian", "polaris", "ski-doo", "skidoo", "can-am", "canam", "arctic cat",
    "arcticcat", "sea-doo", "seadoo", "victory", "royal enfield", "moto guzzi",
    "vespa", "piaggio", "kymco", "cfmoto", "cf moto", "sym", "gas-gas", "sherco",
    # Auto
    "toyota", "ford", "chevrolet", "chevy", "gmc", "dodge", "ram", "jeep",
    "chrysler", "nissan", "mazda", "subaru", "hyundai", "kia", "volkswagen",
    "vw", "audi", "mercedes", "mercedes-benz", "lexus", "infiniti", "acura",
    "tesla", "porsche", "land rover", "range rover", "mitsubishi", "fiat",
    "volvo", "mini", "buick", "cadillac", "lincoln", "genesis", "rivian",
    "lucid", "polestar",
}

VEHICLE_TYPES = {
    "moto": "moto", "motos": "moto", "motorcycle": "moto", "motocyclette": "moto",
    "vtt": "vtt", "atv": "vtt", "quad": "vtt",
    "motoneige": "motoneige", "motoneiges": "motoneige", "snowmobile": "motoneige",
    "sxs": "sxs", "side-by-side": "sxs", "côte-à-côte": "sxs",
    "auto": "auto", "voiture": "auto", "car": "auto", "vehicule": "auto",
    "véhicule": "auto", "suv": "auto", "vus": "auto", "truck": "auto",
    "camion": "auto", "pickup": "auto",
}

CONDITION_NEW = {"neuf", "neufs", "new", "brand new", "0 km"}
CONDITION_USED = {"occasion", "occasions", "used", "usagé", "usage", "pre-owned",
                  "preowned", "second-hand", "secondhand"}

COLORS = {
    "noir", "black", "blanc", "white", "rouge", "red", "bleu", "blue",
    "vert", "green", "jaune", "yellow", "gris", "grey", "gray",
    "orange", "violet", "purple", "argent", "silver", "or", "gold",
    "brun", "brown", "beige", "rose", "pink",
}

# ---------------------------------------------------------------------------
# Patterns prix / année
# ---------------------------------------------------------------------------

# Patterns prix : exigent $ et un nombre COMPACT (pas d'espaces internes pour
# éviter "850 5000" → 8505000). Virgules et points autorisés (1,000 / 25.000).
_PRICE_RANGE = re.compile(
    r"(\d[\d,.]{1,12})\s*[-à]\s*(\d[\d,.]{1,12})\s*\$",
    re.IGNORECASE,
)
_PRICE_MAX = re.compile(
    r"(?:<|moins de|sous|under|below|max(?:\.|imum)?\s*:?)\s*(\d[\d,.]{1,12})\s*\$?",
    re.IGNORECASE,
)
_PRICE_MIN = re.compile(
    r"(?:>|plus de|over|above|min(?:\.|imum)?\s*:?)\s*(\d[\d,.]{1,12})\s*\$?",
    re.IGNORECASE,
)
_PRICE_AT = re.compile(r"(\d[\d,.]{2,12})\s*\$")

# Année range : exige espaces optionnels, années 4 chiffres encadrant le tiret
_YEAR_RANGE = re.compile(r"\b(19[5-9]\d|20\d{2})\s*[-à]\s*(19[5-9]\d|20\d{2})\b")
_YEAR_SINGLE = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def parse_query(text: str) -> SearchQuery:
    """Convertit un texte libre en SearchQuery structurée.
    Ne fait jamais d'erreur — au pire renvoie une SearchQuery avec juste raw_text + keywords."""
    if not text or not text.strip():
        return SearchQuery(raw_text=text or "")

    raw = text.strip()
    q = SearchQuery(raw_text=raw)
    remaining = raw

    # 1) Année AVANT prix : sinon "850 2023-2025" serait pris comme prix range
    remaining, q.annee, q.annee_min, q.annee_max = _extract_years(remaining)

    # 2) Prix (range > max > min > brut $)
    remaining, q.prix_min, q.prix_max = _extract_prices(remaining)

    # 3) Type véhicule
    remaining, q.type_vehicule = _extract_first_match(remaining, VEHICLE_TYPES)

    # 4) Condition (neuf / occasion)
    remaining, q.etat = _extract_condition(remaining)

    # 5) Couleur
    remaining, q.couleur = _extract_first_match(
        remaining, {c: c for c in COLORS}, word_boundary=True,
    )

    # 6) Marque (1er token reconnu OU 1er token capitalisé)
    remaining, q.marque = _extract_brand(remaining)

    # 7) Modèle = ce qui reste (heuristique : alphanum, capitalisé, court)
    q.modele, q.keywords = _extract_model_and_keywords(remaining)

    return q


# ---------------------------------------------------------------------------
# Sub-extractors
# ---------------------------------------------------------------------------

def _extract_prices(text: str) -> Tuple[str, Optional[float], Optional[float]]:
    """Retourne (text restant, prix_min, prix_max)."""
    prix_min: Optional[float] = None
    prix_max: Optional[float] = None

    m = _PRICE_RANGE.search(text)
    if m:
        a = _parse_money(m.group(1))
        b = _parse_money(m.group(2))
        if a and b:
            prix_min, prix_max = min(a, b), max(a, b)
            text = (text[:m.start()] + " " + text[m.end():]).strip()
            return text, prix_min, prix_max

    m = _PRICE_MAX.search(text)
    if m:
        prix_max = _parse_money(m.group(1))
        text = (text[:m.start()] + " " + text[m.end():]).strip()

    m = _PRICE_MIN.search(text)
    if m:
        prix_min = _parse_money(m.group(1))
        text = (text[:m.start()] + " " + text[m.end():]).strip()

    if prix_min is None and prix_max is None:
        m = _PRICE_AT.search(text)
        if m:
            val = _parse_money(m.group(1))
            if val and val >= 100:
                prix_max = val  # interprétation prudente : "20000$" → max 20k
                text = (text[:m.start()] + " " + text[m.end():]).strip()

    return text, prix_min, prix_max


def _parse_money(s: str) -> Optional[float]:
    cleaned = re.sub(r"[^\d.,]", "", s.strip())
    cleaned = cleaned.replace(",", "").replace(" ", "")
    if "." in cleaned:
        parts = cleaned.split(".")
        if len(parts[-1]) > 2:
            cleaned = cleaned.replace(".", "")
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def _extract_years(text: str) -> Tuple[str, Optional[int], Optional[int], Optional[int]]:
    """Retourne (text restant, annee_exacte, annee_min, annee_max)."""
    m = _YEAR_RANGE.search(text)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        text = (text[:m.start()] + " " + text[m.end():]).strip()
        return text, None, min(a, b), max(a, b)

    years = _YEAR_SINGLE.findall(text)
    if years:
        # Si plusieurs années, on prend la min comme annee_min et max comme annee_max
        if len(set(years)) > 1:
            ints = sorted(int(y) for y in years)
            for y in years:
                text = re.sub(rf"\b{y}\b", " ", text, count=1)
            return text.strip(), None, ints[0], ints[-1]
        else:
            y = int(years[0])
            text = re.sub(rf"\b{years[0]}\b", " ", text, count=1).strip()
            return text, y, None, None

    return text, None, None, None


def _extract_first_match(text: str, vocab_map: dict,
                          word_boundary: bool = True) -> Tuple[str, Optional[str]]:
    """Cherche le 1er mot du vocab dans le texte, le retire, retourne la valeur mappée.
    Utilise toujours \\b pour éviter de matcher 'auto' dans 'automatique', etc."""
    text_lower = text.lower()
    for term in sorted(vocab_map.keys(), key=len, reverse=True):
        if word_boundary:
            pattern = rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])"
            m = re.search(pattern, text_lower)
        else:
            idx = text_lower.find(term)
            if idx < 0:
                continue
            m = re.search(re.escape(term), text_lower[idx:])
            if m:
                m = re.match(".*", text)  # placeholder
                start = idx
                end = idx + len(term)
                text = (text[:start] + " " + text[end:]).strip()
                return text, vocab_map[term]
            continue
        if m:
            start, end = m.start(), m.end()
            text = (text[:start] + " " + text[end:]).strip()
            text = re.sub(r"\s+", " ", text)
            return text, vocab_map[term]
    return text, None


def _extract_condition(text: str) -> Tuple[str, Optional[str]]:
    text_lower = text.lower()
    for w in CONDITION_NEW:
        if re.search(rf"\b{re.escape(w)}\b", text_lower):
            text = re.sub(rf"\b{re.escape(w)}\b", " ", text, flags=re.IGNORECASE).strip()
            return text, "neuf"
    for w in CONDITION_USED:
        if re.search(rf"\b{re.escape(w)}\b", text_lower):
            text = re.sub(rf"\b{re.escape(w)}\b", " ", text, flags=re.IGNORECASE).strip()
            return text, "occasion"
    return text, None


def _extract_brand(text: str) -> Tuple[str, Optional[str]]:
    """Extrait la marque : 1er match dans KNOWN_BRANDS, sinon 1er token capitalisé."""
    text_lower = text.lower()
    # Trier par longueur décroissante (matcher 'harley-davidson' avant 'harley')
    for brand in sorted(KNOWN_BRANDS, key=len, reverse=True):
        pattern = rf"\b{re.escape(brand)}\b"
        m = re.search(pattern, text_lower)
        if m:
            actual = text[m.start():m.end()]
            text = (text[:m.start()] + " " + text[m.end():]).strip()
            text = re.sub(r"\s+", " ", text)
            return text, _normalize_brand(actual)

    # Fallback : 1er mot capitalisé
    tokens = text.split()
    for i, tok in enumerate(tokens):
        if len(tok) > 1 and tok[0].isupper() and tok.isalpha():
            tokens.pop(i)
            return " ".join(tokens).strip(), _normalize_brand(tok)

    return text, None


def _normalize_brand(name: str) -> str:
    """Normalise les variantes (ex: 'harley' → 'Harley-Davidson', 'gasgas' → 'GasGas')."""
    n = name.lower().strip()
    aliases = {
        "harley": "Harley-Davidson",
        "skidoo": "Ski-Doo",
        "ski-doo": "Ski-Doo",
        "canam": "Can-Am",
        "can-am": "Can-Am",
        "seadoo": "Sea-Doo",
        "sea-doo": "Sea-Doo",
        "arcticcat": "Arctic Cat",
        "arctic cat": "Arctic Cat",
        "gasgas": "GasGas",
        "gas gas": "GasGas",
        "vw": "Volkswagen",
        "chevy": "Chevrolet",
    }
    if n in aliases:
        return aliases[n]
    # Title case avec préservation de la casse pour les sigles courts
    if len(n) <= 3:
        return n.upper()
    return n.title()


_MODEL_FILLER = {"de", "du", "le", "la", "les", "the", "and", "et", "or", "ou",
                 "with", "avec", "for", "pour"}


def _extract_model_and_keywords(remaining: str) -> Tuple[Optional[str], List[str]]:
    """Le reste du texte = modèle + keywords.
    Heuristique : on prend les tokens 'modèle-like' (capitalisés, alphanumériques,
    contenant des chiffres) en préservant l'ordre d'apparition."""
    if not remaining or not remaining.strip():
        return None, []

    remaining = re.sub(r"[,;:]", " ", remaining)
    remaining = re.sub(r"\s+", " ", remaining).strip()
    tokens = [t for t in remaining.split() if t and len(t) >= 1]
    tokens = [t for t in tokens if t.lower() not in _MODEL_FILLER]
    if not tokens:
        return None, []

    # Tous les tokens restants sont candidats au modèle si :
    #  - contiennent un chiffre  (SX150, 250, F-150)
    #  - sont en MAJUSCULES      (CBR, YZ, RR, GT)
    #  - sont capitalisés        (Civic, Tundra, Wrangler)
    #  - sont courts < 5 chars   (Si, R1, MT)
    model_tokens: List[str] = []
    keyword_tokens: List[str] = []

    for tok in tokens:
        is_modelish = (
            any(c.isdigit() for c in tok)
            or tok.isupper()
            or (tok[0].isupper() and tok[1:].islower())
            or len(tok) <= 4
        )
        if is_modelish:
            model_tokens.append(tok)
        else:
            keyword_tokens.append(tok)

    if len(model_tokens) > 5:
        keyword_tokens = model_tokens[5:] + keyword_tokens
        model_tokens = model_tokens[:5]

    modele = " ".join(model_tokens) if model_tokens else None
    return modele, keyword_tokens
