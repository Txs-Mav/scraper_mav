"""
Scraper dédié pour Évasion Sport / Évasion DR (evasion-sport.com) —
Laterrière (Saguenay). Concessionnaire Yamaha, Arctic Cat, Avalon, Legend,
Mercury, Argo, Adly, ScootTerre, Stark Varg…
Sélecteurs hardcodés — aucun appel Gemini.

Plateforme atypique : site « Simply Web Editor » + inventaire injecté par
le service equipmentsearch.com, MAIS les listings et le JSON-LD produit
sont rendus côté serveur — requests suffit.

Stratégie :
  1. Découverte par pagination serveur du listing complet
     /fr/Inventaire/page/N/ (58 pages au 2026-08-19, ~10 cartes/page),
     SANS CAP, tolérante aux pages en erreur (continue + plafond d'échecs
     consécutifs). URLs /fr/Inventaire/adid/<id>/<slug>/ — l'adid est
     l'identifiant unique d'unité (clé de dédup).
  2. En parallèle de la découverte : carte adid → catégorie construite en
     paginant les listings par catégorie (/fr/Motoneiges/, /fr/ATVs/, …)
     — la fiche ne porte AUCUNE catégorie. Adid absents des catégories →
     vehicule_type omis (honnête).
  3. Pages détail (pipeline de base) → JSON-LD "Product" (name, brand,
     mpn = n° de stock, image, description, offers.priceSpecification.price,
     offers.itemCondition).

Pièges connus de cette plateforme (equipmentsearch.com) :
  - itemCondition est DANS offers (pas au niveau Product)
  - Le prix est dans offers.priceSpecification[].price (offers n'a pas
    de champ price direct) ; les montants « $0 » du widget sont du bruit
  - Description = écho du nom + boilerplate concessionnaire (« Évasion
    Sport, concessionnaire reconnu… ») → couper au marqueur, souvent vide
  - Ni km, ni couleur, ni VIN côté serveur → champs omis honnêtement
  - La même unité apparaît sous /fr/Inventaire/adid/X/ et
    /fr/Occasion/adid/X/ → découverte UNIQUEMENT via /fr/Inventaire/
  - ⚠️ ANTI-BOT AGRESSIF (TurnkeyWebSolutions) : à 8 workers l'IP se fait
    bannir temporairement (« temporarily blocked for suspicious
    behaviour ») → 2 workers MAX + pause entre les pages de listing.

Écrit à la main le 2026-08-19.
"""
import html as html_lib
import json
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class EvasionSportScraper(DedicatedScraper):

    SITE_NAME = "Évasion Sport"
    SITE_SLUG = "evasion-sport"
    SITE_URL = "https://evasion-sport.com/fr/"
    SITE_DOMAIN = "evasion-sport.com"

    # ⚠️ Ne PAS augmenter : l'anti-bot du site bannit l'IP au-delà
    # (vu à 8 workers le 2026-08-19)
    MAX_WORKERS = 2
    LISTING_PAGE_DELAY_S = 0.6
    LISTING_MAX_PAGES = 200
    LISTING_MAX_CONSECUTIVE_FAILS = 3

    _PRODUCT_URL_RE = re.compile(r'/fr/Inventaire/adid/\d+/', re.I)

    # Page catégorie du site → type de véhicule lisible (le segment est
    # encodé en %xx dans l'URL réelle)
    CATEGORY_PAGES = {
        'Motoneiges': 'Motoneige',
        'ATVs': 'VTT',
        'Côte-à-côte': 'Côte-à-côte',
        'Bateaux': 'Bateau',
        'Pontons': 'Ponton',
        'Moteurs-hors-bord': 'Moteur hors-bord',
        'Remorques': 'Remorque',
        'Vélos-électriques': 'Vélo électrique',
        'motocyclettes-&-Scooters': 'Moto',
        'Produit-énergétique': 'Équipement énergétique',
    }

    def __init__(self):
        super().__init__()
        self._category_by_adid: Dict[str, str] = {}
        self._occasion_adids: set = set()
        self._discovered_count = 0

    # ──────────────────────────────────────────────────────────────
    # GARDE-FOU ANTI-PARTIEL : si l'anti-bot frappe en plein run, on
    # préfère un échec franc (l'ancien cache est conservé) à une
    # sauvegarde tronquée marquée « success ».
    # ──────────────────────────────────────────────────────────────

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict:
        result = super().scrape(categories=categories, inventory_only=inventory_only)
        products = result.get('products', [])
        if self._discovered_count >= 50 and len(products) < 0.8 * self._discovered_count:
            raise RuntimeError(
                f"Scrape partiel probable (anti-bot ?) : {len(products)} produits "
                f"pour {self._discovered_count} URLs découvertes — rien n'est sauvegardé")
        return result

    # ──────────────────────────────────────────────────────────────
    # DÉCOUVERTE (pagination serveur /fr/Inventaire/page/N/)
    # ──────────────────────────────────────────────────────────────

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        urls, complete = self._paginate_listing(
            'https://evasion-sport.com/fr/Inventaire/', strict=True)
        if not complete:
            # Pagination interrompue (anti-bot ?) → échec franc plutôt
            # qu'une découverte tronquée silencieuse.
            raise RuntimeError(
                "Pagination /fr/Inventaire/ interrompue avant la dernière page "
                "(anti-bot probable) — scrape annulé, ancien cache conservé")
        print(f"   📄 Listing /fr/Inventaire/ : {len(urls)} unités uniques "
              f"— AUCUN plafond")
        self._discovered_count = len(urls)

        # Carte adid → catégorie (la fiche ne porte aucune catégorie)
        for segment, vtype in self.CATEGORY_PAGES.items():
            base = f"https://evasion-sport.com/fr/{quote(segment)}/"
            cat_urls, _ = self._paginate_listing(base, quiet=True)
            for url in cat_urls:
                adid = self._adid(url)
                if adid and adid not in self._category_by_adid:
                    self._category_by_adid[adid] = vtype
        print(f"   🏷️  Catégories mappées pour {len(self._category_by_adid)} adids "
              f"({len(self.CATEGORY_PAGES)} listings catégorie)")

        # Adids listés « Occasion » (fallback d'état si le JSON-LD est muet)
        occ_urls, _ = self._paginate_listing('https://evasion-sport.com/fr/Occasion/', quiet=True)
        for url in occ_urls:
            adid = self._adid(url)
            if adid:
                self._occasion_adids.add(adid)

        return urls

    def _paginate_listing(self, base_url: str, quiet: bool = False,
                          strict: bool = False):
        """Pagine base_url + page/N/ en suivant le pager serveur. Une page en
        erreur ne sacrifie pas la suite (continue + plafond d'échecs).
        Retourne (urls, complete) — complete=False si la pagination a été
        interrompue avant la dernière page annoncée par le pager."""
        urls: List[str] = []
        seen = set()
        max_page = 1
        fails = 0
        complete = True

        page = 1
        while page <= min(max_page, self.LISTING_MAX_PAGES) or page == 1:
            page_url = base_url if page == 1 else f"{base_url}page/{page}/"
            if page > 1:
                time.sleep(self.LISTING_PAGE_DELAY_S)
            try:
                resp = self.session.get(page_url, timeout=self.HTTP_TIMEOUT)
                if resp.status_code != 200:
                    raise RuntimeError(f"HTTP {resp.status_code}")
                html = resp.text
                fails = 0
            except Exception:
                fails += 1
                if fails >= self.LISTING_MAX_CONSECUTIVE_FAILS:
                    if not quiet:
                        print(f"   ⚠️  {fails} pages listing en erreur d'affilée — arrêt à la page {page}")
                    complete = False
                    break
                page += 1
                continue

            pager = [int(p) for p in re.findall(r'/page/(\d+)/', html)]
            if pager:
                max_page = max(max_page, max(pager))

            for match in re.finditer(
                    r'href="(/fr/[^"]*?adid/(\d+)/[^"]*)"', html):
                adid = match.group(2)
                if adid in seen:
                    continue
                seen.add(adid)
                # URL canonique /fr/Inventaire/adid/… (certains listings
                # émettent /fr/Occasion/adid/… pour la même unité)
                path = match.group(1)
                path = re.sub(r'^/fr/[^/]+/adid/', '/fr/Inventaire/adid/', path)
                urls.append('https://evasion-sport.com' + path)

            if page >= max_page:
                break
            page += 1

        return urls, complete

    @staticmethod
    def _adid(url: str) -> Optional[str]:
        match = re.search(r'/adid/(\d+)/', url)
        return match.group(1) if match else None

    def _is_product_url(self, url: str) -> bool:
        return bool(url and self.SITE_DOMAIN in url.lower()
                    and self._PRODUCT_URL_RE.search(url))

    # ──────────────────────────────────────────────────────────────
    # EXTRACTION PAGE DÉTAIL (JSON-LD Product)
    # ──────────────────────────────────────────────────────────────

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        specs: Dict[str, Any] = {}

        product = self._find_product_json_ld(html)
        if product:
            name = product.get('name')
            if self._valid(name):
                specs['name'] = self._clean_name(str(name))

            brand = product.get('brand')
            if isinstance(brand, dict):
                brand = brand.get('name')
            if self._valid(brand):
                specs['marque'] = str(brand).strip()

            mpn = product.get('mpn') or product.get('sku')
            if self._valid(mpn):
                specs['inventaire'] = str(mpn).strip()

            image = product.get('image')
            if isinstance(image, list):
                image = image[0] if image else None
            if self._valid(image) and str(image).startswith('http'):
                specs['image'] = str(image)

            offers = product.get('offers')
            if isinstance(offers, list):
                offers = offers[0] if offers else None
            if isinstance(offers, dict):
                condition = str(offers.get('itemCondition', ''))
                if 'New' in condition:
                    specs['etat'] = 'neuf'
                elif 'Used' in condition:
                    specs['etat'] = 'occasion'

                price_specs = offers.get('priceSpecification') or []
                if isinstance(price_specs, dict):
                    price_specs = [price_specs]
                prices = []
                for ps in price_specs:
                    if isinstance(ps, dict):
                        price = self.clean_price(str(ps.get('price', '')))
                        if price:
                            prices.append(price)
                if prices:
                    specs['prix'] = min(prices)
                    if max(prices) > min(prices):
                        specs['prix_original'] = max(prices)

            description = product.get('description')
            if self._valid(description):
                cleaned = self._clean_description(
                    str(description), specs.get('name', ''))
                if cleaned:
                    specs['description'] = cleaned

        # Fallback nom : <title> (= nom brut sur ce site)
        if not specs.get('name'):
            title_tag = soup.select_one('title')
            if title_tag and title_tag.get_text(strip=True):
                specs['name'] = self._clean_name(title_tag.get_text(strip=True))

        if not specs.get('name'):
            return None

        # Année en fin de nom, modèle = nom − marque − année
        self._fill_from_name(specs)

        # État : fallback appartenance au listing /fr/Occasion/, sinon neuf
        adid = self._adid(url)
        if not specs.get('etat'):
            specs['etat'] = 'occasion' if adid in self._occasion_adids else 'neuf'
        specs['sourceCategorie'] = (
            'vehicules_occasion' if specs['etat'] == 'occasion' else 'inventaire')

        # Type de véhicule : carte adid → catégorie construite à la découverte
        vtype = self._category_by_adid.get(adid or '')
        if vtype:
            specs['vehicule_type'] = vtype

        name = specs['name']
        if re.search(r'\b(démo|demo|démonstrateur)\b', name.lower()):
            specs['etat'] = 'demonstrateur'

        return specs

    def _fill_from_name(self, specs: Dict[str, Any]) -> None:
        name = specs.get('name') or ''
        if not name:
            return

        if not specs.get('annee'):
            year_match = re.search(r'\b(19|20)\d{2}\s*$', name)
            if year_match:
                year = self.clean_year(year_match.group(0))
                if year:
                    specs['annee'] = year

        marque = str(specs.get('marque') or '')
        if marque and not specs.get('modele'):
            rest = name
            if name.lower().startswith(marque.lower()):
                rest = name[len(marque):].strip()
            rest = re.sub(r'\b(19|20)\d{2}\s*$', '', rest).strip(' -')
            if rest:
                specs['modele'] = rest

    def _find_product_json_ld(self, html: str) -> Optional[Dict]:
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
            nodes = data if isinstance(data, list) else [data]
            for node in nodes:
                if isinstance(node, dict) and node.get('@type') == 'Product':
                    return node
        return None

    # ──────────────────────────────────────────────────────────────
    # DÉDUP & NETTOYAGE
    # ──────────────────────────────────────────────────────────────

    def _deduplicate(self, products: List[Dict]) -> List[Dict]:
        """L'adid (dans l'URL) identifie l'unité : clé = sourceUrl UNIQUEMENT,
        jamais nom+prix (plusieurs unités identiques du même modèle)."""
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
        name = re.sub(r'\s+(neuf|usagé|usage)?\s*[àa]\s+(Laterri[èe]re|Saguenay|Chicoutimi).*$',
                      '', name, flags=re.I)
        name = re.sub(r'\s*[|–-]\s*[ÉE]vasion\s*(Sport|DR).*$', '', name, flags=re.I)
        name = re.sub(r'\s*[àa]\s+vendre.*$', '', name, flags=re.I)
        name = re.sub(r'\s*(\.{3}|…)\s*$', '', name)
        name = re.sub(r'\s+', ' ', name).strip(' -|')
        tokens = name.split(' ')
        deduped: List[str] = []
        for t in tokens:
            window = 2 if t.isalpha() else 1
            if any(t.casefold() == prev.casefold() for prev in deduped[-window:]):
                continue
            deduped.append(t)
        return ' '.join(deduped)

    def _clean_description(self, description: str, name: str = '') -> str:
        description = html_lib.unescape(html_lib.unescape(
            self._fix_mojibake(description)))
        description = re.sub(r'\s+', ' ', description).strip()
        # Couper le boilerplate concessionnaire (présent sur CHAQUE fiche)
        description = re.split(
            r'[ÉE]vasion Sport,?\s+concessionnaire reconnu', description)[0].strip()
        # Écho du nom en tête (la description commence par le nom répété)
        if name:
            echo = re.escape(re.sub(r'\s+', ' ', name).strip())
            description = re.sub(r'^(?:\s*' + echo + r'\s*)+', '', description, flags=re.I).strip()
            description = re.sub(r'(?:\s*' + echo + r'\s*)+$', '', description, flags=re.I).strip()
        return description[:2000]

    @staticmethod
    def _valid(value) -> bool:
        if value is None:
            return False
        text = str(value).strip()
        return bool(text) and text.lower() not in ('s/o', 'n/a', 'null', '-', 'none')
