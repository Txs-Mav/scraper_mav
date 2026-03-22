"""
Scraper dédié pour Rock Moto Sport (plateforme Convertus/AutoTrader — WordPress).

Concessionnaire moto, motoneige, VTT et motomarines à Sherbrooke, QC (Estrie).
Marques : Kawasaki, Arctic Cat, Aprilia, Moto Guzzi, Piaggio, KTM, Ducati, BMW,
          Suzuki, Harley-Davidson, Yamaha, Ski-Doo.

Stratégie API Convertus VMS (primaire) + sitemap (fallback) :
  1. API VMS via proxy WordPress :
       ajax-vehicles.php?endpoint={vms_api_url}&action=vms_data
     → JSON complet avec tous les véhicules (nom, prix, marque, modèle, année,
       stock, km, image, couleur, type, URL détail, etc.)
     Le proxy passe par Cloudflare, géré via cloudscraper.
  2. Fallback sitemap XML (used-vehicle-1-sitemap.xml) si l'API échoue
  3. Fallback pages détail (parallèle) → meta OG + HTML specs

API VMS Convertus :
  - Base: https://vms.prod.convertus.rocks/api/filtering/
  - Proxy: /wp-content/plugins/convertus-vms/include/php/ajax-vehicles.php
  - cp=718 (dealer code), ln=fr, pg=page, pc=per_page, sc=new|used
  - Retourne JSON avec toutes les données véhicules

URL pattern: /vehicles/{year}/{make}/{model}/sherbrooke/qc/{id}/?sale_class=neuf|used
"""
import re
import json
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse, quote
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from curl_cffi import requests as cffi_requests
    _HAS_CURL_CFFI = True
except ImportError:
    _HAS_CURL_CFFI = False

try:
    import cloudscraper
    _HAS_CLOUDSCRAPER = True
except ImportError:
    _HAS_CLOUDSCRAPER = False

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class RockMotoSportScraper(DedicatedScraper):

    SITE_NAME = "Rock Moto Sport"
    SITE_SLUG = "rock-moto-sport"
    SITE_URL = "https://www.rockmotosport.com/"
    SITE_DOMAIN = "rockmotosport.com"

    VMS_API = "https://vms.prod.convertus.rocks/api/filtering/"
    VMS_PROXY = "https://www.rockmotosport.com/wp-content/plugins/convertus-vms/include/php/ajax-vehicles.php"
    DEALER_CODE = "718"

    SITEMAP_USED = "https://www.rockmotosport.com/used-vehicle-1-sitemap.xml"
    SITEMAP_NEW = "https://www.rockmotosport.com/new-vehicle-1-sitemap.xml"
    SITEMAP_INDEX = "https://www.rockmotosport.com/sitemap_index.xml"

    WORKERS = 6
    DETAIL_TIMEOUT = 25
    MAX_RETRIES = 4
    RETRY_DELAY = 2.0
    VMS_PER_PAGE = 1000

    _VEHICLE_URL_RE = re.compile(
        r'/vehicles/(\d{4})/([^/]+)/([^/]+)/[^/]+/qc/(\d+)/?'
    )

    _TYPE_MAP = {
        'motorcycle': 'Motocyclette',
        'moto': 'Motocyclette',
        'atv': 'VTT',
        'vtt': 'VTT',
        'side-by-side': 'Côte à côte',
        'sxs': 'Côte à côte',
        'snowmobile': 'Motoneige',
        'motoneige': 'Motoneige',
        'pwc': 'Motomarine',
        'motomarine': 'Motomarine',
        'trailer': 'Remorque',
        'remorque': 'Remorque',
        'electric-bike': 'Vélo électrique',
        'velo-electrique': 'Vélo électrique',
    }

    def __init__(self):
        super().__init__()
        self._cffi_session = None
        self._cs = None
        self._init_http_client()

    def _init_http_client(self) -> None:
        if _HAS_CURL_CFFI:
            self._cffi_session = cffi_requests.Session(impersonate='chrome')
        if _HAS_CLOUDSCRAPER:
            self._cs = cloudscraper.create_scraper(
                browser={'browser': 'chrome', 'platform': 'darwin', 'desktop': True}
            )

    def _get(self, url: str, timeout: int = 25) -> Optional[Any]:
        """GET avec retry et fallback (curl_cffi → cloudscraper → requests)."""
        clients = []
        if self._cffi_session:
            clients.append(('cffi', self._cffi_session))
        if self._cs:
            clients.append(('cloudscraper', self._cs))
        clients.append(('requests', self.session))

        for attempt in range(1, self.MAX_RETRIES + 1):
            for label, client in clients:
                try:
                    resp = client.get(url, timeout=timeout)
                    if resp.status_code == 200:
                        return resp
                except Exception:
                    continue

            if attempt < self.MAX_RETRIES:
                time.sleep(self.RETRY_DELAY * attempt)
                if _HAS_CLOUDSCRAPER:
                    self._cs = cloudscraper.create_scraper(
                        browser={'browser': 'chrome', 'platform': 'darwin', 'desktop': True}
                    )
                if _HAS_CURL_CFFI:
                    self._cffi_session = cffi_requests.Session(impersonate='chrome')

        return None

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

        products = self._scrape_via_vms_api(categories)

        if not products:
            print("   ⚠️ API VMS Convertus indisponible (403), fallback sitemap + pages détail")
            print("   ℹ️ Cloudflare protège ce site — l'extraction sera lente et partielle")
            products = self._scrape_via_sitemap_and_detail(categories)

        if inventory_only:
            products = [p for p in products if p.get('sourceCategorie') != 'catalogue']

        pre_group = len(products)
        products = self._group_identical_products(products)
        if pre_group != len(products):
            grouped = pre_group - len(products)
            multi = sum(1 for p in products if p.get('quantity', 1) > 1)
            print(f"\n   📦 Regroupement: {pre_group} → {len(products)} produits "
                  f"({grouped} combinés, {multi} groupes multi-unités)")

        elapsed = time.time() - start_time
        total_urls = len(products)

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
    # STRATÉGIE 1 : API CONVERTUS VMS (PRIMAIRE)
    # ================================================================

    def _build_vms_proxy_url(self, sale_class: str, page: int = 1) -> str:
        """Construit l'URL du proxy WordPress pour l'API VMS."""
        api_params = (
            f"cp={self.DEALER_CODE}&ln=fr&pg={page}&pc={self.VMS_PER_PAGE}"
            f"&st=year%2Cdesc&sc={sale_class}&v1=Tout"
            f"&in_transit=true&in_stock=true&on_order=true"
            f"&pnpi=msrp&pnpm=none&pnpf=aski"
            f"&pupi=msrp&pupm=aski&pupf=none"
            f"&nnpi=msrp&nnpm=none&nnpf=aski"
            f"&nupi=msrp&nupm=none&nupf=aski"
        )
        endpoint = quote(f"{self.VMS_API}?{api_params}", safe='')
        return f"{self.VMS_PROXY}?endpoint={endpoint}&action=vms_data"

    def _fetch_vms_vehicles(self, sale_class: str) -> List[Dict]:
        """Récupère tous les véhicules d'une catégorie via l'API VMS paginée."""
        all_vehicles = []
        page = 1

        while True:
            url = self._build_vms_proxy_url(sale_class, page)
            resp = self._get(url, timeout=30)
            if not resp:
                break

            try:
                data = resp.json()
            except (json.JSONDecodeError, ValueError):
                break

            results = data.get('results', []) if isinstance(data, dict) else data if isinstance(data, list) else []
            if not results:
                break

            all_vehicles.extend(results)

            summary = data.get('summary', {}) if isinstance(data, dict) else {}
            total_expected = summary.get('total_vehicles', 0)
            if len(all_vehicles) >= total_expected or len(results) < self.VMS_PER_PAGE:
                break
            page += 1

        return all_vehicles

    def _scrape_via_vms_api(self, categories: List[str]) -> List[Dict]:
        """Scrape complet via l'API VMS — retourne les produits directement."""
        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_occasion = any(c in ('occasion', 'usage') for c in categories)
        products: List[Dict] = []

        if want_neuf:
            vehicles = self._fetch_vms_vehicles('new')
            print(f"   🔌 API VMS [neuf]: {len(vehicles)} véhicules")
            for v in vehicles:
                p = self._parse_vms_vehicle(v, 'neuf', 'inventaire')
                if p:
                    products.append(p)

        if want_occasion:
            vehicles = self._fetch_vms_vehicles('used')
            print(f"   🔌 API VMS [occasion]: {len(vehicles)} véhicules")
            for v in vehicles:
                p = self._parse_vms_vehicle(v, 'occasion', 'vehicules_occasion')
                if p:
                    products.append(p)

        return products

    def _parse_vms_vehicle(self, v: Dict, etat: str, source_cat: str) -> Optional[Dict]:
        """Convertit un objet véhicule VMS en produit normalisé."""
        year = v.get('year')
        make = v.get('make', '')
        model = v.get('model', '')
        trim = v.get('trim', '')

        name_parts = []
        if year:
            name_parts.append(str(year))
        if make:
            name_parts.append(make)
        if model:
            name_parts.append(model)
        if trim and trim.lower() != model.lower():
            name_parts.append(trim)
        name = ' '.join(name_parts)

        if not name:
            return None

        product: Dict[str, Any] = {
            'name': name,
            'sourceSite': self.SITE_URL,
            'etat': etat,
            'sourceCategorie': source_cat,
            'quantity': 1,
        }

        if make:
            product['marque'] = self._slug_to_title(make) if '-' in make else make
        if model:
            product['modele'] = model
        if trim and trim.lower() != model.lower():
            product['modele'] = f"{model} {trim}"
        if year:
            try:
                product['annee'] = int(year)
            except (ValueError, TypeError):
                pass

        vdp = v.get('vdp_url', v.get('url', v.get('link', '')))
        if vdp:
            if vdp.startswith('http://'):
                vdp = vdp.replace('http://', 'https://', 1)
            elif not vdp.startswith('http'):
                vdp = f"https://www.rockmotosport.com{vdp}"
            vdp = vdp.replace(' ', '-').rstrip('/')
            vdp = re.sub(r'(?<!:)//', '/', vdp)
            product['sourceUrl'] = vdp
        else:
            vid = v.get('vehicle_id', v.get('id', ''))
            make_slug = make.lower().replace(' ', '-')
            model_slug = (model or '').lower().replace(' ', '-')
            if vid and make_slug and model_slug and year:
                sc = 'neuf' if etat == 'neuf' else 'used'
                product['sourceUrl'] = (
                    f"https://www.rockmotosport.com/vehicles/{year}/{make_slug}/"
                    f"{model_slug}/sherbrooke/qc/{vid}/?sale_class={sc}"
                )
            else:
                product['sourceUrl'] = self.SITE_URL

        for price_key in ('price', 'asking_price', 'msrp', 'sale_price', 'internet_price'):
            raw = v.get(price_key)
            if raw:
                try:
                    price = float(str(raw).replace(',', '').replace('$', ''))
                    if price > 0:
                        product['prix'] = price
                        break
                except (ValueError, TypeError):
                    continue

        stock = v.get('stock_number', v.get('stock', v.get('vin', '')))
        if stock:
            product['inventaire'] = str(stock)

        km = v.get('odometer', v.get('kilometers', v.get('mileage')))
        if km is not None:
            try:
                product['kilometrage'] = int(str(km).replace(',', ''))
            except (ValueError, TypeError):
                pass

        color = v.get('exterior_color', v.get('color', ''))
        if color and color.lower() not in ('n/a', '-', ''):
            product['couleur'] = color.title()

        vclass = v.get('vehicle_class', '')
        if vclass and vclass.lower() not in ('autre', 'other', 'n/a', ''):
            product['vehicule_type'] = vclass
        else:
            body = v.get('body_style', v.get('body_type', v.get('type', '')))
            if body:
                vtype = self._body_style_to_type(body)
                if vtype:
                    product['vehicule_type'] = vtype
            elif v.get('vehicle_class_en'):
                vtype = self._body_style_to_type(v['vehicle_class_en'])
                if vtype:
                    product['vehicule_type'] = vtype

        img = v.get('image')
        if isinstance(img, dict):
            for size_key in ('image_lg', 'image_md', 'image_original', 'image_sm'):
                img_url = img.get(size_key, '')
                if img_url and img_url.startswith('http'):
                    product['image'] = img_url
                    break
        elif isinstance(img, str) and img.startswith('http'):
            product['image'] = img

        if not product.get('image'):
            placeholder = v.get('placeholder_image', '')
            if isinstance(placeholder, str) and placeholder.startswith('http'):
                product['image'] = placeholder

        trans = v.get('transmission', '')
        if trans and trans.lower() not in ('n/a', '-', ''):
            product['transmission'] = trans

        engine = v.get('engine', '')
        if engine and engine.lower() not in ('n/a', '-', ''):
            product['moteur'] = engine

        product['groupedUrls'] = [product.get('sourceUrl', '')]
        return product

    # ================================================================
    # STRATÉGIE 2 : FALLBACK SITEMAP + PAGES DÉTAIL
    # ================================================================

    def _scrape_via_sitemap_and_detail(self, categories: List[str]) -> List[Dict]:
        """Fallback: sitemap pour découverte + pages détail pour extraction."""
        url_map = self._discover_all_urls(categories)

        if not url_map:
            return []

        total = sum(len(v) for v in url_map.values())
        for cat, entries in url_map.items():
            print(f"   📋 [{cat}]: {len(entries)} URLs")

        return self._extract_from_detail_pages(url_map)

    def _discover_all_urls(self, categories: List[str]) -> Dict[str, List[tuple]]:
        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_occasion = any(c in ('occasion', 'usage') for c in categories)

        url_map: Dict[str, List[tuple]] = {}
        seen: set = set()

        if want_neuf:
            urls = self._discover_from_sitemap_source(self.SITEMAP_NEW, 'neuf')
            for u in urls:
                norm = u.rstrip('/').lower()
                if norm not in seen:
                    seen.add(norm)
                    url_map.setdefault('inventaire', []).append((u, 'neuf', 'inventaire'))

        if want_occasion:
            urls = self._discover_from_sitemap_source(self.SITEMAP_USED, 'occasion')
            if not urls:
                urls = self._discover_from_sitemap_index()
            for u in urls:
                norm = u.rstrip('/').lower()
                if norm not in seen:
                    seen.add(norm)
                    url_map.setdefault('occasion', []).append((u, 'occasion', 'vehicules_occasion'))

        return url_map

    def _discover_from_sitemap_source(self, sitemap_url: str, label: str) -> List[str]:
        """Parse un sitemap XML direct pour les véhicules."""
        urls = []
        resp = self._get(sitemap_url, timeout=15)
        if resp:
            for loc in re.findall(r'<loc>(.*?)</loc>', resp.text):
                if self._VEHICLE_URL_RE.search(loc):
                    urls.append(loc)
        print(f"   🗺️ Sitemap [{label}]: {len(urls)} URLs véhicules")
        return urls

    def _discover_from_sitemap_index(self) -> List[str]:
        """Fallback: parse le sitemap index pour trouver des sous-sitemaps véhicules."""
        urls = []
        resp = self._get(self.SITEMAP_INDEX, timeout=15)
        if resp:
            for loc in re.findall(r'<loc>(.*?)</loc>', resp.text):
                if 'vehicle' in loc.lower() and 'sitemap' in loc.lower():
                    sub_resp = self._get(loc, timeout=15)
                    if sub_resp:
                        for sub_loc in re.findall(r'<loc>(.*?)</loc>', sub_resp.text):
                            if self._VEHICLE_URL_RE.search(sub_loc):
                                urls.append(sub_loc)
        return urls

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
            try:
                for future in as_completed(futures, timeout=max(600, total * 5)):
                    processed += 1
                    try:
                        product = future.result(timeout=self.DETAIL_TIMEOUT + 10)
                        if product:
                            products.append(product)
                        else:
                            errors += 1
                    except Exception:
                        errors += 1

                    if processed % 10 == 0 or processed == total:
                        elapsed = time.time() - start
                        rate = processed / elapsed if elapsed > 0 else 0
                        print(f"      📊 [{processed}/{total}] {len(products)} ok, "
                              f"{errors} erreurs — {rate:.1f}/s")
            except TimeoutError:
                pending = total - processed
                print(f"      ⚠️ Timeout — {pending} URL(s) abandonnées")

        print(f"      ✅ {len(products)}/{total} produits extraits "
              f"({errors} erreurs)")
        return products

    def _fetch_and_parse_detail(self, url: str, etat: str, source_cat: str) -> Optional[Dict]:
        resp = self._get(url, timeout=self.DETAIL_TIMEOUT)
        if not resp:
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

        self._extract_from_url(url, product)
        self._extract_og_meta(soup, product)
        self._extract_html_specs(soup, product)
        self._extract_json_ld(soup, product)
        self._extract_price_from_description(product)

        if not product.get('name'):
            h1 = soup.find('h1')
            if h1:
                product['name'] = self._clean_name(h1.get_text(strip=True))

        if not product.get('name'):
            parts = [product.get('marque', ''), product.get('modele', '')]
            if product.get('annee'):
                parts.insert(0, str(product['annee']))
            name = ' '.join(p for p in parts if p)
            if name:
                product['name'] = name

        if not product.get('name'):
            return None

        product['groupedUrls'] = [url]
        return product

    # ================================================================
    # EXTRACTEURS DE DONNÉES
    # ================================================================

    def _extract_from_url(self, url: str, out: Dict) -> None:
        """Extrait année, marque, modèle et ID depuis l'URL."""
        match = self._VEHICLE_URL_RE.search(url)
        if not match:
            return

        year, make_slug, model_slug, vehicle_id = match.groups()

        try:
            year_int = int(year)
            if 1950 <= year_int <= 2030:
                out.setdefault('annee', year_int)
        except ValueError:
            pass

        out.setdefault('marque', self._slug_to_title(make_slug))
        out.setdefault('modele', self._slug_to_title(model_slug))
        out.setdefault('inventaire', vehicle_id)

        if 'sale_class=used' in url:
            out.setdefault('etat', 'occasion')
        elif 'sale_class=new' in url:
            out.setdefault('etat', 'neuf')

    def _extract_og_meta(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait données des meta tags Open Graph."""
        for meta in soup.find_all('meta'):
            prop = meta.get('property', '') or meta.get('name', '')
            content = meta.get('content', '')
            if not content:
                continue

            if prop == 'og:title':
                out.setdefault('name', self._clean_name(content))
            elif prop == 'og:image' and content.startswith('http'):
                out.setdefault('image', content)
            elif prop == 'og:description':
                out.setdefault('_og_description', content)
                if not out.get('description'):
                    cleaned = re.sub(
                        r'Découvrez votre prochain .+? chez Rock Moto Sport pour seulement .+? CAD,',
                        '', content
                    ).strip()
                    if cleaned and len(cleaned) > 20:
                        out['description'] = cleaned[:2000]

    def _extract_price_from_description(self, out: Dict) -> None:
        """Extrait le prix depuis og:description."""
        desc = out.pop('_og_description', '')
        if not desc or out.get('prix'):
            return

        price_match = re.search(r'\$([\d,]+)', desc)
        if price_match:
            price = self.clean_price(price_match.group(0))
            if price:
                out['prix'] = price

    def _extract_html_specs(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait specs depuis les li de la page détail Convertus."""
        for li in soup.find_all('li'):
            text = li.get_text(strip=True)
            if not text or len(text) > 150:
                continue

            text_lower = text.lower()

            if '# de stock' in text_lower or 'stock #' in text_lower:
                val = re.sub(r'^.*?[:#]\s*#?', '', text).strip()
                if val:
                    out.setdefault('inventaire', val)

            elif 'odom' in text_lower or 'km' == text_lower.split(':')[-1].strip():
                val = re.sub(r'^.*?:\s*', '', text).strip()
                km = self.clean_mileage(val)
                if km is not None:
                    out.setdefault('kilometrage', km)

            elif 'style de carrosserie' in text_lower or 'body style' in text_lower:
                val = re.sub(r'^.*?:\s*', '', text).strip()
                if val and val.lower() not in ('autre', 'other', 'n/a'):
                    vtype = self._body_style_to_type(val)
                    if vtype:
                        out.setdefault('vehicule_type', vtype)

            elif 'transmission' in text_lower:
                val = re.sub(r'^.*?:\s*', '', text).strip()
                if val and val.lower() not in ('n/a', '-'):
                    out.setdefault('transmission', val)

            elif 'couleur' in text_lower or 'color' in text_lower:
                val = re.sub(r'^.*?:\s*', '', text).strip()
                if val and val.lower() not in ('n/a', '-'):
                    out.setdefault('couleur', val.title())

            elif 'moteur' in text_lower or 'engine' in text_lower:
                val = re.sub(r'^.*?:\s*', '', text).strip()
                if val and val.lower() not in ('n/a', '-'):
                    out.setdefault('moteur', val)

    def _extract_json_ld(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait JSON-LD si disponible (WebPage ou Product)."""
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string)
                graph = data.get('@graph', [data] if '@type' in data else [])
                for item in graph:
                    item_type = item.get('@type', '')
                    if item_type in ('Vehicle', 'Product'):
                        if item.get('name'):
                            out.setdefault('name', self._clean_name(item['name']))
                        brand = item.get('brand', item.get('manufacturer', ''))
                        if isinstance(brand, dict):
                            brand = brand.get('name', '')
                        if brand:
                            out.setdefault('marque', brand.strip().title())
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

                        offers = item.get('offers', {})
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

                        break
            except (json.JSONDecodeError, TypeError, KeyError):
                continue

    # ================================================================
    # HELPERS
    # ================================================================

    @staticmethod
    def _slug_to_title(slug: str) -> str:
        """Convertit un slug URL en nom lisible."""
        brand_map = {
            'arctic-cat': 'Arctic Cat',
            'harley-davidson': 'Harley-Davidson',
            'moto-guzzi': 'Moto Guzzi',
            'ski-doo': 'Ski-Doo',
            'sea-doo': 'Sea-Doo',
            'can-am': 'Can-Am',
            'gas-gas': 'GAS GAS',
            'ktm': 'KTM',
            'bmw': 'BMW',
        }
        lower = slug.lower()
        if lower in brand_map:
            return brand_map[lower]
        return slug.replace('-', ' ').title()

    def _body_style_to_type(self, style: str) -> Optional[str]:
        lower = style.lower()
        for keyword, vtype in self._TYPE_MAP.items():
            if keyword in lower:
                return vtype
        return None

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r'\s*[|–-]\s*Rock\s*Moto\s*Sport.*$', '', name, flags=re.I)
        name = re.sub(r'\s*à\s+Sherbrooke.*$', '', name, flags=re.I)
        name = re.sub(r'\s*-\s*\d{5,}$', '', name)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()

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
    # INTERFACE DedicatedScraper
    # ================================================================

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']
        url_map = self._discover_all_urls(categories)
        all_urls = []
        for entries in url_map.values():
            all_urls.extend(u for u, _, _ in entries)
        seen = set()
        return [u for u in all_urls
                if u.rstrip('/').lower() not in seen and not seen.add(u.rstrip('/').lower())]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        out: Dict[str, Any] = {}
        self._extract_from_url(url, out)
        self._extract_og_meta(soup, out)
        self._extract_html_specs(soup, out)
        self._extract_json_ld(soup, out)
        self._extract_price_from_description(out)
        return out if out else None
