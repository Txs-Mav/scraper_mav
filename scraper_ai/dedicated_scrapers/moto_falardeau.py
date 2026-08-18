"""
Scraper dédié pour Moto Falardeau (motofalardeau.com) — Mont-Laurier,
Laurentides. Concessionnaire Kawasaki, CFMOTO, Husqvarna, Alumacraft.
Sélecteurs hardcodés — aucun appel Gemini.

Stratégie :
  1. Découverte via sitemap PowerGO (inventory-sitemap.xml), URLs
     /fr/inventaire/…-a-vendre-ins#####/ SANS CAP — les listings sont
     rendus côté client, le sitemap est la seule source de découverte.
     Le sitemap liste FR + EN en double : on ne garde que /fr/.
  2. Pages détail (parallèle, pipeline de base) → JSON-LD "Vehicle"
     (marque, modèle, année, couleur, km, prix, sku INS#####, état) + prix
     barré depuis le bloc CSS pg-vehicle-price.

Pièges connus de cette plateforme (PowerGO / WordPress) :
  - Le bloc Vehicle est dans son PROPRE <script> (pas dans @graph ici),
    avec des caractères de contrôle bruts dans description →
    json.loads(strict=False) obligatoire, sinon le bloc est perdu
  - Mojibake UTF-8 double-encodé possible sur descriptions/prix CSS
  - mileageFromOdometer absent/None sur le neuf → ne pas émettre km=0
  - Pas de segment neuf/usage dans l'URL : l'état vient d'itemCondition
    (fallback : « usagé/occasion » dans le titre de la page)

Écrit à la main le 2026-08-17 (modèle : smsport.py).
"""
import html as html_lib
import json
import re
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class MotoFalardeauScraper(DedicatedScraper):

    SITE_NAME = "Moto Falardeau"
    SITE_SLUG = "moto-falardeau"
    SITE_URL = "https://motofalardeau.com/fr/"
    SITE_DOMAIN = "motofalardeau.com"

    MAX_WORKERS = 10

    SITEMAP_CANDIDATES = (
        "https://motofalardeau.com/inventory-sitemap.xml",
        "https://motofalardeau.com/sitemap_index.xml",
    )

    # /fr/inventaire/<categorie>-<marque>-<modele>-<annee>-a-vendre-ins#####/
    _PRODUCT_URL_RE = re.compile(r'/fr/inventaire/[a-z0-9-]*a-vendre-[a-z]*\d+/?$')

    # Préfixe du slug d'inventaire → type de véhicule lisible.
    # Testés du plus long au plus court (voir _vehicle_type_from_url).
    VEHICLE_TYPE_MAP = {
        'motocyclettes': 'Moto',
        'cotes-a-cotes': 'Côte-à-côte',
        'vtt': 'VTT',
        'pontons': 'Ponton',
        'bateaux': 'Bateau',
        'motomarines': 'Motomarine',
        'motoneiges': 'Motoneige',
        'velos-electriques': 'Vélo électrique',
        'produits-mecaniques': 'Équipement mécanique',
        'remorques': 'Remorque',
        'vr': 'VR',
    }

    _LD_TYPE_PRIORITY = ('Vehicle', 'Car', 'AutomotiveVehicle', 'MotorVehicle',
                         'Motorcycle', 'Product', 'IndividualProduct')

    # Marques vues chez ce concessionnaire (neuf + occasion) — sert au
    # fallback marque/modèle/année depuis le nom quand une page n'a pas de
    # JSON-LD Vehicle (certaines unités sont rendues 100 % côté client).
    _KNOWN_BRANDS = (
        'harley-davidson', 'arctic cat', 'can-am', 'sea-doo', 'ski-doo',
        'kawasaki', 'cfmoto', 'husqvarna', 'alumacraft', 'armada',
        'starcraft', 'suzuki', 'yamaha', 'polaris', 'honda', 'ktm',
        'gasgas', 'triumph', 'kymco', 'segway', 'argo', 'mercury',
        'princecraft', 'legend', 'beta', 'sherco', 'indian', 'ducati',
        'bmw', 'aprilia', 'vespa', 'piaggio',
    )

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
                print(f"   🗺️  Sitemap {sitemap_url}: {len(urls)} URLs produit "
                      f"(/fr/ uniquement, doublons EN exclus) — AUCUN plafond")
                break

        return urls

    def _is_product_url(self, url: str) -> bool:
        if not url or self.SITE_DOMAIN not in url.lower():
            return False
        low = url.lower()
        # Le sitemap liste chaque unité en FR et en EN : on ne garde que FR.
        if '/fr/inventaire/' not in low:
            return False
        return bool(self._PRODUCT_URL_RE.search(low.rstrip('/') + '/'))

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

        # Sans JSON-LD Vehicle, le nom « Marque Modèle Année » reste la
        # meilleure source pour marque/modèle/année (ne remplit que les trous).
        self._fill_from_name(specs)

        # Km : jamais dans le JSON-LD de ce site, mais affiché sur les
        # occasions dans <ul class="specs"><li class="km">…<span class="number">
        if not specs.get('kilometrage'):
            km_node = soup.select_one('ul.specs li.km .number, li.km .number')
            if km_node:
                km = self.clean_mileage(km_node.get_text())
                if km:
                    specs['kilometrage'] = km

        # Prix : fallback + prix barré depuis le bloc CSS PowerGO
        price_box = soup.select_one('[class*="pg-vehicle-price"]')
        if price_box:
            strike = price_box.select_one('del, s, [class*="line-through"], [class*="strike"]')
            if strike:
                old_price = self.clean_price(strike.get_text())
                if old_price and old_price != specs.get('prix'):
                    specs['prix_original'] = old_price
            if not specs.get('prix'):
                box_text = price_box.get_text(' ', strip=True)
                strike_text = strike.get_text(strip=True) if strike else ''
                current = self.clean_price(box_text.replace(strike_text, ''))
                if current:
                    specs['prix'] = current

        # État : pas de segment neuf/usage dans l'URL ici — fallback sur le
        # titre de la page (« … usagé à Mont-Laurier ») si le JSON-LD est muet.
        if not specs.get('etat'):
            title_tag = soup.select_one('title')
            title_text = (title_tag.get_text() if title_tag else '').lower()
            specs['etat'] = (
                'occasion' if re.search(r'\b(usag[eé]|occasion)\b', title_text)
                else 'neuf')
        specs['sourceCategorie'] = (
            'vehicules_occasion' if specs['etat'] == 'occasion' else 'inventaire')

        vehicle_type = self._vehicle_type_from_url(url)
        if vehicle_type:
            specs['vehicule_type'] = vehicle_type

        name = specs.get('name', '')
        if name and re.search(r'\b(démo|demo|démonstrateur)\b', name.lower()):
            specs['etat'] = 'demonstrateur'

        return specs if specs.get('name') else None

    def _fill_from_name(self, specs: Dict[str, Any]) -> None:
        """Complète marque/modèle/année manquants depuis le nom nettoyé
        (« Husqvarna TE300 2026 »). Marque reconnue en tête de nom seulement,
        année = 4 chiffres en fin de nom."""
        name = specs.get('name') or ''
        if not name:
            return
        low = name.lower()

        if not specs.get('annee'):
            year_match = re.search(r'\b(19|20)\d{2}\s*$', name)
            if year_match:
                year = self.clean_year(year_match.group(0))
                if year:
                    specs['annee'] = year

        rest = name
        if not specs.get('marque'):
            for brand in self._KNOWN_BRANDS:
                if low.startswith(brand + ' ') or low == brand:
                    specs['marque'] = name[:len(brand)]
                    rest = name[len(brand):].strip()
                    break
        elif low.startswith(str(specs['marque']).lower()):
            rest = name[len(str(specs['marque'])):].strip()

        if not specs.get('modele') and specs.get('marque'):
            rest = re.sub(r'\b(19|20)\d{2}\s*$', '', rest).strip(' -')
            if rest:
                specs['modele'] = rest

    def _vehicle_type_from_url(self, url: str) -> Optional[str]:
        """Le type est le préfixe du slug d'inventaire
        (« cotes-a-cotes-cfmoto-… » → Côte-à-côte). Préfixes testés du plus
        long au plus court pour que « velos-electriques » gagne sur « velos »."""
        match = re.search(r'/fr/inventaire/([a-z0-9-]+)/?$', url.lower())
        if not match:
            return None
        slug = match.group(1)
        for prefix in sorted(self.VEHICLE_TYPE_MAP, key=len, reverse=True):
            if slug.startswith(prefix + '-') or slug == prefix:
                return self.VEHICLE_TYPE_MAP[prefix]
        return None

    def _find_vehicle_json_ld(self, html: str) -> Optional[Dict]:
        """Déballe les blocs JSON-LD (@graph inclus) et retourne le meilleur
        candidat par priorité de type. Sur ce site le Vehicle est dans son
        propre <script> avec des caractères de contrôle bruts dans la
        description → strict=False, puis nettoyage si ça échoue encore."""
        candidates: List[Dict] = []

        for match in re.finditer(
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html, re.DOTALL | re.IGNORECASE,
        ):
            raw = match.group(1).strip()
            data = None
            try:
                data = json.loads(raw, strict=False)
            except (json.JSONDecodeError, TypeError):
                try:
                    cleaned = re.sub(r'[\x00-\x1f\x7f]', ' ', raw)
                    data = json.loads(cleaned, strict=False)
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
        """Chaque unité PowerGO a une URL unique (…a-vendre-ins#####) : clé =
        sourceUrl UNIQUEMENT, jamais nom+prix (plusieurs unités identiques
        du même modèle coexistent, ex. 3 Mule SX 2026)."""
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
        name = re.sub(r'\s+(neuf|usagé|usage)?\s*[àa]\s+Mont-Laurier.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[|–-]\s*Moto\s*Falardeau.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[àa]\s+vendre.*$', '', name, flags=re.I)
        name = re.sub(r'\s*(\.{3}|…)\s*$', '', name)
        name = re.sub(r'\s+', ' ', name).strip(' -|')
        # Tokens adjacents dupliqués (« Kawasaki KAWASAKI … »)
        tokens = name.split(' ')
        deduped = [t for i, t in enumerate(tokens)
                   if i == 0 or t.casefold() != tokens[i - 1].casefold()]
        return ' '.join(deduped)

    def _clean_description(self, description: str) -> str:
        # Les descriptions JSON-LD arrivent avec des entités HTML
        # (&Eacute;, &nbsp;, &rsquo;) → double unescape défensif.
        description = html_lib.unescape(html_lib.unescape(
            self._fix_mojibake(description)))
        description = re.sub(r'\s+', ' ', description).strip()
        # Couper le boilerplate marketing du concessionnaire
        description = re.sub(
            r'\s*Moto Falardeau\s*[—–-]?\s*Votre concessionnaire.*$', '',
            description, flags=re.I)
        return description[:2000]

    @staticmethod
    def _valid(value) -> bool:
        if value is None:
            return False
        text = str(value).strip()
        return bool(text) and text.lower() not in ('s/o', 'n/a', 'null', '-', 'none')
