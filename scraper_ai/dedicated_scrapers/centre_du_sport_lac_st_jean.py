"""
Scraper dédié pour Centre du Sport Lac-St-Jean (centredusportlacstjean.com).
Sélecteurs CSS hardcodés — aucun appel Gemini.

Stratégie hybride:
  1. Pages listing SM360 (?page=N, 24 produits/page) → nom, prix, image, URL,
     état, type de véhicule (segment d'URL)
  2. Pages détail (parallèle) → JSON-LD "Car" (marque, modèle, année, couleur,
     kilométrage, prix, état) + blob JS (numéro de stock, VIN)

Site: plateforme SM360 (Shift Digital) — images img.sm360.ca
Sections: /fr/inventaire-neuf, /fr/inventaire-occasion
"""
import json
import re
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup, Tag

from .base import DedicatedScraper


class CentreDuSportLacStJeanScraper(DedicatedScraper):

    SITE_NAME = "Centre du Sport Lac-St-Jean"
    SITE_SLUG = "centre-du-sport-lac-st-jean"
    SITE_URL = "https://www.centredusportlacstjean.com/fr/"
    SITE_DOMAIN = "centredusportlacstjean.com"

    LISTING_PAGES = {
        'inventaire': {
            'url': 'https://www.centredusportlacstjean.com/fr/inventaire-neuf',
            'etat': 'neuf',
            'sourceCategorie': 'inventaire',
        },
        'occasion': {
            'url': 'https://www.centredusportlacstjean.com/fr/inventaire-occasion',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
    }

    LISTING_TIMEOUT = 25
    LISTING_MAX_PAGES = 80
    WORKERS = 10
    DETAIL_TIMEOUT = 15

    # Segment d'URL → type de véhicule lisible
    VEHICLE_TYPE_MAP = {
        'moto': 'Moto',
        'vtt': 'VTT',
        'vcc': 'Côte-à-côte',
        'motoneige': 'Motoneige',
        'motomarine': 'Motomarine',
        'bateau-a-moteur': 'Bateau à moteur',
        'ponton': 'Ponton',
        'voilier': 'Voilier',
        'configuration-moteur': 'Moteur hors-bord',
        'remorque': 'Remorque',
        'remorques': 'Remorque',
        'equipement-motorise': 'Équipement motorisé',
        'velo-electrique': 'Vélo électrique',
        'velo': 'Vélo',
    }

    _PRODUCT_URL_RE = re.compile(r'-id(\d+)/?$')

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()

        if categories is None:
            categories = ['inventaire', 'occasion']

        print(f"\n{'='*70}")
        print(f"🔧 SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"🌐 Site: {self.SITE_URL}")
        print(f"📦 Catégories: {categories}")

        products = self._extract_from_listings(categories)

        if not products:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        products = self._enrich_from_detail_pages(products)

        if inventory_only:
            products = [p for p in products if p.get(
                'sourceCategorie') != 'catalogue']

        pre_group = len(products)
        products = self._dedupe_by_url(products)
        elapsed = time.time() - start_time

        print(f"\n{'='*70}")
        print(f"✅ {self.SITE_NAME}: {len(products)} produits en {elapsed:.1f}s")
        print(f"{'='*70}")

        return {
            'products': products,
            'metadata': {
                'site_url': self.SITE_URL,
                'site_name': self.SITE_NAME,
                'scraper_type': 'dedicated',
                'scraper_module': self.SITE_SLUG,
                'products_count': len(products),
                'urls_processed': pre_group,
                'execution_time_seconds': round(elapsed, 2),
                'categories': categories,
                'cache_status': 'dedicated',
            },
            'scraper_info': {
                'type': 'dedicated',
                'module': self.SITE_SLUG,
                'selectors': 'hardcoded',
            }
        }

    # ──────────────────────────────────────────────────────────────
    # PHASE 1 : LISTINGS
    # ──────────────────────────────────────────────────────────────

    def _extract_from_listings(self, categories: List[str]) -> List[Dict]:
        all_products = []
        seen_urls = set()

        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories and not any(c in cat_key for c in categories):
                continue

            print(f"\n   📋 [{cat_key}]: {config['url']}")
            products = self._load_listing_pages(config)

            fresh = []
            for product in products:
                url_norm = product.get('sourceUrl', '').rstrip('/').lower()
                if url_norm and url_norm not in seen_urls:
                    seen_urls.add(url_norm)
                    fresh.append(product)

            print(f"      ✅ {len(fresh)} produits extraits")
            all_products.extend(fresh)

        return all_products

    def _load_listing_pages(self, config: Dict) -> List[Dict]:
        listing_url = config['url']
        all_products = []

        try:
            response = self.session.get(listing_url, timeout=self.LISTING_TIMEOUT)
            if response.status_code != 200:
                print(f"      ⚠️ HTTP {response.status_code} pour {listing_url}")
                return []
        except Exception as exc:
            print(f"      ⚠️ Erreur listing: {exc}")
            return []

        total_pages = self._parse_max_page(response.text)
        print(f"      📊 SM360: {total_pages} page(s) de 24 produits")

        all_products.extend(self._parse_listing_html(response.text, config))

        for page in range(2, min(total_pages, self.LISTING_MAX_PAGES) + 1):
            page_url = f"{listing_url}?page={page}"
            try:
                resp = self.session.get(page_url, timeout=self.LISTING_TIMEOUT)
                if resp.status_code != 200:
                    break
                page_products = self._parse_listing_html(resp.text, config)
                if not page_products:
                    break
                all_products.extend(page_products)
                time.sleep(0.2)
            except Exception:
                break

        return all_products

    @staticmethod
    def _parse_max_page(html: str) -> int:
        pages = [int(m) for m in re.findall(r'\?page=(\d+)', html)]
        return max(pages) if pages else 1

    def _parse_listing_html(self, html: str, config: Dict) -> List[Dict]:
        soup = BeautifulSoup(html, 'lxml')
        products = []

        for card in soup.select('article.inventory-list-layout-wrapper'):
            product = self._parse_listing_card(card, config)
            if product and product.get('name') and product.get('sourceUrl'):
                products.append(product)

        return products

    def _parse_listing_card(self, card: Tag, config: Dict) -> Optional[Dict]:
        product: Dict[str, Any] = {}

        title_a = card.select_one('a.inventory-list-layout__preview-name')
        if not title_a or not title_a.get('href'):
            return None

        href = title_a['href']
        product['sourceUrl'] = href if href.startswith(
            'http') else urljoin(self.SITE_URL, href)
        if not self._is_product_url(product['sourceUrl']):
            return None

        name_el = title_a.select_one('[itemprop="name"]')
        product['name'] = self._clean_name(
            (name_el or title_a).get_text(strip=True))
        if not product['name']:
            return None

        product['sourceSite'] = self.SITE_URL

        img = card.select_one('.inventory-list-layout__preview-image img')
        if img:
            src = img.get('src') or img.get('data-src', '')
            if src and 'sm360' in src:
                product['image'] = src

        price_meta = card.select_one('meta[itemprop="price"]')
        if price_meta and price_meta.get('content'):
            price = self.clean_price(price_meta['content'])
            if price:
                product['prix'] = price

        strike_el = card.select_one('.inventory-list-layout__preview-price-strike')
        if strike_el:
            old_price = self.clean_price(strike_el.get_text())
            if old_price and old_price != product.get('prix'):
                product['prix_original'] = old_price
                if not product.get('prix'):
                    product['prix'] = old_price

        year = self.clean_year(product['name'])
        if year:
            product['annee'] = year

        vehicle_type = self._vehicle_type_from_url(product['sourceUrl'])
        if vehicle_type:
            product['vehicule_type'] = vehicle_type

        product['etat'] = config['etat']
        product['sourceCategorie'] = config['sourceCategorie']

        picto = card.select_one('.picto')
        if picto:
            picto_txt = (picto.get('title') or picto.get_text(strip=True)).lower()
            if 'démo' in picto_txt or 'demo' in picto_txt:
                product['etat'] = 'demonstrateur'

        if re.search(r'\b(démo|demo|démonstrateur)\b', product['name'].lower()):
            product['etat'] = 'demonstrateur'

        product['quantity'] = 1
        product['groupedUrls'] = [product['sourceUrl']]

        return product

    def _vehicle_type_from_url(self, url: str) -> Optional[str]:
        match = re.search(r'/fr/([a-z0-9-]+)/inventaire-', url)
        if not match:
            return None
        segment = match.group(1)
        if segment in self.VEHICLE_TYPE_MAP:
            return self.VEHICLE_TYPE_MAP[segment]
        return segment.replace('-', ' ').capitalize()

    # ──────────────────────────────────────────────────────────────
    # PHASE 2 : ENRICHISSEMENT PAGES DÉTAIL
    # ──────────────────────────────────────────────────────────────

    def _enrich_from_detail_pages(self, products: List[Dict]) -> List[Dict]:
        total = len(products)
        if total == 0:
            return products

        workers = min(self.WORKERS, total)
        enriched_count = 0
        start = time.time()

        print(f"\n   🔍 Enrichissement: {total} pages détail ({workers} workers)...")

        url_to_product = {p['sourceUrl']: p for p in products}

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._fetch_detail_specs, p['sourceUrl']): p['sourceUrl']
                for p in products
            }

            processed = 0
            try:
                for future in as_completed(futures, timeout=max(900, total * 4)):
                    processed += 1
                    url = futures[future]
                    try:
                        specs = future.result(timeout=self.DETAIL_TIMEOUT + 5)
                        if specs:
                            product = url_to_product[url]
                            for key, value in specs.items():
                                if value is not None and (
                                    not product.get(key)
                                    or key in ('marque', 'modele', 'annee', 'couleur',
                                               'kilometrage', 'inventaire', 'etat',
                                               'prix', 'prix_original')
                                ):
                                    product[key] = value
                            enriched_count += 1
                    except Exception:
                        pass

                    if processed % 50 == 0 or processed == total:
                        elapsed = time.time() - start
                        rate = processed / elapsed if elapsed > 0 else 0
                        print(f"      📊 [{processed}/{total}] {enriched_count} enrichis — {rate:.1f}/s")
            except TimeoutError:
                pending = total - processed
                print(f"      ⚠️ Timeout — {pending}/{total} URL(s) abandonnée(s), "
                      f"{enriched_count} produit(s) enrichis conservé(s)")
                for f in futures:
                    f.cancel()

        print(f"      ✅ {enriched_count}/{total} produits enrichis")
        return products

    def _fetch_detail_specs(self, url: str) -> Optional[Dict]:
        try:
            response = self.session.get(
                url, timeout=self.DETAIL_TIMEOUT, allow_redirects=True)
            if response.status_code != 200:
                return None

            soup = BeautifulSoup(response.text, 'lxml')
            return self.extract_from_detail_page(url, response.text, soup)

        except Exception:
            return None

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        """Extrait les specs d'une page détail SM360 (JSON-LD Car + blob JS)."""
        specs: Dict[str, Any] = {}

        ld = self._parse_vehicle_json_ld(html)
        if ld:
            brand = ld.get('brand') or ld.get('manufacturer')
            if self._valid(brand):
                specs['marque'] = str(brand).strip()

            model = ld.get('model')
            if self._valid(model):
                specs['modele'] = str(model).strip()

            year = self.clean_year(str(ld.get('modelDate') or ld.get('productionDate') or ''))
            if year:
                specs['annee'] = year

            color = ld.get('color')
            if self._valid(color):
                specs['couleur'] = str(color).strip()

            mileage = ld.get('mileageFromOdometer')
            if isinstance(mileage, dict):
                km = self.clean_mileage(str(mileage.get('value', '')))
                # 0 = odomètre non renseigné sur SM360 (fréquent sur les
                # occasions marines) — on n'émet pas un faux « 0 km ».
                if km:
                    specs['kilometrage'] = km

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
            if self._valid(image):
                specs['image'] = str(image)

            description = ld.get('description')
            if self._valid(description) and len(str(description)) > 20:
                specs['description'] = str(description)[:2000]

            name = ld.get('name')
            if self._valid(name):
                specs['name'] = self._clean_name(str(name))

        stock_match = re.search(r"stockNumber:\s*'([^']+)'", html)
        if stock_match and stock_match.group(1).strip():
            specs['inventaire'] = stock_match.group(1).strip()

        vin_match = re.search(r"vin:\s*'([^']+)'", html)
        if vin_match and len(vin_match.group(1).strip()) >= 11:
            specs['vin'] = vin_match.group(1).strip()

        if not specs.get('name'):
            h1 = soup.select_one('h1')
            if h1:
                specs['name'] = self._clean_name(h1.get_text(' ', strip=True))

        return specs if specs else None

    @staticmethod
    def _parse_vehicle_json_ld(html: str) -> Optional[Dict]:
        for match in re.finditer(
            r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL
        ):
            try:
                data = json.loads(match.group(1))
            except (json.JSONDecodeError, TypeError):
                continue
            items = data if isinstance(data, list) else [data]
            for item in items:
                if isinstance(item, dict) and item.get('@type') in (
                    'Car', 'Vehicle', 'Motorcycle', 'MotorVehicle', 'Product'
                ):
                    return item
        return None

    @staticmethod
    def _valid(value) -> bool:
        if value is None:
            return False
        text = str(value).strip()
        return bool(text) and text.lower() not in ('s/o', 'n/a', 'null', '-', 'none')

    # ──────────────────────────────────────────────────────────────
    # PIPELINE DE BASE (discover + dedupe)
    # ──────────────────────────────────────────────────────────────

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']

        products = self._extract_from_listings(categories)
        seen = set()
        urls = []
        for p in products:
            url = p.get('sourceUrl', '').rstrip('/').lower()
            if url and url not in seen:
                seen.add(url)
                urls.append(p['sourceUrl'])
        return urls

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        if '/inventaire-neuf/' in url_lower or '/inventaire-occasion/' in url_lower:
            return bool(self._PRODUCT_URL_RE.search(url_lower.rstrip('/')))
        return False

    def _dedupe_by_url(self, products: List[Dict]) -> List[Dict]:
        """Chaque unité SM360 a une URL unique (…-id########) : on ne
        regroupe JAMAIS par nom+prix pour ne pas écraser plusieurs unités
        identiques du même modèle (clé = sourceUrl)."""
        seen_urls: set = set()
        unique: List[Dict] = []
        for product in products:
            url = product.get('sourceUrl', '').rstrip('/')
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            product.setdefault('quantity', 1)
            product.setdefault('groupedUrls', [product.get('sourceUrl', '')])
            unique.append(product)
        return unique

    def _deduplicate(self, products: List[Dict]) -> List[Dict]:
        return self._dedupe_by_url(products)

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r'\s+[àa]\s+Alma.*$', '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Centre\s+du\s+sport.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
