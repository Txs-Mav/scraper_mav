"""
Scraper dédié pour Joliette Récréatif (jolietterecreatif.ca).
Sélecteurs CSS hardcodés — aucun appel Gemini.

Stratégie hybride:
  1. Pages listing FacetWP (?fwp_per_page=500) → nom, prix, km, stock, image, URL
  2. Pages détail (parallèle) → marque, modèle, année, catégorie, type, couleur,
     kilométrage, description, prix promotionnel, état

Site: WordPress + PowerGO + FacetWP
Sections: inventaire-neuf, produits-occasion
"""
import json
import re
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup, Tag

from .base import DedicatedScraper


class JolietteRecreatifScraper(DedicatedScraper):

    SITE_NAME = "Joliette Récréatif"
    SITE_SLUG = "joliette-recreatif"
    SITE_URL = "https://www.jolietterecreatif.ca/fr/"
    SITE_DOMAIN = "jolietterecreatif.ca"

    LISTING_PAGES = {
        'inventaire': {
            'url': 'https://www.jolietterecreatif.ca/fr/inventaire-neuf/',
            'etat': 'neuf',
            'sourceCategorie': 'inventaire',
        },
        'occasion': {
            'url': 'https://www.jolietterecreatif.ca/fr/produits-occasion/',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
    }

    FWP_MAX_PER_PAGE = 500
    WORKERS = 10
    DETAIL_TIMEOUT = 12

    DETAIL_FIELD_SELECTORS = {
        'marque': '#product-specs-overview li.make .value',
        'modele': '#product-specs-overview li.model .value',
        'annee': '#product-specs-overview li.year .value',
        'inventaire': '#product-specs-overview li.stock .value',
        'vehicule_type': '#product-specs-overview li.type .value',
        'vehicule_categorie': '#product-specs-overview li.category .value',
        'kilometrage': '#product-specs-overview li.km .value .number, #product-specs-overview li.km .value',
        'couleur': '#product-specs-overview li.ext-color .value',
    }

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

    def _extract_from_listings(self, categories: List[str]) -> List[Dict]:
        all_products = []
        seen_urls = set()

        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories and not any(c in cat_key for c in categories):
                continue

            print(f"\n   📋 [{cat_key}]: {config['url']}")
            products = self._load_listing_page(config)

            fresh = []
            for product in products:
                url_norm = product.get('sourceUrl', '').rstrip('/').lower()
                if url_norm and url_norm not in seen_urls:
                    seen_urls.add(url_norm)
                    fresh.append(product)

            print(f"      ✅ {len(fresh)} produits extraits")
            all_products.extend(fresh)

        return all_products

    def _load_listing_page(self, config: Dict) -> List[Dict]:
        listing_url = config['url']
        etat = config['etat']
        source_cat = config['sourceCategorie']
        all_products = []

        bulk_url = f"{listing_url.rstrip('/')}/?fwp_per_page={self.FWP_MAX_PER_PAGE}"

        try:
            response = self.session.get(bulk_url, timeout=30)
            if response.status_code != 200:
                print(f"      ⚠️ HTTP {response.status_code} pour {bulk_url}")
                return []

            total_pages = 1
            total_rows = 0
            fwp_match = re.search(r'FWP_JSON\s*=\s*({.*?});', response.text, re.DOTALL)
            if fwp_match:
                try:
                    fwp_data = json.loads(fwp_match.group(1))
                    pager = fwp_data.get('preload_data', {}).get('settings', {}).get('pager', {})
                    total_pages = max(1, int(pager.get('total_pages', 1)))
                    total_rows = int(pager.get('total_rows', 0))
                except (json.JSONDecodeError, TypeError, ValueError, KeyError):
                    pass

            print(f"      📊 FacetWP: {total_rows or '?'} produits, {total_pages} page(s)")

            page_products = self._parse_listing_html(response.text, listing_url, etat, source_cat)
            all_products.extend(page_products)

            for page in range(2, total_pages + 1):
                page_url = (
                    f"{listing_url.rstrip('/')}/?fwp_per_page={self.FWP_MAX_PER_PAGE}"
                    f"&fwp_paged={page}"
                )
                try:
                    response_p = self.session.get(page_url, timeout=30)
                    if response_p.status_code != 200:
                        break
                    all_products.extend(
                        self._parse_listing_html(response_p.text, listing_url, etat, source_cat)
                    )
                    time.sleep(0.3)
                except Exception:
                    break

        except Exception as exc:
            print(f"      ⚠️ Erreur listing: {exc}")

        return all_products

    def _parse_listing_html(self, html: str, base_url: str, etat: str, source_cat: str) -> List[Dict]:
        soup = BeautifulSoup(html, 'lxml')
        products = []

        for item in soup.select('.product-list .item'):
            product = self._parse_listing_item(item, base_url, etat, source_cat)
            if product and product.get('name') and product.get('sourceUrl'):
                products.append(product)

        return products

    def _parse_listing_item(self, item: Tag, base_url: str, etat: str, source_cat: str) -> Optional[Dict]:
        product: Dict[str, Any] = {}

        title_a = item.select_one('.listWImgsContent h3 a, h3 a')
        if not title_a:
            return None

        href = title_a.get('href', '')
        if not href:
            return None

        product['sourceUrl'] = href if href.startswith('http') else urljoin(base_url, href)
        if not self._is_product_url(product['sourceUrl']):
            return None

        product['sourceSite'] = self.SITE_URL
        product['name'] = self._clean_name(title_a.get_text(strip=True))
        if not product['name']:
            return None

        img = item.select_one('img')
        if img:
            src = img.get('src') or img.get('data-src', '')
            if src:
                product['image'] = src if src.startswith('http') else urljoin(base_url, src)

        price_li = item.select_one('.specs li.price')
        if price_li:
            current_price_val = None
            old_price_val = None

            for num_el in price_li.select('.number'):
                price = self.clean_price(num_el.get_text())
                if not price:
                    continue
                if num_el.find_parent('del'):
                    if not old_price_val:
                        old_price_val = price
                else:
                    if not current_price_val:
                        current_price_val = price

            if current_price_val:
                product['prix'] = current_price_val
            elif old_price_val:
                product['prix'] = old_price_val

            if old_price_val and old_price_val != product.get('prix'):
                product['prix_original'] = old_price_val

        km_el = item.select_one('.specs li.km .value .number, .specs li.km .value')
        if km_el:
            km_val = self.clean_mileage(km_el.get_text(strip=True))
            if km_val is not None:
                product['kilometrage'] = km_val

        stock_el = item.select_one('.specs li.stock .value')
        if stock_el:
            stock = stock_el.get_text(strip=True)
            if stock:
                product['inventaire'] = stock

        year = self.clean_year(product['name'])
        if year:
            product['annee'] = year

        product['etat'] = etat
        product['sourceCategorie'] = source_cat

        if re.search(r'\b(démo|demo|démonstrateur)\b', product['name'].lower()):
            product['etat'] = 'demonstrateur'

        product['quantity'] = 1
        product['groupedUrls'] = [product['sourceUrl']]

        return product

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
                                or key in ('marque', 'modele', 'annee', 'vehicule_type',
                                           'vehicule_categorie', 'prix', 'prix_original')
                            ):
                                product[key] = value
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
        try:
            response = self.session.get(url, timeout=self.DETAIL_TIMEOUT, allow_redirects=True)
            if response.status_code != 200:
                return None

            soup = BeautifulSoup(response.text, 'lxml')
            specs: Dict[str, Any] = {}

            for field, selector in self.DETAIL_FIELD_SELECTORS.items():
                el = soup.select_one(selector)
                if not el:
                    continue
                text = el.get_text(strip=True)
                if not text or text.lower() in ('n/a', '-', '', 'null'):
                    continue
                if field == 'annee':
                    parsed = self.clean_year(text)
                    if parsed:
                        specs[field] = parsed
                elif field == 'kilometrage':
                    parsed = self.clean_mileage(text)
                    if parsed is not None:
                        specs[field] = parsed
                else:
                    specs[field] = text

            cond_el = soup.select_one('#product-specs-overview li.condition .value')
            if cond_el:
                cond_text = cond_el.get_text(strip=True).lower()
                if 'neuf' in cond_text or 'new' in cond_text:
                    specs['etat'] = 'neuf'
                elif 'occasion' in cond_text or 'used' in cond_text or 'usagé' in cond_text:
                    specs['etat'] = 'occasion'
                elif 'démo' in cond_text or 'demo' in cond_text:
                    specs['etat'] = 'demonstrateur'

            price_box = soup.select_one('#product-price .price')
            if price_box:
                current_price_val = None
                old_price_val = None

                for num_el in price_box.select('.number'):
                    price = self.clean_price(num_el.get_text())
                    if not price:
                        continue
                    if num_el.find_parent('del') or num_el.find_parent(class_='old-price'):
                        if not old_price_val:
                            old_price_val = price
                    else:
                        if not current_price_val:
                            current_price_val = price

                if current_price_val:
                    specs['prix'] = current_price_val
                elif old_price_val:
                    specs['prix'] = old_price_val

                if old_price_val and old_price_val != specs.get('prix'):
                    specs['prix_original'] = old_price_val

            notes_el = soup.select_one('#product-notes')
            if notes_el:
                description = notes_el.get_text(' ', strip=True)
                description = re.sub(r'^Notes\s+Notes\s*:?\s*', '', description, flags=re.I)
                if description and len(description) > 20:
                    specs['description'] = description[:2000]

            image_meta = soup.select_one('meta[property="og:image"]')
            if image_meta and image_meta.get('content'):
                specs['image'] = image_meta['content']

            title_el = soup.select_one('h1')
            if title_el:
                specs['name'] = self._clean_name(title_el.get_text(strip=True))

            return specs if specs else None

        except Exception:
            return None

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']

        all_urls = []
        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories and not any(c in cat_key for c in categories):
                continue

            listing_url = config['url']
            bulk_url = f"{listing_url.rstrip('/')}/?fwp_per_page={self.FWP_MAX_PER_PAGE}"
            try:
                response = self.session.get(bulk_url, timeout=30)
                if response.status_code == 200:
                    all_urls.extend(self._extract_product_urls_from_html(response.text, listing_url))
            except Exception:
                pass

        seen = set()
        return [
            url for url in all_urls
            if url.rstrip('/').lower() not in seen and not seen.add(url.rstrip('/').lower())
        ]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        specs: Dict[str, Any] = {}

        title_el = soup.select_one('h1')
        if title_el:
            specs['name'] = self._clean_name(title_el.get_text(strip=True))

        for field, selector in self.DETAIL_FIELD_SELECTORS.items():
            el = soup.select_one(selector)
            if not el:
                continue
            text = el.get_text(strip=True)
            if not text:
                continue
            if field == 'annee':
                parsed = self.clean_year(text)
                if parsed:
                    specs[field] = parsed
            elif field == 'kilometrage':
                parsed = self.clean_mileage(text)
                if parsed is not None:
                    specs[field] = parsed
            else:
                specs[field] = text

        return specs if specs else None

    def _extract_product_urls_from_html(self, html: str, base_url: str) -> List[str]:
        soup = BeautifulSoup(html, 'lxml')
        urls = []

        for card in soup.select('.product-list .item'):
            link = card.select_one('.listWImgsContent h3 a, h3 a')
            if link and link.get('href'):
                full_url = link['href']
                if not full_url.startswith('http'):
                    full_url = urljoin(base_url, full_url)
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
        seen_urls: set = set()
        unique: List[Dict] = []
        for product in products:
            url = product.get('sourceUrl', '').rstrip('/')
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            product['quantity'] = 1
            product['groupedUrls'] = [product.get('sourceUrl', '')]
            unique.append(product)
        return unique

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r"\s+-\s+Pr[ée]-commander.*$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s*d['’]?occasion\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Joliette\s+R[ée]cr[ée]atif.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
