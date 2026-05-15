"""
AmazonAdapter — recherche Amazon (.ca par défaut, .com supporté).

Amazon a des protections anti-bot très agressives :
  - CAPTCHA (mostly puzzle ou audio) sur les premières requêtes d'une nouvelle IP.
  - Détection de UA + headers + comportement (TLS fingerprint, ordre des headers).
  - Throttling agressif au-delà de 5-10 req/min depuis une IP.

Stratégie réaliste sans Product Advertising API :
  1. Tenter d'abord l'endpoint **autocomplete public**
     `completion.amazon.ca/api/2017/suggestions` — pas de protection, retourne
     des suggestions de produits avec asin/url. Couvre les recherches simples.
  2. Pour des résultats riches (prix, image, état) → render la page de search via
     BrowserAgent (Playwright + stealth), parser les cards `[data-component-type="s-search-result"]`.
  3. Si CAPTCHA détecté → AdapterError propre (pas de retry agressif qui ferait
     bannir l'IP).

Recommandation prod : si tu utilises ça à grande échelle, ajoute un proxy résidentiel
(Bright Data, Smartproxy, Oxylabs) via `AMAZON_PROXY_URL` dans .env. Sans proxy, ça
fonctionne pour quelques requêtes/jour sans bannissement.
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urljoin

import requests

from ..models import SearchHit, SearchQuery
from ..scoring import make_hit, score_product
from .base import AdapterError, SearchAdapter

try:
    from scraper_ai.scraper_usine.stealth import stealth_headers
except Exception:
    def stealth_headers(*args, **kwargs):
        return {"User-Agent": "Mozilla/5.0", "Accept-Language": "fr-CA,fr;q=0.9"}


_AMAZON_DOMAINS = {
    "ca": "www.amazon.ca",
    "com": "www.amazon.com",
    "fr": "www.amazon.fr",
    "co.uk": "www.amazon.co.uk",
}


class AmazonAdapter(SearchAdapter):
    """Adapter Amazon — autocomplete + recherche HTML rendue."""

    name = "Amazon.ca"
    site_url = "https://www.amazon.ca"
    supported_types: List[str] = []  # accepte tout (legacy)
    serves_categories: List[str] = ["*"]  # marketplace généraliste

    def __init__(self, *,
                 region: str = "ca",
                 timeout_ms: int = 18000,
                 use_browser: bool = True,
                 max_pages: int = 1):
        """
        Args:
            region: 'ca' (Canada, défaut), 'com' (US), 'fr', 'co.uk'
            timeout_ms: timeout par page rendue
            use_browser: si False → uniquement autocomplete (pas de prix, plus rapide)
            max_pages: nb de pages SERP à scraper (1 = ~16 produits)
        """
        if region not in _AMAZON_DOMAINS:
            raise ValueError(f"Région Amazon non supportée: {region}")
        self.region = region
        self.host = _AMAZON_DOMAINS[region]
        self.site_url = f"https://{self.host}"
        self.name = f"Amazon.{region}"
        self.timeout_ms = timeout_ms
        self.use_browser = use_browser
        self.max_pages = max_pages

    # ------------------------------------------------------------------
    # search()
    # ------------------------------------------------------------------

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        text = query.search_text()
        if not text:
            return []

        products: List[Dict[str, Any]] = []

        if self.use_browser:
            try:
                products.extend(self._search_via_browser(text, max_results=max_results))
            except AdapterError as e:
                # On loggue mais on tombe quand même sur l'autocomplete pour avoir
                # quelque chose plutôt que rien.
                fallback = self._search_via_autocomplete(text)
                if not fallback:
                    raise
                products = fallback

        if not products:
            products = self._search_via_autocomplete(text)

        if not products:
            return []

        hits: List[SearchHit] = []
        seen = set()
        for p in products:
            url = p.get("sourceUrl", "")
            sku = p.get("sku", "")
            key = sku or url
            if key in seen:
                continue
            seen.add(key)
            sc, reason = score_product(query, p)
            if sc < query.min_score:
                continue
            hits.append(make_hit(
                p, sc, reason,
                source_site=self.host,
                source_slug=f"amazon:{self.region}",
            ))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:max_results]

    # ------------------------------------------------------------------
    # 1) Autocomplete (pas de protection, mais résultats minimalistes)
    # ------------------------------------------------------------------

    def _search_via_autocomplete(self, text: str) -> List[Dict[str, Any]]:
        """Endpoint completion. Retourne des suggestions de produits avec asin + url
        mais pas le prix. Utile en fallback."""
        url = f"https://completion.{self.host.replace('www.', '')}/api/2017/suggestions"
        params = {
            "limit": 11,
            "prefix": text,
            "alias": "aps",
            "site-variant": "desktop",
            "client-info": "amazon-search-ui",
            "mid": f"A2EUQ1WTGCTBG2" if self.region == "ca" else "ATVPDKIKX0DER",
        }
        try:
            resp = requests.get(
                url, params=params,
                headers={**stealth_headers(),
                         "Accept": "application/json, text/plain, */*"},
                timeout=10,
            )
        except requests.RequestException as e:
            raise AdapterError(f"Amazon autocomplete error: {e}")
        if resp.status_code != 200:
            return []
        try:
            data = resp.json()
        except ValueError:
            return []

        products: List[Dict[str, Any]] = []
        suggestions = data.get("suggestions") or []
        for s in suggestions:
            if not isinstance(s, dict):
                continue
            value = s.get("value") or s.get("suggestion") or ""
            if not value:
                continue
            ref = s.get("refTag") or s.get("ref") or ""
            asin = ""
            for k in ("asin", "ASIN", "id"):
                if k in s and s[k]:
                    asin = str(s[k])
                    break
            search_url = (f"{self.site_url}/dp/{asin}" if asin
                          else f"{self.site_url}/s?k={quote_plus(value)}")
            products.append({
                "name": value,
                "prix": None,
                "marque": None,
                "image": "",
                "sku": asin or None,
                "sourceUrl": search_url,
                "etat": "neuf",
                "_amazon_source": "autocomplete",
            })
        return products

    # ------------------------------------------------------------------
    # 2) SERP via BrowserAgent
    # ------------------------------------------------------------------

    def _search_via_browser(self, text: str, *,
                             max_results: int) -> List[Dict[str, Any]]:
        try:
            from scraper_ai.scraper_usine.browser_agent import BrowserAgent
        except ImportError as e:
            raise AdapterError(f"BrowserAgent indisponible: {e}")

        proxy = os.getenv("AMAZON_PROXY_URL", "").strip()
        proxy_dict = None
        if proxy:
            proxy_dict = {"server": proxy}
            user = os.getenv("AMAZON_PROXY_USERNAME", "").strip()
            pwd = os.getenv("AMAZON_PROXY_PASSWORD", "").strip()
            if user:
                proxy_dict["username"] = user
            if pwd:
                proxy_dict["password"] = pwd

        all_products: List[Dict[str, Any]] = []
        try:
            with BrowserAgent(block_assets=True, locale="fr-CA",
                              proxy=proxy_dict) as agent:
                for page in range(1, self.max_pages + 1):
                    page_part = f"&page={page}" if page > 1 else ""
                    url = (f"{self.site_url}/s?k={quote_plus(text)}"
                           f"&ref=nb_sb_noss{page_part}")
                    try:
                        result = agent.render(
                            url,
                            timeout_ms=self.timeout_ms,
                            networkidle_ms=2500,
                            scroll=True,
                            max_scrolls=2,
                            dismiss_cookies=True,
                        )
                    except Exception as e:
                        raise AdapterError(f"Amazon render error {url}: {e}")

                    html = result.html or ""
                    if self._looks_like_captcha(html):
                        raise AdapterError(
                            "Amazon CAPTCHA détecté (configure AMAZON_PROXY_URL "
                            "avec un proxy résidentiel pour contourner)."
                        )
                    if len(html) < 5000:
                        continue
                    products = self._parse_serp(html)
                    all_products.extend(products)
                    if len(all_products) >= max_results * 2:
                        break
        except AdapterError:
            raise
        except Exception as e:
            raise AdapterError(f"Amazon browser session error: {e}")
        return all_products

    @staticmethod
    def _looks_like_captcha(html: str) -> bool:
        if not html:
            return True
        haystack = html[:5000].lower()
        return any(marker in haystack for marker in (
            "type the characters you see in this image",
            "/errors/validatecaptcha",
            "captcha-prompt",
            "robot check",
            "enter the characters you see below",
        ))

    def _parse_serp(self, html: str) -> List[Dict[str, Any]]:
        """Parse les cards de la page de résultats Amazon."""
        try:
            from bs4 import BeautifulSoup
        except ImportError as e:
            raise AdapterError(f"BeautifulSoup requis: {e}")

        soup = BeautifulSoup(html, "lxml")
        cards = soup.select("[data-component-type='s-search-result']")
        if not cards:
            cards = soup.select("div.s-result-item[data-asin]")

        products: List[Dict[str, Any]] = []
        for card in cards:
            asin = card.get("data-asin", "").strip()
            if not asin:
                continue

            title_el = card.select_one("h2 a span") or card.select_one("h2 span")
            title = title_el.get_text(" ", strip=True) if title_el else ""
            if not title:
                continue

            link_el = card.select_one("h2 a")
            href = link_el.get("href") if link_el else ""
            if href and not href.startswith("http"):
                href = urljoin(self.site_url, href)
            if not href and asin:
                href = f"{self.site_url}/dp/{asin}"

            price = self._parse_price(card)
            image_el = card.select_one("img.s-image")
            image = image_el.get("src", "") if image_el else ""

            brand_el = card.select_one("h5 span.a-size-base-plus") \
                       or card.select_one(".s-line-clamp-1")
            brand = brand_el.get_text(strip=True) if brand_el else None

            rating_el = card.select_one("span.a-icon-alt")
            rating = None
            if rating_el:
                m = re.search(r"(\d[.,]\d)", rating_el.get_text())
                if m:
                    try:
                        rating = float(m.group(1).replace(",", "."))
                    except ValueError:
                        pass

            sponsored = bool(card.select_one("span.s-sponsored-label-text"))

            products.append({
                "name": title,
                "prix": price,
                "currency": "CAD" if self.region == "ca" else "USD",
                "marque": brand,
                "image": image,
                "sku": asin,
                "sourceUrl": href,
                "etat": "neuf",
                "rating": rating,
                "sponsored": sponsored,
            })
        return products

    def _parse_price(self, card) -> Optional[float]:
        """Extrait le prix d'une card Amazon (multiple emplacements possibles)."""
        for css in ("span.a-price > span.a-offscreen",
                    "span.a-price-whole",
                    "span.a-color-base"):
            el = card.select_one(css)
            if not el:
                continue
            text = el.get_text(strip=True)
            if not text:
                continue
            cleaned = re.sub(r"[^\d.,]", "", text)
            if not cleaned:
                continue
            cleaned = cleaned.replace(",", "")
            try:
                v = float(cleaned)
                if v > 0:
                    return v
            except ValueError:
                continue
        return None
