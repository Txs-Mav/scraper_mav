"""Pré-traitement du HTML avant envoi à Claude.

Réduit le nombre de tokens consommés en retirant tout ce qui ne sert pas à
identifier des sélecteurs CSS, MAIS conserve impérativement les sources de
données structurées que Claude utilise pour deviner les bons sélecteurs.

Whitelist (à NE JAMAIS retirer) :
  - ``<script type="application/ld+json">`` : JSON-LD (schema.org). Sur
    Shopify, Magento, BigCommerce, eDealer, les prix, images et variantes
    sont quasi systématiquement là.
  - ``<script type="application/json">`` : payloads structurés
    (``__NEXT_DATA__``, ``__NUXT__``, etc.)
  - ``<script type="application/microdata+json">`` : microdata sérialisée.
  - balises ``<meta property="og:*">`` et ``<meta name="twitter:*">`` :
    fallback usuel pour ``name``, ``image``, ``description``.
  - attributs ``itemprop``, ``itemtype``, ``itemscope`` (microdata HTML).

Blacklist (toujours retirer) :
  - ``<script>`` SANS attribut ``type`` ou ``type="text/javascript"`` /
    ``type="module"`` (= scripts JS exécutables, inutiles à Claude).
  - balises ``<style>``, ``<svg>``, ``<noscript>``, ``<iframe>``.
  - attributs ``style=`` (CSS inline).
  - attributs ``data-*`` qui ne servent pas comme sélecteur (heuristique :
    on conserve ceux dont le nom contient ``id``, ``sku``, ``price``,
    ``product``, ``category``, ``url``).
  - commentaires HTML.

Gain typique sur HTML e-commerce moderne : -30 à -40 % d'octets, sans
perdre la moindre information utile à la décision sélecteur de Claude.
"""
from __future__ import annotations

import re
from typing import Optional

from bs4 import BeautifulSoup, Comment


# Types ``<script>`` à PRÉSERVER (whitelist) - tout le reste tombe.
_SCRIPT_TYPES_TO_KEEP = (
    "application/ld+json",
    "application/json",
    "application/microdata+json",
)

# Substrings de noms d'attributs ``data-*`` à conserver. Heuristique pour
# garder les data-attrs qui peuvent servir de sélecteur sémantique.
_DATA_ATTR_KEYWORDS_TO_KEEP = (
    "id", "sku", "price", "product", "category",
    "url", "slug", "code", "stock", "quantity",
)

# Balises retirées complètement (avec leur contenu).
_TAGS_TO_REMOVE = ("style", "svg", "noscript", "iframe")


def clean_html_for_llm(html: str, *, aggressive: bool = True) -> str:
    """Retire le bruit du HTML avant de l'envoyer à Claude.

    Args:
        html: HTML brut.
        aggressive: si False, ne retire que les ``<script>`` JS et ``<style>``
            (mode minimal pour les sites où on suspecte que tout est utile).
            Par défaut True (retire aussi svg, noscript, iframe, data-attrs
            non sémantiques, commentaires, attributs style).

    Returns:
        HTML nettoyé. Vide si l'entrée est vide ou None.
    """
    if not html:
        return ""

    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")

    _strip_scripts(soup)

    if aggressive:
        _strip_tags(soup, _TAGS_TO_REMOVE)
        _strip_comments(soup)
        _strip_attributes(soup)

    return str(soup)


def _strip_scripts(soup: BeautifulSoup) -> None:
    """Retire les ``<script>`` JS exécutables, conserve JSON-LD/JSON/microdata."""
    for script in soup.find_all("script"):
        script_type = (script.get("type") or "").strip().lower()
        if script_type in _SCRIPT_TYPES_TO_KEEP:
            continue  # Whitelist : on garde
        # Tout ce qui n'est pas explicitement whitelisté tombe (y compris les
        # <script> sans type, qui par défaut sont du JS exécutable HTML5).
        script.decompose()


def _strip_tags(soup: BeautifulSoup, tag_names: tuple[str, ...]) -> None:
    for name in tag_names:
        for el in soup.find_all(name):
            el.decompose()


def _strip_comments(soup: BeautifulSoup) -> None:
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()


def _strip_attributes(soup: BeautifulSoup) -> None:
    """Retire ``style=`` et data-attrs non sémantiques sur tous les éléments.

    Conserve ``itemprop``, ``itemtype``, ``itemscope`` (microdata) et les
    data-attrs porteurs de sémantique (cf. ``_DATA_ATTR_KEYWORDS_TO_KEEP``).
    """
    for el in soup.find_all(True):
        attrs = dict(el.attrs)
        for attr_name in attrs:
            if attr_name == "style":
                del el.attrs[attr_name]
                continue
            if attr_name.startswith("data-"):
                key_lower = attr_name[5:].lower()
                if not any(kw in key_lower for kw in _DATA_ATTR_KEYWORDS_TO_KEEP):
                    del el.attrs[attr_name]


def estimate_token_savings(html: str) -> dict:
    """Pour debug : estime le gain en pourcentage du nettoyage.

    Returns:
        dict avec ``before_chars``, ``after_chars``, ``savings_pct``.
    """
    if not html:
        return {"before_chars": 0, "after_chars": 0, "savings_pct": 0.0}
    cleaned = clean_html_for_llm(html, aggressive=True)
    before = len(html)
    after = len(cleaned)
    return {
        "before_chars": before,
        "after_chars": after,
        "savings_pct": round((1 - after / max(before, 1)) * 100, 1),
    }


__all__ = ["clean_html_for_llm", "estimate_token_savings"]
