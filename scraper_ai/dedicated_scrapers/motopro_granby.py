"""
Scraper dédié pour MotoPro Granby (Next.js + PowerGO CDN).

Concessionnaire motos, VTT, côtes-à-côtes, motoneiges, motomarines,
Argo et produits mécaniques situé à Granby, QC (Estrie).

Stratégie sitemap + détail :
  1. 2 sitemaps (inventory-detail.xml + showroom-detail.xml)
     → découverte de TOUTES les URLs produits
  2. Pages détail (parallèle) → JSON-LD Vehicle + specs HTML (li.spec-*)

Le site est Next.js (React SSR) avec le backend PowerGO.
Le JSON-LD Vehicle fournit la majorité des données structurées.
Les specs HTML (li.spec-*) complètent avec des champs supplémentaires.

Les URLs contiennent l'état du véhicule (/neuf/ vs /usage/) et le
type de véhicule (/vtt/, /motocyclette/, /cote-a-cote/, etc.).

Marques : Kawasaki, CFMOTO, Argo, Adly.

Types de produits : Motocyclette, VTT, Côte à côte, Motoneige,
Motomarine, Argo, Produit mécanique, Scooter.
"""
import re
import json
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class MotoProGranbyScraper(DedicatedScraper):

    SITE_NAME = "MotoPro Granby"
    SITE_SLUG = "motopro-granby"
    SITE_URL = "https://www.motoprogranby.com/fr/"
    SITE_DOMAIN = "motoprogranby.com"

    SITEMAPS = {
        'inventory': 'https://www.motoprogranby.com/sitemaps/inventory-detail.xml',
        'showroom': 'https://www.motoprogranby.com/sitemaps/showroom-detail.xml',
    }

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    SEL_SPEC_VALUE = 'span.font-bold'

    _TYPE_MAP_FR = {
        'motocyclette': 'Motocyclette',
        'vtt': 'VTT',
        'cote-a-cote': 'Côte à côte',
        'motomarine': 'Motomarine',
        'motoneige': 'Motoneige',
        'argo': 'Argo',
        'produit-mecanique': 'Produit mécanique',
        'scooter': 'Scooter',
    }

    _TYPE_MAP_EN = {
        'motorcycle': 'Motocyclette',
        'atv': 'VTT',
        'side-by-side': 'Côte à côte',
        'watercraft': 'Motomarine',
        'snowmobile': 'Motoneige',
        'argo': 'Argo',
        'power-equipment': 'Produit mécanique',
        'scooter': 'Scooter',
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
    # PHASE 1 : DÉCOUVERTE DES URLs VIA SITEMAPS
    # ================================================================

    def _discover_urls_from_sitemaps(self, categories: List[str]) -> Dict[str, List[str]]:
        """Parse les 2 sitemaps et trie les URLs par catégorie.

        On priorise les URLs françaises (/fr/) pour la cohérence.
        Les sitemaps contiennent des URLs FR et EN — on déduplique.
        """
        want_inventory = any(c in ('inventaire', 'occasion', 'neuf') for c in categories)
        want_catalog = any(c in ('catalogue', 'catalog') for c in categories)

        url_map: Dict[str, List[str]] = {}
        seen_stocks: Dict[str, str] = {}
        seen_showroom: Dict[str, str] = {}

        if want_inventory:
            urls = self._parse_sitemap(self.SITEMAPS['inventory'])
            for raw_url in urls:
                if self.SITE_DOMAIN not in raw_url:
                    continue
                if not self._is_inventory_url(raw_url):
                    continue

                stock = self._extract_stock_from_url(raw_url)
                is_fr = '/fr/' in raw_url

                if stock and stock in seen_stocks:
                    if is_fr and '/en/' in seen_stocks[stock]:
                        self._remove_url_from_map(url_map, seen_stocks[stock])
                    else:
                        continue

                is_used = '/usage/' in raw_url or '/used/' in raw_url
                cat_key = 'occasion' if is_used else 'inventaire'
                url_map.setdefault(cat_key, []).append(raw_url)
                if stock:
                    seen_stocks[stock] = raw_url

        if want_catalog:
            urls = self._parse_sitemap(self.SITEMAPS['showroom'])
            for raw_url in urls:
                if self.SITE_DOMAIN not in raw_url:
                    continue

                slug = self._extract_slug(raw_url)
                is_fr = '/fr/' in raw_url

                if slug and slug in seen_showroom:
                    if is_fr and '/en/' in seen_showroom[slug]:
                        self._remove_url_from_map(url_map, seen_showroom[slug])
                    else:
                        continue

                url_map.setdefault('catalogue', []).append(raw_url)
                if slug:
                    seen_showroom[slug] = raw_url

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
            for match in re.finditer(r'<loc>(https?://[^<]+)</loc>', resp.text):
                urls.append(match.group(1))

        return urls

    @staticmethod
    def _is_inventory_url(url: str) -> bool:
        url_lower = url.lower()
        if '/fr/' in url_lower:
            return '/inventaire/' in url_lower and 'a-vendre-' in url_lower
        if '/en/' in url_lower:
            return '/inventory/' in url_lower and 'for-sale-' in url_lower
        return False

    @staticmethod
    def _extract_stock_from_url(url: str) -> Optional[str]:
        match = re.search(r'(?:a-vendre|for-sale)-([a-zA-Z0-9_-]+)/?$', url)
        if match:
            return match.group(1).lower()
        return None

    @staticmethod
    def _extract_slug(url: str) -> Optional[str]:
        path = urlparse(url).path.strip('/')
        parts = path.split('/')
        if len(parts) >= 2:
            return parts[-1].lower()
        return None

    @staticmethod
    def _remove_url_from_map(url_map: Dict[str, List[str]], url: str) -> None:
        for key in url_map:
            try:
                url_map[key].remove(url)
            except ValueError:
                pass

    # ================================================================
    # PHASE 2 : EXTRACTION DEPUIS LES PAGES DÉTAIL
    # ================================================================

    def _extract_from_detail_pages(self, url_map: Dict[str, List[str]]) -> List[Dict]:
        tasks: List[tuple] = []
        for cat_key, urls in url_map.items():
            etat = 'occasion' if cat_key == 'occasion' else 'neuf'
            source_cat = 'vehicules_occasion' if cat_key == 'occasion' else cat_key
            for url in urls:
                tasks.append((url, etat, source_cat))

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

                if processed % 100 == 0 or processed == total:
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

            resp.encoding = resp.apparent_encoding or 'utf-8'
            soup = BeautifulSoup(resp.text, 'lxml')
            product: Dict[str, Any] = {
                'sourceUrl': resp.url,
                'sourceSite': self.SITE_URL,
                'etat': etat,
                'sourceCategorie': source_cat,
                'quantity': 1,
            }

            self._extract_json_ld(soup, product)
            self._extract_html_specs(soup, product)

            h1 = soup.select_one('h1')
            raw_title = h1.get_text(strip=True) if h1 else ''
            if raw_title:
                meta = self._detect_name_metadata(raw_title)
                if meta.get('etat'):
                    product['etat'] = meta['etat']
                if meta.get('kilometrage') and not product.get('kilometrage'):
                    product['kilometrage'] = meta['kilometrage']

            if not product.get('prix'):
                self._extract_price_fallback(soup, product)

            if not product.get('name'):
                if raw_title:
                    product['name'] = self._clean_name(raw_title)

            if not product.get('name'):
                parts = [product.get('marque', ''), product.get('modele', '')]
                if product.get('annee'):
                    parts.insert(0, str(product['annee']))
                name = ' '.join(p for p in parts if p)
                if name:
                    product['name'] = name

            if not product.get('name'):
                return None

            if not product.get('image'):
                self._extract_image_fallback(soup, url, product)

            if not product.get('description'):
                desc_el = soup.select_one('div.pg-vehicle-description .prose')
                if desc_el:
                    desc_text = desc_el.get_text(separator=' ', strip=True)
                    if desc_text and len(desc_text) > 10:
                        product['description'] = desc_text[:2000]

            if not product.get('vehicule_type'):
                vtype = self._extract_type_from_url(url)
                if vtype:
                    product['vehicule_type'] = vtype

            product['groupedUrls'] = [product['sourceUrl']]
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
                graph = data.get('@graph', [data] if '@type' in data else [])
                for item in graph:
                    if item.get('@type') != 'Vehicle':
                        continue

                    if item.get('name'):
                        out.setdefault('name', self._clean_name(item['name']))
                    if item.get('manufacturer'):
                        out.setdefault('marque', item['manufacturer'])
                    if item.get('model'):
                        out.setdefault('modele', item['model'])
                    if item.get('vehicleModelDate'):
                        try:
                            out.setdefault('annee', int(item['vehicleModelDate']))
                        except (ValueError, TypeError):
                            pass
                    if item.get('color'):
                        out.setdefault('couleur', item['color'])
                    if item.get('sku'):
                        out.setdefault('inventaire', item['sku'])

                    condition = item.get('itemCondition', '')
                    if 'NewCondition' in condition or '/new' in condition:
                        out.setdefault('etat', 'neuf')
                    elif 'UsedCondition' in condition or '/used' in condition:
                        out.setdefault('etat', 'occasion')

                    odometer = item.get('mileageFromOdometer')
                    if isinstance(odometer, dict) and odometer.get('value'):
                        try:
                            out.setdefault('kilometrage', int(odometer['value']))
                        except (ValueError, TypeError):
                            pass

                    offers = item.get('offers', {})
                    if isinstance(offers, list) and offers:
                        offers = offers[0]
                    if isinstance(offers, dict) and offers.get('price'):
                        try:
                            price = float(offers['price'])
                            if price > 0:
                                out.setdefault('prix', price)
                        except (ValueError, TypeError):
                            pass

                    img = item.get('image')
                    if isinstance(img, list) and img:
                        img = img[0]
                    if isinstance(img, str) and img.startswith('http'):
                        out.setdefault('image', img)
                    elif isinstance(img, dict) and img.get('url', '').startswith('http'):
                        out.setdefault('image', img['url'])

                    desc = item.get('description', '')
                    if desc and len(desc) > 10:
                        out.setdefault('description', desc[:2000])

                    break
            except (json.JSONDecodeError, TypeError, KeyError, ValueError):
                continue

    def _extract_html_specs(self, soup: BeautifulSoup, out: Dict) -> None:
        spec_map = {
            'spec-make': 'marque',
            'spec-model': 'modele',
            'spec-year': 'annee',
            'spec-color': 'couleur',
            'spec-vin': 'vin',
            'spec-stock-number': 'inventaire',
            'spec-type': 'vehicule_type',
            'spec-category': 'vehicule_categorie',
            'spec-condition': '_condition',
            'spec-submodel': 'vehicule_sous_modele',
            'spec-trim': 'finition',
            'spec-usage': 'kilometrage',
        }

        for selector, field in spec_map.items():
            el = soup.select_one(f'li.{selector}')
            if not el:
                continue

            value_el = el.select_one(self.SEL_SPEC_VALUE)
            if not value_el:
                continue

            text = value_el.get_text(strip=True)
            if not text or text in ('-', 'N/A', '', 'null'):
                continue

            if field == '_condition':
                tl = text.lower()
                if 'neuf' in tl or 'new' in tl:
                    out.setdefault('etat', 'neuf')
                elif 'usag' in tl or 'used' in tl:
                    out.setdefault('etat', 'occasion')
                elif 'démo' in tl or 'demo' in tl:
                    out.setdefault('etat', 'demonstrateur')
                continue

            if field == 'annee':
                parsed = self.clean_year(text)
                if parsed:
                    out.setdefault(field, parsed)
            elif field == 'kilometrage':
                parsed = self.clean_mileage(text)
                if parsed is not None:
                    out.setdefault(field, parsed)
            else:
                out.setdefault(field, text)

    def _extract_price_fallback(self, soup: BeautifulSoup, out: Dict) -> None:
        price_el = soup.select_one(
            'div.pg-vehicle-price, div.pg-vehicle-mobile-price, '
            'div.pg-vehicle-desktop-price, [class*="price"]'
        )
        if not price_el:
            return

        sale_el = price_el.select_one('.text-sale, .text-red, s, del, [class*="original"]')
        if sale_el:
            original_price = self.clean_price(sale_el.get_text(strip=True))
            if original_price:
                out.setdefault('prix_original', original_price)

        price_text = price_el.get_text(strip=True)
        price_text = re.sub(r'(?:Save|Économisez|Rabais)\s*\$?\s*[\d,.\s]+', '', price_text, flags=re.I)
        parsed = self.clean_price(price_text)
        if parsed:
            out.setdefault('prix', parsed)

    def _extract_image_fallback(self, soup: BeautifulSoup, url: str, out: Dict) -> None:
        img = soup.select_one(
            'img.pg-vehicle-image, .pg-vehicle-gallery img, '
            'img[src*="cdn.powergo.ca"], img[srcset*="cdn.powergo.ca"]'
        )
        if img:
            src = img.get('src') or img.get('data-src', '')
            if not src:
                srcset = img.get('srcset', '')
                if srcset:
                    src = srcset.split(',')[0].split()[0]
            if src and src.startswith('http'):
                out['image'] = src

    # ================================================================
    # DÉTECTION ÉTAT / KM DEPUIS LE TITRE
    # ================================================================

    @staticmethod
    def _detect_name_metadata(raw_name: str) -> Dict[str, Any]:
        meta: Dict[str, Any] = {}
        lower = raw_name.lower()

        if re.search(r'\b(d[ée]monstrateur|d[ée]mo|demo)\b', lower):
            meta['etat'] = 'demonstrateur'
        elif re.search(r'\blocation\b', lower):
            meta['etat'] = 'occasion'
        elif re.search(r'\busag[ée]e?\b', lower):
            meta['etat'] = 'occasion'

        km_match = re.search(r'\b(\d[\d\s]*)\s*km\b', lower)
        if km_match:
            km_str = km_match.group(1).replace(' ', '')
            try:
                km_val = int(km_str)
                if km_val > 0:
                    meta['kilometrage'] = km_val
                    if 'etat' not in meta:
                        meta['etat'] = 'occasion'
            except ValueError:
                pass

        return meta

    # ================================================================
    # HELPERS
    # ================================================================

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        path = urlparse(url).path.lower()
        for slug, label in self._TYPE_MAP_FR.items():
            if f'/{slug}/' in path:
                return label
        for slug, label in self._TYPE_MAP_EN.items():
            if f'/{slug}/' in path:
                return label
        return None

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
        self._extract_json_ld(soup, out)
        self._extract_html_specs(soup, out)
        h1 = soup.select_one('h1')
        if h1:
            out.setdefault('name', self._clean_name(h1.get_text(strip=True)))
        return out if out else None

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

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r'\s*[-–|]\s*MotoPro\s*Granby.*$', '', name, flags=re.I)
        name = re.sub(
            r'\s+(?:en\s+vente|neuf|usag[ée]+|occasion|à\s+vendre)'
            r'(?:\s+[àa]\s+[\w\s-]+)?$',
            '', name, flags=re.I
        )
        name = re.sub(r'\s+[àa]\s+Granby\s*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
