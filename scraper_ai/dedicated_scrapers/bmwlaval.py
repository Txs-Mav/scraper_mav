"""Scraper dédié pour BMW Laval (https://www.bmwlaval.com/).

Site WordPress de concessionnaire BMW. Cloudflare est activé en
managed challenge ; on s'appuie donc sur les headers stealth de la
session de base (rotation UA) et un parsing très tolérant pour
fonctionner aussi bien sur la home/listing que sur les pages détail.

Stratégie :
- Découverte : pages de listing FR/EN + pagination + sitemap_index.xml.
- Extraction par page détail :
    * JSON-LD (Vehicle / Car / Product)
    * Meta OpenGraph
    * Heuristiques regex sur le DOM (kilométrage, VIN, prix, couleur)
"""

from __future__ import annotations

import json
import re
from typing import Dict, List, Optional, Any, Iterable
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from scraper_ai.dedicated_scrapers.base import DedicatedScraper


VEHICLE_URL_RE = re.compile(
    r"/(?:fr|en)/"
    r"(?:vehicule|vehicles?|vehicules?|inventaire|inventory|"
    r"vehicules-occasion|vehicules-neufs|used-inventory|new-inventory|"
    r"used|neuf|new|occasion|pre-owned|cpo|certified)"
    r"/[^/?#]+/[^/?#]+",
    re.IGNORECASE,
)

LISTING_KEYWORDS = {
    "vehicules-occasion", "vehicules-neufs", "used-inventory",
    "new-inventory", "inventory", "inventaire", "occasion", "neuf",
    "used", "new", "cpo", "pre-owned", "vehicles", "vehicule",
    "vehicules",
}

YEAR_RE = re.compile(r"\b(19[8-9]\d|20[0-4]\d)\b")
KM_RE = re.compile(
    r"(\d{1,3}(?:[ \u00a0,.]?\d{3})+|\d{3,7})\s*(?:km|kilom)",
    re.IGNORECASE,
)
VIN_RE = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b")

BMW_MODELS = [
    "X1", "X2", "X3", "X4", "X5", "X6", "X7", "XM",
    "M2", "M3", "M4", "M5", "M8",
    "i3", "i4", "i5", "i7", "i8", "iX", "iX1", "iX2", "iX3",
    "Z4",
    "M240", "M340", "M440", "M550", "M850",
    "230", "330", "430", "530", "540", "740", "750", "760", "840", "850",
    "228", "328", "428", "528", "535", "550",
]


class BmwLavalScraper(DedicatedScraper):
    SITE_NAME = "BMW Laval"
    SITE_SLUG = "bmwlaval"
    SITE_URL = "https://www.bmwlaval.com/"
    SITE_DOMAIN = "www.bmwlaval.com"

    LISTING_URLS = [
        "https://www.bmwlaval.com/fr/vehicules-occasion",
        "https://www.bmwlaval.com/fr/vehicules-neufs",
        "https://www.bmwlaval.com/en/used-inventory",
        "https://www.bmwlaval.com/en/new-inventory",
    ]

    SITEMAP_URLS = [
        "https://www.bmwlaval.com/sitemap_index.xml",
        "https://www.bmwlaval.com/sitemap.xml",
        "https://www.bmwlaval.com/fr/sitemap_index.xml",
        "https://www.bmwlaval.com/en/sitemap_index.xml",
    ]

    MAX_LISTING_PAGES = 25

    # ------------------------------------------------------------------
    # Helpers HTTP
    # ------------------------------------------------------------------
    def _get_text(self, url: str) -> Optional[str]:
        try:
            r = self.session.get(url, timeout=self.HTTP_TIMEOUT,
                                 allow_redirects=True)
            if r.status_code != 200:
                return None
            return r.text
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Découverte
    # ------------------------------------------------------------------
    def discover_product_urls(
        self, categories: Optional[List[str]] = None
    ) -> List[str]:
        urls: set[str] = set()

        # 1) Listings + pagination
        for listing in self.LISTING_URLS:
            consecutive_empty = 0
            for page in range(1, self.MAX_LISTING_PAGES + 1):
                page_url = listing if page == 1 else f"{listing}/page/{page}"
                html = self._get_text(page_url)
                if not html:
                    break
                found = self._extract_vehicle_links(html, base=page_url)
                new = found - urls
                urls |= found
                if not new:
                    consecutive_empty += 1
                    if consecutive_empty >= 2:
                        break
                else:
                    consecutive_empty = 0

        # 2) Sitemaps en complément
        for sm_url in self.SITEMAP_URLS:
            xml_text = self._get_text(sm_url)
            if not xml_text:
                continue
            urls |= self._extract_sitemap_urls(xml_text, depth=0)

        filtered = sorted({
            u for u in urls if self._looks_like_vehicle_url(u)
        })
        return filtered

    def _extract_vehicle_links(self, html: str, base: str) -> set[str]:
        soup = BeautifulSoup(html, "html.parser")
        out: set[str] = set()
        for a in soup.find_all("a", href=True):
            href = (a.get("href") or "").strip()
            if not href or href.startswith("#") or href.lower().startswith("javascript:"):
                continue
            abs_url = urljoin(base, href)
            p = urlparse(abs_url)
            if p.netloc and p.netloc != self.SITE_DOMAIN:
                continue
            if self._looks_like_vehicle_url(abs_url):
                clean = abs_url.split("?")[0].split("#")[0].rstrip("/")
                out.add(clean)
        return out

    def _extract_sitemap_urls(self, xml_text: str, depth: int = 0) -> set[str]:
        out: set[str] = set()
        if depth > 3:
            return out
        for m in re.finditer(r"<loc>\s*([^<\s]+)\s*</loc>", xml_text,
                             re.IGNORECASE):
            url = m.group(1).strip()
            if url.endswith(".xml"):
                sub = self._get_text(url)
                if sub:
                    out |= self._extract_sitemap_urls(sub, depth + 1)
            elif self._looks_like_vehicle_url(url):
                out.add(url.split("?")[0].rstrip("/"))
        return out

    def _looks_like_vehicle_url(self, url: str) -> bool:
        if not url:
            return False
        p = urlparse(url)
        if p.netloc and p.netloc != self.SITE_DOMAIN:
            return False
        path = p.path.lower().strip("/")
        if not path:
            return False
        segs = [s for s in path.split("/") if s]
        if len(segs) < 3:
            return False
        last = segs[-1]
        if last in LISTING_KEYWORDS:
            return False
        if any(x in path for x in (
            "/page/", "wp-content", "wp-admin", "wp-includes", "/feed",
            "/tag/", "/category/", "/auteur/", "/author/", "/wp-json",
        )):
            return False
        if VEHICLE_URL_RE.search("/" + path):
            return True
        # Heuristique repli : URL contenant une année et un mot-clé véhicule
        if YEAR_RE.search(last) and any(
            k in path for k in ("vehicul", "vehicle", "inventory",
                                "inventaire", "occasion", "neuf", "used",
                                "new")
        ):
            return True
        return False

    # ------------------------------------------------------------------
    # Extraction page détail
    # ------------------------------------------------------------------
    def extract_from_detail_page(
        self,
        url: str,
        html: str,
        soup: BeautifulSoup,
    ) -> Optional[Dict[str, Any]]:
        if not html or not soup:
            return None

        data: Dict[str, Any] = {"url": url}

        jsonld = self._parse_jsonld(soup)
        data.update(jsonld)

        og = self._parse_og(soup)
        for k, v in og.items():
            data.setdefault(k, v)

        dom = self._parse_dom(soup)
        for k, v in dom.items():
            if not data.get(k):
                data[k] = v

        # name fallback
        if not data.get("name"):
            h1 = soup.find("h1")
            if h1 and h1.get_text(strip=True):
                data["name"] = h1.get_text(" ", strip=True)
            elif soup.title and soup.title.string:
                data["name"] = soup.title.string.strip()

        if not data.get("marque"):
            data["marque"] = "BMW"

        name = data.get("name") or ""
        if not data.get("annee"):
            m = YEAR_RE.search(name)
            if m:
                try:
                    data["annee"] = int(m.group(1))
                except Exception:
                    pass
        if not data.get("modele"):
            mdl = self._guess_model(name)
            if mdl:
                data["modele"] = mdl

        imgs = data.get("image") or []
        if isinstance(imgs, str):
            imgs = [imgs]
        imgs = [i for i in dict.fromkeys(imgs) if i]
        data["image"] = imgs

        if not data.get("name") and not data.get("prix"):
            return None

        return data

    # ------------------------------------------------------------------
    # Parsers spécifiques
    # ------------------------------------------------------------------
    def _parse_jsonld(self, soup: BeautifulSoup) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for tag in soup.find_all("script", type=lambda t: t and "ld+json" in t):
            raw = tag.string or tag.get_text() or ""
            if not raw.strip():
                continue
            try:
                data = json.loads(raw)
            except Exception:
                try:
                    cleaned = re.sub(r"//[^\n]*\n", "\n", raw)
                    data = json.loads(cleaned)
                except Exception:
                    continue
            for node in self._iter_jsonld_nodes(data):
                if not isinstance(node, dict):
                    continue
                t = node.get("@type")
                types = [t] if isinstance(t, str) else list(t or [])
                if not any(x in ("Vehicle", "Car", "Product", "MotorVehicle")
                           for x in types):
                    continue

                if not out.get("name") and node.get("name"):
                    out["name"] = str(node["name"]).strip()
                if not out.get("description") and node.get("description"):
                    out["description"] = str(node["description"]).strip()

                brand = node.get("brand") or node.get("manufacturer")
                if brand:
                    if isinstance(brand, dict):
                        bname = brand.get("name")
                        if bname:
                            out.setdefault("marque", str(bname).strip())
                    else:
                        out.setdefault("marque", str(brand).strip())

                if node.get("model"):
                    out.setdefault("modele", str(node["model"]).strip())

                year = (node.get("vehicleModelDate")
                        or node.get("modelDate")
                        or node.get("productionDate")
                        or node.get("releaseDate"))
                if year:
                    m = re.search(r"(\d{4})", str(year))
                    if m:
                        try:
                            out.setdefault("annee", int(m.group(1)))
                        except Exception:
                            pass

                vin = node.get("vehicleIdentificationNumber") or node.get("vin")
                if vin:
                    out.setdefault("vin", str(vin).strip())

                color = node.get("color") or node.get("vehicleInteriorColor")
                if color:
                    out.setdefault("couleur", str(color).strip())

                mileage = node.get("mileageFromOdometer")
                if isinstance(mileage, dict):
                    val = mileage.get("value")
                    if val is not None:
                        try:
                            out.setdefault("kilometrage", int(float(val)))
                        except Exception:
                            pass
                elif mileage is not None:
                    try:
                        out.setdefault("kilometrage", int(float(mileage)))
                    except Exception:
                        pass

                offers = node.get("offers")
                price = None
                if isinstance(offers, dict):
                    price = offers.get("price") or offers.get("lowPrice")
                elif isinstance(offers, list) and offers:
                    o0 = offers[0]
                    if isinstance(o0, dict):
                        price = o0.get("price") or o0.get("lowPrice")
                if price is None:
                    price = node.get("price")
                if price is not None:
                    try:
                        clean = (str(price).replace(",", "")
                                 .replace("$", "").strip())
                        val = float(clean)
                        if 1 <= val <= 1_000_000:
                            out.setdefault("prix", val)
                    except Exception:
                        pass

                img = node.get("image")
                if img and "image" not in out:
                    if isinstance(img, str):
                        out["image"] = [img]
                    elif isinstance(img, list):
                        out["image"] = [str(i) for i in img if i]
                    elif isinstance(img, dict) and img.get("url"):
                        out["image"] = [str(img["url"])]
        return out

    def _iter_jsonld_nodes(self, node: Any) -> Iterable[Any]:
        if isinstance(node, list):
            for n in node:
                yield from self._iter_jsonld_nodes(n)
        elif isinstance(node, dict):
            yield node
            if "@graph" in node:
                yield from self._iter_jsonld_nodes(node["@graph"])
            for v in node.values():
                if isinstance(v, (list, dict)):
                    yield from self._iter_jsonld_nodes(v)

    def _parse_og(self, soup: BeautifulSoup) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            out["name"] = og_title["content"].strip()
        og_desc = soup.find("meta", property="og:description")
        if og_desc and og_desc.get("content"):
            out["description"] = og_desc["content"].strip()
        og_img = soup.find("meta", property="og:image")
        if og_img and og_img.get("content"):
            out["image"] = [og_img["content"].strip()]
        return out

    def _parse_dom(self, soup: BeautifulSoup) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        text = soup.get_text(" ", strip=True)

        m = VIN_RE.search(text)
        if m:
            out["vin"] = m.group(1)

        m = KM_RE.search(text)
        if m:
            raw = re.sub(r"[ \u00a0,.]", "", m.group(1))
            try:
                val = int(raw)
                if 0 <= val <= 999_999:
                    out["kilometrage"] = val
            except Exception:
                pass

        # Prix : nodes contenant un $
        price_candidates: List[float] = []
        for el in soup.find_all(string=re.compile(r"\d[\d \u00a0,.]*\s*\$")):
            for pm in re.finditer(
                r"(\d{1,3}(?:[ \u00a0,.]\d{3})+|\d{4,7})\s*\$",
                str(el),
            ):
                raw = re.sub(r"[ \u00a0,.]", "", pm.group(1))
                try:
                    val = float(raw)
                    if 1000 <= val <= 500_000:
                        price_candidates.append(val)
                except Exception:
                    continue
        if price_candidates:
            normal = [p for p in price_candidates if p >= 5000]
            out["prix"] = min(normal) if normal else min(price_candidates)

        # Couleur
        for label_re in (
            re.compile(r"couleur\s*ext", re.IGNORECASE),
            re.compile(r"exterior\s*colou?r", re.IGNORECASE),
            re.compile(r"^couleur$", re.IGNORECASE),
            re.compile(r"^colou?r$", re.IGNORECASE),
        ):
            tag = soup.find(string=label_re)
            if tag and tag.parent:
                nxt = tag.parent.find_next(string=True)
                val = nxt.strip() if nxt else ""
                if val and not label_re.search(val) and len(val) < 80:
                    out["couleur"] = val
                    break

        # Images de galerie
        imgs: List[str] = []
        for img in soup.find_all("img"):
            src = (img.get("data-src") or img.get("data-lazy-src")
                   or img.get("src") or "")
            src = src.strip()
            if not src or src.startswith("data:"):
                continue
            low = src.lower()
            if any(s in low for s in ("logo", "icon", "sprite", "placeholder",
                                       "spinner", "loader")):
                continue
            absu = urljoin(self.SITE_URL, src)
            imgs.append(absu)
        if imgs:
            out["image"] = list(dict.fromkeys(imgs))[:20]

        return out

    @staticmethod
    def _guess_model(name: str) -> Optional[str]:
        if not name:
            return None
        upper = name.upper()
        for mdl in BMW_MODELS:
            if re.search(r"\b" + re.escape(mdl.upper()) + r"\b", upper):
                return mdl
        m = YEAR_RE.search(name)
        if m:
            tail = name[m.end():].strip()
            tokens = tail.split()
            if tokens:
                if tokens[0].upper() == "BMW" and len(tokens) > 1:
                    return tokens[1]
                return tokens[0]
        return None
