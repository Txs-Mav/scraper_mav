"""
Scraper dédié pour SM Sport (smsport.ca).
Plateforme : PowerGo / Next.js.
Découverte : sitemap inventory-detail.xml.
Extraction : JSON-LD Vehicle (présent dans chaque page produit).
"""
from __future__ import annotations

import json
import re
import logging
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

try:
    from .base import DedicatedScraper
except Exception:  # pragma: no cover
    from base import DedicatedScraper  # type: ignore

logger = logging.getLogger(__name__)


class SmsportScraper(DedicatedScraper):

    SITE_NAME = "SM Sport"
    SITE_SLUG = "smsport"
    SITE_URL = "https://smsport.ca/fr/"
    SITE_DOMAIN = "smsport.ca"

    SITEMAP_CANDIDATES = (
        "https://smsport.ca/sitemaps/inventory-detail.xml",
        "https://smsport.ca/sitemap.xml",
    )

    PRODUCT_URL_PATTERNS = ("/fr/neuf/", "/fr/usage/")
    EXCLUDE_SEGMENTS = ("sitemap",)

    MAX_PRODUCT_URLS = 400

    # ------------------------------------------------------------------
    # 1) Découverte des URLs produit via sitemap
    # ------------------------------------------------------------------
    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        urls: List[str] = []
        seen = set()

        for sm_url in self.SITEMAP_CANDIDATES:
            try:
                found = self._fetch_sitemap_urls(sm_url, depth=0)
            except Exception as exc:
                logger.debug("[%s] sitemap %s: %s", self.SITE_SLUG, sm_url, exc)
                continue
            for u in found:
                if u in seen:
                    continue
                if self._is_product_url(u):
                    seen.add(u)
                    urls.append(u)
            if urls:
                logger.info("[%s] %d URLs via %s", self.SITE_SLUG, len(urls), sm_url)
                break

        if len(urls) > self.MAX_PRODUCT_URLS:
            urls = urls[: self.MAX_PRODUCT_URLS]

        logger.info("[%s] Total URLs produit : %d", self.SITE_SLUG, len(urls))
        return urls

    def _fetch_sitemap_urls(self, sitemap_url: str, depth: int = 0) -> List[str]:
        if depth > 2:
            return []
        try:
            resp = self.session.get(sitemap_url, timeout=self.HTTP_TIMEOUT)
            if resp.status_code != 200 or not resp.text:
                return []
            text = resp.text
        except Exception:
            return []

        if "<sitemapindex" in text:
            sub_urls = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", text)
            collected: List[str] = []
            inv_subs = [s for s in sub_urls if any(
                k in s.lower() for k in ("inventory", "vehicle", "neuf", "usage", "inventaire")
            )]
            for sub in (inv_subs or sub_urls)[:15]:
                try:
                    collected.extend(self._fetch_sitemap_urls(sub, depth + 1))
                except Exception:
                    continue
            return collected

        return re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", text)

    def _is_product_url(self, url: str) -> bool:
        if not url or not isinstance(url, str):
            return False
        low = url.lower()
        if self.SITE_DOMAIN not in low:
            return False
        if not any(p in low for p in self.PRODUCT_URL_PATTERNS):
            return False
        if any(e in low for e in self.EXCLUDE_SEGMENTS):
            return False
        # Doit comporter /inventaire/ + slug produit final
        if "/inventaire/" not in low:
            return False
        path = low.split(self.SITE_DOMAIN, 1)[-1]
        segments = [s for s in path.split("/") if s]
        if len(segments) < 5:
            return False
        last = segments[-1]
        if last in ("inventaire", "inventory"):
            return False
        return True

    # ------------------------------------------------------------------
    # 2) Extraction depuis une page produit
    # ------------------------------------------------------------------
    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        # a) JSON-LD Vehicle/Product
        product = self._find_jsonld_vehicle(html)

        data: Dict[str, Any] = {}

        if product:
            self._fill_from_jsonld(data, product)

        # b) Fallbacks via meta OG si JSON-LD incomplet
        if not data.get("name"):
            og_title = self._meta(soup, "og:title")
            if og_title:
                data["name"] = self._clean_text(og_title)
        if not data.get("description"):
            og_desc = self._meta(soup, "og:description")
            if og_desc:
                data["description"] = self._clean_text(og_desc)
        if not data.get("image"):
            og_image = self._meta(soup, "og:image")
            if og_image:
                data["image"] = [og_image]

        # c) Enrichissement depuis URL (catégorie, condition)
        self._enrich_from_url(data, url)

        # d) Enrichissement depuis le nom (année, marque, modèle si manquants)
        self._enrich_from_name(data)

        if not data.get("name"):
            return None

        # Garantir clés attendues côté validation
        data.setdefault("prix", None)
        data.setdefault("marque", None)
        data.setdefault("modele", None)
        data.setdefault("annee", None)
        data.setdefault("kilometrage", None)
        data.setdefault("vin", None)
        data.setdefault("couleur", None)
        data.setdefault("image", [])
        data.setdefault("description", None)

        return data

    # ------------------------------------------------------------------
    # JSON-LD helpers
    # ------------------------------------------------------------------
    def _find_jsonld_vehicle(self, html: str) -> Optional[Dict[str, Any]]:
        blocks = re.findall(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html, re.DOTALL | re.IGNORECASE,
        )
        product_types = {"Vehicle", "Car", "Motorcycle", "Product"}
        for raw in blocks:
            try:
                data = json.loads(raw.strip())
            except Exception:
                # Parfois plusieurs JSON concaténés ; tenter une réparation simple.
                try:
                    data = json.loads(re.sub(r",\s*}", "}", raw.strip()))
                except Exception:
                    continue
            found = self._search_product(data, product_types)
            if found:
                return found
        return None

    def _search_product(self, node: Any, types: set) -> Optional[Dict[str, Any]]:
        if isinstance(node, dict):
            t = node.get("@type")
            if isinstance(t, str) and t in types:
                return node
            if isinstance(t, list) and any(x in types for x in t):
                return node
            graph = node.get("@graph")
            if isinstance(graph, list):
                for it in graph:
                    f = self._search_product(it, types)
                    if f:
                        return f
            for v in node.values():
                if isinstance(v, (dict, list)):
                    f = self._search_product(v, types)
                    if f:
                        return f
        elif isinstance(node, list):
            for it in node:
                f = self._search_product(it, types)
                if f:
                    return f
        return None

    def _fill_from_jsonld(self, data: Dict[str, Any], p: Dict[str, Any]) -> None:
        # Nom
        name = p.get("name")
        if isinstance(name, str) and name.strip():
            data["name"] = self._clean_text(name)

        # Description
        desc = p.get("description")
        if isinstance(desc, str) and desc.strip():
            data["description"] = self._clean_text(desc)

        # Marque
        brand = p.get("brand") or p.get("manufacturer")
        if isinstance(brand, dict):
            brand = brand.get("name")
        if isinstance(brand, str) and brand.strip():
            data["marque"] = brand.strip()

        # Modèle
        model = p.get("model")
        if isinstance(model, dict):
            model = model.get("name")
        if isinstance(model, str) and model.strip():
            data["modele"] = model.strip()

        # Année
        year = p.get("vehicleModelDate") or p.get("modelDate") or p.get("productionDate")
        if year:
            yr = self.clean_year(str(year))
            if yr:
                data["annee"] = yr

        # Couleur
        color = p.get("color") or p.get("vehicleInteriorColor")
        if isinstance(color, str) and color.strip():
            data["couleur"] = color.strip()

        # VIN
        vin = p.get("vehicleIdentificationNumber") or p.get("vin")
        if isinstance(vin, str) and vin.strip():
            data["vin"] = vin.strip()

        # SKU / inventaire
        sku = p.get("sku") or p.get("mpn") or p.get("productID")
        if sku:
            data["inventaire"] = str(sku).strip()
            data["sku"] = str(sku).strip()

        # Kilométrage
        mileage = p.get("mileageFromOdometer")
        if isinstance(mileage, dict):
            val = mileage.get("value")
            if val not in (None, "", "null"):
                km = self.clean_mileage(str(val))
                if km is not None:
                    data["kilometrage"] = km
        elif isinstance(mileage, (str, int, float)):
            km = self.clean_mileage(str(mileage))
            if km is not None:
                data["kilometrage"] = km

        # Images
        images_raw = p.get("image") or []
        if isinstance(images_raw, str):
            images_raw = [images_raw]
        elif isinstance(images_raw, dict):
            images_raw = [images_raw.get("url") or images_raw.get("contentUrl")]
        images = [i for i in images_raw if isinstance(i, str) and i.startswith("http")]
        if images:
            data["image"] = images

        # Prix via offers
        offers = p.get("offers")
        if isinstance(offers, list) and offers:
            offers = offers[0]
        if isinstance(offers, dict):
            price = offers.get("price") or offers.get("lowPrice") or offers.get("highPrice")
            if price not in (None, "", 0, "0"):
                price_val = self.clean_price(str(price))
                if price_val:
                    data["prix"] = price_val
            currency = offers.get("priceCurrency")
            if currency:
                data["devise"] = currency
            availability = offers.get("availability")
            if availability:
                # Normaliser disponibilité
                data["disponibilite"] = str(availability).split("/")[-1]

        # Condition
        cond = p.get("itemCondition")
        if isinstance(cond, str):
            low = cond.lower()
            if "new" in low:
                data["condition"] = "Neuf"
            elif "used" in low:
                data["condition"] = "Usagé"

    # ------------------------------------------------------------------
    # Enrichissement URL / nom
    # ------------------------------------------------------------------
    def _enrich_from_url(self, data: Dict[str, Any], url: str) -> None:
        low = url.lower()
        path = low.split(self.SITE_DOMAIN, 1)[-1]
        segments = [s for s in path.split("/") if s]

        if not data.get("condition"):
            if "/neuf/" in low:
                data["condition"] = "Neuf"
            elif "/usage/" in low:
                data["condition"] = "Usagé"

        # /fr/neuf/<categorie>/inventaire/<slug>
        if not data.get("categorie") and len(segments) >= 3:
            cat = segments[2].replace("-", " ").strip()
            if cat and cat not in ("inventaire", "inventory"):
                data["categorie"] = cat

    def _enrich_from_name(self, data: Dict[str, Any]) -> None:
        name = data.get("name")
        if not name:
            return
        if not data.get("annee"):
            yr = self.clean_year(name)
            if yr:
                data["annee"] = yr

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _meta(soup: BeautifulSoup, prop: str) -> Optional[str]:
        tag = soup.find("meta", attrs={"property": prop})
        if tag and tag.get("content"):
            return tag["content"].strip()
        tag = soup.find("meta", attrs={"name": prop})
        if tag and tag.get("content"):
            return tag["content"].strip()
        return None

    @staticmethod
    def _clean_text(text: str) -> str:
        if not text:
            return text
        # Décodage simple de séquences moji-bake fréquentes (Ã©, Ã , etc.)
        # Le HTML est servi en UTF-8 mais certains champs JSON-LD sont mal encodés.
        try:
            if "Ã" in text or "Â" in text:
                fixed = text.encode("latin-1", errors="ignore").decode("utf-8", errors="ignore")
                if fixed and ("Ã" not in fixed or len(fixed) < len(text)):
                    text = fixed
        except Exception:
            pass
        text = re.sub(r"\s+", " ", text).strip()
        # Couper le suffixe « Neuf À Québec », « | SM Sport » etc.
        for suf in (" Neuf À Québec", " Usagé À Québec", " À Québec",
                    " | SM Sport", " - SM Sport"):
            idx = text.lower().rfind(suf.lower())
            if idx > 0:
                text = text[:idx].strip()
        return text.strip(" -|")
