"""
Helpers d'URL pour le scraper_usine et les scrapers générés.

Construction d'URLs de pagination URL-safe (gère les query strings existantes,
fragments, encodage), et navigation cursor-based.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple
from urllib.parse import (
    parse_qs, urlencode, urlparse, urlunparse, urljoin,
)


def build_paginated_url(base_url: str, param: str, value: Any) -> str:
    """
    Ajoute/remplace un paramètre de pagination de manière URL-safe.

    Préserve les autres query params, gère les URLs avec/sans '?', avec/sans
    fragment, et l'encodage des valeurs.

    Exemple:
        >>> build_paginated_url("https://x.com/inv?marque=honda", "page", 2)
        'https://x.com/inv?marque=honda&page=2'
        >>> build_paginated_url("https://x.com/inv", "page", 3)
        'https://x.com/inv?page=3'
    """
    parsed = urlparse(base_url)
    qs = parse_qs(parsed.query, keep_blank_values=True)
    qs[param] = [str(value)]
    new_query = urlencode(qs, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def add_query_params(base_url: str, params: Dict[str, Any]) -> str:
    """Ajoute plusieurs paramètres à une URL de manière sûre."""
    parsed = urlparse(base_url)
    qs = parse_qs(parsed.query, keep_blank_values=True)
    for k, v in params.items():
        if v is None:
            qs.pop(k, None)
        else:
            qs[k] = [str(v)]
    return urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))


def absolute_url(base_url: str, href: str) -> str:
    """Convertit un href relatif en URL absolue. Robuste aux //, /, http(s)."""
    if not href:
        return ""
    if href.startswith(("http://", "https://")):
        return href
    if href.startswith("//"):
        scheme = urlparse(base_url).scheme or "https"
        return f"{scheme}:{href}"
    return urljoin(base_url, href)


def extract_path_field(data: Any, path: str) -> Any:
    """
    Extrait une valeur depuis un dict imbriqué via un chemin pointé.

    Exemples:
        extract_path_field({"a": {"b": [1,2]}}, "a.b") -> [1, 2]
        extract_path_field({"data": {"items": [...]}}, "data.items") -> [...]
        extract_path_field(d, "pageInfo.endCursor") -> "abc123" ou None
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


def parse_link_header(link_header: str) -> Dict[str, str]:
    """Parse un header HTTP Link (RFC 5988) → {rel: url}.

    Exemple:
        '<https://api.x.com/items?page=2>; rel="next", <...>; rel="last"'
        → {'next': 'https://api.x.com/items?page=2', 'last': '...'}
    """
    if not link_header:
        return {}
    out: Dict[str, str] = {}
    for part in link_header.split(","):
        segments = part.strip().split(";")
        if len(segments) < 2:
            continue
        url = segments[0].strip().lstrip("<").rstrip(">")
        for seg in segments[1:]:
            seg = seg.strip()
            if seg.startswith("rel="):
                rel = seg[4:].strip('"\' ')
                out[rel] = url
    return out


def merge_url_params(url: str, override: Optional[Dict[str, Any]] = None) -> Tuple[str, Dict[str, str]]:
    """Sépare l'URL et ses params, applique éventuellement un override.

    Retourne (url_sans_query, params_dict).
    """
    parsed = urlparse(url)
    qs = parse_qs(parsed.query, keep_blank_values=True)
    flat: Dict[str, str] = {k: v[0] for k, v in qs.items() if v}
    if override:
        for k, v in override.items():
            if v is None:
                flat.pop(k, None)
            else:
                flat[k] = str(v)
    base = urlunparse(parsed._replace(query=""))
    return base, flat
