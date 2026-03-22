"""
Scraper dédié pour Laval Moto (WordPress + PowerGO CDN).

Concessionnaire motos, scooters, VTT et produits mécaniques
situé à Laval, QC (Rive-Nord de Montréal).

Stratégie multi-sitemap + détail :
  1. 6 sitemaps Yoast paginés (motorcycle×2, atv, power-equipment, inventory×2)
     → découverte de TOUTES les URLs produits
  2. Pages détail (parallèle) → HTML specs (li.make/.model/.year) + OG meta

Le site utilise WordPress avec le thème PowerGO et Yoast SEO.
Les pages catalogue (motorcycles/atv/power-equipment) sont des fiches
techniques avec prix PDSF.  Les pages inventaire sont les produits
physiques en stock (neufs et occasion) avec prix, état et numéro de stock.

Marques : Suzuki, Kawasaki, Yamaha, Vespa, Honda, Piaggio.

Types de produits : Motocyclette, Scooter, VTT, Produit mécanique.
"""
import re
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class LavalMotoScraper(DedicatedScraper):

    SITE_NAME = "Laval Moto"
    SITE_SLUG = "laval-moto"
    SITE_URL = "https://www.lavalmoto.com/fr/"
    SITE_DOMAIN = "lavalmoto.com"

    SITEMAPS = {
        'motorcycle-1': 'https://www.lavalmoto.com/fr/motorcycle-sitemap1.xml',
        'motorcycle-2': 'https://www.lavalmoto.com/fr/motorcycle-sitemap2.xml',
        'atv': 'https://www.lavalmoto.com/fr/atv-sitemap.xml',
        'power-equipment': 'https://www.lavalmoto.com/fr/power-equipment-sitemap.xml',
        'inventory-1': 'https://www.lavalmoto.com/fr/inventory-sitemap1.xml',
        'inventory-2': 'https://www.lavalmoto.com/fr/inventory-sitemap2.xml',
    }

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    _TYPE_MAP = {
        'motocyclette': 'Motocyclette',
        'motorcycle': 'Motocyclette',
        'vtt': 'VTT',
        'atv': 'VTT',
        'power-equipment': 'Produit mécanique',
    }

    _INVENTORY_TYPE_MAP = {
        'motocyclettes': 'Motocyclette',
        'motorcycles': 'Motocyclette',
        'scooters': 'Scooter',
        'vtt': 'VTT',
        'atvs': 'VTT',
        'cote-a-cote': 'Côte à côte',
        'side-by-side': 'Côte à côte',
        'produits-mecaniques': 'Produit mécanique',
        'power-equipment': 'Produit mécanique',
    }

    _NORMALIZE_TYPE = {
        'motocyclette': 'Motocyclette',
        'motocyclettes': 'Motocyclette',
        'motorcycle': 'Motocyclette',
        'sport': 'Motocyclette',
        'custom': 'Motocyclette',
        'cruiser': 'Motocyclette',
        'touring': 'Motocyclette',
        'adventure': 'Motocyclette',
        'dual sport': 'Motocyclette',
        'naked': 'Motocyclette',
        'standard': 'Motocyclette',
        'supermoto': 'Motocyclette',
        'off-road': 'Motocyclette',
        'trail': 'Motocyclette',
        'motocross': 'Motocyclette',
        'enduro': 'Motocyclette',
        'scooter': 'Scooter',
        'scooters': 'Scooter',
        'vtt': 'VTT',
        'atv': 'VTT',
        'utilitaire': 'VTT',
        'récréatif': 'VTT',
        'sport (atv)': 'VTT',
        'côte à côte': 'Côte à côte',
        'side-by-side': 'Côte à côte',
        'produit mécanique': 'Produit mécanique',
        'produits mécaniques': 'Produit mécanique',
        'power equipment': 'Produit mécanique',
        'génératrice': 'Produit mécanique',
        'générateur': 'Produit mécanique',
        'souffleuse': 'Produit mécanique',
        'tondeuse': 'Produit mécanique',
    }

    def __init__(self):
        super().__init__()

    # ================================================================
    # PIPELINE PRINCIPAL
    # ================================================================

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()

        if categories is None:
            categories = ['inventaire', 'catalogue']

        print(f"\n{'='*70}")
        print(f"🔧 SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"🌐 Site: {self.SITE_URL}")
        print(f"📦 Catégories: {categories}")

        url_map = self._discover_urls_from_sitemaps(categories)

        if not url_map:
            print("   ⚠️ Aucune URL trouvée dans les sitemaps")
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        total_urls = sum(len(urls) for urls in url_map.values())
        for cat, urls in url_map.items():
            print(f"   📋 [{cat}]: {len(urls)} URLs")

        products = self._extract_from_detail_pages(url_map)

        if not products:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

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
    # PHASE 1 : DÉCOUVERTE DES URLs VIA SITEMAPS XML
    # ================================================================

    def _discover_urls_from_sitemaps(self, categories: List[str]) -> Dict[str, List[str]]:
        """Parse les 6 sitemaps Yoast paginés et trie les URLs par catégorie.

        Toutes les URLs sont en français (/fr/) — pas de déduplication FR/EN.
        """
        want_inventory = any(c in ('inventaire', 'occasion', 'neuf') for c in categories)
        want_catalog = any(c in ('catalogue', 'catalog') for c in categories)

        url_map: Dict[str, List[str]] = {}
        seen_slugs: set = set()

        catalog_keys = ['motorcycle-1', 'motorcycle-2', 'atv', 'power-equipment']
        inventory_keys = ['inventory-1', 'inventory-2']

        sitemaps_to_fetch = []
        if want_catalog:
            sitemaps_to_fetch.extend(catalog_keys)
        if want_inventory:
            sitemaps_to_fetch.extend(inventory_keys)

        for sitemap_key in sitemaps_to_fetch:
            sitemap_url = self.SITEMAPS.get(sitemap_key)
            if not sitemap_url:
                continue

            urls = self._parse_sitemap(sitemap_url)
            if not urls:
                continue

            is_inventory = sitemap_key.startswith('inventory')

            for raw_url in urls:
                if self.SITE_DOMAIN not in raw_url:
                    continue

                slug = self._extract_slug(raw_url)
                if slug and slug in seen_slugs:
                    continue
                if slug:
                    seen_slugs.add(slug)

                cat_key = 'inventaire' if is_inventory else 'catalogue'
                url_map.setdefault(cat_key, []).append(raw_url)

        return url_map

    def _parse_sitemap(self, sitemap_url: str) -> List[str]:
        try:
            resp = self.session.get(sitemap_url, timeout=15)
            if resp.status_code != 200:
                print(f"   ⚠️ Sitemap {sitemap_url} indisponible ({resp.status_code})")
                return []
        except Exception as e:
            print(f"   ⚠️ Erreur sitemap {sitemap_url}: {e}")
            return []

        urls = []
        try:
            soup = BeautifulSoup(resp.text, 'xml')
            for url_tag in soup.find_all('url'):
                loc = url_tag.find('loc')
                if loc and loc.text.strip():
                    urls.append(loc.text.strip())
        except Exception:
            url_pattern = re.compile(r'<loc>(https?://[^<]+)</loc>')
            for match in url_pattern.finditer(resp.text):
                urls.append(match.group(1))

        return urls

    @staticmethod
    def _extract_slug(url: str) -> Optional[str]:
        path = urlparse(url).path.strip('/')
        parts = path.split('/')
        if len(parts) >= 2:
            return parts[-1].lower()
        return None

    # ================================================================
    # PHASE 2 : EXTRACTION DEPUIS LES PAGES DÉTAIL
    # ================================================================

    def _extract_from_detail_pages(self, url_map: Dict[str, List[str]]) -> List[Dict]:
        tasks: List[tuple] = []
        for cat_key, urls in url_map.items():
            for url in urls:
                tasks.append((url, cat_key))

        total = len(tasks)
        workers = min(self.WORKERS, total)
        products: List[Dict] = []
        errors = 0
        start = time.time()

        print(f"\n   🔍 Extraction: {total} pages détail ({workers} workers)...")

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._fetch_and_parse_detail, url, source_cat): url
                for url, source_cat in tasks
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

                if processed % 100 == 0 or processed == total:
                    elapsed = time.time() - start
                    rate = processed / elapsed if elapsed > 0 else 0
                    print(f"      📊 [{processed}/{total}] {len(products)} ok, "
                          f"{errors} erreurs — {rate:.1f}/s")

        print(f"      ✅ {len(products)}/{total} produits extraits "
              f"({errors} erreurs)")
        return products

    def _fetch_and_parse_detail(self, url: str, source_cat: str) -> Optional[Dict]:
        try:
            resp = self.session.get(url, timeout=self.DETAIL_TIMEOUT, allow_redirects=True)
            if resp.status_code != 200:
                return None

            resp.encoding = resp.apparent_encoding or 'utf-8'
            soup = BeautifulSoup(resp.text, 'lxml')

            is_inventory = source_cat == 'inventaire'

            product: Dict[str, Any] = {
                'sourceUrl': resp.url,
                'sourceSite': self.SITE_URL,
                'sourceCategorie': source_cat,
                'quantity': 1,
            }

            self._extract_og_meta(soup, product)
            self._extract_html_specs(soup, product)
            self._extract_price(soup, product)
            self._extract_images(soup, url, product)
            self._extract_description(soup, product)
            self._detect_etat(soup, product, is_inventory)
            self._extract_type_from_url(url, product)

            h1 = soup.select_one('h1')
            raw_title = h1.get_text(strip=True) if h1 else ''
            if raw_title and not product.get('name'):
                product['name'] = self._clean_name(raw_title)

            if not product.get('name'):
                parts = []
                if product.get('annee'):
                    parts.append(str(product['annee']))
                if product.get('marque'):
                    parts.append(product['marque'])
                if product.get('modele'):
                    parts.append(product['modele'])
                name = ' '.join(parts)
                if name:
                    product['name'] = name

            if not product.get('name'):
                return None

            product['groupedUrls'] = [product['sourceUrl']]
            return product

        except Exception:
            return None

    # ================================================================
    # EXTRACTEURS DE DONNÉES
    # ================================================================

    def _extract_og_meta(self, soup: BeautifulSoup, out: Dict) -> None:
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content', '').startswith('http'):
            out.setdefault('image', og_image['content'])

    def _extract_html_specs(self, soup: BeautifulSoup, out: Dict) -> None:
        spec_section = soup.select_one(
            '#product-specs-overview .content ul, '
            '#product-specs .content ul'
        )
        if not spec_section:
            return

        spec_map = {
            'make': 'marque',
            'model': 'modele',
            'year': 'annee',
            'stock': 'inventaire',
            'type': 'vehicule_type',
            'condition': '_condition',
            'ext-color': 'couleur',
            'int-color': 'couleur_interieur',
            'engine': 'moteur',
            'engine-capacity': 'cylindree',
            'hp': 'puissance',
            'fuel': 'carburant',
            'weight': 'poids',
            'mileage': 'kilometrage',
            'hours': 'heures',
            'vin': 'vin',
            'vehicle-id': '_vehicle_id',
            'transmission': 'transmission',
            'transmission_speed': 'vitesses',
            'drive': 'entrainement',
            'cylinders': 'cylindres',
            'cooling': 'refroidissement',
        }

        for li in spec_section.find_all('li', recursive=False):
            classes = li.get('class', [])
            if not classes:
                continue

            li_class = classes[0]

            if li_class == 'custom_fields':
                self._extract_custom_field(li, out)
                continue

            field = spec_map.get(li_class)
            if not field:
                continue

            value_el = li.select_one('span.value')
            if not value_el:
                continue

            text = value_el.get_text(strip=True)
            if not text or text in ('-', 'N/A', '', 'null'):
                continue

            if field == '_condition':
                tl = text.lower()
                if 'new' in tl or 'neuf' in tl:
                    out.setdefault('etat', 'neuf')
                elif 'used' in tl or 'usag' in tl or 'occasion' in tl:
                    out.setdefault('etat', 'occasion')
                elif 'demo' in tl or 'démo' in tl:
                    out.setdefault('etat', 'demonstrateur')
                continue

            if field == '_vehicle_id':
                continue

            if field == 'vehicule_type':
                normalized = self._NORMALIZE_TYPE.get(text.lower().strip())
                if normalized:
                    out.setdefault(field, normalized)
                else:
                    out.setdefault('vehicule_categorie', text)
                continue

            if field == 'annee':
                parsed = self.clean_year(text)
                if parsed:
                    out.setdefault(field, parsed)
            elif field in ('kilometrage', 'heures'):
                parsed = self.clean_mileage(text)
                if parsed is not None:
                    out.setdefault(field, parsed)
            else:
                out.setdefault(field, text)

    def _extract_custom_field(self, li, out: Dict) -> None:
        label_el = li.select_one('span.label')
        value_el = li.select_one('span.value')
        if not label_el or not value_el:
            return

        label = label_el.get_text(strip=True).rstrip(':').lower()
        value = value_el.get_text(strip=True)
        if not value or value in ('-', 'N/A'):
            return

        custom_map = {
            'displacement': 'cylindree',
            'cylindrée': 'cylindree',
            'déplacement': 'cylindree',
            'seat height': 'hauteur_selle',
            'hauteur de selle': 'hauteur_selle',
            'wet weight': 'poids',
            'poids en ordre de marche': 'poids',
            'dry weight': 'poids',
            'poids sec': 'poids',
            'fuel capacity': 'capacite_carburant',
            'capacité carburant': 'capacite_carburant',
            'bore x stroke': 'alesage_course',
            'alésage x course': 'alesage_course',
            'wheelbase': 'empattement',
            'empattement': 'empattement',
        }

        field = custom_map.get(label)
        if field:
            out.setdefault(field, value)

    def _extract_price(self, soup: BeautifulSoup, out: Dict) -> None:
        price_section = soup.select_one('#product-price')
        if not price_section:
            return

        old_price_el = price_section.select_one('.old-price .number')
        if old_price_el:
            original = self.clean_price(old_price_el.get_text(strip=True))
            if original:
                out['prix_original'] = original

        current_price_el = price_section.select_one('.current-price .number')
        if current_price_el:
            price = self.clean_price(current_price_el.get_text(strip=True))
            if price:
                out['prix'] = price
                return

        price_el = price_section.select_one('[data-price] .number, .price .number')
        if price_el:
            price = self.clean_price(price_el.get_text(strip=True))
            if price:
                out['prix'] = price

    def _extract_images(self, soup: BeautifulSoup, url: str, out: Dict) -> None:
        if out.get('image'):
            return

        gallery = soup.select_one('#product-photos .gallery .slider')
        if gallery:
            img = gallery.select_one('img[src]')
            if img:
                src = img.get('src', '')
                if src.startswith('http'):
                    out['image'] = src
                    return

        img = soup.select_one(
            '#product-photos .img img[src], '
            'img[src*="cdn.powergo.ca"]'
        )
        if img:
            src = img.get('src', '')
            if src.startswith('http'):
                out['image'] = src

    def _extract_description(self, soup: BeautifulSoup, out: Dict) -> None:
        desc_section = soup.select_one('#product-notes .text, #product-description .text')
        if not desc_section:
            return
        text = desc_section.get_text(separator=' ', strip=True)
        if text and len(text) > 10:
            out.setdefault('description', text[:2000])

    def _detect_etat(self, soup: BeautifulSoup, out: Dict, is_inventory: bool) -> None:
        if out.get('etat'):
            return

        if not is_inventory:
            out['etat'] = 'neuf'
            return

        body = soup.find('body')
        if body:
            body_classes = ' '.join(body.get('class', []))
            if 'is-used' in body_classes:
                out['etat'] = 'occasion'
                return

        condition_li = soup.select_one('li.condition .value')
        if condition_li:
            cond_text = condition_li.get_text(strip=True).lower()
            if 'used' in cond_text or 'usag' in cond_text or 'occasion' in cond_text:
                out['etat'] = 'occasion'
                return

        out['etat'] = 'neuf'

    def _extract_type_from_url(self, url: str, out: Dict) -> None:
        if out.get('vehicule_type'):
            return

        path = urlparse(url).path.lower()

        for slug, label in self._TYPE_MAP.items():
            if f'/{slug}/' in path:
                out['vehicule_type'] = label
                return

        if '/inventaire/' in path or '/inventory/' in path:
            last_segment = path.rstrip('/').split('/')[-1]
            first_word = last_segment.split('-')[0]
            for prefix, label in self._INVENTORY_TYPE_MAP.items():
                if first_word == prefix or last_segment.startswith(prefix + '-'):
                    out['vehicule_type'] = label
                    return

    # ================================================================
    # INTERFACE DedicatedScraper
    # ================================================================

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'catalogue']
        url_map = self._discover_urls_from_sitemaps(categories)
        all_urls = []
        for urls in url_map.values():
            all_urls.extend(urls)
        seen = set()
        return [u for u in all_urls
                if u.rstrip('/').lower() not in seen and not seen.add(u.rstrip('/').lower())]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        out: Dict[str, Any] = {}
        is_inventory = '/inventaire/' in url.lower() or '/inventory/' in url.lower()
        self._extract_og_meta(soup, out)
        self._extract_html_specs(soup, out)
        self._extract_price(soup, out)
        self._extract_images(soup, url, out)
        self._extract_description(soup, out)
        self._detect_etat(soup, out, is_inventory)
        self._extract_type_from_url(url, out)

        h1 = soup.select_one('h1')
        if h1:
            out.setdefault('name', self._clean_name(h1.get_text(strip=True)))
        return out if out.get('name') else None

    # ================================================================
    # REGROUPEMENT
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
            marque = product.get('marque', '').lower().strip()
            modele = product.get('modele', '').lower().strip()
            annee = product.get('annee', 0)
            etat = product.get('etat', 'neuf')

            if marque and modele:
                key = (marque, modele, annee, etat)
            else:
                key = (product.get('name', '').lower().strip(), annee, etat)

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

    # ================================================================
    # HELPERS
    # ================================================================

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r'\s*[-–]\s*Laval\s*Moto.*$', '', name, flags=re.I)
        name = re.sub(
            r'\s+(?:en\s+vente|neuf|usag[ée]+|occasion|à\s+vendre)'
            r'(?:\s+[àa]\s+[\w\s-]+)?$',
            '', name, flags=re.I
        )
        name = re.sub(r'\s+[àa]\s+Laval\s*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
