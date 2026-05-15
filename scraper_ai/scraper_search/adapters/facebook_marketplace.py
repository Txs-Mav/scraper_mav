"""
FacebookMarketplaceAdapter — Marketplace de Facebook.

⚠️ CONTRAINTE MAJEURE : Facebook **REQUIERT une authentification** pour voir
les listings Marketplace au-delà des 1-2 premiers résultats. Sans cookies de
session valides, on obtient juste une landing page.

Stratégie :
  1. Charger les cookies de session FB depuis un fichier JSON (chemin via
     `FB_COOKIES_FILE` dans .env).
  2. Injecter ces cookies dans le contexte Playwright AVANT de naviguer.
  3. Aller sur /marketplace/category/search/?query=<q>&exact=false.
  4. Parser les listings dans le DOM (FB embed un gros JSON dans la page).

Comment exporter tes cookies FB :
  - Connecte-toi à facebook.com dans ton navigateur.
  - Installe l'extension "Cookie-Editor" (Chrome/Firefox) ou "EditThisCookie".
  - Domaine .facebook.com → "Export" → format "JSON".
  - Sauvegarde le fichier (ex: ~/.config/scraper_mav/fb_cookies.json).
  - Variable d'env : FB_COOKIES_FILE=/path/to/fb_cookies.json

Limitations :
  - Les cookies FB expirent (rotation tous les ~30j).
  - Trop de requêtes → CAPTCHA puis ban temporaire du compte.
  - À utiliser **uniquement avec un compte dédié au scraping**, jamais ton
    compte personnel.

L'adapter est désactivé par défaut. Active-le explicitement via la CLI
(`--facebook`) ou le toggle UI.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urljoin

from ..models import SearchQuery
from ._browser_serp_base import BrowserSerpAdapter
from .base import AdapterError


class FacebookMarketplaceAdapter(BrowserSerpAdapter):
    name = "Facebook Marketplace"
    site_url = "https://www.facebook.com"
    serves_categories: List[str] = ["*"]

    marketplace_hint = ""
    default_timeout_ms = 30000  # FB est lourd (gros bundle React)
    scroll_on_load = True
    max_scrolls = 4

    def __init__(self, *,
                 cookies_file: Optional[str] = None,
                 location: str = "montreal",
                 radius_km: int = 60,
                 **kwargs):
        """
        Args:
            cookies_file: chemin vers JSON cookies FB (sinon variable FB_COOKIES_FILE).
            location: ville pour le périmètre de recherche (URL slug FB).
            radius_km: rayon de recherche autour de la ville (1, 2, 5, 10, 20, 40, 60, 80, 100, 250, 500).
        """
        super().__init__(use_proxy_env="FB_PROXY_URL", **kwargs)
        self.cookies_file = cookies_file or os.getenv("FB_COOKIES_FILE", "").strip()
        self.location = location
        self.radius_km = radius_km

    def _build_url(self, query: SearchQuery, text: str, *, page: int = 1) -> str:
        # FB Marketplace ne pagine pas par URL — c'est du scroll infini.
        # On n'utilise donc jamais `page > 1`.
        if page > 1:
            return ""
        params: List[str] = [
            f"query={quote_plus(text)}",
            f"radius={self.radius_km}",
            "exact=false",
        ]
        if query.prix_min:
            params.append(f"minPrice={int(query.prix_min)}")
        if query.prix_max:
            params.append(f"maxPrice={int(query.prix_max)}")
        return (f"https://www.facebook.com/marketplace/{quote_plus(self.location)}"
                f"/search/?{'&'.join(params)}")

    # ------------------------------------------------------------------
    # Override search() pour injecter les cookies AVANT navigation
    # ------------------------------------------------------------------

    def search(self, query, *, max_results: int = 50):
        if not self.cookies_file:
            raise AdapterError(
                "Facebook Marketplace : FB_COOKIES_FILE non configuré. "
                "Voir scraper_search/adapters/facebook_marketplace.py pour le setup."
            )
        if not os.path.exists(self.cookies_file):
            raise AdapterError(
                f"Facebook Marketplace : fichier cookies introuvable: {self.cookies_file}"
            )

        cookies = self._load_cookies()
        if not cookies:
            raise AdapterError(
                "Facebook Marketplace : aucun cookie valide trouvé dans le fichier."
            )

        text = query.search_text()
        if not text:
            return []

        urls = self._build_urls(query, text)
        if not urls:
            return []

        try:
            from scraper_ai.scraper_usine.browser_agent import BrowserAgent
        except ImportError as e:
            raise AdapterError(f"BrowserAgent indisponible: {e}")

        all_products: List[Dict[str, Any]] = []
        proxy_dict = self._proxy_dict()

        try:
            with BrowserAgent(block_assets=True, locale="fr-CA",
                              proxy=proxy_dict) as agent:
                # Injection des cookies dans le contexte Playwright
                if hasattr(agent, "_context") and agent._context:
                    try:
                        agent._context.add_cookies(cookies)
                    except Exception as e:
                        raise AdapterError(f"Failed to inject FB cookies: {e}")

                for url in urls:
                    try:
                        result = agent.render(
                            url,
                            timeout_ms=self.timeout_ms,
                            networkidle_ms=3500,
                            scroll=True,
                            max_scrolls=self.max_scrolls,
                            dismiss_cookies=False,  # FB cookie banner = pas notre concern
                            post_load_wait_ms=2000,
                        )
                    except Exception as e:
                        raise AdapterError(f"FB Marketplace render error: {e}")

                    html = result.html or ""
                    if "login" in result.final_url.lower() and "marketplace" not in result.final_url.lower():
                        raise AdapterError(
                            "FB Marketplace : redirection vers login → cookies expirés. "
                            "Re-exporte les cookies depuis ton navigateur."
                        )
                    if self._looks_blocked(html):
                        raise AdapterError("FB Marketplace : blocage détecté.")
                    products = self._parse_listing(html, base_url=url)
                    all_products.extend(products)
        except AdapterError:
            raise
        except Exception as e:
            raise AdapterError(f"FB Marketplace session error: {e}")

        return self._score_and_filter(query, all_products, max_results)

    # ------------------------------------------------------------------
    # Cookies loader
    # ------------------------------------------------------------------

    def _load_cookies(self) -> List[Dict[str, Any]]:
        """Charge un fichier JSON cookies au format export Cookie-Editor.
        Convertit en format Playwright `add_cookies`."""
        with open(self.cookies_file, "r", encoding="utf-8") as f:
            raw = json.load(f)

        if isinstance(raw, dict) and "cookies" in raw:
            raw = raw["cookies"]
        if not isinstance(raw, list):
            return []

        out: List[Dict[str, Any]] = []
        for c in raw:
            if not isinstance(c, dict):
                continue
            name = c.get("name")
            value = c.get("value")
            domain = c.get("domain", ".facebook.com")
            if not name or value is None:
                continue
            cookie: Dict[str, Any] = {
                "name": name,
                "value": str(value),
                "domain": domain,
                "path": c.get("path", "/"),
            }
            # Champs optionnels Playwright
            if "expirationDate" in c:
                cookie["expires"] = float(c["expirationDate"])
            elif "expires" in c:
                cookie["expires"] = float(c["expires"])
            if "httpOnly" in c:
                cookie["httpOnly"] = bool(c["httpOnly"])
            if "secure" in c:
                cookie["secure"] = bool(c["secure"])
            same_site = c.get("sameSite", "Lax")
            if isinstance(same_site, str):
                # Cookie-Editor renvoie "no_restriction" / "unspecified" / "lax" / "strict"
                ss_map = {"no_restriction": "None", "unspecified": "Lax",
                          "lax": "Lax", "strict": "Strict", "none": "None"}
                cookie["sameSite"] = ss_map.get(same_site.lower(), "Lax")
            out.append(cookie)
        return out

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse_listing(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        # FB Marketplace embed les listings dans des balises script de type
        # `application/json` avec data-content-len. On peut aussi extraire via
        # __isProfileBookmarks ou en cherchant des marketplace_listing_id.
        listings = self._extract_marketplace_listings(html)
        if listings:
            return self._post_process(listings, base_url=base_url)
        # Fallback : scrape du DOM (les liens /marketplace/item/<id>)
        return self._post_process(self._scrape_dom_links(html, base_url=base_url),
                                   base_url=base_url)

    def _extract_marketplace_listings(self, html: str) -> List[Dict[str, Any]]:
        """Cherche les blocs JSON qui contiennent les listings FB."""
        out: List[Dict[str, Any]] = []
        # Pattern : "marketplace_listing_id":"<id>","marketplace_listing_title":"…","listing_price":…
        pattern = re.compile(
            r'\{"marketplace_listing_id"\s*:\s*"(\d+)"[^{}]*?'
            r'"marketplace_listing_title"\s*:\s*"([^"]+)"[^{}]*?'
            r'"listing_price"\s*:\s*\{[^}]*?"amount"\s*:\s*"([\d.]+)"'
            r'[^{}]*?"primary_listing_photo"\s*:\s*\{[^}]*?"image"\s*:\s*\{[^}]*?'
            r'"uri"\s*:\s*"([^"]+)"',
            re.DOTALL
        )
        for m in pattern.finditer(html):
            lid, title, price, photo = m.groups()
            try:
                price_v = float(price)
            except ValueError:
                price_v = None
            # Le titre peut être en JSON-escaped (\u00e9 etc.)
            try:
                title = json.loads(f'"{title}"')
            except Exception:
                pass
            try:
                photo = json.loads(f'"{photo}"')
            except Exception:
                pass
            out.append({
                "name": title,
                "prix": price_v,
                "currency": "CAD",
                "image": photo,
                "sku": lid,
                "sourceUrl": f"https://www.facebook.com/marketplace/item/{lid}/",
                "etat": "occasion",
            })
            if len(out) >= 60:
                break
        return out

    def _scrape_dom_links(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        """Fallback : liens /marketplace/item/<id>."""
        out: List[Dict[str, Any]] = []
        for m in re.finditer(r'/marketplace/item/(\d+)/', html):
            lid = m.group(1)
            url = f"https://www.facebook.com/marketplace/item/{lid}/"
            if any(p["sourceUrl"] == url for p in out):
                continue
            out.append({
                "name": f"FB Marketplace #{lid}",
                "prix": None,
                "sourceUrl": url,
                "sku": lid,
                "etat": "occasion",
            })
            if len(out) >= 30:
                break
        return out
