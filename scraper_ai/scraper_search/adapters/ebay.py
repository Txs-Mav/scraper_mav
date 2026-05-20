"""
EbayBrowseAdapter — recherche sur eBay via l'API Browse officielle.

Endpoint  : https://api.ebay.com/buy/browse/v1/item_summary/search
Doc       : https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
Auth      : OAuth 2.0 client_credentials (grant gratuit pour Browse, 5000 req/jour
            en sandbox / 5M par mois en production)

Variables d'environnement requises (à ajouter dans .env) :
  EBAY_CLIENT_ID            (App ID / Client ID)
  EBAY_CLIENT_SECRET        (Cert ID / Client Secret)
  EBAY_MARKETPLACE          (optionnel, défaut: EBAY_CA pour le Canada — sinon EBAY_US)
  EBAY_USE_SANDBOX          (optionnel, '1' pour utiliser sandbox.ebay.com)

L'adapter cache le token OAuth en mémoire (rotation auto avant expiration).
Pas de scraping HTML ici : tout passe par l'API JSON propre.
"""
from __future__ import annotations

import os
import threading
import time
import re
from typing import Any, Dict, List, Optional

import requests

from ..models import SearchHit, SearchQuery
from ..scoring import select_hits
from .base import AdapterError, SearchAdapter


_TOKEN_LOCK = threading.Lock()
_CACHED_TOKEN: Dict[str, Any] = {"value": None, "expires_at": 0.0, "scope_key": ""}

_PART_TITLE_KEYWORDS = {
    "adapter", "bearing", "bracket", "brake", "cable", "caliper", "cap",
    "case", "chain", "clutch", "cover", "crank", "crankshaft", "cylinder",
    "exhaust", "filter", "fork", "gasket", "graphics", "handlebar", "kit",
    "lever", "mount", "oem", "piston", "plastics", "radiator", "rebuild",
    "reed", "ring", "seat", "shock", "silencer", "sprocket", "valve", "wheel",
}
_PART_CATEGORY_HINTS = (
    "accessories", "components", "parts", "piston", "rebuild", "rings",
    "scooter parts",
)


class EbayBrowseAdapter(SearchAdapter):
    """Adapter eBay (US/CA) via l'API Browse officielle."""

    name = "eBay"
    site_url = "https://www.ebay.ca"
    supported_types: List[str] = []  # accepte toutes les requêtes (legacy)
    serves_categories: List[str] = ["*"]  # marketplace généraliste

    def __init__(self,
                 client_id: Optional[str] = None,
                 client_secret: Optional[str] = None,
                 marketplace_id: Optional[str] = None,
                 *,
                 use_sandbox: Optional[bool] = None,
                 timeout: int = 15):
        self.client_id = client_id or os.getenv("EBAY_CLIENT_ID", "")
        self.client_secret = client_secret or os.getenv("EBAY_CLIENT_SECRET", "")
        self.marketplace_id = marketplace_id or os.getenv("EBAY_MARKETPLACE", "EBAY_CA")
        if use_sandbox is None:
            use_sandbox = os.getenv("EBAY_USE_SANDBOX", "0") in ("1", "true", "yes")
        self.use_sandbox = use_sandbox
        self.timeout = timeout
        self.site_url = "https://www.ebay.com" if self.marketplace_id == "EBAY_US" \
                         else "https://www.ebay.ca"
        self.name = f"eBay ({self.marketplace_id.replace('EBAY_', '')})"

    @property
    def _api_base(self) -> str:
        return ("https://api.sandbox.ebay.com" if self.use_sandbox
                else "https://api.ebay.com")

    @property
    def _oauth_base(self) -> str:
        return ("https://api.sandbox.ebay.com/identity/v1/oauth2/token"
                if self.use_sandbox
                else "https://api.ebay.com/identity/v1/oauth2/token")

    # ------------------------------------------------------------------
    # OAuth (client_credentials, scope public)
    # ------------------------------------------------------------------

    def _ensure_token(self) -> str:
        if not self.client_id or not self.client_secret:
            raise AdapterError(
                "eBay : EBAY_CLIENT_ID / EBAY_CLIENT_SECRET non configurés. "
                "Crée une app sur https://developer.ebay.com/my/keys et ajoute "
                "les credentials dans .env."
            )

        scope_key = f"{self.client_id}:{self.use_sandbox}"
        with _TOKEN_LOCK:
            cached = _CACHED_TOKEN
            now = time.time()
            if (cached.get("value") and cached.get("scope_key") == scope_key
                    and cached.get("expires_at", 0) > now + 30):
                return cached["value"]

            try:
                resp = requests.post(
                    self._oauth_base,
                    auth=(self.client_id, self.client_secret),
                    data={
                        "grant_type": "client_credentials",
                        "scope": "https://api.ebay.com/oauth/api_scope",
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=self.timeout,
                )
            except requests.RequestException as e:
                raise AdapterError(f"eBay OAuth fetch error: {e}")
            if resp.status_code != 200:
                raise AdapterError(
                    f"eBay OAuth HTTP {resp.status_code} : {resp.text[:200]}"
                )

            try:
                data = resp.json()
            except ValueError as e:
                raise AdapterError(f"eBay OAuth JSON invalid: {e}")

            token = data.get("access_token")
            if not token:
                raise AdapterError(f"eBay OAuth: pas de access_token ({data})")

            _CACHED_TOKEN.update({
                "value": token,
                "expires_at": now + float(data.get("expires_in", 7200)),
                "scope_key": scope_key,
            })
            return token

    # ------------------------------------------------------------------
    # search()
    # ------------------------------------------------------------------

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        text = query.search_text()
        if not text:
            return []

        token = self._ensure_token()
        url = f"{self._api_base}/buy/browse/v1/item_summary/search"

        params: Dict[str, Any] = {
            "q": text,
            "limit": min(max_results, 100),
        }

        # Filtres prix / état (syntaxe filter de l'API Browse)
        filters: List[str] = []
        if query.prix_min is not None or query.prix_max is not None:
            lo = int(query.prix_min) if query.prix_min else 0
            hi = int(query.prix_max) if query.prix_max else 9999999
            currency = "CAD" if self.marketplace_id == "EBAY_CA" else "USD"
            filters.append(f"price:[{lo}..{hi}],priceCurrency:{currency}")
        if query.etat == "neuf":
            filters.append("conditions:{NEW}")
        elif query.etat == "occasion":
            filters.append("conditions:{USED|REFURBISHED|FOR_PARTS_OR_NOT_WORKING}")
        if filters:
            params["filter"] = ",".join(filters)

        headers = {
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": self.marketplace_id,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=self.timeout)
        except requests.RequestException as e:
            raise AdapterError(f"eBay search fetch error: {e}")
        if resp.status_code == 401:
            # Token peut être expiré entre-temps : on force une rotation
            with _TOKEN_LOCK:
                _CACHED_TOKEN["expires_at"] = 0
            raise AdapterError("eBay search HTTP 401 (token rejeté, retry au prochain appel)")
        if resp.status_code != 200:
            raise AdapterError(f"eBay search HTTP {resp.status_code}: {resp.text[:200]}")

        try:
            data = resp.json()
        except ValueError as e:
            raise AdapterError(f"eBay search JSON invalid: {e}")

        items = data.get("itemSummaries") or []
        products = [self._normalize(it) for it in items if isinstance(it, dict)]
        if self._looks_like_vehicle_query(query):
            products = [p for p in products if not self._looks_like_part_listing(p)]

        hits, scanned, approx = select_hits(
            query, products,
            max_results=max_results,
            source_site="ebay.ca" if self.marketplace_id == "EBAY_CA" else "ebay.com",
            source_slug=f"ebay:{self.marketplace_id.lower()}",
        )
        self.last_products_scanned = scanned
        self.last_approximate_count = approx
        return hits

    @staticmethod
    def _looks_like_vehicle_query(query: SearchQuery) -> bool:
        if query.category_path and query.category_path.startswith("vehicule"):
            return True
        if not query.is_generic_product:
            return True
        text = " ".join([query.modele or "", query.raw_text or ""]).lower()
        has_letters = bool(re.search(r"[a-z]", text))
        has_digits = bool(re.search(r"\d", text))
        return has_letters and has_digits and len(text.split()) <= 5

    @staticmethod
    def _looks_like_part_listing(product: Dict[str, Any]) -> bool:
        title = str(product.get("name", "") or "").lower()
        category = str(product.get("categorie", "") or "").lower()
        if any(hint in category for hint in _PART_CATEGORY_HINTS):
            return True
        tokens = set(re.findall(r"[a-z]+", title))
        return bool(tokens & _PART_TITLE_KEYWORDS)

    def _normalize(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Convertit un itemSummary eBay en dict produit normalisé."""
        price = None
        currency = None
        if isinstance(item.get("price"), dict):
            try:
                price = float(item["price"].get("value"))
            except (TypeError, ValueError):
                price = None
            currency = item["price"].get("currency")

        condition = item.get("condition") or ""
        condition_lower = condition.lower()
        if "new" in condition_lower:
            etat = "neuf"
        elif any(w in condition_lower for w in ("used", "pre-owned", "refurbished")):
            etat = "occasion"
        else:
            etat = None

        image = ""
        if isinstance(item.get("image"), dict):
            image = item["image"].get("imageUrl") or ""
        if not image and isinstance(item.get("thumbnailImages"), list) \
                and item["thumbnailImages"]:
            image = item["thumbnailImages"][0].get("imageUrl") or ""

        seller = item.get("seller") or {}
        marque = None
        for asp in (item.get("itemSpecifics") or []):
            if isinstance(asp, dict) and (asp.get("name") or "").lower() == "brand":
                marque = " ".join(asp.get("value") or []) or None
                break

        return {
            "name": item.get("title", ""),
            "prix": price,
            "currency": currency,
            "marque": marque,
            "categorie": (item.get("categories") or [{}])[0].get("categoryName")
                          if item.get("categories") else None,
            "image": image,
            "description": item.get("shortDescription", "") or "",
            "sku": item.get("legacyItemId") or item.get("itemId"),
            "etat": etat,
            "sourceUrl": item.get("itemWebUrl") or item.get("itemHref") or "",
            "vendor": seller.get("username"),
        }
