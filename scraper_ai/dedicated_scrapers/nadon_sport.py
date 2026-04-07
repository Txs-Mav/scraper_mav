"""
Scraper dédié pour Nadon Sport (Magento 2).

Concessionnaire moto, VTT, côtes-à-côtes et motoneiges à Saint-Eustache, QC.
Marques : BMW, Ducati, Yamaha, Kawasaki, GAS GAS, Husqvarna, Polaris.

Stratégie listing paginé par sous-catégorie + pages détail :
  1. Sous-catégories par marque/type paginées via ?p=N&product_list_limit=36
     → découverte de toutes les URLs (~1500+ produits)
     Deux patterns d'URLs :
       - Inventaire physique :  …-cs-24988    (stock numérique)
       - Catalogue/commande :  …-cs-na-web-7181  (produits commandables)
  2. Produits catalogue : données extraites directement du listing Magento
     (nom, prix, image) + URL slug (année, type, marque) — aucune requête
     détail nécessaire.
  3. Produits inventaire/occasion : pages détail (parallèle) →
     JSON-LD Product + tableaux de specs HTML (km, couleur, moteur, etc.)
  4. Regroupement des variantes (couleurs) d'un même modèle.

Le slug URL encode le type, la catégorie, la marque, l'année et le stock :
  /fr/vehicules-d-occasion/moto-custom-harley-flsl-softail-slim-2019-cs-24988
  /fr/vehicules-neufs/ducati/motocyclettes/moto-sport-touring-ducati-scrambler-800-icon-dark-2026-cs-na-web-7181
"""
import re
import json
import time
import unicodedata
from typing import Dict, List, Optional, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class NadonSportScraper(DedicatedScraper):

    SITE_NAME = "Nadon Sport"
    SITE_SLUG = "nadon-sport"
    SITE_URL = "https://www.nadonsport.com/fr/"
    SITE_DOMAIN = "nadonsport.com"

    _BASE = 'https://www.nadonsport.com/fr'

    _NEUF_SUBCATEGORIES = [
        f'{_BASE}/vehicules-neufs/ducati/motocyclettes',
        f'{_BASE}/vehicules-neufs/bmw/motocyclettes',
        f'{_BASE}/vehicules-neufs/yamaha/motocyclettes',
        f'{_BASE}/vehicules-neufs/yamaha/vtt',
        f'{_BASE}/vehicules-neufs/yamaha/cotes-a-cotes',
        f'{_BASE}/vehicules-neufs/yamaha/produits-mecaniques',
        f'{_BASE}/vehicules-neufs/kawasaki/motocyclettes',
        f'{_BASE}/vehicules-neufs/kawasaki/vtt',
        f'{_BASE}/vehicules-neufs/kawasaki/cotes-a-cotes',
        f'{_BASE}/vehicules-neufs/gasgas/motocyclettes',
        f'{_BASE}/vehicules-neufs/husqvarna/motocyclettes',
        f'{_BASE}/vehicules-neufs/polaris/vtt',
        f'{_BASE}/vehicules-neufs/polaris/cotes-a-cotes',
        f'{_BASE}/vehicules-neufs/polaris/motoneiges',
    ]

    _OCCASION_URLS = [
        f'{_BASE}/vehicules-d-occasion',
    ]

    _PRODUCT_URL_RE = re.compile(r'-cs-(?:na-web-)?\d+[a-z]*$')

    PER_PAGE = 36
    MAX_PAGES = 50
    WORKERS = 20
    DETAIL_TIMEOUT = 10
    LISTING_TIMEOUT = 12
    LISTING_WORKERS = 6
    DISCOVERY_TIMEOUT = 300

    _TYPE_MAP = {
        'moto': 'Motocyclette',
        'scooter': 'Scooter',
        'vtt': 'VTT',
        'cac': 'Côte à côte',
        'motoneige': 'Motoneige',
    }

    _BRAND_FIXES = {
        'Bmw': 'BMW',
        'Gasgas': 'GasGas',
    }

    _GROUP_COLOR_KEYWORDS = frozenset({
        'blanc', 'noir', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'rose', 'violet',
        'gris', 'argent', 'bronze', 'beige', 'marron', 'brun', 'turquoise',
        'brillant', 'mat', 'metallise', 'metallique', 'perle', 'nacre', 'satin',
        'chrome', 'carbone', 'fonce', 'clair', 'fluo', 'neon', 'acide',
        'ebene', 'graphite', 'anthracite', 'platine', 'titane',
        'phantom', 'midnight', 'cosmic', 'storm', 'combat', 'lime', 'sauge',
        'cristal', 'obsidian', 'racing', 'dark', 'ice', 'frozen',
        'white', 'black', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
        'gray', 'grey', 'silver', 'gold', 'brown', 'matte', 'glossy',
        'metallic', 'pearl', 'carbon', 'light', 'bright',
    })

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

        url_map = self._discover_urls_from_listings(categories)

        if not url_map:
            print("   ⚠️ Aucun produit trouvé dans les listings")
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        total_urls = sum(len(v) for v in url_map.values())
        for cat, entries in url_map.items():
            print(f"   📋 [{cat}]: {len(entries)} URLs")

        products = self._extract_products(url_map)

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
                'urls_processed': total_urls,
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
    # PHASE 1 : DÉCOUVERTE DES URLs VIA SOUS-CATÉGORIES PAGINÉES
    # ================================================================

    def _discover_urls_from_listings(self, categories: List[str]) -> Dict[str, List[tuple]]:
        """Parcourt toutes les sous-catégories par marque/type et pagine chacune.

        Retourne {catégorie: [(url, etat, source_cat, listing_data), ...]}
        où listing_data est un dict {name, prix, image, marque} ou None.
        """
        from threading import Lock

        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_occasion = any(c in ('occasion', 'usage') for c in categories)

        url_map: Dict[str, List[tuple]] = {}
        global_seen: set = set()
        seen_lock = Lock()

        tasks: List[tuple] = []
        if want_neuf:
            for listing_url in self._NEUF_SUBCATEGORIES:
                tasks.append((listing_url, 'neuf', 'inventaire'))
        if want_occasion:
            for listing_url in self._OCCASION_URLS:
                tasks.append((listing_url, 'occasion', 'vehicules_occasion'))

        if not tasks:
            return url_map

        total_tasks = len(tasks)
        workers = min(self.LISTING_WORKERS, total_tasks)
        print(f"\n   🔍 Découverte: {total_tasks} sous-catégories ({workers} workers, "
              f"timeout global {self.DISCOVERY_TIMEOUT}s)...")

        discovery_start = time.time()
        results: List[tuple] = []

        def _paginate_task(args):
            listing_url, etat, source_cat = args
            entries = self._paginate_listing(listing_url, etat, source_cat, global_seen, seen_lock)
            label = listing_url.split('/fr/')[-1] if '/fr/' in listing_url else listing_url
            elapsed = time.time() - discovery_start
            print(f"      ✅ {label}: {len(entries)} produits ({elapsed:.0f}s)")
            return (etat, source_cat, entries)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(_paginate_task, t): t for t in tasks}
            try:
                for future in as_completed(futures, timeout=self.DISCOVERY_TIMEOUT):
                    try:
                        result = future.result(timeout=30)
                        results.append(result)
                    except Exception as e:
                        url = futures[future][0]
                        label = url.split('/fr/')[-1] if '/fr/' in url else url
                        print(f"      ⚠️ {label}: erreur — {e}")
            except TimeoutError:
                pending = sum(1 for f in futures if not f.done())
                print(f"      ⏰ Timeout découverte: {pending}/{total_tasks} sous-catégorie(s) abandonnée(s)")
                for f in futures:
                    f.cancel()

        for etat, source_cat, entries in results:
            cat_key = 'inventaire' if etat == 'neuf' else 'occasion'
            url_map.setdefault(cat_key, []).extend(entries)

        elapsed = time.time() - discovery_start
        total_urls = sum(len(v) for v in url_map.values())
        print(f"   📋 Découverte terminée: {total_urls} URLs en {elapsed:.0f}s")

        return url_map

    def _paginate_listing(self, base_url: str, etat: str, source_cat: str,
                          global_seen: set, seen_lock=None) -> List[tuple]:
        from threading import Lock
        if seen_lock is None:
            seen_lock = Lock()

        entries: List[tuple] = []
        page_seen: set = set()

        brand_match = re.search(r'/vehicules-neufs/([^/]+)/', base_url)
        brand = None
        if brand_match:
            brand = brand_match.group(1).replace('-', ' ').title()
            brand = self._BRAND_FIXES.get(brand, brand)

        consecutive_failures = 0

        for page in range(1, self.MAX_PAGES + 1):
            url = f'{base_url}?product_list_limit={self.PER_PAGE}&p={page}'
            try:
                resp = self.session.get(url, timeout=self.LISTING_TIMEOUT, allow_redirects=True)
                if resp.status_code != 200:
                    consecutive_failures += 1
                    if consecutive_failures >= 2:
                        break
                    continue
                consecutive_failures = 0
            except Exception:
                consecutive_failures += 1
                if consecutive_failures >= 2:
                    break
                continue

            html = resp.text

            product_urls = set(re.findall(
                r'href="(https://www\.nadonsport\.com/fr/[^"?#]*-cs-(?:na-web-)?\d+[a-z]*)"',
                html
            ))

            with seen_lock:
                new_urls = product_urls - page_seen - global_seen
                if not new_urls:
                    break
                global_seen.update(new_urls)

            listing_data = self._extract_listing_data(html, brand)

            for u in new_urls:
                ld = listing_data.get(u)
                entries.append((u, etat, source_cat, ld))
            page_seen.update(new_urls)

            items_match = re.search(r'Items\s+\d+-(\d+)\s+of\s+(\d+)', html)
            if items_match:
                current_end = int(items_match.group(1))
                total_items = int(items_match.group(2))
                if current_end >= total_items:
                    break

        return entries

    def _extract_listing_data(self, html: str, brand: Optional[str] = None) -> Dict[str, Dict]:
        """Extract product data from Magento listing page product cards.

        This Magento theme has no a.product-item-link; the product name comes
        from the img alt attribute, the link from a.product-item-photo href.

        Returns {url: {name, prix, image, marque}} for each product on the page.
        """
        data_map: Dict[str, Dict] = {}
        soup = BeautifulSoup(html, 'lxml')

        for item in soup.select('li.product-item'):
            photo_link = item.select_one('a.product-item-photo')
            if not photo_link:
                continue

            href = (photo_link.get('href') or '').split('?')[0].split('#')[0]
            if not href or not self._PRODUCT_URL_RE.search(href):
                continue

            listing: Dict[str, Any] = {}

            img_el = item.select_one('img.product-image-photo')
            if img_el:
                alt = (img_el.get('alt') or '').strip()
                if alt:
                    listing['name'] = self._clean_name(alt)
                src = img_el.get('src') or img_el.get('data-src', '')
                if src and src.startswith('http'):
                    listing['image'] = src

            price_el = item.select_one('[data-price-amount]')
            if price_el:
                try:
                    price = float(price_el['data-price-amount'])
                    if price > 0:
                        listing['prix'] = price
                except (ValueError, TypeError, KeyError):
                    pass

            if brand:
                listing['marque'] = brand

            if listing:
                data_map[href] = listing

        return data_map

    # ================================================================
    # PHASE 2 : EXTRACTION (LISTING + DÉTAIL)
    # ================================================================

    def _extract_products(self, url_map: Dict[str, List[tuple]]) -> List[Dict]:
        """Build products from listing data (catalog) and detail pages (inventory/occasion)."""
        catalog_tasks: List[tuple] = []
        detail_tasks: List[tuple] = []

        for entries in url_map.values():
            for entry in entries:
                url, etat, source_cat, listing_data = entry
                is_catalog = 'cs-na-web-' in url

                if is_catalog and listing_data and listing_data.get('name'):
                    name = listing_data['name']
                    brand = listing_data.get('marque', '')
                    if self._is_name_sufficient(name, brand):
                        catalog_tasks.append(entry)
                        continue

                detail_tasks.append(entry)

        products: List[Dict] = []

        if catalog_tasks:
            print(f"\n   ⚡ {len(catalog_tasks)} produits catalogue "
                  f"extraits du listing (sans requête détail)")
            for url, etat, source_cat, listing_data in catalog_tasks:
                product = self._build_product_from_listing(url, etat, source_cat, listing_data)
                if product:
                    products.append(product)

        if detail_tasks:
            detail_products = self._extract_from_detail_pages(detail_tasks)
            products.extend(detail_products)

        return products

    def _build_product_from_listing(self, url: str, etat: str,
                                     source_cat: str, listing_data: Dict) -> Optional[Dict]:
        """Build a product dict from listing page data + URL slug parsing."""
        product: Dict[str, Any] = {
            'sourceUrl': url,
            'sourceSite': self.SITE_URL,
            'etat': etat,
            'sourceCategorie': source_cat,
            'quantity': 1,
        }

        if listing_data.get('name'):
            product['name'] = listing_data['name']
        if listing_data.get('prix'):
            product['prix'] = listing_data['prix']
        if listing_data.get('image'):
            product['image'] = listing_data['image']
        if listing_data.get('marque'):
            product['marque'] = listing_data['marque']

        self._extract_from_url_slug(url, product)

        if 'cs-na-web-' in url:
            product['sourceCategorie'] = 'catalogue'

        if not product.get('name'):
            return None

        product['groupedUrls'] = [url]
        return product

    def _extract_from_detail_pages(self, tasks: List[tuple]) -> List[Dict]:
        total = len(tasks)
        workers = min(self.WORKERS, total)
        products: List[Dict] = []
        errors = 0
        start = time.time()

        print(f"\n   🔍 Extraction: {total} pages détail ({workers} workers)...")

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._fetch_and_parse_detail, url, etat, source_cat): url
                for url, etat, source_cat, _ in tasks
            }

            processed = 0
            try:
                for future in as_completed(futures, timeout=900):
                    processed += 1
                    try:
                        product = future.result(timeout=self.DETAIL_TIMEOUT + 5)
                        if product:
                            products.append(product)
                        else:
                            errors += 1
                    except Exception:
                        errors += 1

                    if processed % 50 == 0 or processed == total:
                        elapsed = time.time() - start
                        rate = processed / elapsed if elapsed > 0 else 0
                        print(f"      📊 [{processed}/{total}] {len(products)} ok, "
                              f"{errors} erreurs — {rate:.1f}/s")
            except TimeoutError:
                pending = total - processed
                print(f"      ⚠️ Timeout — {pending}/{total} URL(s) abandonnée(s), "
                      f"{len(products)} produit(s) conservé(s)")
                for f in futures:
                    f.cancel()

        print(f"      ✅ {len(products)}/{total} produits extraits "
              f"({errors} erreurs)")
        return products

    def _fetch_and_parse_detail(self, url: str, etat: str, source_cat: str) -> Optional[Dict]:
        try:
            resp = self.session.get(url, timeout=self.DETAIL_TIMEOUT, allow_redirects=True)
            if resp.status_code != 200:
                return None

            final_url = resp.url
            if '/vehicules-neufs' not in final_url and '/vehicules-d-occasion' not in final_url:
                return None

            html = resp.text
            soup = BeautifulSoup(html, 'lxml')

            product: Dict[str, Any] = {
                'sourceUrl': url,
                'sourceSite': self.SITE_URL,
                'etat': etat,
                'sourceCategorie': source_cat,
                'quantity': 1,
            }

            self._extract_json_ld(soup, product)
            self._extract_specs_table(soup, product)
            self._extract_from_url_slug(url, product)

            if not product.get('prix'):
                price_el = soup.select_one('[data-price-amount]')
                if price_el:
                    try:
                        product['prix'] = float(price_el['data-price-amount'])
                    except (ValueError, TypeError):
                        pass

            if not product.get('image'):
                img = soup.select_one(
                    '.product.media img, .gallery-placeholder img, '
                    'img.product-image-photo'
                )
                if img:
                    src = img.get('src') or img.get('data-src', '')
                    if src and src.startswith('http'):
                        product['image'] = src

            if not product.get('name'):
                h1 = soup.select_one('h1.page-title span, h1')
                if h1:
                    product['name'] = self._clean_name(h1.get_text(strip=True))

            if not product.get('name'):
                return None

            product['groupedUrls'] = [url]

            return product

        except Exception:
            return None

    # ================================================================
    # EXTRACTEURS DE DONNÉES
    # ================================================================

    def _extract_json_ld(self, soup: BeautifulSoup, out: Dict) -> None:
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string)
                if data.get('@type') != 'Product':
                    continue

                raw_name = data.get('name', '')
                if raw_name:
                    out.setdefault('name', self._clean_name(raw_name))

                brand = data.get('brand', {})
                if isinstance(brand, dict) and brand.get('name'):
                    out.setdefault('marque', brand['name'].strip().title())
                elif isinstance(brand, str):
                    out.setdefault('marque', brand.strip().title())

                if data.get('sku'):
                    out.setdefault('inventaire', data['sku'])

                img = data.get('image')
                if isinstance(img, str) and img.startswith('http'):
                    out.setdefault('image', img)

                offers = data.get('offers', {})
                if isinstance(offers, dict) and offers.get('price'):
                    try:
                        price = float(offers['price'])
                        if price > 0:
                            out.setdefault('prix', price)
                    except (ValueError, TypeError):
                        pass

                desc = data.get('description', '')
                if desc and len(desc) > 20:
                    out.setdefault('description', desc[:2000])

                break
            except (json.JSONDecodeError, TypeError, KeyError, ValueError):
                continue

    def _extract_specs_table(self, soup: BeautifulSoup, out: Dict) -> None:
        table = soup.select_one(
            'table#product-attribute-specs-table, '
            'table.additional-attributes, '
            'div.additional-attributes table'
        )
        if not table:
            tables = soup.find_all('table')
            for t in tables:
                rows = t.find_all('tr')
                if rows:
                    first_labels = [r.find('th') for r in rows[:3]]
                    labels_text = [
                        l.get_text(strip=True).lower() if l else ''
                        for l in first_labels
                    ]
                    if any(kw in ' '.join(labels_text) for kw in
                           ('couleur', 'color', 'kilometer', 'poids', 'moteur',
                            'cylindr', 'entrainement', 'reservoir')):
                        table = t
                        break

        if not table:
            return

        for row in table.find_all('tr'):
            th = row.find('th')
            td = row.find('td')
            if not th or not td:
                continue

            label = th.get_text(strip=True).lower()
            value = td.get_text(strip=True)
            if not value or value in ('-', 'N/A', ''):
                continue

            if 'couleur' in label or 'color' in label:
                out.setdefault('couleur', value.title())
            elif 'kilometer' in label or 'km' == label or 'mileage' in label:
                km = self.clean_mileage(value)
                if km is not None:
                    out.setdefault('kilometrage', km)
            elif 'vin' == label:
                out.setdefault('vin', value.upper())
            elif 'poids' in label or 'weight' in label:
                out.setdefault('poids', value)
            elif 'moteur' in label or 'engine' in label:
                out.setdefault('moteur', value)
            elif 'cylindr' in label or 'displacement' in label:
                out.setdefault('cylindree', value)
            elif 'transmission' in label:
                out.setdefault('transmission', value)
            elif 'reservoir' in label or 'fuel' in label:
                out.setdefault('reservoir', value)

    def _extract_from_url_slug(self, url: str, out: Dict) -> None:
        slug = url.rstrip('/').split('/')[-1]

        stock_match = re.search(r'-cs-((?:na-web-)?\d+[a-z]*)$', slug, re.I)
        if stock_match and not out.get('inventaire'):
            out['inventaire'] = f'CS-{stock_match.group(1).upper()}'

        if 'cs-na-web-' in slug:
            out.setdefault('sourceCategorie', 'catalogue')

        year_match = re.search(r'-(\d{4})-cs-', slug)
        if year_match:
            year = int(year_match.group(1))
            if 1990 <= year <= 2030:
                out.setdefault('annee', year)

        cat_map = {
            'custom': 'Custom',
            'sport': 'Sport',
            'sport-touring': 'Sport Touring',
            'grand-touring': 'Grand Touring',
            'double-usage': 'Double Usage',
            'retro-standard': 'Rétro / Standard',
            '3-roues': '3 Roues',
            'utilitaire': 'Utilitaire',
            '4x4': '4x4',
            '1-place': '1 Place',
            '2-places': '2 Places',
            'cross-country': 'Cross Country',
        }

        for prefix, vtype in self._TYPE_MAP.items():
            if slug.startswith(prefix + '-'):
                out.setdefault('vehicule_type', vtype)
                remainder = slug[len(prefix) + 1:]
                cat_match = re.match(r'^([a-z]+(?:-[a-z]+)*)-(?:[a-z]{2,})', remainder)
                if cat_match and cat_match.group(1) in cat_map:
                    out.setdefault('vehicule_categorie', cat_map[cat_match.group(1)])
                break

        if not out.get('vehicule_type'):
            path = url.lower()
            path_type_map = {
                '/motocyclettes/': 'Motocyclette',
                '/vtt/': 'VTT',
                '/cotes-a-cotes/': 'Côte à côte',
                '/motoneiges/': 'Motoneige',
                '/produits-mecaniques/': 'Produit mécanique',
                '/velos-electriques/': 'Vélo électrique',
            }
            for path_frag, vtype in path_type_map.items():
                if path_frag in path:
                    out.setdefault('vehicule_type', vtype)
                    break

        if not out.get('annee'):
            name = out.get('name', '')
            year_from_name = self.clean_year(name)
            if year_from_name:
                out['annee'] = year_from_name

    # ================================================================
    # REGROUPEMENT DES VARIANTES (COULEURS) D'UN MÊME MODÈLE
    # ================================================================

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
            marque_norm = self._deep_normalize(product.get('marque', ''))
            group_model = self._normalize_group_model(product)
            annee = product.get('annee', 0)
            etat = product.get('etat', 'neuf')

            if marque_norm and group_model and len(group_model) >= 3:
                key = (marque_norm, group_model, annee, etat)
            else:
                inv = product.get('inventaire', '')
                if inv:
                    key = ('_inv', inv.lower().strip())
                else:
                    key = ('_url', product.get('sourceUrl', '').rstrip('/'))


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

    @staticmethod
    def _deep_normalize(text: str) -> str:
        if not text:
            return ''
        text = text.lower().strip()
        text = unicodedata.normalize('NFKD', text)
        text = ''.join(c for c in text if not unicodedata.category(c).startswith('M'))
        text = re.sub(r'([a-z])(\d)', r'\1 \2', text)
        text = re.sub(r'(\d)([a-z])', r'\1 \2', text)
        text = re.sub(r'[^a-z0-9\s]', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        words = text.split()
        merged: list = []
        i = 0
        while i < len(words):
            if len(words[i]) == 1 and words[i].isalpha():
                letters = [words[i]]
                j = i + 1
                while j < len(words) and len(words[j]) == 1 and words[j].isalpha():
                    letters.append(words[j])
                    j += 1
                merged.append(''.join(letters) if len(letters) > 1 else words[i])
                i = j
            else:
                merged.append(words[i])
                i += 1
        return ' '.join(merged)

    # Multi-word equipment/option phrases stripped for grouping only (kept in display name)
    _GROUP_OPTION_RE = re.compile(
        r'\b(?:'
        r'(?:m\s+)?pack(?:age)?\s+roue\s+(?:forge[e]?|carbone?|carbon|alliage|magnesium)'
        r'|valves?\s+fait(?:\s*-?\s*automatique)?'
        r'|fait\s*-?\s*automatique'
        r'|comme\s+neuf'
        r')\b',
        re.I
    )

    _GROUP_OPTION_KEYWORDS = frozenset({
        'automatique', 'automatic',
        'impeccable', 'parfait', 'excellent', 'mint', 'wow', 'deal', 'aubaine',
    })

    def _normalize_group_model(self, product: Dict) -> str:
        """Build a normalized model key stripping brand, year, colors, and options.

        Equipment descriptors (VALVES FAIT, AUTOMATIQUE, PACK ROUE FORGE, etc.)
        are stripped here so they don't prevent grouping of the same base model,
        but they remain in the displayed product name.

        Option stripping happens on the raw name BEFORE deep_normalize to avoid
        the single-letter merge problem (e.g. "S1000R M" → "rm").
        """
        name = (product.get('name') or '').strip()
        marque = (product.get('marque') or '').strip()
        couleur = (product.get('couleur') or '').strip()

        if not name:
            return ''

        # Strip options from raw name BEFORE deep_normalize
        name_stripped = self._GROUP_OPTION_RE.sub(' ', name)
        name_stripped = ' '.join(
            w for w in name_stripped.split()
            if w.lower() not in self._GROUP_OPTION_KEYWORDS
        )

        name_norm = self._deep_normalize(name_stripped)
        marque_norm = self._deep_normalize(marque) if marque else ''

        if marque_norm and name_norm.startswith(marque_norm + ' '):
            model = name_norm[len(marque_norm):].strip()
        elif marque_norm and name_norm.startswith(marque_norm):
            model = name_norm[len(marque_norm):].strip()
        else:
            model = name_norm

        model = re.sub(r'\b(?:19|20)\d{2}\b', '', model).strip()

        if couleur:
            couleur_norm = self._deep_normalize(couleur)
            if couleur_norm:
                model = model.replace(couleur_norm, ' ').strip()

        words = model.split()
        words = [w for w in words if w not in self._GROUP_COLOR_KEYWORDS]
        model = ' '.join(words)

        model = re.sub(r'\s+', ' ', model).strip()
        return model

    # ================================================================
    # HELPERS
    # ================================================================

    @staticmethod
    def _is_name_sufficient(name: str, brand: str = '') -> bool:
        """Check if the product name has enough info beyond brand + year."""
        cleaned = name
        if brand:
            cleaned = re.sub(re.escape(brand), '', cleaned, count=1, flags=re.I)
        cleaned = re.sub(r'\b\d{4}\b', '', cleaned)
        cleaned = re.sub(r'[^a-zA-Z0-9]', '', cleaned)
        return len(cleaned) >= 3

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name

        # Strip *text* marketing annotations (*IMPECCABLE*, *AUTOMATIQUE*, etc.)
        name = re.sub(r'\*+([^*]*)\*+', '', name)
        name = re.sub(r'\*+', '', name)

        name = re.sub(r'\bPROMO\s+[\d\s,.]+\$?\s*(?:INCLUS)?\b', '', name, flags=re.I)
        name = re.sub(r'\bCS-(?:NA-WEB-)?\d+[a-z]*\b', '', name, flags=re.I)
        name = re.sub(r'\b(Occasion|Usagé|Neuf)\b', '', name, flags=re.I)
        name = re.sub(r'\ba\s+vendre\b', '', name, flags=re.I)
        name = re.sub(r'\bchez\s+nadon\s+sport\b', '', name, flags=re.I)
        name = re.sub(r'\s+\d{1,2}\s*$', '', name)
        name = re.sub(r'\(\s*\)', '', name)

        # Strip standalone marketing fluff
        name = re.sub(
            r'\b(IMPECCABLE|COMME\s+NEUF|MINT|PARFAIT|EXCELLENT|WOW|DEAL|AUBAINE)\b',
            '', name, flags=re.I
        )

        dup = re.match(
            r'^(\S+\s+\d{4}\s+)(.+?)\s+\2\s*$',
            name, re.I
        )
        if dup:
            name = dup.group(1) + dup.group(2)

        name = re.sub(r'\s+', ' ', name).strip()
        name = re.sub(r'^La\s+', '', name)
        name = re.sub(r'\s*[|–-]\s*$', '', name)
        return name.strip()

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']
        url_map = self._discover_urls_from_listings(categories)
        all_urls = []
        for entries in url_map.values():
            all_urls.extend(u for u, _, _, _ in entries)
        seen = set()
        return [u for u in all_urls
                if u.rstrip('/').lower() not in seen and not seen.add(u.rstrip('/').lower())]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        out: Dict[str, Any] = {}
        self._extract_json_ld(soup, out)
        self._extract_specs_table(soup, out)
        self._extract_from_url_slug(url, out)
        return out if out else None
