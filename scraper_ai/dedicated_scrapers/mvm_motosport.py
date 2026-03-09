"""
Scraper dédié pour MVM Moto Sport (mvmmotosport.com).
Sélecteurs CSS hardcodés — aucun appel Gemini.

Stratégie hybride:
  1. Pages listing (FacetWP fwp_per_page=500) → nom, prix, km, stock, image, URL
  2. Pages détail (parallèle) → marque, modèle, année, couleur, VIN, cylindrée, état

Site: WordPress + PowerGO CDN + FacetWP (pagination AJAX)
Sections: inventaire-neuf, produits-occasion
"""
import re
import json
import time
from typing import Dict, List, Optional, Any, Tuple
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup, Tag

from .base import DedicatedScraper


class MvmMotosportScraper(DedicatedScraper):

    SITE_NAME = "MVM Moto Sport"
    SITE_SLUG = "mvm-motosport"
    SITE_URL = "https://www.mvmmotosport.com/fr/"
    SITE_DOMAIN = "mvmmotosport.com"

    LISTING_PAGES = {
        'occasion': {
            'url': 'https://www.mvmmotosport.com/fr/produits-occasion/',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
        'inventaire': {
            'url': 'https://www.mvmmotosport.com/fr/inventaire-neuf/',
            'etat': 'neuf',
            'sourceCategorie': 'inventaire',
        },
    }

    FWP_MAX_PER_PAGE = 500

    # ── Sélecteurs CSS (page détail — enrichissement) ──
    SEL_BRAND = '#product-specs-overview li.make .value'
    SEL_MODEL = '#product-specs-overview li.model .value'
    SEL_YEAR = '#product-specs-overview li.year .value'
    SEL_KM = '#product-specs-overview li.km .value .number, #product-specs-overview li.km .value'
    SEL_VIN = '#product-specs-overview li.vin .value'
    SEL_COLOR = '#product-specs-overview li.ext-color .value'
    SEL_ENGINE = '#product-specs-overview li.engine-capacity .value'
    SEL_CONDITION = '#product-specs-overview li.condition .value'
    SEL_TYPE = '#product-specs-overview li.type .value'
    SEL_TRANSMISSION = '#product-specs-overview li.transmission .value'
    SEL_FUEL = '#product-specs-overview li.fuel-type .value'

    def __init__(self):
        super().__init__()
        self._url_category_map: Dict[str, Dict] = {}

    # ================================================================
    # PIPELINE PRINCIPAL (override de base.scrape)
    # ================================================================

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()

        if categories is None:
            categories = ['inventaire', 'occasion']

        print(f"\n{'='*70}")
        print(f"🔧 SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"🌐 Site: {self.SITE_URL}")
        print(f"📦 Catégories: {categories}")

        # Phase 1: extraction depuis les pages listing
        products = self._extract_from_listings(categories)

        if not products:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        # Phase 2: enrichissement via les pages détail (parallèle)
        products = self._enrich_from_detail_pages(products)

        if inventory_only:
            products = [p for p in products if p.get('sourceCategorie') != 'catalogue']

        # Phase 3: regrouper les produits identiques (marque+modèle+année+état)
        pre_group = len(products)
        products = self._group_identical_products(products)
        if pre_group != len(products):
            grouped_count = pre_group - len(products)
            multi = [p for p in products if p.get('quantity', 1) > 1]
            print(f"\n   📦 Regroupement: {pre_group} → {len(products)} produits ({grouped_count} combinés, {len(multi)} groupes multi-unités)")

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
                'urls_processed': len(products),
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

    # ================================================================
    # PHASE 1: EXTRACTION DEPUIS LES PAGES LISTING
    # ================================================================

    def _extract_from_listings(self, categories: List[str]) -> List[Dict]:
        """Charge toutes les pages listing FacetWP et extrait les produits."""
        all_products = []
        seen_urls = set()

        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories and not any(c in cat_key for c in categories):
                continue

            print(f"\n   📋 [{cat_key}]: {config['url']}")
            products = self._load_listing_page(config)

            fresh = []
            for p in products:
                url_norm = p.get('sourceUrl', '').rstrip('/').lower()
                if url_norm and url_norm not in seen_urls:
                    seen_urls.add(url_norm)
                    fresh.append(p)

            print(f"      ✅ {len(fresh)} produits extraits")
            all_products.extend(fresh)

        return all_products

    def _load_listing_page(self, config: Dict) -> List[Dict]:
        """Charge une page listing complète via fwp_per_page."""
        listing_url = config['url']
        etat = config['etat']
        source_cat = config['sourceCategorie']
        all_products = []

        bulk_url = f"{listing_url.rstrip('/')}/?fwp_per_page={self.FWP_MAX_PER_PAGE}"
        try:
            resp = self.session.get(bulk_url, timeout=30)
            if resp.status_code != 200:
                return []

            total_pages = 1
            total_rows = 0
            fwp_match = re.search(r'FWP_JSON\s*=\s*({.*?});', resp.text, re.DOTALL)
            if fwp_match:
                try:
                    fwp_data = json.loads(fwp_match.group(1))
                    pager = fwp_data.get('preload_data', {}).get('settings', {}).get('pager', {})
                    total_pages = pager.get('total_pages', 1)
                    total_rows = pager.get('total_rows', 0)
                except (json.JSONDecodeError, KeyError):
                    pass

            print(f"      📊 FacetWP: {total_rows} produits, {total_pages} page(s)")

            page1_products = self._parse_listing_html(resp.text, listing_url, etat, source_cat)
            all_products.extend(page1_products)

            for page in range(2, total_pages + 1):
                page_url = f"{listing_url.rstrip('/')}/?fwp_per_page={self.FWP_MAX_PER_PAGE}&fwp_paged={page}"
                try:
                    resp_p = self.session.get(page_url, timeout=30)
                    if resp_p.status_code != 200:
                        break
                    products_p = self._parse_listing_html(resp_p.text, listing_url, etat, source_cat)
                    all_products.extend(products_p)
                    time.sleep(0.3)
                except Exception:
                    break

        except Exception:
            pass

        return all_products

    def _parse_listing_html(self, html: str, base_url: str, etat: str, source_cat: str) -> List[Dict]:
        """Parse le HTML d'une page listing et extrait les produits."""
        soup = BeautifulSoup(html, 'lxml')
        products = []

        for item in soup.select('.product-list .item'):
            product = self._parse_listing_item(item, base_url, etat, source_cat)
            if product and product.get('name') and product.get('sourceUrl'):
                products.append(product)

        return products

    def _parse_listing_item(self, item: Tag, base_url: str, etat: str, source_cat: str) -> Optional[Dict]:
        """Extrait un produit depuis un item de la page listing."""
        product: Dict[str, Any] = {}

        # Titre + URL
        title_a = item.select_one('.listWImgsContent h3 a, h3 a')
        if not title_a:
            return None

        product['name'] = self._clean_name(title_a.get_text(strip=True))
        product['sourceUrl'] = urljoin(base_url, title_a.get('href', ''))
        product['sourceSite'] = self.SITE_URL

        if not self._is_product_url(product['sourceUrl']):
            return None

        # Image
        img = item.select_one('img')
        if img:
            src = img.get('src') or img.get('data-src', '')
            if src:
                product['image'] = urljoin(base_url, src)

        # Prix (current = non-barré)
        price_li = item.select_one('.specs li.price')
        if price_li:
            for number_el in price_li.select('.value .number'):
                if not any(p.name == 'del' for p in number_el.parents):
                    parsed = self.clean_price(number_el.get_text())
                    if parsed:
                        product['prix'] = parsed
                        break

        # Kilométrage
        km_el = item.select_one('.specs li.km .value .number')
        if km_el:
            product['kilometrage'] = self.clean_mileage(km_el.get_text())

        # Stock/Inventaire
        stock_el = item.select_one('.specs li.stock .value')
        if stock_el:
            product['inventaire'] = stock_el.get_text(strip=True)

        # Année (depuis le nom)
        year = self.clean_year(product['name'])
        if year:
            product['annee'] = year

        # État et catégorie (depuis la page listing source)
        product['etat'] = etat
        product['sourceCategorie'] = source_cat

        # Démo dans le nom
        if re.search(r'\b(démo|demo|démonstrateur)\b', product['name'].lower()):
            product['etat'] = 'demonstrateur'

        product['quantity'] = 1
        product['groupedUrls'] = [product['sourceUrl']]

        return product

    # ================================================================
    # PHASE 2: ENRICHISSEMENT VIA PAGES DÉTAIL
    # ================================================================

    def _enrich_from_detail_pages(self, products: List[Dict]) -> List[Dict]:
        """Enrichit chaque produit avec les données des pages détail (parallèle)."""
        total = len(products)
        workers = min(8, total)
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
            for future in as_completed(futures, timeout=300):
                processed += 1
                url = futures[future]
                try:
                    specs = future.result(timeout=15)
                    if specs:
                        product = url_to_product[url]
                        for key, val in specs.items():
                            if val and not product.get(key):
                                product[key] = val
                        enriched_count += 1
                except Exception:
                    pass

                if processed % 50 == 0 or processed == total:
                    elapsed = time.time() - start
                    rate = processed / elapsed if elapsed > 0 else 0
                    print(f"      📊 [{processed}/{total}] {enriched_count} enrichis — {rate:.1f}/s")

        print(f"      ✅ {enriched_count}/{total} produits enrichis")
        return products

    def _fetch_detail_specs(self, url: str) -> Optional[Dict]:
        """Fetch une page détail et extrait les specs supplémentaires."""
        try:
            resp = self.session.get(url, timeout=10, allow_redirects=True)
            if resp.status_code != 200:
                return None

            soup = BeautifulSoup(resp.text, 'lxml')

            specs_overview = soup.select_one('#product-specs-overview')
            if not specs_overview:
                return None

            specs: Dict[str, Any] = {}

            field_map = {
                'marque': self.SEL_BRAND,
                'modele': self.SEL_MODEL,
                'annee': self.SEL_YEAR,
                'kilometrage': self.SEL_KM,
                'vin': self.SEL_VIN,
                'couleur': self.SEL_COLOR,
                'cylindree': self.SEL_ENGINE,
                'transmission': self.SEL_TRANSMISSION,
                'type_carburant': self.SEL_FUEL,
            }

            for field, selector in field_map.items():
                el = soup.select_one(selector)
                if el:
                    text = el.get_text(strip=True)
                    if text and text.lower() not in ('n/a', '-', '', 'null'):
                        if field == 'annee':
                            specs[field] = self.clean_year(text)
                        elif field == 'kilometrage':
                            specs[field] = self.clean_mileage(text)
                        else:
                            specs[field] = text

            # Condition depuis les specs
            cond_el = soup.select_one(self.SEL_CONDITION)
            if cond_el:
                cond_text = cond_el.get_text(strip=True).lower()
                if 'neuf' in cond_text or 'new' in cond_text:
                    specs['etat'] = 'neuf'
                elif 'occasion' in cond_text or 'used' in cond_text or 'usagé' in cond_text:
                    specs['etat'] = 'occasion'
                elif 'démo' in cond_text or 'demo' in cond_text:
                    specs['etat'] = 'demonstrateur'

            # Type de véhicule
            type_el = soup.select_one(self.SEL_TYPE)
            if type_el:
                specs['vehicule_type'] = type_el.get_text(strip=True)

            return specs if specs else None

        except Exception:
            return None

    # ================================================================
    # HELPERS
    # ================================================================

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        """Interface requise par la classe de base (non utilisée dans scrape)."""
        if categories is None:
            categories = ['inventaire', 'occasion']

        all_urls = []
        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories:
                continue
            listing_url = config['url']
            bulk_url = f"{listing_url.rstrip('/')}/?fwp_per_page={self.FWP_MAX_PER_PAGE}"
            try:
                resp = self.session.get(bulk_url, timeout=30)
                if resp.status_code == 200:
                    all_urls.extend(self._extract_product_urls_from_html(resp.text, listing_url))
            except Exception:
                pass

        seen = set()
        return [u for u in all_urls if u.rstrip('/').lower() not in seen and not seen.add(u.rstrip('/').lower())]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        """Interface requise par la classe de base (non utilisée dans le flow hybride)."""
        specs = {}
        title_el = soup.select_one('h1')
        if title_el:
            specs['name'] = self._clean_name(title_el.get_text(strip=True))
        detail = self._fetch_detail_specs.__wrapped__(self, url) if hasattr(self._fetch_detail_specs, '__wrapped__') else None
        return specs or None

    def _extract_product_urls_from_html(self, html: str, base_url: str) -> List[str]:
        """Extrait les URLs de produits depuis le HTML d'une page listing."""
        soup = BeautifulSoup(html, 'lxml')
        urls = []
        for card in soup.select('.product-list .item'):
            link = card.select_one('.listWImgsContent h3 a, h3 a')
            if link and link.get('href'):
                full_url = urljoin(base_url, link['href'])
                if self._is_product_url(full_url):
                    urls.append(full_url)
        return urls

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        if 'a-vendre-' in url_lower or '/inventaire/' in url_lower:
            if any(x in url_lower for x in ['/blog/', '/service/', '/contact/', '/financement/']):
                return False
            return True
        return False

    def _group_identical_products(self, products: List[Dict]) -> List[Dict]:
        """Regroupe les produits identiques (marque+modèle+année+état).

        Deux passes:
          1. Éliminer les vrais doublons (même sourceUrl).
          2. Regrouper par clé (marque, modèle, année, état) → quantity + groupedUrls.
        """
        # Passe 1: dédoublonnage par URL
        seen_urls: set = set()
        unique: List[Dict] = []
        for product in products:
            url = product.get('sourceUrl', '').rstrip('/')
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            unique.append(product)

        # Passe 2: regroupement par modèle identique
        groups: Dict[tuple, Dict] = {}

        for product in unique:
            marque = product.get('marque', '').lower().strip()
            modele = product.get('modele', '').lower().strip()
            annee = product.get('annee', 0)
            etat = product.get('etat', 'neuf')
            couleur = product.get('couleur', '').lower().strip()

            if marque and modele:
                key = (marque, modele, annee, etat, couleur)
            else:
                key = (product.get('name', '').lower().strip(), annee, etat, couleur)

            if key not in groups:
                product['quantity'] = 1
                product['groupedUrls'] = [product.get('sourceUrl', '')]
                groups[key] = product
            else:
                groups[key]['quantity'] = groups[key].get('quantity', 1) + 1
                url = product.get('sourceUrl', '')
                if url:
                    groups[key].setdefault('groupedUrls', []).append(url)
                # Garder le prix le plus bas comme prix affiché
                existing_price = groups[key].get('prix')
                new_price = product.get('prix')
                if existing_price and new_price:
                    try:
                        if float(new_price) < float(existing_price):
                            groups[key]['prix'] = new_price
                    except (ValueError, TypeError):
                        pass

        return list(groups.values())

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r"\s+d['\u2019]?occasion\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        parts = name.rsplit(' - ', 1)
        if len(parts) == 2 and len(parts[1]) < 50:
            if not re.search(r'\b(19|20)\d{2}\b', parts[1]):
                name = parts[0]
        name = re.sub(r'\s*\|\s*MVM.*$', '', name, flags=re.I)
        return name.strip()
