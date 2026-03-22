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
  2. Pages détail (parallèle) → JSON-LD Product + tableaux de specs HTML
     (kilométrage, couleur, poids, moteur, cylindrée, etc.)

Le slug URL encode le type, la catégorie, la marque, l'année et le stock :
  /fr/vehicules-d-occasion/moto-custom-harley-flsl-softail-slim-2019-cs-24988
  /fr/vehicules-neufs/ducati/motocyclettes/moto-sport-touring-ducati-scrambler-800-icon-dark-2026-cs-na-web-7181
"""
import re
import json
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin
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
    WORKERS = 12
    DETAIL_TIMEOUT = 12

    _TYPE_MAP = {
        'moto': 'Motocyclette',
        'scooter': 'Scooter',
        'vtt': 'VTT',
        'cac': 'Côte à côte',
        'motoneige': 'Motoneige',
    }

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

        products = self._extract_from_detail_pages(url_map)

        if inventory_only:
            products = [p for p in products if p.get('sourceCategorie') != 'catalogue']

        products = self._deduplicate(products)

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

        Retourne {catégorie: [(url, etat, source_cat), ...]}
        """
        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_occasion = any(c in ('occasion', 'usage') for c in categories)

        url_map: Dict[str, List[tuple]] = {}
        global_seen: set = set()

        if want_neuf:
            neuf_entries: List[tuple] = []
            for listing_url in self._NEUF_SUBCATEGORIES:
                new_entries = self._paginate_listing(
                    listing_url, 'neuf', 'inventaire', global_seen
                )
                neuf_entries.extend(new_entries)
            if neuf_entries:
                url_map['inventaire'] = neuf_entries

        if want_occasion:
            occasion_entries: List[tuple] = []
            for listing_url in self._OCCASION_URLS:
                new_entries = self._paginate_listing(
                    listing_url, 'occasion', 'vehicules_occasion', global_seen
                )
                occasion_entries.extend(new_entries)
            if occasion_entries:
                url_map['occasion'] = occasion_entries

        return url_map

    def _paginate_listing(self, base_url: str, etat: str, source_cat: str,
                          global_seen: set) -> List[tuple]:
        entries: List[tuple] = []
        page_seen: set = set()

        for page in range(1, self.MAX_PAGES + 1):
            url = f'{base_url}?product_list_limit={self.PER_PAGE}&p={page}'
            try:
                resp = self.session.get(url, timeout=15, allow_redirects=True)
                if resp.status_code != 200:
                    break
            except Exception:
                break

            html = resp.text

            product_urls = set(re.findall(
                r'href="(https://www\.nadonsport\.com/fr/[^"?#]*-cs-(?:na-web-)?\d+[a-z]*)"',
                html
            ))
            new_urls = product_urls - page_seen - global_seen
            if not new_urls:
                break

            for u in new_urls:
                entries.append((u, etat, source_cat))
            page_seen.update(new_urls)
            global_seen.update(new_urls)

            items_match = re.search(r'Items\s+\d+-(\d+)\s+of\s+(\d+)', html)
            if items_match:
                current_end = int(items_match.group(1))
                total_items = int(items_match.group(2))
                if current_end >= total_items:
                    break

        return entries

    # ================================================================
    # PHASE 2 : EXTRACTION DEPUIS LES PAGES DÉTAIL
    # ================================================================

    def _extract_from_detail_pages(self, url_map: Dict[str, List[tuple]]) -> List[Dict]:
        tasks: List[tuple] = []
        for entries in url_map.values():
            tasks.extend(entries)

        total = len(tasks)
        workers = min(self.WORKERS, total)
        products: List[Dict] = []
        errors = 0
        start = time.time()

        print(f"\n   🔍 Extraction: {total} pages détail ({workers} workers)...")

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._fetch_and_parse_detail, url, etat, source_cat): url
                for url, etat, source_cat in tasks
            }

            processed = 0
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
        """Extrait les specs du premier tableau (Couleur, Kilometers, Poids, etc.)."""
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
        """Extrait type, catégorie, année et stock depuis le slug URL."""
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
    # HELPERS
    # ================================================================

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r'\bPROMO\s+[\d\s,.]+\$?\s*(?:INCLUS)?\b', '', name, flags=re.I)
        name = re.sub(r'\bCS-(?:NA-WEB-)?\d+[a-z]*\b', '', name, flags=re.I)
        name = re.sub(r'\b(Occasion|Usagé|Neuf)\b', '', name, flags=re.I)
        name = re.sub(r'\ba\s+vendre\b', '', name, flags=re.I)
        name = re.sub(r'\bchez\s+nadon\s+sport\b', '', name, flags=re.I)
        name = re.sub(r'\(\s*\)', '', name)

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
            all_urls.extend(u for u, _, _ in entries)
        seen = set()
        return [u for u in all_urls
                if u.rstrip('/').lower() not in seen and not seen.add(u.rstrip('/').lower())]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        out: Dict[str, Any] = {}
        self._extract_json_ld(soup, out)
        self._extract_specs_table(soup, out)
        self._extract_from_url_slug(url, out)
        return out if out else None
