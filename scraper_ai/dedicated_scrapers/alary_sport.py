"""
Scraper dédié pour Alary Sport (alarysport.com) — Saint-Jérôme (Laurentides).
Sélecteurs hardcodés — aucun appel Gemini.

Stratégie :
  1. Découverte via sitemap PowerGO (inventory-detail.xml), URLs /fr/ SANS CAP
     — les listings sont rendus côté client (RSC Next.js), le sitemap est la
     source de découverte. Oracle vérifié le 2026-08-19 : le payload Next.js
     de /fr/usage/ affiche total=151 = exactement les 151 URLs usagé du
     sitemap ; côté neuf les listings filtrent le « sur commande »
     (motocyclette : 195 listés vs 281 au sitemap) — le sitemap est le
     superset voulu, ces produits ont tous une page valide avec prix
     (échantillon 15/15 OK).
  2. Pages détail (parallèle, pipeline de base) → JSON-LD niché dans @graph :
     "Vehicle" pour les véhicules, "Product" pour les remorques/équipement
     (marque, modèle, année, couleur, km, prix, sku, état) + prix barré
     depuis le bloc CSS pg-vehicle-price (list-price line-through).

Particularités de ce site (vs autres PowerGO) :
  - Très large éventail de segments : bateaux (bateau, bateaux-de-peche,
    chaloupes, ponton), voiturettes-de-golf, vehicules-a-3-roues…
  - Numéros de stock parfois ALPHANUMÉRIQUES dans l'URL (a-vendre-edl70sde,
    a-vendre-v-drive-2es) — regex à la excelmoto.
  - Deux unités distinctes peuvent partager le même id d'URL avec des slugs
    différents (sku « 39171 » vs « 39171_ ») → dédup par sourceUrl, jamais
    par id de stock.
  - Marque doublée dans les noms d'usagés (« Harley-Davidson Harley-Davidson
    SPORTSTER… ») → dédup de tokens adjacents.
  - Descriptions en entités HTML (&Egrave;, &eacute;) + bannières « **…** »
    → unescape + retrait des runs d'astérisques.
  - mileageFromOdometer.value = null sur le neuf (pas de placebo).

Écrit à la main le 2026-08-19.
"""
import html as html_lib
import json
import re
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class AlarySportScraper(DedicatedScraper):

    SITE_NAME = "Alary Sport"
    SITE_SLUG = "alary-sport"
    SITE_URL = "https://www.alarysport.com/fr/"
    SITE_DOMAIN = "alarysport.com"

    MAX_WORKERS = 10

    SITEMAP_CANDIDATES = (
        "https://www.alarysport.com/sitemaps/inventory-detail.xml",
        "https://www.alarysport.com/sitemap-index.xml",
    )

    # IDs de stock parfois alphanumériques (edl70sde, v-drive-2es…)
    _PRODUCT_URL_RE = re.compile(
        r'/fr/(neuf|usage)/[a-z0-9-]+/inventaire/[^/]*a-vendre-[a-z0-9-]+/$')

    # Segment d'URL → type de véhicule lisible
    VEHICLE_TYPE_MAP = {
        'motocyclette': 'Moto',
        'moteur-hors-bord': 'Moteur hors-bord',
        'motoneige': 'Motoneige',
        'cote-a-cote': 'Côte-à-côte',
        'remorque': 'Remorque',
        'vtt': 'VTT',
        'bateau': 'Bateau',
        'bateaux-de-peche': 'Bateau de pêche',
        'chaloupes': 'Chaloupe',
        'ponton': 'Ponton',
        'motomarine': 'Motomarine',
        'equipement-mecanique': 'Équipement mécanique',
        'voiturettes-de-golf': 'Voiturette de golf',
        'vehicules-a-3-roues': 'Véhicule à 3 roues',
        'scooter': 'Scooter',
        'velo-electrique': 'Vélo électrique',
    }

    _LD_TYPE_PRIORITY = ('Vehicle', 'Car', 'AutomotiveVehicle', 'MotorVehicle',
                         'Motorcycle', 'Product', 'IndividualProduct')

    # ──────────────────────────────────────────────────────────────
    # DÉCOUVERTE (sitemap — les listings sont client-side)
    # ──────────────────────────────────────────────────────────────

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        urls: List[str] = []
        seen = set()

        for sitemap_url in self.SITEMAP_CANDIDATES:
            try:
                resp = self.session.get(sitemap_url, timeout=30)
                if resp.status_code != 200 or '<loc>' not in resp.text:
                    continue
            except Exception:
                continue

            locs = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', resp.text)

            # Index de sitemaps → suivre les sous-sitemaps inventaire
            if '<sitemapindex' in resp.text:
                sub_locs = []
                for sub in locs[:15]:
                    if 'showroom' in sub.lower() or 'pages' in sub.lower():
                        continue
                    try:
                        sub_resp = self.session.get(sub, timeout=30)
                        if sub_resp.status_code == 200:
                            sub_locs.extend(re.findall(
                                r'<loc>\s*([^<\s]+)\s*</loc>', sub_resp.text))
                    except Exception:
                        continue
                locs = sub_locs

            for url in locs:
                norm = url.rstrip('/').lower()
                if norm in seen:
                    continue
                if self._is_product_url(url):
                    seen.add(norm)
                    urls.append(url)

            if urls:
                neuf = sum(1 for u in urls if '/neuf/' in u)
                print(f"   🗺️  Sitemap {sitemap_url}: {len(urls)} URLs produit "
                      f"({neuf} neuf, {len(urls) - neuf} usagé) — AUCUN plafond")
                break

        return urls

    def _is_product_url(self, url: str) -> bool:
        if not url or self.SITE_DOMAIN not in url.lower():
            return False
        return bool(self._PRODUCT_URL_RE.search(url.lower().rstrip('/') + '/'))

    # ──────────────────────────────────────────────────────────────
    # EXTRACTION PAGE DÉTAIL
    # ──────────────────────────────────────────────────────────────

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        specs: Dict[str, Any] = {}

        ld = self._find_vehicle_json_ld(html)
        if ld:
            name = ld.get('name')
            if self._valid(name):
                specs['name'] = self._clean_name(str(name))

            brand = ld.get('brand') or ld.get('manufacturer')
            if isinstance(brand, dict):
                brand = brand.get('name')
            if self._valid(brand):
                specs['marque'] = str(brand).strip()

            model = ld.get('model')
            if isinstance(model, dict):
                model = model.get('name')
            if self._valid(model):
                specs['modele'] = str(model).strip()

            year = self.clean_year(str(
                ld.get('vehicleModelDate') or ld.get('modelDate')
                or ld.get('productionDate') or ''))
            if year:
                specs['annee'] = year

            color = ld.get('color')
            if self._valid(color):
                specs['couleur'] = str(color).strip()

            mileage = ld.get('mileageFromOdometer')
            if isinstance(mileage, dict):
                km = self.clean_mileage(str(mileage.get('value') or ''))
                # None/0 = odomètre non renseigné (systématique sur le neuf)
                if km:
                    specs['kilometrage'] = km

            sku = ld.get('sku') or ld.get('mpn') or ld.get('productID')
            if self._valid(sku):
                specs['inventaire'] = str(sku).strip()

            vin = ld.get('vehicleIdentificationNumber') or ld.get('vin')
            if self._valid(vin) and len(str(vin).strip()) >= 11:
                specs['vin'] = str(vin).strip()

            condition = str(ld.get('itemCondition', ''))
            if 'New' in condition:
                specs['etat'] = 'neuf'
            elif 'Used' in condition:
                specs['etat'] = 'occasion'

            offers = ld.get('offers')
            if isinstance(offers, list):
                offers = offers[0] if offers else None
            if isinstance(offers, dict):
                price = self.clean_price(str(offers.get('price', '')))
                if price:
                    specs['prix'] = price

            image = ld.get('image')
            if isinstance(image, list):
                image = image[0] if image else None
            elif isinstance(image, dict):
                image = image.get('url') or image.get('contentUrl')
            if self._valid(image) and str(image).startswith('http'):
                specs['image'] = str(image)

            description = ld.get('description')
            if self._valid(description):
                specs['description'] = self._clean_description(str(description))

        # Fallbacks OG si JSON-LD incomplet
        if not specs.get('name'):
            og_title = soup.select_one('meta[property="og:title"]')
            if og_title and og_title.get('content'):
                specs['name'] = self._clean_name(og_title['content'])
        if not specs.get('image'):
            og_image = soup.select_one('meta[property="og:image"]')
            if og_image and og_image.get('content'):
                specs['image'] = og_image['content']

        # Prix : fallback + prix barré depuis le bloc CSS PowerGO
        price_box = soup.select_one('[class*="pg-vehicle-price"]')
        if price_box:
            strike = price_box.select_one('del, s, [class*="line-through"], [class*="strike"]')
            if strike:
                old_price = self.clean_price(strike.get_text())
                # Garde-fou : list-price parfois égal au sale-price
                if old_price and old_price != specs.get('prix'):
                    specs['prix_original'] = old_price
            if not specs.get('prix'):
                box_text = price_box.get_text(' ', strip=True)
                strike_text = strike.get_text(strip=True) if strike else ''
                current = self.clean_price(box_text.replace(strike_text, ''))
                if current:
                    specs['prix'] = current

        # État + catégories depuis l'URL
        url_lower = url.lower()
        if not specs.get('etat'):
            specs['etat'] = 'occasion' if '/usage/' in url_lower else 'neuf'
        specs['sourceCategorie'] = (
            'vehicules_occasion' if specs['etat'] == 'occasion' else 'inventaire')

        seg_match = re.search(r'/fr/(?:neuf|usage)/([a-z0-9-]+)/', url_lower)
        if seg_match:
            segment = seg_match.group(1)
            specs['vehicule_type'] = self.VEHICLE_TYPE_MAP.get(
                segment, segment.replace('-', ' ').capitalize())

        name = specs.get('name', '')
        if name and re.search(r'\b(démo|demo|démonstrateur)\b', name.lower()):
            specs['etat'] = 'demonstrateur'

        return specs if specs.get('name') else None

    def _find_vehicle_json_ld(self, html: str) -> Optional[Dict]:
        """Déballe les blocs JSON-LD (@graph inclus) et retourne le meilleur
        candidat par priorité de type — sur alarysport.com le Vehicle (ou
        Product pour remorques/équipement) est niché dans un @graph."""
        candidates: List[Dict] = []

        for match in re.finditer(
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html, re.DOTALL | re.IGNORECASE,
        ):
            try:
                data = json.loads(match.group(1).strip())
            except (json.JSONDecodeError, TypeError):
                continue
            candidates.extend(self._unpack_ld(data))

        candidates.sort(key=lambda item: next(
            (i for i, t in enumerate(self._LD_TYPE_PRIORITY)
             if item.get('@type') == t), 99))

        for item in candidates:
            if item.get('@type') in self._LD_TYPE_PRIORITY:
                return item
        return None

    def _unpack_ld(self, node: Any) -> List[Dict]:
        results: List[Dict] = []
        if isinstance(node, list):
            for sub in node:
                results.extend(self._unpack_ld(sub))
        elif isinstance(node, dict):
            graph = node.get('@graph')
            if isinstance(graph, list):
                for sub in graph:
                    results.extend(self._unpack_ld(sub))
            else:
                results.append(node)
        return results

    # ──────────────────────────────────────────────────────────────
    # DÉDUP & NETTOYAGE
    # ──────────────────────────────────────────────────────────────

    def _deduplicate(self, products: List[Dict]) -> List[Dict]:
        """Clé = sourceUrl UNIQUEMENT. Sur ce site deux unités distinctes
        peuvent partager le même id d'URL sous des slugs différents (sku
        « 39171 » vs « 39171_ ») — jamais dédupliquer par id de stock ni
        par nom+prix."""
        seen_urls: set = set()
        unique: List[Dict] = []
        for product in products:
            url = product.get('sourceUrl', '').rstrip('/')
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            unique.append(product)
        return unique

    @staticmethod
    def _fix_mojibake(text: str) -> str:
        """Répare l'UTF-8 double-encodé des champs PowerGO (« hÃ©roÃ¯ne »)."""
        if not text or ('Ã' not in text and 'Â' not in text and 'â' not in text):
            return text
        try:
            fixed = text.encode('latin-1', errors='ignore').decode('utf-8', errors='ignore')
            if fixed and ('Ã' not in fixed or len(fixed) < len(text)):
                return fixed
        except Exception:
            pass
        return text

    def _clean_name(self, name: str) -> str:
        if not name:
            return name
        name = html_lib.unescape(self._fix_mojibake(name))
        name = re.sub(r'\s+(neuf|usagé|usage)?\s*[àa]\s+Saint-J[ée]r[ôo]me.*$',
                      '', name, flags=re.I)
        name = re.sub(r'\s*[|–-]\s*Alary\s*Sport.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[àa]\s+vendre.*$', '', name, flags=re.I)
        name = re.sub(r'\s+(Neuf|Usagé|Usage)\s*$', '', name)
        name = re.sub(r'\s*(\.{3}|…)\s*$', '', name)
        name = re.sub(r'\s+', ' ', name).strip(' -|')
        # Tokens dupliqués : adjacents pour tous (« Harley-Davidson
        # Harley-Davidson … », « 2023 2023 ») + fenêtre de 2 pour les
        # alphabétiques seulement (écho de marque, sans casser
        # « CFORCE 600 Touring 600 »)
        tokens = name.split(' ')
        deduped: List[str] = []
        for t in tokens:
            window = 2 if t.isalpha() else 1
            if any(t.casefold() == prev.casefold() for prev in deduped[-window:]):
                continue
            deduped.append(t)
        return ' '.join(deduped)

    def _clean_description(self, description: str) -> str:
        """Unescape des entités HTML (&Egrave;, cascades &nbsp;), retrait des
        bannières « **…** » et normalisation des espaces."""
        description = html_lib.unescape(html_lib.unescape(
            self._fix_mojibake(description)))
        description = description.replace('\xa0', ' ')
        description = re.sub(r'\*{2,}', ' ', description)
        description = re.sub(r'\s+', ' ', description).strip()
        return description[:2000]

    @staticmethod
    def _valid(value) -> bool:
        if value is None:
            return False
        text = str(value).strip()
        return bool(text) and text.lower() not in ('s/o', 'n/a', 'null', '-', 'none')
