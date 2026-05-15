"""
LesPacAdapter — LesPAC.com (petites annonces québécoises).

LesPAC a fait une refonte SSR fin 2025/début 2026 :
  - L'ancienne URL `/q/search?searchKeywords=` retourne maintenant 404.
  - La nouvelle URL active est `/search/results?keywords=<text>`.
  - Le `__NEXT_DATA__` n'est plus présent ; à la place, le HTML SSR embarque
    un bloc inline `var searchResponse = {...};` qui contient un payload
    JSON complet : `{ searchResults: [...], totalResults, totalPages, ... }`.

Chaque entrée de `searchResults` a la forme :
  {
    listingPublicId, title, description,
    price (float, déjà en CAD), priceLabel,
    mainImageUrl, listingDisplayUrl,
    cityLabel, distanceLabel,
    publishedSinceLabel, categoryCode,
    searchPageTrackingInfo: { 'listing-condition': {value: 'USED'|'NEW'}, ... },
    ...
  }

Note : LesPAC reste un petit marché (4-50 résultats / requête typique), mais
les listings sont propres et structurés — c'est notre meilleur signal pour
les annonces régionales au Québec.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List
from urllib.parse import quote_plus, urljoin

from ..models import SearchQuery
from ._browser_serp_base import BrowserSerpAdapter


_SEARCH_RESPONSE_RE = re.compile(
    r"var\s+searchResponse\s*=\s*(\{.*?\});\s*\n", re.DOTALL,
)


class LesPacAdapter(BrowserSerpAdapter):
    name = "LesPAC.com"
    site_url = "https://www.lespac.com"
    serves_categories: List[str] = ["*"]

    marketplace_hint = ""
    default_timeout_ms = 18000
    scroll_on_load = False  # SSR : tout est dans le HTML initial
    max_scrolls = 0

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def _build_url(self, query: SearchQuery, text: str, *, page: int = 1) -> str:
        # Nouvelle URL active (depuis refonte 2025/2026).
        # `pageNumber` est ignoré côté SSR si absent → on l'ajoute seulement
        # pour la page 2+. `pageSize=20` est la valeur par défaut.
        page_part = f"&pageNumber={page}" if page > 1 else ""
        return (
            f"https://www.lespac.com/search/results"
            f"?keywords={quote_plus(text)}{page_part}"
        )

    def _parse_listing(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        m = _SEARCH_RESPONSE_RE.search(html)
        if not m:
            # Fallback générique (au cas où LesPAC changerait à nouveau de format).
            return super()._parse_listing(html, base_url=base_url)
        try:
            payload = json.loads(m.group(1))
        except json.JSONDecodeError:
            return super()._parse_listing(html, base_url=base_url)

        results = payload.get("searchResults") or []
        if not isinstance(results, list):
            return []

        out: List[Dict[str, Any]] = []
        for item in results:
            if not isinstance(item, dict):
                continue
            product = self._normalize_item(item, base_url=base_url)
            if product:
                out.append(product)
        return self._post_process(out, base_url=base_url)

    @staticmethod
    def _normalize_item(item: Dict[str, Any], *, base_url: str) -> Dict[str, Any] | None:
        title = item.get("title")
        if not isinstance(title, str) or len(title) < 3:
            return None

        # Prix : LesPAC envoie déjà la valeur en CAD (float ou int).
        price_raw = item.get("price")
        prix: float | None = None
        if isinstance(price_raw, (int, float)):
            prix = float(price_raw)
        elif isinstance(price_raw, str):
            digits = re.sub(r"[^\d.]", "", price_raw)
            if digits:
                try:
                    prix = float(digits)
                except ValueError:
                    prix = None

        # URL : `listingDisplayUrl` est déjà absolue normalement.
        raw_url = item.get("listingDisplayUrl") or ""
        if not isinstance(raw_url, str) or not raw_url:
            # Fallback : reconstruire avec listingPublicId
            pid = item.get("listingPublicId")
            if pid:
                raw_url = f"https://www.lespac.com/v/{pid}"
            else:
                return None
        url = raw_url if raw_url.startswith("http") else urljoin(
            "https://www.lespac.com", raw_url,
        )

        # Image : mainImageUrl est déjà absolue ; sinon premier `images[*]`.
        image = item.get("mainImageUrl") or ""
        if not isinstance(image, str):
            image = ""
        if not image:
            images = item.get("images") or []
            if isinstance(images, list) and images:
                first = images[0]
                if isinstance(first, dict):
                    fmt_url = first.get("formattableImageUrl") or ""
                    placeholder = first.get("formatPlaceholder") or "%FORMAT%"
                    # On résout en taille `zoomedGallery` (≈ 800px de large) — c'est
                    # le format utilisé par mainImageUrl quand il est présent.
                    if isinstance(fmt_url, str) and placeholder in fmt_url:
                        image = fmt_url.replace(placeholder, "zoomedGallery")
                    elif isinstance(fmt_url, str):
                        image = fmt_url
                elif isinstance(first, str):
                    image = first

        # État (neuf/occasion) — lu dans searchPageTrackingInfo si disponible.
        # LesPAC code en majuscules : "USED" / "NEW".
        tracking = item.get("searchPageTrackingInfo") or {}
        etat = "occasion"
        if isinstance(tracking, dict):
            cond_node = tracking.get("listing-condition") or {}
            if isinstance(cond_node, dict):
                cond_value = str(cond_node.get("value", "")).upper()
                if cond_value == "NEW":
                    etat = "neuf"
                elif cond_value == "USED":
                    etat = "occasion"

        # Vendor / location : cityLabel ("Montréal / Villeray").
        city = item.get("cityLabel") or ""
        if not isinstance(city, str):
            city = ""

        description = item.get("description") or ""
        if not isinstance(description, str):
            description = ""

        return {
            "name": title.strip(),
            "prix": prix,
            "currency": "CAD",
            "image": image,
            "sourceUrl": url,
            "etat": etat,
            "vendor": city.strip() or None,
            "description": description[:300],
        }
