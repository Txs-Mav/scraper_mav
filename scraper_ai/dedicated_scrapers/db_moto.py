"""
Scraper dédié pour DB Moto (dbmoto.ca).

Site WordPress + Yoast SEO + PowerGO CDN (cdn.powergo.ca).
Concessionnaire Kawasaki, CFMOTO, Arctic Cat, Textron à Ste-Julienne et Châteauguay.

Stratégie REST API + détail:
  1. Découverte via API REST WordPress (fiable, pas de dépendance aux sitemaps):
     - Catalogue: CPTs motorcycle, atv, side-by-side, snowmobile, watercraft, electric-bike, boat
     - Inventaire: CPT inventory (fallback sitemap XML si REST échoue)
  2. Pages détail (parallèle, rate-limit-aware):
     - Catalogue: JSON-LD Vehicle (schema.org) propre
     - Inventaire: JSON-LD Vehicle (parfois cassé) + specs HTML (li.make, li.model, etc.)

URL patterns:
  - Catalogue: /fr/{type}/{marque-modele-couleur-annee}/
  - Inventaire: /fr/inventaire/{type}-{details}-a-vendre-{slug}/
"""
import re
import json
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

from .base import DedicatedScraper


CATALOGUE_CPTS = {
    'motorcycle': 'Motocyclette',
    'atv': 'VTT',
    'side-by-side': 'Côte à côte',
    'snowmobile': 'Motoneige',
    'watercraft': 'Motomarine',
    'electric-bike': 'Vélo électrique',
    'boat': 'Bateau',
}

INVENTORY_CPT = 'inventory'

_COLOR_WORDS = {
    'blanc', 'noir', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'rose', 'violet',
    'gris', 'argent', 'or', 'bronze', 'beige', 'marron', 'brun', 'turquoise',
    'kaki', 'sable', 'ivoire', 'creme',
    'brillant', 'mat', 'metallise', 'metallique', 'perle', 'nacre', 'satin', 'chrome', 'carbone',
    'fonce', 'clair', 'fluo', 'neon',
    'ebene', 'graphite', 'anthracite', 'platine', 'titane', 'cuivre', 'acier', 'cobalt',
    'combat', 'lime', 'sauge', 'cristal', 'obsidian',
    'etincelle', 'velocite', 'bonbon', 'diablo', 'champagne', 'phantom', 'fantome',
    'nebuleux', 'nebuleuse',
    'white', 'black', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
    'gray', 'grey', 'silver', 'gold', 'brown', 'matte', 'glossy', 'pearl', 'carbon',
    'dark', 'light', 'bright', 'midnight', 'cosmic', 'storm', 'candy',
    'ivory', 'charcoal', 'titanium', 'copper', 'steel', 'platinum',
}


class DBMotoScraper(DedicatedScraper):

    SITE_NAME = "DB Moto"
    SITE_SLUG = "db-moto"
    SITE_URL = "https://www.dbmoto.ca/fr/"
    SITE_DOMAIN = "dbmoto.ca"

    SITEMAP_INDEX_URL = "https://www.dbmoto.ca/sitemap.xml"
    SITEMAP_BASE = "https://www.dbmoto.ca/fr/"

    WORKERS = 6
    DETAIL_TIMEOUT = 15
    REQUEST_DELAY = 0.15

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

        url_map = self._discover_all_urls(categories)

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
            products = [p for p in products if p.get(
                'sourceCategorie') != 'catalogue']

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

    def _discover_all_urls(self, categories: List[str]) -> Dict[str, List[str]]:
        """Découvre TOUTES les URLs produits.

        Catalogue : API REST WordPress (CPTs motorcycle, atv, etc.).
        Inventaire : API REST WordPress (CPT inventory), fallback sitemap XML.
        """
        url_map: Dict[str, List[str]] = {}

        want_catalogue = 'catalogue' in categories
        want_inventaire = 'inventaire' in categories

        if want_catalogue:
            catalogue_urls = self._discover_catalogue_via_rest()
            if catalogue_urls:
                url_map['catalogue'] = catalogue_urls

        if want_inventaire:
            inv_urls = self._discover_inventory_via_rest()
            if not inv_urls:
                print("   ⚠️ API REST inventaire 0 résultat — fallback sitemap")
                sitemap_url = f"{self.SITEMAP_BASE}inventory-sitemap.xml"
                inv_urls = self._fetch_sitemap_urls(sitemap_url)
            if inv_urls:
                url_map['inventaire'] = inv_urls

        return url_map

    def _discover_inventory_via_rest(self) -> List[str]:
        """Découvre les URLs inventaire via l'API REST WordPress (CPT inventory)."""
        all_urls: List[str] = []
        rest_base = "https://www.dbmoto.ca/wp-json/wp/v2"
        page = 1

        while True:
            api_url = f"{rest_base}/{INVENTORY_CPT}?per_page=100&page={page}&_fields=link"
            items = self._rest_get_with_retry(api_url)
            if items is None:
                print(f"   ⚠️ [inventory] API REST échoué page {page}")
                break
            if not items:
                break
            for item in items:
                link = item.get('link', '')
                if link:
                    all_urls.append(link.rstrip('/'))
            total_pages = self._last_rest_total_pages or 1
            if page >= total_pages:
                break
            page += 1

        if all_urls:
            print(f"   📋 [inventory] {len(all_urls)} URLs inventaire (REST API)")
        return all_urls

    def _discover_catalogue_via_rest(self) -> List[str]:
        """Découvre les URLs catalogue via l'API REST WordPress (fiable et complet)."""
        all_urls: List[str] = []
        rest_base = "https://www.dbmoto.ca/wp-json/wp/v2"

        for cpt, vtype in CATALOGUE_CPTS.items():
            page = 1
            cat_count = 0
            while True:
                api_url = f"{rest_base}/{cpt}?per_page=100&page={page}&_fields=link"
                items = self._rest_get_with_retry(api_url)
                if items is None:
                    print(f"   ⚠️ [{cpt}] API REST échoué page {page}")
                    break
                if not items:
                    break
                for item in items:
                    link = item.get('link', '')
                    if link:
                        all_urls.append(link.rstrip('/'))
                        cat_count += 1
                total_pages = self._last_rest_total_pages or 1
                if page >= total_pages:
                    break
                page += 1

            if cat_count:
                print(f"   📋 [{cpt}] {cat_count} URLs catalogue")

        if not all_urls:
            print("   ⚠️ API REST 0 résultat — fallback sitemap catalogue")
            all_urls = self._discover_catalogue_via_sitemaps()

        return all_urls

    _last_rest_total_pages: int = 1

    def _rest_get_with_retry(self, url: str, max_retries: int = 3) -> Optional[list]:
        """GET avec retry et backoff pour l'API REST WP."""
        self._last_rest_total_pages = 1
        for attempt in range(max_retries):
            try:
                resp = self.session.get(url, timeout=20)
                if resp.status_code == 200:
                    try:
                        self._last_rest_total_pages = int(
                            resp.headers.get('X-WP-TotalPages', '1'))
                    except (ValueError, TypeError):
                        pass
                    return resp.json()
                if resp.status_code in (429, 503):
                    wait = 2 ** (attempt + 1)
                    print(
                        f"      ⏳ Rate limit ({resp.status_code}), retry dans {wait}s...")
                    time.sleep(wait)
                    continue
                return None
            except Exception as e:
                if attempt < max_retries - 1:
                    wait = 2 ** attempt
                    print(f"      ⏳ Erreur REST ({e}), retry dans {wait}s...")
                    time.sleep(wait)
                else:
                    print(
                        f"      ❌ REST échoué après {max_retries} tentatives: {e}")
        return None

    def _discover_catalogue_via_sitemaps(self) -> List[str]:
        """Fallback : découverte catalogue via sitemaps (filtre les 404)."""
        sitemap_slugs = {
            'motorcycle': 'Motocyclette', 'atv': 'VTT',
            'side-by-side': 'Côte à côte', 'snowmobile': 'Motoneige',
            'watercraft': 'Motomarine', 'electric-bike': 'Vélo électrique',
            'boat': 'Bateau',
        }
        all_urls: List[str] = []
        for slug in sitemap_slugs:
            sitemap_url = f"{self.SITEMAP_BASE}{slug}-sitemap.xml"
            urls = self._fetch_sitemap_urls(sitemap_url)
            all_urls.extend(urls)
        print(
            f"   📋 Sitemap fallback: {len(all_urls)} URLs catalogue (non vérifiées)")
        return all_urls

    def _fetch_sitemap_urls(self, sitemap_url: str) -> List[str]:
        try:
            resp = self.session.get(sitemap_url, timeout=15)
            if resp.status_code != 200:
                return []
        except Exception:
            return []

        soup = BeautifulSoup(resp.text, 'xml')
        urls = []
        for url_tag in soup.find_all('url'):
            loc = url_tag.find('loc')
            if loc:
                raw = loc.text.strip()
                if '/fr/' in raw:
                    urls.append(raw)
        return urls

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
        self._consecutive_errors = 0

        print(
            f"\n   🔍 Extraction: {total} pages détail ({workers} workers, "
            f"delay {self.REQUEST_DELAY}s)...")

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._fetch_and_parse_detail, url, cat_key): (url, cat_key)
                for url, cat_key in tasks
            }

            processed = 0
            failed_for_retry: List[tuple] = []

            try:
                for future in as_completed(futures, timeout=900):
                    processed += 1
                    url, cat_key = futures[future]
                    try:
                        product = future.result(timeout=self.DETAIL_TIMEOUT + 5)
                        if product:
                            products.append(product)
                            self._consecutive_errors = 0
                        elif product is None:
                            errors += 1
                            self._consecutive_errors += 1
                            failed_for_retry.append((url, cat_key))
                    except Exception:
                        errors += 1
                        self._consecutive_errors += 1
                        failed_for_retry.append((url, cat_key))

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

        # Retry des pages échouées (max 100, séquentiel avec délai)
        if failed_for_retry:
            retry_batch = failed_for_retry[:100]
            print(f"\n      🔄 Retry: {len(retry_batch)} pages échouées (séquentiel)...")
            retry_ok = 0
            for url, cat_key in retry_batch:
                time.sleep(0.3)
                try:
                    product = self._fetch_and_parse_detail(url, cat_key)
                    if product:
                        products.append(product)
                        retry_ok += 1
                        errors -= 1
                except Exception:
                    pass
            if retry_ok:
                print(f"      ✅ Retry: {retry_ok}/{len(retry_batch)} récupérés")

        print(f"      ✅ {len(products)}/{total} produits extraits "
              f"({errors} erreurs)")
        return products

    def _fetch_and_parse_detail(self, url: str, cat_key: str) -> Optional[Dict]:
        time.sleep(self.REQUEST_DELAY)

        try:
            resp = self.session.get(
                url, timeout=self.DETAIL_TIMEOUT, allow_redirects=True)

            if resp.status_code == 429 or resp.status_code == 503:
                wait = min(2 ** getattr(self, '_consecutive_errors', 1), 10)
                print(f"      ⏳ Rate limit ({resp.status_code}) sur {url[-40:]}, "
                      f"pause {wait}s...")
                time.sleep(wait)
                resp = self.session.get(
                    url, timeout=self.DETAIL_TIMEOUT, allow_redirects=True)

            if resp.status_code == 404:
                return None

            if resp.status_code != 200:
                print(f"      ⚠️ HTTP {resp.status_code} sur {url[-50:]}")
                return None

            soup = BeautifulSoup(resp.text, 'lxml')
            is_inventory = cat_key == 'inventaire'

            product: Dict[str, Any] = {
                'sourceUrl': resp.url,
                'sourceSite': self.SITE_URL,
                'quantity': 1,
            }

            if is_inventory:
                product['sourceCategorie'] = 'inventaire'
            else:
                product['sourceCategorie'] = 'catalogue'
                product['etat'] = 'neuf'

            self._extract_json_ld_vehicle(soup, product)
            if is_inventory:
                self._extract_html_specs(soup, product)

            self._extract_price(soup, product)

            if not product.get('name'):
                h1 = soup.select_one('h1')
                if h1:
                    product['name'] = self._clean_name(h1.get_text(strip=True))

            if not product.get('name'):
                parts = [product.get('marque', ''), product.get('modele', '')]
                if product.get('annee'):
                    parts.append(str(product['annee']))
                name = ' '.join(p for p in parts if p)
                if name:
                    product['name'] = name

            if not product.get('name'):
                return None

            self._extract_image(soup, product, url)

            if not product.get('vehicule_type'):
                vtype = self._extract_type_from_url(url)
                if vtype:
                    product['vehicule_type'] = vtype

            self._extract_description(soup, product)
            self._strip_colors(product)

            product['groupedUrls'] = [product['sourceUrl']]

            return product

        except requests.exceptions.Timeout:
            print(f"      ⏱️ Timeout {self.DETAIL_TIMEOUT}s sur {url[-50:]}")
            return None
        except requests.exceptions.ConnectionError:
            print(f"      🔌 Connexion refusée sur {url[-50:]}")
            return None
        except Exception as e:
            print(f"      ❌ Erreur inattendue sur {url[-50:]}: {type(e).__name__}")
            return None

    # ================================================================
    # EXTRACTEURS DE DONNÉES
    # ================================================================

    def _extract_json_ld_vehicle(self, soup: BeautifulSoup, out: Dict) -> None:
        for script in soup.find_all('script', type='application/ld+json'):
            text = script.string or ''
            if 'Vehicle' not in text:
                continue

            text = re.sub(r',\s*}', '}', text)
            text = re.sub(r',\s*]', ']', text)
            text = re.sub(r'[\x00-\x1f]', ' ', text)

            try:
                data = json.loads(text)
            except (json.JSONDecodeError, TypeError):
                continue

            items = data.get('@graph', [data] if '@type' in data else [])
            for item in items:
                if item.get('@type') != 'Vehicle':
                    continue

                if item.get('name'):
                    out.setdefault('name', self._clean_name(item['name']))
                if item.get('manufacturer'):
                    out.setdefault('marque', item['manufacturer'])
                brand = item.get('brand')
                if isinstance(brand, dict) and brand.get('name'):
                    out.setdefault('marque', brand['name'])
                elif isinstance(brand, str) and brand:
                    out.setdefault('marque', brand)
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
                if 'NewCondition' in str(condition):
                    out.setdefault('etat', 'neuf')
                elif 'UsedCondition' in str(condition):
                    out.setdefault('etat', 'occasion')

                odometer = item.get('mileageFromOdometer')
                if isinstance(odometer, dict) and odometer.get('value'):
                    try:
                        out.setdefault('kilometrage', int(odometer['value']))
                    except (ValueError, TypeError):
                        pass

                offers = item.get('offers', {})
                if isinstance(offers, dict) and offers.get('price'):
                    try:
                        out.setdefault('prix', float(offers['price']))
                    except (ValueError, TypeError):
                        pass

                imgs = item.get('image', [])
                if isinstance(imgs, str) and imgs.startswith('http'):
                    out.setdefault('image', imgs)
                elif isinstance(imgs, list):
                    for img in imgs:
                        if isinstance(img, str) and img.startswith('http'):
                            out.setdefault('image', img)
                            break
                elif isinstance(imgs, dict) and imgs.get('url', '').startswith('http'):
                    out.setdefault('image', imgs['url'])

                break

    def _extract_html_specs(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait les specs depuis les li.{class} des pages inventaire."""
        spec_map = {
            'li.make': 'marque',
            'li.model': 'modele',
            'li.year': 'annee',
            'li.color': 'couleur',
            'li.vin': 'vin',
            'li.stock': 'inventaire',
            'li.type': 'vehicule_type',
            'li.km': 'kilometrage',
        }

        for selector, field in spec_map.items():
            el = soup.select_one(selector)
            if not el:
                continue

            label_el = el.select_one('span.label')
            if label_el:
                label_el.extract()
            text = el.get_text(strip=True)
            if not text or text in ('-', 'N/A', '', 'null'):
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

        cond_el = soup.select_one('li.condition')
        if cond_el:
            cond_text = cond_el.get_text(strip=True).lower()
            if 'occasion' in cond_text or ("usag" in cond_text and 'neuf' not in cond_text):
                out['etat'] = 'occasion'
            elif 'demo' in cond_text or 'démo' in cond_text:
                out['etat'] = 'demonstrateur'
            elif 'neuf' in cond_text or 'new' in cond_text:
                out['etat'] = 'neuf'
                out.pop('kilometrage', None)
        else:
            body = soup.select_one('body')
            body_cls = ' '.join(body.get('class', [])) if body else ''
            if 'is-new-inventory' in body_cls:
                out.setdefault('etat', 'neuf')
                out.pop('kilometrage', None)
            elif 'is-used' in body_cls and 'is-new-inventory' not in body_cls:
                out.setdefault('etat', 'occasion')

        cat_el = soup.select_one('li.category')
        if cat_el:
            label_el = cat_el.select_one('span.label')
            if label_el:
                label_el.extract()
            cat_text = cat_el.get_text(strip=True)
            if cat_text:
                cat_map = {
                    'motocyclettes': 'Motocyclette',
                    'motocyclette': 'Motocyclette',
                    'vtt': 'VTT',
                    'côtes-à-côtes': 'Côte à côte',
                    'cote-a-cote': 'Côte à côte',
                    'motoneiges': 'Motoneige',
                    'motoneige': 'Motoneige',
                    'motomarines': 'Motomarine',
                    'motomarine': 'Motomarine',
                    'bateaux': 'Bateau',
                    'vélos électriques': 'Vélo électrique',
                }
                normalized = cat_map.get(cat_text.lower().strip())
                if normalized:
                    out.setdefault('vehicule_type', normalized)

    def _extract_price(self, soup: BeautifulSoup, out: Dict) -> None:
        if out.get('prix'):
            return

        price_section = soup.select_one(
            'section#product-price, section.price-financing')
        if price_section:
            price_div = price_section.select_one('div.price, .price')
            if price_div:
                price_text = price_div.get_text(strip=True)
                parsed = self.clean_price(price_text)
                if parsed:
                    out['prix'] = parsed
                    return

        og_desc = soup.select_one('meta[property="og:description"]')
        if og_desc:
            desc = og_desc.get('content', '')
            m = re.search(r'(\d[\d\s,.]*)\s*\$', desc)
            if m:
                parsed = self.clean_price(m.group(1))
                if parsed:
                    out['prix'] = parsed

    def _extract_image(self, soup: BeautifulSoup, out: Dict, url: str) -> None:
        if out.get('image'):
            return

        photos = soup.select_one('section.photos, section#product-photos')
        if photos:
            img = photos.select_one('img[src*="powergo"], img[src*="dbmoto"]')
            if img:
                src = img.get('src', '')
                if src:
                    out['image'] = src if src.startswith(
                        'http') else urljoin(url, src)
                    return

        gallery = soup.select_one('.gallery, .slider')
        if gallery:
            img = gallery.select_one('img')
            if img:
                src = img.get('src') or img.get('data-src', '')
                if src and ('powergo' in src or 'dbmoto' in src):
                    out['image'] = src if src.startswith(
                        'http') else urljoin(url, src)
                    return

        og_img = soup.select_one('meta[property="og:image"]')
        if og_img:
            content = og_img.get('content', '')
            if content and content.startswith('http'):
                out['image'] = content

    def _extract_description(self, soup: BeautifulSoup, out: Dict) -> None:
        if out.get('description'):
            return

        desc_section = soup.select_one(
            'section#product-description, section.description')
        if desc_section:
            prose = desc_section.select_one('.text, .reset-text, p')
            if prose:
                desc_text = prose.get_text(separator=' ', strip=True)
                if desc_text and len(desc_text) > 10:
                    out['description'] = desc_text[:2000]
                    return

        og_desc = soup.select_one('meta[property="og:description"]')
        if og_desc:
            content = og_desc.get('content', '')
            if content and len(content) > 10:
                out['description'] = content[:2000]

    def _detect_etat_from_body(self, soup: BeautifulSoup, out: Dict) -> None:
        body = soup.select_one('body')
        if not body:
            return
        classes = ' '.join(body.get('class', []))
        if 'is-new-inventory' in classes:
            out.setdefault('etat', 'neuf')
        elif 'is-used' in classes and 'is-new-inventory' not in classes:
            out.setdefault('etat', 'occasion')

    # ================================================================
    # NETTOYAGE DES COULEURS
    # ================================================================

    @staticmethod
    def _normalize_word(word: str) -> str:
        import unicodedata
        w = word.lower()
        return ''.join(
            c for c in unicodedata.normalize('NFKD', w)
            if not unicodedata.category(c).startswith('M')
        )

    def _strip_colors(self, product: Dict) -> None:
        """Retire les couleurs de name et modele (l'info reste dans le champ couleur)."""
        couleur_raw = product.get('couleur', '')

        if couleur_raw:
            couleur_words = {self._normalize_word(
                w) for w in couleur_raw.split() if w}
        else:
            couleur_words = set()

        words_to_strip = _COLOR_WORDS | couleur_words

        for field in ('name', 'modele'):
            val = product.get(field, '')
            if not val:
                continue
            tokens = val.split()
            kept = [t for t in tokens if self._normalize_word(
                t) not in words_to_strip]
            cleaned = ' '.join(kept).strip()
            cleaned = re.sub(r'\s+', ' ', cleaned)
            if cleaned:
                product[field] = cleaned

    # ================================================================
    # HELPERS
    # ================================================================

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        path = urlparse(url).path.lower()

        if '/inventaire/' in path:
            inv_type_map = {
                'motocyclettes-': 'Motocyclette',
                'vtt-': 'VTT',
                'cotes-a-cotes-': 'Côte à côte',
                'motoneiges-': 'Motoneige',
                'motomarines-': 'Motomarine',
                'bateaux-': 'Bateau',
                'velos-electriques-': 'Vélo électrique',
            }
            segment = path.split('/inventaire/')[-1]
            for prefix, label in inv_type_map.items():
                if segment.startswith(prefix):
                    return label
            return None

        cat_type_map = {
            '/motocyclette/': 'Motocyclette',
            '/vtt/': 'VTT',
            '/cote-a-cote/': 'Côte à côte',
            '/motoneige/': 'Motoneige',
            '/motomarine/': 'Motomarine',
            '/bateau/': 'Bateau',
            '/velo-electrique/': 'Vélo électrique',
        }
        for slug, label in cat_type_map.items():
            if slug in path:
                return label
        return None

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r'\s*\*\*[^*]+\*\*\s*', ' ', name)
        name = re.sub(
            r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)
        name = re.sub(r'\s*(?:\||-|–)\s*DB\s*Moto.*$', '', name, flags=re.I)
        name = re.sub(r'\s+en\s+vente\s+.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'catalogue']
        url_map = self._discover_all_urls(categories)
        all_urls = []
        for urls in url_map.values():
            all_urls.extend(urls)
        seen = set()
        return [u for u in all_urls
                if u.rstrip('/').lower() not in seen and not seen.add(u.rstrip('/').lower())]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        out: Dict[str, Any] = {}
        self._extract_json_ld_vehicle(soup, out)
        self._extract_html_specs(soup, out)
        self._extract_price(soup, out)
        h1 = soup.select_one('h1')
        if h1:
            out.setdefault('name', self._clean_name(h1.get_text(strip=True)))
        self._extract_image(soup, out, url)
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
            couleur = product.get('couleur', '').lower().strip()

            if marque and modele:
                key = (marque, modele, annee, etat, couleur)
            else:
                key = (product.get('name', '').lower().strip(),
                       annee, etat, couleur)

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
