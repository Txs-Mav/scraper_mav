"""
Helpers partagés entre scraper_usine (Phase 1 d'analyse) et le code généré
(scrapers dédiés produits par le générateur).

Source de vérité unique pour:
  - is_product_url      : décision "cette URL est-elle une fiche produit ?"
  - filter_language_duplicates : préférer FR sur EN quand les deux existent
  - classify_state      : déduire 'neuf' | 'occasion' | 'demonstrateur'
  - fix_mojibake        : corriger un texte UTF-8 mal décodé en latin-1
  - build_paginated_url : ajouter/remplacer un param de pagination URL-safe
  - extract_path_field  : navigation dict imbriqué via 'a.b.c'

Ce module ne dépend de RIEN d'autre que la stdlib pour rester importable
depuis n'importe quel scraper généré sans cycle d'import.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import (
    parse_qs, urlencode, urlparse, urlunparse,
)


# ---------------------------------------------------------------------------
# is_product_url — heuristique unique
# ---------------------------------------------------------------------------

# Exclusions transversales (pages non-produit qu'on retrouve sur tout site).
_DEFAULT_EXCLUDED_PATH_PARTS: Tuple[str, ...] = (
    "/blog", "/contact", "/about", "/a-propos", "/politique",
    "/privacy", "/terms", "/conditions",
    "/emploi", "/carrieres", "/careers", "/nouvelles", "/news",
    "/tag/", "/category/", "/wp-content/", "/page/",
    "/css/", "/js/", "/images/", "/assets/", "/fonts/",
    "/login", "/account", "/compte", "/cart", "/panier", "/checkout",
    "/wishlist", "/favoris", "/comparer", "/compare",
    "/service/", "/financement/", "/pieces/", "/parts/",
    "/equipe/", "/team/", "/promotions/", "/promotion/",
    "/store-locator", "/magasins", "/boutiques",
    "/shipping", "/livraison", "/returns", "/retour",
    "/faq", "/aide", "/help", "/support",
    "/gallery", "/galerie", "/photos", "/media",
    "/heures", "/hours", "/directions", "/map", "/carte",
    "/temoignages", "/testimonials", "/reviews",
    "/calculator", "/calculatrice", "/mortgage", "/hypotheque",
    "/agents", "/courtiers",
    "/gift-card", "/carte-cadeau",
)

_DEFAULT_EXCLUDED_EXTENSIONS: Tuple[str, ...] = (
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
    ".ico", ".css", ".js", ".xml", ".txt",
)

# Signaux génériques (toutes verticales) pour reconnaître une fiche produit
# par son chemin URL.
_DEFAULT_PRODUCT_PATH_SIGNALS: Tuple[str, ...] = (
    # Powersports / motos / autos
    "/neuf/", "/neufs/", "/occasion/", "/occasions/", "/usage/", "/usages/",
    "/inventory/", "/inventaire/", "/vehicle/", "/vehicule/",
    "/moto/", "/motoneige/", "/vtt/", "/quad/", "/side-by-side/",
    "/new/", "/used/", "/certified/", "/pre-owned/",
    "/cars/", "/trucks/", "/suv/", "/sedan/",
    "/voiture/", "/camion/", "/vus/",
    "/listing/", "/stock/", "/vin/",
    # E-commerce
    "/products/", "/product/", "/produit/", "/produits/",
    "/p/", "/-p-", "/item/", "/detail/",
    "/collections/",
    # Immobilier
    "/property/", "/listing/", "/propriete/",
    "/maison/", "/condo/", "/mls",
    # Emplois
    "/jobs/", "/job/", "/emploi/", "/emplois/",
    "/career/", "/posting/",
)

_LIKELY_DETAIL_REGEXES: Tuple[re.Pattern, ...] = (
    # ID numérique en fin de slug (eDealer/PowerGO style)
    re.compile(r"-id\d+/?$", re.I),
    # /neuf/2024-honda-civic, /used/2023-toyota
    re.compile(r"/(?:new|used|neuf|occasion|usage|usages)/\d{4}-", re.I),
    # /neuf/honda-civic-...
    re.compile(r"/(?:new|used|neuf|occasion|usage|usages)/[A-Za-z]+-[A-Za-z]", re.I),
    # PowerGO: ...-a-vendre-12345
    re.compile(r"-a-vendre-\d+/?$", re.I),
    # PrestaShop: /15-honda-cbr
    re.compile(r"/\d+-[a-z]", re.I),
    # *.html avec année
    re.compile(r"\.html$.*\d{4}", re.I),
)


def is_product_url(
    url: str,
    *,
    domain: str = "",
    excluded_paths: Optional[Iterable[str]] = None,
    detail_url_patterns: Optional[Iterable[str]] = None,
    extra_path_signals: Optional[Iterable[str]] = None,
) -> bool:
    """Décide si une URL ressemble à une fiche produit.

    Args:
        url: URL à tester (absolue ou relative).
        domain: si fourni, l'URL doit appartenir à ce domaine (ou ses sous-domaines).
        excluded_paths: chemins à rejeter (en supplément des exclusions par défaut).
            Provient typiquement de DomainProfile.excluded_paths.
        detail_url_patterns: regex (str) attendues dans le path. Provient de
            DomainProfile.detail_url_patterns. Si match, la fonction retourne True.
        extra_path_signals: substrings à considérer comme signal positif
            (en supplément de la liste par défaut). Typiquement issus du PlatformRecipe.
    """
    if not url:
        return False

    parsed = urlparse(url)
    if not parsed.path and not parsed.netloc:
        return False

    if domain:
        netloc = parsed.netloc.replace("www.", "").lower()
        target = domain.replace("www.", "").lower()
        if netloc and target and target not in netloc:
            return False

    path_lower = parsed.path.lower()

    if not path_lower or path_lower in ("/", "/fr", "/fr/", "/en", "/en/"):
        return False

    for ext in _DEFAULT_EXCLUDED_EXTENSIONS:
        if path_lower.endswith(ext):
            return False

    for ex in _DEFAULT_EXCLUDED_PATH_PARTS:
        if ex in path_lower:
            return False
    if excluded_paths:
        for ex in excluded_paths:
            ex_low = ex.lower().rstrip("/")
            if ex_low and ex_low in path_lower:
                return False

    if detail_url_patterns:
        for pat in detail_url_patterns:
            try:
                if re.search(pat, parsed.path, re.I):
                    return True
            except re.error:
                if pat.lower() in path_lower:
                    return True

    for sig in _DEFAULT_PRODUCT_PATH_SIGNALS:
        if sig in path_lower:
            return True
    if extra_path_signals:
        for sig in extra_path_signals:
            if sig and sig.lower() in path_lower:
                return True

    for pat in _LIKELY_DETAIL_REGEXES:
        if pat.search(path_lower):
            return True

    return False


# ---------------------------------------------------------------------------
# filter_language_duplicates
# ---------------------------------------------------------------------------

def filter_language_duplicates(urls: List[str], prefer: str = "fr") -> List[str]:
    """Si des URLs existent à la fois en /fr/ et /en/, ne garder que la version
    préférée. Les URLs sans marqueur de langue sont conservées telles quelles.
    """
    if not urls:
        return []

    prefer = prefer.lower().strip("/")
    other = "en" if prefer == "fr" else "fr"
    pref_marker = f"/{prefer}/"
    other_marker = f"/{other}/"

    pref_urls: List[str] = []
    other_urls: List[str] = []
    no_lang: List[str] = []

    for u in urls:
        path = urlparse(u).path.lower()
        if pref_marker in path:
            pref_urls.append(u)
        elif other_marker in path:
            other_urls.append(u)
        else:
            no_lang.append(u)

    if pref_urls and other_urls:
        return list(dict.fromkeys(pref_urls + no_lang))
    if other_urls and not pref_urls:
        return list(dict.fromkeys(other_urls + no_lang))
    return list(dict.fromkeys(urls))


# ---------------------------------------------------------------------------
# classify_state
# ---------------------------------------------------------------------------

# Ordre important : 'demonstrateur' avant 'occasion' (chevauchement possible).
_STATE_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("demonstrateur",
     re.compile(r"\b(?:demo|d[ée]mo|d[ée]monstrateur|dmonstrateur)\b", re.I)),
    ("occasion",
     re.compile(
         r"\b(?:occasion|usag[ée]e?|used|pre[\-\s]?owned|preowned|"
         r"certified|certifi[ée]|location)\b|/(?:used|usage|usages|occasion|occasions)/",
         re.I,
     )),
    ("neuf",
     re.compile(
         r"\b(?:neuf|neufs|new|brand[\-\s]?new|nouveau|inventaire|inventory)\b"
         r"|/(?:new|neuf|neufs)/",
         re.I,
     )),
]


def classify_state(*sources: str, default: str = "neuf") -> str:
    """Détecte l'état d'un produit ('neuf' | 'occasion' | 'demonstrateur') à partir
    de signaux textuels (titre, URL, catégorie source, etc.).

    Concatène toutes les sources non vides puis applique les patterns dans l'ordre.
    Retourne `default` si rien ne matche.
    """
    blob = " ".join(s for s in sources if s)
    if not blob.strip():
        return default
    for label, pat in _STATE_PATTERNS:
        if pat.search(blob):
            return label
    return default


# ---------------------------------------------------------------------------
# Source categorie : inventaire vs vehicules_occasion vs catalogue
# ---------------------------------------------------------------------------

# Marqueurs URL forts qui indiquent un véhicule réellement en stock (avec SKU).
# PowerGO/eDealer : ".../-a-vendre-12345/", PrestaShop : "/14-occasions/<id>".
_INVENTORY_MARKERS = re.compile(
    r"(?:-a-vendre-\d+|/inventaire/|/inventory/|-id\d+|/stock/|-sku-)",
    re.I,
)

# Marqueurs URL qui indiquent une fiche showroom (modèle générique sans stock).
_CATALOGUE_MARKERS = re.compile(
    r"(?:/showroom/|/catalogue/|/catalog/|/collection-|/models?/|/gamme/)",
    re.I,
)


def classify_source_category(*sources: str, default: str = "inventaire") -> str:
    """Détecte la sourceCategorie d'un produit:
      - 'vehicules_occasion' : véhicule usagé/démo en stock
      - 'inventaire'         : véhicule neuf en stock (avec SKU)
      - 'catalogue'          : fiche showroom (modèle, sans SKU/stock)

    Sources typiques : sourceUrl, sourceCategorie déjà existant, name, etat.
    """
    blob = " ".join(s for s in sources if s)
    if not blob.strip():
        return default

    state = classify_state(*sources, default="")
    if state in ("occasion", "demonstrateur"):
        return "vehicules_occasion"

    # /catalogue/ ou /showroom/ explicite, sans marqueur d'inventaire fort.
    if _CATALOGUE_MARKERS.search(blob) and not _INVENTORY_MARKERS.search(blob):
        return "catalogue"

    # Pas de SKU/inventaire visible et URL ressemblant à un modèle générique
    # (ex: /fr/neuf/motocyclette/honda/cbr-1000/) → catalogue.
    has_inventory = bool(_INVENTORY_MARKERS.search(blob))
    if not has_inventory and re.search(r"/(?:neuf|new)/[^/]+/[^/]+/[^/]+/?$", blob, re.I):
        return "catalogue"

    return default


def classify_listing(text: str = "", url: str = "") -> tuple:
    """Classifie un listing/lien en (etat, sourceCategorie).

    États possibles      : 'neuf' | 'occasion' | 'demonstrateur'
    Catégories possibles : 'inventaire' | 'vehicules_occasion' | 'catalogue'

    Combinaisons valides:
      - ('neuf',          'inventaire')         → véhicule neuf en stock
      - ('neuf',          'catalogue')          → fiche showroom (pas de stock)
      - ('occasion',      'vehicules_occasion') → véhicule usagé en stock
      - ('demonstrateur', 'vehicules_occasion') → démonstrateur en stock
    """
    sources = (text, url)
    state = classify_state(*sources, default="neuf")

    if state == "occasion":
        return "occasion", "vehicules_occasion"
    if state == "demonstrateur":
        return "demonstrateur", "vehicules_occasion"

    # State == 'neuf' : reste à distinguer inventaire vs catalogue.
    cat = classify_source_category(*sources, default="inventaire")
    return "neuf", cat


# ---------------------------------------------------------------------------
# fix_mojibake
# ---------------------------------------------------------------------------

# Patterns littéraux : utiles quand le texte a déjà été partiellement décodé
# (par ex. concat à partir de plusieurs sources où un seul fragment est cassé).
_MOJIBAKE_LITERALS: Tuple[Tuple[str, str], ...] = (
    ("Ã©", "é"), ("Ã¨", "è"), ("Ãª", "ê"), ("Ã«", "ë"),
    ("Ã ", "à"), ("Ã¢", "â"), ("Ã®", "î"), ("Ã¯", "ï"),
    ("Ã´", "ô"), ("Ã¶", "ö"), ("Ã¹", "ù"), ("Ã»", "û"),
    ("Ã§", "ç"), ("Ã‰", "É"), ("Ã€", "À"), ("ÃŠ", "Ê"),
    ("ÃŽ", "Î"), ("Ã”", "Ô"), ("Ã›", "Û"), ("Ã‡", "Ç"),
    ("â€™", "'"), ("â€˜", "'"), ("â€œ", '"'), ("â€\x9d", '"'),
    ("â€“", "–"), ("â€”", "—"), ("â€¦", "…"),
)


def fix_mojibake(text: Optional[str]) -> str:
    """Tente de corriger un texte UTF-8 mal décodé en latin-1.

    Stratégie:
      1) Si le texte contient des marqueurs typiques de mojibake, on essaie
         d'abord encode('latin-1').decode('utf-8') (méthode la plus fiable).
      2) Sinon (ou si l'étape 1 échoue), on applique un mapping littéral.
    """
    if not text or not isinstance(text, str):
        return text or ""

    has_mojibake_marker = any(m in text for m, _ in _MOJIBAKE_LITERALS)
    if has_mojibake_marker:
        try:
            fixed = text.encode("latin-1").decode("utf-8")
            if fixed and "\ufffd" not in fixed and "\x00" not in fixed:
                return fixed
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass

    for bad, good in _MOJIBAKE_LITERALS:
        if bad in text:
            text = text.replace(bad, good)
    return text


def fix_mojibake_dict(out: Dict[str, Any]) -> None:
    """Applique fix_mojibake() en place sur toutes les valeurs string d'un dict."""
    for key in list(out.keys()):
        val = out[key]
        if isinstance(val, str):
            out[key] = fix_mojibake(val)


# ---------------------------------------------------------------------------
# URL helpers (pagination, navigation pointée)
# ---------------------------------------------------------------------------

def build_paginated_url(base_url: str, param: str, value: Any) -> str:
    """Ajoute/remplace un paramètre de pagination URL-safe, en préservant les
    autres query params.

    Exemples:
        build_paginated_url('https://x.com/inv?marque=honda', 'page', 2)
        -> 'https://x.com/inv?marque=honda&page=2'
        build_paginated_url('https://x.com/inv', 'page', 3)
        -> 'https://x.com/inv?page=3'
    """
    if not param:
        return base_url
    parsed = urlparse(base_url)
    qs = parse_qs(parsed.query, keep_blank_values=True)
    qs[param] = [str(value)]
    return urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))


def extract_path_field(data: Any, path: str) -> Any:
    """Navigation dans un dict/list imbriqué via un chemin pointé.

    Exemple:
        extract_path_field({'a': {'b': [1, 2]}}, 'a.b') -> [1, 2]
        extract_path_field(d, 'pageInfo.endCursor') -> 'abc' ou None
    """
    if not path:
        return data
    cur = data
    for key in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(key)
        elif isinstance(cur, list):
            try:
                cur = cur[int(key)]
            except (ValueError, IndexError):
                return None
        else:
            return None
        if cur is None:
            return None
    return cur


def normalize_url(url: str, *, strip_tracking: bool = True) -> str:
    """Normalise une URL: enlève le fragment et (optionnellement) les params
    de tracking (utm_*, gclid, fbclid…). Utile pour la déduplication."""
    if not url:
        return ""
    parsed = urlparse(url)
    new_query = parsed.query
    if strip_tracking and parsed.query:
        qs = parse_qs(parsed.query, keep_blank_values=True)
        cleaned = {
            k: v for k, v in qs.items()
            if not k.lower().startswith(("utm_", "uts_", "mc_"))
            and k.lower() not in ("gclid", "fbclid", "msclkid", "yclid", "dclid")
        }
        new_query = urlencode(cleaned, doseq=True)
    return urlunparse(parsed._replace(query=new_query, fragment=""))


__all__ = [
    "is_product_url",
    "filter_language_duplicates",
    "classify_state",
    "classify_source_category",
    "classify_listing",
    "fix_mojibake",
    "fix_mojibake_dict",
    "build_paginated_url",
    "extract_path_field",
    "normalize_url",
]
