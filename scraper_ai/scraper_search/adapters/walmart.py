"""
WalmartAdapter — Walmart Canada (.ca) via SERP rendue.

Anti-bot : Walmart utilise PerimeterX (anciennement Akamai). HTTP direct → 412.
Stratégie : Playwright stealth, parser le `__NEXT_DATA__` qui contient toute
la liste des produits SSR (Walmart est en Next.js).
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List
from urllib.parse import quote_plus, urljoin

from ..extractors import extract_products_from_listing
from ..models import SearchQuery
from ._browser_serp_base import BrowserSerpAdapter


class WalmartAdapter(BrowserSerpAdapter):
    name = "Walmart.ca"
    site_url = "https://www.walmart.ca"
    serves_categories: List[str] = ["*"]  # Walmart vend de tout

    item_selector = "div[data-testid='itemStack'] > div, div[role='group']"
    marketplace_hint = ""
    default_timeout_ms = 22000  # Walmart est lourd (gros bundle JS)

    def __init__(self, **kwargs):
        super().__init__(use_proxy_env="WALMART_PROXY_URL", **kwargs)

    def _build_url(self, query: SearchQuery, text: str, *, page: int = 1) -> str:
        suffix = f"&page={page}" if page > 1 else ""
        return f"https://www.walmart.ca/search?q={quote_plus(text)}{suffix}"

    def _parse_listing(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        # Stratégie 1 : __NEXT_DATA__ (le plus fiable)
        nd = self._parse_next_data(html, base_url=base_url)
        if nd:
            return self._post_process(nd, base_url=base_url)
        # Stratégie 2 : extracteur générique (JSON-LD / microdata)
        return super()._parse_listing(html, base_url=base_url)

    def _parse_next_data(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        m = re.search(
            r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            html, re.DOTALL,
        )
        if not m:
            return []
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            return []

        items: List[Dict[str, Any]] = []
        self._walk(data, items)
        return items

    def _walk(self, node: Any, out: List[Dict[str, Any]], *, depth: int = 0) -> None:
        if depth > 30 or len(out) >= 100:
            return
        if isinstance(node, list):
            for it in node:
                self._walk(it, out, depth=depth + 1)
            return
        if not isinstance(node, dict):
            return

        # Heuristique : un produit Walmart a (name OR title) + (price OR priceInfo)
        # + (canonicalUrl OR productLink OR url)
        name = node.get("name") or node.get("title")
        url = node.get("canonicalUrl") or node.get("productLink") or node.get("url")
        price_node = node.get("priceInfo") or node.get("price") or node.get("currentPrice")

        if (isinstance(name, str) and 5 < len(name) < 250
                and isinstance(url, str) and url
                and price_node is not None):
            full_url = url if url.startswith("http") else urljoin("https://www.walmart.ca", url)
            price = self._extract_price(price_node)
            image = ""
            for k in ("image", "imageUrl", "imageInfo", "primaryImage"):
                v = node.get(k)
                if isinstance(v, str):
                    image = v
                    break
                if isinstance(v, dict):
                    img_v = v.get("url") or v.get("thumbnailUrl") or v.get("src")
                    if img_v:
                        image = img_v
                        break

            sku = node.get("usItemId") or node.get("itemId") or node.get("id") or ""

            out.append({
                "name": name.strip(),
                "prix": price,
                "currency": "CAD",
                "image": image,
                "sku": str(sku),
                "marque": (node.get("brand") or {}).get("name") if isinstance(node.get("brand"), dict) else node.get("brand"),
                "sourceUrl": full_url,
                "etat": "neuf",
            })
            return  # ne descend pas dans un produit déjà identifié

        for v in node.values():
            self._walk(v, out, depth=depth + 1)

    def _extract_price(self, node: Any) -> float | None:
        if isinstance(node, (int, float)):
            return float(node)
        if isinstance(node, str):
            m = re.search(r"\d[\d,.]*", node)
            if m:
                try:
                    return float(m.group(0).replace(",", ""))
                except ValueError:
                    return None
            return None
        if isinstance(node, dict):
            for k in ("currentPrice", "price", "value", "amount", "displayPrice"):
                v = node.get(k)
                if v is None:
                    continue
                if isinstance(v, dict):
                    p = self._extract_price(v)
                    if p is not None:
                        return p
                else:
                    p = self._extract_price(v)
                    if p is not None:
                        return p
        return None
