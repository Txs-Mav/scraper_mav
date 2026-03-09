"""
Scraper dédié pour Mathias Sports (mathiassports.com).
Sélecteurs CSS hardcodés — aucun appel Gemini.

Stratégie hybride (Magento 2):
  1. Pages listing (product_list_limit=708) → nom, prix, image, URL
  2. Pages détail (parallèle) → marque, modèle, année, type, inventaire,
     kilométrage, couleur, carburant, description

Site: Magento 2 + Mirasvit Layered Navigation
Sections: vehicules-neufs.html, vehicules-d-occasion.html
"""
import re
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup, Tag

from .base import DedicatedScraper


class MathiasSportsScraper(DedicatedScraper):

    SITE_NAME = "Mathias Sports"
    SITE_SLUG = "mathias-sports"
    SITE_URL = "https://mathiassports.com/"
    SITE_DOMAIN = "mathiassports.com"

    LISTING_PAGES = {
        'inventaire': {
            'url': 'https://mathiassports.com/vehicules-neufs.html',
            'etat': 'neuf',
            'sourceCategorie': 'inventaire',
        },
        'occasion': {
            'url': 'https://mathiassports.com/vehicules-d-occasion.html',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
    }

    MAX_PER_PAGE = 708
    WORKERS = 14
    DETAIL_TIMEOUT = 12

    # ── Sélecteurs CSS : page listing ──
    SEL_PRODUCT_ITEM = 'li.product-item'
    SEL_NAME = '.product-name-js'
    SEL_LINK = 'a.product-item-link'
    SEL_IMAGE = 'img.product-image-photo'
    SEL_PRICE_FINAL = '.price-wrapper[data-price-amount]'
    SEL_PRICE_SPECIAL = '.special-price .price-wrapper[data-price-amount]'
    SEL_PRICE_OLD = '.old-price .price-wrapper[data-price-amount]'

    # ── Sélecteurs CSS : page détail ──
    SEL_DETAIL_MANUFACTURER = '.product-main-info-manufacturer .value'
    SEL_DETAIL_YEAR = '.product-main-info-year .value'
    SEL_DETAIL_TYPE = '.product-main-info-type .value'
    SEL_DETAIL_MODEL = '.product-main-info-model .value'
    SEL_DETAIL_SKU = '.product-main-info-sku .value'
    SEL_DETAIL_IMAGE = '.gallery-placeholder img'
    SEL_DETAIL_DESC = '.product.attribute.description .value'
    SEL_DETAIL_SPECS_ROW = '#product-attribute-specs-table tr'
    SEL_DETAIL_PRICE_SPECIAL = '.product-info-price .special-price .price-wrapper'
    SEL_DETAIL_PRICE_OLD = '.product-info-price .old-price .price-wrapper'
    SEL_DETAIL_PRICE_FINAL = '.product-info-price .price-wrapper'

    def __init__(self):
        super().__init__()

    # ================================================================
    # PIPELINE PRINCIPAL
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

        products = self._extract_from_listings(categories)

        if not products:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        products = self._enrich_from_detail_pages(products)

        if inventory_only:
            products = [p for p in products if p.get('sourceCategorie') != 'catalogue']

        pre_group = len(products)
        products = self._group_identical_products(products)
        if pre_group != len(products):
            grouped_count = pre_group - len(products)
            multi = [p for p in products if p.get('quantity', 1) > 1]
            print(f"\n   📦 Regroupement: {pre_group} → {len(products)} produits "
                  f"({grouped_count} combinés, {len(multi)} groupes multi-unités)")

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
    # PHASE 1 : EXTRACTION DEPUIS LES PAGES LISTING
    # ================================================================

    def _extract_from_listings(self, categories: List[str]) -> List[Dict]:
        all_products = []
        seen_urls = set()

        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories and not any(c in cat_key for c in categories):
                continue

            print(f"\n   📋 [{cat_key}]: {config['url']}")
            products = self._load_listing_pages(config)

            fresh = []
            for p in products:
                url_norm = p.get('sourceUrl', '').rstrip('/').lower()
                if url_norm and url_norm not in seen_urls:
                    seen_urls.add(url_norm)
                    fresh.append(p)

            print(f"      ✅ {len(fresh)} produits extraits")
            all_products.extend(fresh)

        return all_products

    def _load_listing_pages(self, config: Dict) -> List[Dict]:
        listing_url = config['url']
        etat = config['etat']
        source_cat = config['sourceCategorie']
        all_products = []

        page = 1
        while True:
            if page == 1:
                url = f"{listing_url}?product_list_limit={self.MAX_PER_PAGE}"
            else:
                url = f"{listing_url}?product_list_limit={self.MAX_PER_PAGE}&p={page}"

            try:
                resp = self.session.get(url, timeout=30)
                if resp.status_code != 200:
                    print(f"      ⚠️ Page {page}: HTTP {resp.status_code}")
                    break
            except Exception as e:
                print(f"      ⚠️ Page {page}: {e}")
                break

            soup = BeautifulSoup(resp.text, 'lxml')
            items = soup.select(self.SEL_PRODUCT_ITEM)

            if not items:
                break

            page_products = []
            for item in items:
                product = self._parse_listing_item(item, listing_url, etat, source_cat)
                if product and product.get('name') and product.get('sourceUrl'):
                    page_products.append(product)

            all_products.extend(page_products)

            total_text = soup.select_one('.toolbar-amount')
            total_items = 0
            if total_text:
                match = re.search(r'sur\s+(\d[\d\s]*)', total_text.get_text())
                if match:
                    total_items = int(match.group(1).replace(' ', ''))

            print(f"      📊 Page {page}: {len(page_products)} produits "
                  f"(total cumulé: {len(all_products)}"
                  f"{f'/{total_items}' if total_items else ''})")

            if len(items) < self.MAX_PER_PAGE:
                break
            if total_items and len(all_products) >= total_items:
                break

            page += 1
            time.sleep(0.3)

        return all_products

    def _parse_listing_item(self, item: Tag, base_url: str,
                            etat: str, source_cat: str) -> Optional[Dict]:
        product: Dict[str, Any] = {}

        link = item.select_one(self.SEL_LINK)
        if not link:
            return None

        href = link.get('href', '')
        if not href:
            return None
        product['sourceUrl'] = href if href.startswith('http') else urljoin(base_url, href)
        product['sourceSite'] = self.SITE_URL

        if not self._is_product_url(product['sourceUrl']):
            return None

        name_el = item.select_one(self.SEL_NAME)
        if name_el:
            raw_name = name_el.get('data-name', '')
            raw_name = BeautifulSoup(raw_name, 'html.parser').get_text(strip=True)
            product['name'] = self._clean_name(raw_name)
        else:
            link_text = link.get_text(strip=True)
            if link_text:
                product['name'] = self._clean_name(link_text)

        if not product.get('name'):
            return None

        img = item.select_one(self.SEL_IMAGE)
        if img:
            src = img.get('src') or img.get('data-src', '')
            if src:
                product['image'] = src if src.startswith('http') else urljoin(base_url, src)

        special_el = item.select_one(self.SEL_PRICE_SPECIAL)
        old_el = item.select_one(self.SEL_PRICE_OLD)
        final_el = item.select_one(self.SEL_PRICE_FINAL)

        if special_el:
            amount = special_el.get('data-price-amount', '')
            parsed = self._parse_price_amount(amount)
            if parsed:
                product['prix'] = parsed
            if old_el:
                old_amount = old_el.get('data-price-amount', '')
                old_parsed = self._parse_price_amount(old_amount)
                if old_parsed:
                    product['prix_original'] = old_parsed
        elif final_el:
            amount = final_el.get('data-price-amount', '')
            parsed = self._parse_price_amount(amount)
            if parsed:
                product['prix'] = parsed

        url_info = self._parse_url_info(product['sourceUrl'])
        if url_info.get('annee'):
            product['annee'] = url_info['annee']
        if url_info.get('inventaire'):
            product['inventaire'] = url_info['inventaire']

        product['etat'] = etat
        product['sourceCategorie'] = source_cat

        if re.search(r'\b(démo|demo|démonstrateur)\b', product.get('name', '').lower()):
            product['etat'] = 'demonstrateur'

        product['quantity'] = 1
        product['groupedUrls'] = [product['sourceUrl']]

        return product

    # ================================================================
    # PHASE 2 : ENRICHISSEMENT VIA PAGES DÉTAIL
    # ================================================================

    def _enrich_from_detail_pages(self, products: List[Dict]) -> List[Dict]:
        total = len(products)
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
            for future in as_completed(futures, timeout=900):
                processed += 1
                url = futures[future]
                try:
                    specs = future.result(timeout=self.DETAIL_TIMEOUT + 5)
                    if specs:
                        product = url_to_product[url]
                        for key, val in specs.items():
                            if val is not None and (not product.get(key) or key in ('marque', 'modele', 'annee', 'vehicule_type')):
                                product[key] = val
                        enriched_count += 1
                except Exception:
                    pass

                if processed % 100 == 0 or processed == total:
                    elapsed = time.time() - start
                    rate = processed / elapsed if elapsed > 0 else 0
                    print(f"      📊 [{processed}/{total}] {enriched_count} enrichis — {rate:.1f}/s")

        print(f"      ✅ {enriched_count}/{total} produits enrichis")
        return products

    def _fetch_detail_specs(self, url: str) -> Optional[Dict]:
        try:
            resp = self.session.get(url, timeout=self.DETAIL_TIMEOUT, allow_redirects=True)
            if resp.status_code != 200:
                return None

            soup = BeautifulSoup(resp.text, 'lxml')
            specs: Dict[str, Any] = {}

            main_info = soup.select_one('.product-main-info')
            if main_info:
                manufacturer_el = main_info.select_one(
                    '.product-main-info-manufacturer .value')
                if manufacturer_el:
                    text = manufacturer_el.get_text(strip=True)
                    if text:
                        specs['marque'] = text

                year_el = main_info.select_one('.product-main-info-year .value')
                if year_el:
                    parsed = self.clean_year(year_el.get_text(strip=True))
                    if parsed:
                        specs['annee'] = parsed

                type_el = main_info.select_one('.product-main-info-type .value')
                if type_el:
                    text = type_el.get_text(strip=True)
                    if text:
                        specs['vehicule_type'] = text

                model_el = main_info.select_one('.product-main-info-model .value')
                if model_el:
                    text = model_el.get_text(strip=True)
                    if text:
                        specs['modele'] = text

                sku_el = main_info.select_one('.product-main-info-sku .value')
                if sku_el:
                    text = sku_el.get_text(strip=True)
                    if text:
                        specs['inventaire'] = text

            price_div = soup.select_one('.product-info-price')
            if price_div:
                sp = price_div.select_one('.special-price .price-wrapper')
                if sp:
                    amount = self._parse_price_amount(
                        sp.get('data-price-amount', ''))
                    if amount:
                        specs['prix'] = amount
                    op = price_div.select_one('.old-price .price-wrapper')
                    if op:
                        old_amount = self._parse_price_amount(
                            op.get('data-price-amount', ''))
                        if old_amount:
                            specs['prix_original'] = old_amount
                else:
                    fp = price_div.select_one('.price-wrapper')
                    if fp:
                        amount = self._parse_price_amount(
                            fp.get('data-price-amount', ''))
                        if amount:
                            specs['prix'] = amount

            specs_rows = soup.select(self.SEL_DETAIL_SPECS_ROW)
            for row in specs_rows:
                th = row.select_one('th')
                td = row.select_one('td')
                if not th or not td:
                    continue
                label = th.get_text(strip=True).lower()
                value = td.get_text(strip=True)
                if not value or value in ('0', '0.000', '', '-', 'N/A'):
                    continue

                if label in ('kilometers', 'kilomètre', 'kilométrage', 'km'):
                    km = self.clean_mileage(value)
                    if km and km > 0:
                        specs['kilometrage'] = km
                elif label in ('couleur', 'color'):
                    if value and value.lower() not in ('n/a', '-', ''):
                        specs['couleur'] = value
                elif label in ('type de carburant', 'fuel type', 'carburant'):
                    specs['type_carburant'] = value
                elif label in ('cylindrée', 'displacement', 'engine'):
                    specs['cylindree'] = value
                elif label == 'transmission':
                    specs['transmission'] = value

            img_el = soup.select_one(self.SEL_DETAIL_IMAGE)
            if img_el:
                src = img_el.get('src') or img_el.get('data-src', '')
                if src and 'catalog/product' in src:
                    specs['image'] = src if src.startswith('http') else urljoin(url, src)

            desc_el = soup.select_one(self.SEL_DETAIL_DESC)
            if desc_el:
                desc = desc_el.get_text(separator=' ', strip=True)
                if desc and len(desc) > 20:
                    specs['description'] = desc[:2000]

            h1 = soup.select_one('h1')
            if h1:
                specs['name'] = self._clean_name(h1.get_text(strip=True))

            return specs if specs else None

        except Exception:
            return None

    # ================================================================
    # HELPERS
    # ================================================================

    @staticmethod
    def _parse_price_amount(value: str) -> Optional[float]:
        if not value:
            return None
        try:
            amount = float(value)
            return amount if amount > 0 else None
        except (ValueError, TypeError):
            return None

    def _parse_url_info(self, url: str) -> Dict[str, Any]:
        """Extrait année et numéro d'inventaire depuis le pattern d'URL Magento."""
        info: Dict[str, Any] = {}
        path = url.rstrip('/').rsplit('/', 1)[-1]
        path = path.replace('.html', '')

        year_match = re.search(r'-(\d{4})-(ms-[\w-]+)$', path, re.I)
        if year_match:
            info['annee'] = int(year_match.group(1))
            info['inventaire'] = year_match.group(2).upper()
        else:
            year_match2 = re.search(r'-(\d{4})-', path)
            if year_match2:
                info['annee'] = int(year_match2.group(1))
            inv_match = re.search(r'(ms-[\w-]+)$', path, re.I)
            if inv_match:
                info['inventaire'] = inv_match.group(1).upper()

        return info

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        non_product = ['/blog/', '/service/', '/contact/', '/financement/',
                       '/pieces/', '/a-propos/', '/carriere/', '/nous-joindre/',
                       '/checkout/', '/customer/', '/catalogsearch/', '/promotions.html']
        if any(x in url_lower for x in non_product):
            return False
        if url_lower.endswith('.html') and '/' not in url_lower.split(self.SITE_DOMAIN)[1].strip('/').rstrip('.html'):
            return True
        return url_lower.endswith('.html')

    def _group_identical_products(self, products: List[Dict]) -> List[Dict]:
        seen_urls: set = set()
        unique: List[Dict] = []
        for product in products:
            url = product.get('sourceUrl', '').rstrip('/')
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            unique.append(product)

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
                existing_price = groups[key].get('prix')
                new_price = product.get('prix')
                if existing_price and new_price:
                    try:
                        if float(new_price) < float(existing_price):
                            groups[key]['prix'] = new_price
                    except (ValueError, TypeError):
                        pass

        return list(groups.values())

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']

        all_urls = []
        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories:
                continue

            page = 1
            while True:
                if page == 1:
                    url = f"{config['url']}?product_list_limit={self.MAX_PER_PAGE}"
                else:
                    url = f"{config['url']}?product_list_limit={self.MAX_PER_PAGE}&p={page}"

                try:
                    resp = self.session.get(url, timeout=30)
                    if resp.status_code != 200:
                        break
                    urls = self._extract_urls_from_html(resp.text, config['url'])
                    if not urls:
                        break
                    all_urls.extend(urls)
                    if len(urls) < self.MAX_PER_PAGE:
                        break
                    page += 1
                    time.sleep(0.3)
                except Exception:
                    break

        seen = set()
        return [u for u in all_urls
                if u.rstrip('/').lower() not in seen and not seen.add(u.rstrip('/').lower())]

    def extract_from_detail_page(self, url: str, html: str,
                                 soup: BeautifulSoup) -> Optional[Dict]:
        specs = self._fetch_detail_specs.__wrapped__(self, url) \
            if hasattr(self._fetch_detail_specs, '__wrapped__') else {}
        if not specs:
            specs = {}
        h1 = soup.select_one('h1')
        if h1:
            specs.setdefault('name', self._clean_name(h1.get_text(strip=True)))
        return specs if specs else None

    def _extract_urls_from_html(self, html: str, base_url: str) -> List[str]:
        soup = BeautifulSoup(html, 'lxml')
        urls = []
        for item in soup.select(self.SEL_PRODUCT_ITEM):
            link = item.select_one(self.SEL_LINK)
            if link and link.get('href'):
                full_url = link['href']
                if not full_url.startswith('http'):
                    full_url = urljoin(base_url, full_url)
                if self._is_product_url(full_url):
                    urls.append(full_url)
        return urls

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = BeautifulSoup(name, 'html.parser').get_text(strip=True)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)
        name = re.sub(r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Mathias.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
