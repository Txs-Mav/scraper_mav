"""
Scraper dédié pour MachineXpert (https://machinexpert.ca)

Note : le domaine fourni dans la mission (machinexperts.ca avec un "s") ne
résout pas en DNS. Le site réel est `machinexpert.ca` (sans "s") — c'est la
même entreprise (MachineXpert, courtiers en machinerie lourde au Québec).

Plateforme : site custom (PHP/Laravel-like), HTML rendu côté serveur.
Pas besoin de Playwright : tout le contenu utile est dans le HTML statique
et un bloc JSON-LD Product complet est présent sur chaque page détail.

Stratégie :
  - discover : pagination sur /fr/inventaire?page=N, on collecte les liens
    .product-card a.link-overflow jusqu'à ce qu'une page n'en renvoie plus.
  - extract  : on parse le JSON-LD Product (name, image[], description, sku,
    offers.price) puis on en déduit annee/marque/modele depuis le titre
    "2014 John Deere 310SK 1402H".

Champs cibles du profil concessionnaire :
  name, prix, marque, modele, annee, kilometrage, vin, couleur,
  image (image_list), description.

kilometrage / vin / couleur ne sont pas exposés sur ce site (machinerie
lourde, pas auto) — on les laisse à None.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from scraper_ai.dedicated_scrapers.base import DedicatedScraper


class MachinexpertsScraper(DedicatedScraper):
    SITE_NAME = "MachineXpert"
    SITE_SLUG = "machinexperts"
    SITE_URL = "https://machinexpert.ca"
    SITE_DOMAIN = "machinexpert.ca"

    LISTING_URL = "https://machinexpert.ca/fr/inventaire"

    # garde-fou pagination
    MAX_PAGES = 60          # ~591 produits / 12 par page = ~50 pages
    MAX_PRODUCTS = 2000

    # ------------------------------------------------------------------
    # DISCOVERY
    # ------------------------------------------------------------------
    def discover_product_urls(self, categories: Optional[List[str]] = None) -> List[str]:
        urls: List[str] = []
        seen: set = set()

        for page in range(1, self.MAX_PAGES + 1):
            if page == 1:
                page_url = self.LISTING_URL
            else:
                page_url = f"{self.LISTING_URL}?page={page}"

            try:
                html = self._fetch(page_url)
            except Exception:
                break
            if not html:
                break

            soup = BeautifulSoup(html, "html.parser")
            cards = soup.select("div.product-card a.link-overflow")
            if not cards:
                # essai sélecteur plus large
                cards = soup.select("a.link-overflow")

            new_on_page = 0
            for a in cards:
                href = a.get("href")
                if not href:
                    continue
                full = urljoin(self.SITE_URL, href)
                # ne garder que les URLs détail d'inventaire
                # forme attendue : /fr/inventaire/{cat_id}_{slug}/{produit-slug}
                if not re.search(r"/fr/inventaire/\d+_[^/]+/[^/?#]+", full):
                    continue
                if full in seen:
                    continue
                seen.add(full)
                urls.append(full)
                new_on_page += 1
                if len(urls) >= self.MAX_PRODUCTS:
                    return urls

            if new_on_page == 0:
                # page sans nouveau produit : fin de l'inventaire
                break

        return urls

    # ------------------------------------------------------------------
    # HELPERS
    # ------------------------------------------------------------------
    def _fetch(self, url: str) -> Optional[str]:
        """Fetch HTTP simple. Utilise self.session si dispo (fourni par la classe de base)."""
        try:
            session = getattr(self, "session", None)
            if session is not None:
                resp = session.get(url, timeout=25)
            else:
                import requests
                resp = requests.get(url, timeout=25, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; MachineXpertScraper/1.0)"
                })
            if resp.status_code == 200:
                return resp.text
        except Exception:
            return None
        return None

    @staticmethod
    def _find_product_jsonld(soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
        for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
            raw = tag.string or tag.text or ""
            raw = raw.strip()
            if not raw or '"Product"' not in raw:
                continue
            try:
                data = json.loads(raw)
            except Exception:
                # certains JSON-LD ont du contenu litigieux ; tente un nettoyage léger
                cleaned = re.sub(r",\s*([}\]])", r"\1", raw)
                try:
                    data = json.loads(cleaned)
                except Exception:
                    continue
            # data peut être un dict ou une liste
            candidates = data if isinstance(data, list) else [data]
            for item in candidates:
                if isinstance(item, dict) and item.get("@type") == "Product":
                    return item
        return None

    @staticmethod
    def _parse_price(value: Any) -> Optional[float]:
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None
        # ex "53,000.00" ou "53000.00"
        s = s.replace("\xa0", "").replace(" ", "").replace("$", "").replace("CAD", "")
        # virgule = séparateur de milliers anglo, point = décimal
        if "," in s and "." in s:
            s = s.replace(",", "")
        else:
            # peut-être virgule décimale française
            if "," in s and "." not in s:
                s = s.replace(",", ".")
        try:
            return float(s)
        except Exception:
            return None

    @staticmethod
    def _parse_title(title: str) -> Dict[str, Optional[str]]:
        """Décompose "2022 Fabrinord 48 pieds 1404H" en année/marque/modèle."""
        if not title:
            return {"annee": None, "marque": None, "modele": None}
        title = title.strip()
        annee: Optional[int] = None
        rest = title
        m = re.match(r"^\s*(19[5-9]\d|20\d{2})\b\s*(.*)$", title)
        if m:
            try:
                annee = int(m.group(1))
            except Exception:
                annee = None
            rest = m.group(2).strip()
        marque: Optional[str] = None
        modele: Optional[str] = None
        if rest:
            tokens = rest.split()
            if tokens:
                # marque = 1er token (en majuscule initiale) ; si commence par "John"/"Caterpillar"…
                # heuristique : marque = 1 ou 2 premiers tokens si "John Deere", "New Holland", etc.
                two_word_brands = {
                    "john deere", "new holland", "case ih", "land rover",
                    "mack truck", "kenworth t", "freightliner m",
                }
                first_two = " ".join(tokens[:2]).lower()
                if first_two in two_word_brands or first_two.startswith(("john deere", "new holland", "case ih")):
                    marque = " ".join(tokens[:2])
                    modele = " ".join(tokens[2:]) or None
                else:
                    marque = tokens[0]
                    modele = " ".join(tokens[1:]) or None
        return {"annee": annee, "marque": marque, "modele": modele}

    # ------------------------------------------------------------------
    # EXTRACTION
    # ------------------------------------------------------------------
    def extract_from_detail_page(
        self,
        url: str,
        html: str,
        soup: BeautifulSoup,
    ) -> Optional[Dict[str, Any]]:
        # 1) JSON-LD Product (source principale)
        product = self._find_product_jsonld(soup)

        name: Optional[str] = None
        description: Optional[str] = None
        images: List[str] = []
        prix: Optional[float] = None
        sku: Optional[str] = None

        if product:
            name = product.get("name") or None
            description = product.get("description") or None
            sku = product.get("sku") or None
            img = product.get("image")
            if isinstance(img, list):
                images = [str(i) for i in img if i]
            elif isinstance(img, str) and img:
                images = [img]
            offers = product.get("offers")
            if isinstance(offers, dict):
                prix = self._parse_price(offers.get("price"))

        # 2) fallback : h1 pour le nom
        if not name:
            h1 = soup.select_one("div.content-head h1, h1")
            if h1:
                name = h1.get_text(strip=True) or None

        # 3) fallback description : meta description
        if not description:
            meta = soup.find("meta", attrs={"name": "description"})
            if meta and meta.get("content"):
                description = meta["content"].strip() or None

        # 4) fallback images : og:image
        if not images:
            og = soup.find("meta", attrs={"property": "og:image"})
            if og and og.get("content"):
                images = [og["content"].strip()]

        # 5) marque / modèle / année à partir du titre
        meta_parts = self._parse_title(name or "")

        # 6) catégorie depuis l'URL : /fr/inventaire/4_transport/...
        category: Optional[str] = None
        m = re.search(r"/fr/inventaire/\d+_([^/]+)/", url)
        if m:
            category = m.group(1).replace("-", " ")

        # filtre minimal : on exige au moins un nom
        if not name:
            return None

        record: Dict[str, Any] = {
            "url": url,
            "name": name,
            "prix": prix,
            "marque": meta_parts["marque"],
            "modele": meta_parts["modele"],
            "annee": meta_parts["annee"],
            "kilometrage": None,   # non exposé (machinerie lourde)
            "vin": None,           # non exposé
            "couleur": None,       # non exposé
            "image": images,
            "description": description,
            "sku": sku,
            "category": category,
            "currency": "CAD",
        }
        return record
