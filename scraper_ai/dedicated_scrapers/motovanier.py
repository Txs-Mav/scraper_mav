"""
Scraper dédié pour Moto Vanier (motovanier.ca).
Sélecteurs CSS hardcodés — aucun appel Gemini.

Stratégie hybride:
  1. Pages listing (PrestaShop pagination ?page=N) → nom, prix, km, image, URL
  2. Pages détail (parallèle) → marque, référence, specs techniques, couleur, état

Site: PrestaShop avec prix/km intégrés dans le HTML stylé (h1/h2)
Sections: /15-neufs (inventaire neuf), /14-occasions (véhicules usagés)
Marques: BMW, Ducati, Kawasaki, Triumph
"""
import re
import json
import math
import time
import random
import threading
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup, Tag

from .base import DedicatedScraper


class MotoVanierScraper(DedicatedScraper):

    SITE_NAME = "Moto Vanier"
    SITE_SLUG = "motovanier"
    SITE_URL = "https://motovanier.ca/"
    SITE_DOMAIN = "motovanier.ca"

    LISTING_PAGES = {
        'inventaire': {
            'url': 'https://motovanier.ca/15-neufs',
            'etat': 'neuf',
            'sourceCategorie': 'inventaire',
        },
        'occasion': {
            'url': 'https://motovanier.ca/14-occasions',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
    }

    PRODUCTS_PER_PAGE = 12
    WORKERS = 3
    LISTING_MAX_RETRIES = 5
    LISTING_RETRY_DELAY = 8

    SPEC_FIELD_MAP = {
        'cylindrée (cc)': 'cylindree',
        'cylindree (cc)': 'cylindree',
        'type de moteur': 'type_moteur',
        'nombre de cylindre(s)': 'nombre_cylindres',
        'système de refroidissement': 'refroidissement',
        "système d'alimentation d'essence": 'alimentation',
        'nombre de rapport(s) de la boîte de vitesses': 'transmission',
        'entraînement final': 'entrainement',
        'freinage': 'freinage',
        'hauteur de la selle (mm)': 'hauteur_selle',
        'capacité du réservoir à carburant (l)': 'reservoir',
        'poids (kg)': 'poids',
        'couleur(s)': 'couleur',
        'puissance': 'puissance',
        'autonomie': 'autonomie',
        'vitesse maximale': 'vitesse_max',
        'garantie (mois)': 'garantie',
    }

    DETAIL_MAX_RETRIES = 3
    DETAIL_RETRY_BASE_DELAY = 5

    def __init__(self):
        super().__init__()
        self._request_lock = threading.Lock()
        self._last_request_time = 0.0
        self._min_request_interval = 0.6
        self._session_warmed = False
        self._consecutive_403 = 0
        self._cooling_until = 0.0

    # ================================================================
    # PIPELINE PRINCIPAL (override)
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
    # PHASE 1: EXTRACTION DEPUIS LES PAGES LISTING
    # ================================================================

    def _extract_from_listings(self, categories: List[str]) -> List[Dict]:
        all_products = []
        seen_urls = set()

        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories and not any(c in cat_key for c in categories):
                continue

            print(f"\n   📋 [{cat_key}]: {config['url']}")
            products = self._load_all_listing_pages(config)

            fresh = []
            for p in products:
                url_norm = p.get('sourceUrl', '').rstrip('/').lower()
                if url_norm and url_norm not in seen_urls:
                    seen_urls.add(url_norm)
                    fresh.append(p)

            print(f"      ✅ {len(fresh)} produits extraits")
            all_products.extend(fresh)

        return all_products

    def _warm_session(self):
        """Visite la page d'accueil puis une page intermédiaire pour construire
        un profil de cookies réaliste avant de crawler les listings."""
        if self._session_warmed:
            return
        self.session.headers.update({
            'Referer': self.SITE_URL,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'DNT': '1',
            'Sec-CH-UA': '"Chromium";v="136", "Not A(Brand";v="99"',
            'Sec-CH-UA-Mobile': '?0',
            'Sec-CH-UA-Platform': '"Windows"',
        })
        warmup_urls = [
            self.SITE_URL,
            f"{self.SITE_URL}content/3-conditions-generales",
        ]
        for i, warmup_url in enumerate(warmup_urls):
            for attempt in range(3):
                try:
                    resp = self.session.get(warmup_url, timeout=15)
                    if resp.status_code == 200:
                        if i == 0:
                            print(f"      🍪 Session réchauffée (cookies PrestaShop)")
                        time.sleep(random.uniform(1.5, 3.0))
                        break
                    time.sleep(3 * (attempt + 1))
                except Exception:
                    time.sleep(3)
        self._session_warmed = True

    def _fetch_listing_with_retry(self, url: str) -> Optional[requests.Response]:
        """GET une page listing avec retry, backoff exponentiel et jitter."""
        self._warm_session()

        for attempt in range(1, self.LISTING_MAX_RETRIES + 1):
            try:
                resp = self.session.get(url, timeout=30)
                if resp.status_code == 200:
                    return resp
                retryable = resp.status_code >= 500 or resp.status_code == 403
                if retryable and attempt < self.LISTING_MAX_RETRIES:
                    wait = self.LISTING_RETRY_DELAY * (2 ** (attempt - 1)) + random.uniform(2, 6)
                    print(f"      ⏳ HTTP {resp.status_code} — nouvelle tentative dans {wait:.0f}s ({attempt}/{self.LISTING_MAX_RETRIES})")
                    time.sleep(wait)
                    continue
                print(f"      ⚠️ HTTP {resp.status_code} pour {url}")
                return None
            except requests.exceptions.RequestException as e:
                if attempt < self.LISTING_MAX_RETRIES:
                    wait = self.LISTING_RETRY_DELAY * (2 ** (attempt - 1)) + random.uniform(2, 6)
                    print(f"      ⏳ Erreur réseau — nouvelle tentative dans {wait:.0f}s ({attempt}/{self.LISTING_MAX_RETRIES})")
                    time.sleep(wait)
                else:
                    print(f"      ⚠️ Erreur après {self.LISTING_MAX_RETRIES} tentatives: {e}")
                    return None
        return None

    def _load_all_listing_pages(self, config: Dict) -> List[Dict]:
        listing_url = config['url']
        etat = config['etat']
        source_cat = config['sourceCategorie']
        all_products = []

        resp = self._fetch_listing_with_retry(listing_url)
        if not resp:
            return []

        try:
            soup = BeautifulSoup(resp.text, 'lxml')

            total_products = self._parse_total_products(soup)
            total_pages = math.ceil(total_products / self.PRODUCTS_PER_PAGE) if total_products > 0 else 1
            print(f"      📊 {total_products} produits, {total_pages} page(s)")

            page1_products = self._parse_listing_html(resp.text, etat, source_cat)
            all_products.extend(page1_products)

            for page in range(2, total_pages + 1):
                page_url = f"{listing_url}?page={page}"
                time.sleep(random.uniform(1.0, 2.5))
                try:
                    resp_p = self._fetch_listing_with_retry(page_url)
                    if not resp_p:
                        break
                    products_p = self._parse_listing_html(resp_p.text, etat, source_cat)
                    all_products.extend(products_p)
                except Exception:
                    break

        except Exception as e:
            print(f"      ⚠️ Erreur: {e}")

        return all_products

    def _parse_total_products(self, soup: BeautifulSoup) -> int:
        total_el = soup.select_one('.total-products')
        if total_el:
            match = re.search(r'(\d+)\s+produit', total_el.get_text())
            if match:
                return int(match.group(1))
        return 0

    def _parse_listing_html(self, html: str, etat: str, source_cat: str) -> List[Dict]:
        soup = BeautifulSoup(html, 'lxml')
        products = []

        for article in soup.select('article.product-miniature'):
            product = self._parse_listing_article(article, etat, source_cat)
            if product and product.get('name') and product.get('sourceUrl'):
                products.append(product)

        return products

    def _parse_listing_article(self, article: Tag, etat: str, source_cat: str) -> Optional[Dict]:
        product: Dict[str, Any] = {}

        title_a = article.select_one('h3.product-title a')
        if not title_a:
            return None

        product['name'] = self._clean_name(title_a.get_text(strip=True))
        product['sourceUrl'] = title_a.get('href', '')
        product['sourceSite'] = self.SITE_URL

        if not product['sourceUrl'] or not self._is_product_url(product['sourceUrl']):
            return None

        img = article.select_one('img')
        if img:
            src = img.get('src') or img.get('data-src', '')
            if src:
                product['image'] = src if src.startswith('http') else urljoin(self.SITE_URL, src)

        desc_div = article.select_one('.product-desc')
        if desc_div:
            price_h1 = desc_div.select_one('h1')
            if price_h1:
                product['prix'] = self._parse_prestashop_price(price_h1)

            km_h2 = desc_div.select_one('h2')
            if km_h2:
                km_text = km_h2.get_text(strip=True)
                km_val = self.clean_mileage(km_text)
                if km_val:
                    product['kilometrage'] = km_val

        year = self.clean_year(product['name'])
        if year:
            product['annee'] = year

        product['etat'] = etat
        product['sourceCategorie'] = source_cat

        name_lower = product['name'].lower()
        if re.search(r'\b(démo|demo|démonstrateur)\b', name_lower):
            product['etat'] = 'demonstrateur'

        product['quantity'] = 1
        product['groupedUrls'] = [product['sourceUrl']]

        return product

    # ================================================================
    # PHASE 2: ENRICHISSEMENT VIA PAGES DÉTAIL
    # ================================================================

    def _enrich_from_detail_pages(self, products: List[Dict]) -> List[Dict]:
        total = len(products)
        workers = min(self.WORKERS, total)
        enriched_count = 0
        start = time.time()

        global_timeout = max(1200, total * 4)

        print(f"\n   🔍 Enrichissement: {total} pages détail ({workers} workers, timeout {global_timeout}s)...")

        url_to_product = {p['sourceUrl']: p for p in products}

        self._consecutive_403 = 0
        self._cooling_until = 0.0

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._fetch_detail_data, p['sourceUrl']): p['sourceUrl']
                for p in products
            }

            processed = 0
            try:
                for future in as_completed(futures, timeout=global_timeout):
                    processed += 1
                    url = futures[future]
                    try:
                        detail = future.result(timeout=30)
                        if detail:
                            product = url_to_product[url]
                            for key, val in detail.items():
                                if val and not product.get(key):
                                    product[key] = val
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

    def _throttled_get(self, url: str, **kwargs) -> requests.Response:
        """GET avec throttle, jitter aléatoire, et respect du cooling global."""
        now = time.monotonic()
        if now < self._cooling_until:
            wait = self._cooling_until - now
            time.sleep(wait)

        with self._request_lock:
            now = time.monotonic()
            jitter = random.uniform(0.1, 0.4)
            interval = self._min_request_interval + jitter
            elapsed = now - self._last_request_time
            if elapsed < interval:
                time.sleep(interval - elapsed)
            self._last_request_time = time.monotonic()
        return self.session.get(url, **kwargs)

    def _register_403(self):
        """Signale un 403 et déclenche un cooling global si trop fréquents."""
        with self._request_lock:
            self._consecutive_403 += 1
            if self._consecutive_403 >= 3:
                cooldown = min(30, 5 * self._consecutive_403)
                self._cooling_until = time.monotonic() + cooldown
                print(f"      ❄️ Cooling global: {cooldown}s ({self._consecutive_403} x 403 consécutifs)")

    def _register_success(self):
        """Réinitialise le compteur de 403 après une requête réussie."""
        with self._request_lock:
            self._consecutive_403 = 0

    def _fetch_detail_data(self, url: str) -> Optional[Dict]:
        for attempt in range(1, self.DETAIL_MAX_RETRIES + 1):
            try:
                resp = self._throttled_get(url, timeout=20, allow_redirects=True)

                if resp.status_code == 403:
                    self._register_403()
                    if attempt < self.DETAIL_MAX_RETRIES:
                        wait = self.DETAIL_RETRY_BASE_DELAY * (2 ** (attempt - 1)) + random.uniform(1, 3)
                        time.sleep(wait)
                        continue
                    return None

                if resp.status_code != 200:
                    return None

                self._register_success()

                soup = BeautifulSoup(resp.text, 'lxml')
                data: Dict[str, Any] = {}

                self._extract_json_ld(soup, data)
                self._extract_prestashop_meta(soup, data)
                self._extract_specs(soup, data)
                self._extract_price_from_detail(soup, data)
                self._extract_km_from_detail(soup, data)

                if not data.get('marque'):
                    brand = self._guess_brand_from_url(url)
                    if brand:
                        data['marque'] = brand

                return data if data else None

            except requests.exceptions.Timeout:
                if attempt < self.DETAIL_MAX_RETRIES:
                    time.sleep(self.DETAIL_RETRY_BASE_DELAY * attempt)
                    continue
                return None
            except Exception:
                return None
        return None

    def _guess_brand_from_url(self, url: str) -> Optional[str]:
        """Déduit la marque depuis le slug de l'URL du produit."""
        url_lower = url.lower()
        brand_map = {
            'bmw': 'BMW', 'ducati': 'Ducati', 'kawasaki': 'Kawasaki',
            'triumph': 'Triumph', 'yamaha': 'Yamaha', 'honda': 'Honda',
            'suzuki': 'Suzuki', 'ktm': 'KTM', 'husqvarna': 'Husqvarna',
            'harley': 'Harley-Davidson', 'indian': 'Indian',
            'aprilia': 'Aprilia', 'can-am': 'Can-Am',
        }
        for slug, name in brand_map.items():
            if f'-{slug}' in url_lower or f'/{slug}' in url_lower:
                return name
        return None

    KNOWN_BRANDS = ['bmw', 'ducati', 'kawasaki', 'triumph', 'yamaha', 'honda',
                    'suzuki', 'ktm', 'husqvarna', 'harley-davidson', 'indian',
                    'aprilia', 'moto guzzi', 'mv agusta', 'can-am', 'polaris',
                    'royal enfield', 'cfmoto', 'benelli']

    def _extract_json_ld(self, soup: BeautifulSoup, out: Dict) -> None:
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string)
                if data.get('@type') != 'Product':
                    continue

                if data.get('name'):
                    out.setdefault('name', self._clean_name(data['name']))

                brand = data.get('brand', {})
                if isinstance(brand, dict) and brand.get('name'):
                    brand_name = brand['name']
                    if brand_name.lower() not in ('motovanier.ca', 'motovanier', 'moto vanier'):
                        out.setdefault('marque', brand_name)

                if data.get('sku'):
                    out.setdefault('inventaire', data['sku'])

                img = data.get('image')
                if isinstance(img, str) and img.startswith('http'):
                    out.setdefault('image', img)

            except (json.JSONDecodeError, TypeError, KeyError, ValueError):
                continue

    def _extract_prestashop_meta(self, soup: BeautifulSoup, out: Dict) -> None:
        man_el = soup.select_one('.product-manufacturer span a')
        if man_el:
            brand = man_el.get_text(strip=True)
            if brand and brand.lower() not in ('motovanier.ca', 'motovanier', 'moto vanier'):
                out.setdefault('marque', brand)

        ref_el = soup.select_one('.product-reference span:not(.label)')
        if not ref_el:
            ref_section = soup.select_one('section.product-reference span')
            if ref_section and 'label' not in (ref_section.get('class') or []):
                ref_el = ref_section
        if ref_el:
            ref_text = ref_el.get_text(strip=True)
            if ref_text:
                out.setdefault('inventaire', ref_text)

        cond_el = soup.select_one('.product-condition span')
        if cond_el:
            cond_text = cond_el.get_text(strip=True).lower()
            if 'nouveau' in cond_text or 'neuf' in cond_text:
                out.setdefault('etat', 'neuf')
            elif 'occasion' in cond_text or 'usagé' in cond_text:
                out.setdefault('etat', 'occasion')

        cond_link = soup.select_one('.product-condition link[href]')
        if cond_link:
            href = cond_link.get('href', '')
            if 'NewCondition' in href:
                out.setdefault('etat', 'neuf')
            elif 'UsedCondition' in href:
                out.setdefault('etat', 'occasion')

    def _extract_specs(self, soup: BeautifulSoup, out: Dict) -> None:
        spec_pairs = soup.select('section.product-features dl.data-sheet dt.name')

        for dt in spec_pairs:
            dd = dt.find_next_sibling('dd', class_='value')
            if not dd:
                continue

            label = dt.get_text(strip=True).lower().strip()
            value = dd.get_text(strip=True)

            if not value or value in ('-', 'N/A', '', 'null'):
                continue

            field = self.SPEC_FIELD_MAP.get(label)
            if field:
                out.setdefault(field, value)

    def _extract_price_from_detail(self, soup: BeautifulSoup, out: Dict) -> None:
        if out.get('prix'):
            return

        info = soup.select_one('.product-information')
        if info:
            h1 = info.select_one('h1')
            if h1:
                price = self._parse_prestashop_price(h1)
                if price:
                    out.setdefault('prix', price)

    def _extract_km_from_detail(self, soup: BeautifulSoup, out: Dict) -> None:
        if out.get('kilometrage'):
            return

        info = soup.select_one('.product-information')
        if info:
            h2 = info.select_one('h2')
            if h2:
                km = self.clean_mileage(h2.get_text(strip=True))
                if km:
                    out.setdefault('kilometrage', km)

    # ================================================================
    # HELPERS
    # ================================================================

    def _parse_prestashop_price(self, element: Tag) -> Optional[float]:
        """Parse le prix depuis un élément h1 PrestaShop.

        Gère les cas où le <span style="line-through"> ne couvre que partiellement
        l'ancien prix (ex: "PRIX 16<del>215$</del>15 595$"). On extrait le texte
        situé APRÈS le strikethrough, qui correspond toujours au prix courant.
        """
        strike = element.select_one('span[style*="line-through"]')

        if strike:
            after_parts = []
            for sibling in strike.next_siblings:
                if isinstance(sibling, str):
                    after_parts.append(sibling)
                elif hasattr(sibling, 'get_text'):
                    after_parts.append(sibling.get_text())
            after_text = ''.join(after_parts).strip()
            price = self.clean_price(after_text)
            if price and price < 500000:
                return price

        text = element.get_text(strip=True).replace('PRIX', '').strip()
        prices = re.findall(r'[\d\s]+\$', text)
        if prices:
            return self.clean_price(prices[-1])

        return self.clean_price(text)

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']

        all_urls = []
        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key not in categories and not any(c in cat_key for c in categories):
                continue

            listing_url = config['url']
            resp = self._fetch_listing_with_retry(listing_url)
            if not resp:
                continue

            try:
                soup = BeautifulSoup(resp.text, 'lxml')
                total = self._parse_total_products(soup)
                total_pages = math.ceil(total / self.PRODUCTS_PER_PAGE) if total > 0 else 1

                urls = self._extract_urls_from_html(resp.text)
                all_urls.extend(urls)

                for page in range(2, total_pages + 1):
                    page_url = f"{listing_url}?page={page}"
                    time.sleep(0.5)
                    try:
                        resp_p = self._fetch_listing_with_retry(page_url)
                        if resp_p:
                            all_urls.extend(self._extract_urls_from_html(resp_p.text))
                    except Exception:
                        break

            except Exception:
                pass

        seen = set()
        return [u for u in all_urls if u.rstrip('/').lower() not in seen and not seen.add(u.rstrip('/').lower())]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        out: Dict[str, Any] = {}
        self._extract_json_ld(soup, out)
        self._extract_prestashop_meta(soup, out)
        self._extract_specs(soup, out)
        self._extract_price_from_detail(soup, out)
        self._extract_km_from_detail(soup, out)

        h1 = soup.select_one('h1.h1')
        if h1:
            out.setdefault('name', self._clean_name(h1.get_text(strip=True)))

        return out if out else None

    def _extract_urls_from_html(self, html: str) -> List[str]:
        soup = BeautifulSoup(html, 'lxml')
        urls = []
        for article in soup.select('article.product-miniature'):
            link = article.select_one('h3.product-title a')
            if link and link.get('href'):
                full_url = link['href']
                if self._is_product_url(full_url):
                    urls.append(full_url)
        return urls

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        if url_lower.endswith('.html'):
            excludes = ['/content/', '/module/', '/panier', '/nous-contacter',
                        '/mon-compte', '/commande', '/brand/']
            return not any(x in url_lower for x in excludes)
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
        name = re.sub(r'\s*\|\s*Moto\s*Vanier.*$', '', name, flags=re.I)
        name = re.sub(r'\s*-\s*Motovanier.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
