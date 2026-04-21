"""
Scraper dédié pour St-Onge Ford | Ford Dealership in Shawinigan and La Tuque (st-onge-ford.com).
Généré par scraper_usine le 2026-04-12.
Stratégie: sitemap + hybrid
Plateforme: eDealer
"""
import re
import json
import math
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup

from .base import DedicatedScraper


class StOngeFordScraper(DedicatedScraper):

    SITE_NAME = "St-Onge Ford | Ford Dealership in Shawinigan and La Tuque"
    SITE_SLUG = "st-onge-ford"
    SITE_URL = "https://www.st-onge-ford.com/fr/"
    SITE_DOMAIN = "st-onge-ford.com"
    SITEMAP_URL = "https://www.st-onge-ford.com/sitemaps.xml"
    WORKERS = 8
    HTTP_TIMEOUT = 20
    def __init__(self):
        super().__init__()
    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']

        raw_urls = self._parse_sitemap_live()

        # Déduplication par ID de produit: préférer les chemins FR non-brochure
        # (ex: /neufs/ > /new/, mais /used/ > /occasion/-brochure si FR vide)
        _FR_PREFIXES = ('neufs', 'demonstrateurs')
        id_map: Dict[str, str] = {}
        no_id: list = []
        for u in raw_urls:
            m = re.search(r'-id(\d+)', u)
            if m:
                pid = m.group(1)
                existing = id_map.get(pid)
                if existing is None:
                    id_map[pid] = u
                else:
                    seg = u.lower().split('/')
                    # Préférer FR seulement si pas une brochure
                    if any(any(s.startswith(p) for p in _FR_PREFIXES) for s in seg):
                        id_map[pid] = u
            else:
                no_id.append(u)

        seen = set()
        result = list(id_map.values())
        for u in no_id:
            k = u.rstrip('/').lower()
            if k not in seen:
                seen.add(k)
                result.append(u)
        return result

    def _parse_sitemap_live(self) -> List[str]:
        """Parse le sitemap XML en live à chaque exécution (pas de cache)."""
        base = self.SITE_URL.rstrip('/')
        parsed = urlparse(base)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        candidates = []
        if hasattr(self, 'SITEMAP_URL') and self.SITEMAP_URL:
            candidates.append(self.SITEMAP_URL)
        candidates += [
            origin + '/sitemaps/inventory-detail.xml',
            origin + '/sitemap.xml',
            origin + '/robots.txt',
        ]

        product_urls = []
        seen_sitemaps = set()

        for sitemap_url in candidates:
            if sitemap_url in seen_sitemaps:
                continue
            seen_sitemaps.add(sitemap_url)
            try:
                resp = self.session.get(sitemap_url, timeout=15)
                if resp.status_code != 200:
                    continue

                if sitemap_url.endswith('robots.txt'):
                    for line in resp.text.splitlines():
                        if line.strip().lower().startswith('sitemap:'):
                            sm = line.split(':', 1)[1].strip()
                            if sm not in seen_sitemaps:
                                candidates.append(sm)
                    continue

                if '<' not in resp.text[:200]:
                    continue

                soup_sm = BeautifulSoup(resp.text, 'lxml-xml')

                sitemapindex = soup_sm.find_all('sitemap')
                if sitemapindex:
                    for sm in sitemapindex:
                        loc = sm.find('loc')
                        if loc:
                            sub_url = loc.text.strip()
                            if 'compare' in sub_url.lower():
                                continue
                            if sub_url not in seen_sitemaps:
                                candidates.append(sub_url)
                    continue

                for url_tag in soup_sm.find_all('url'):
                    loc = url_tag.find('loc')
                    if loc:
                        u = loc.text.strip()
                        # Garder uniquement les pages de détail individuelles (avec -id)
                        if '-id' not in u:
                            continue
                        # Exclure PDFs, brochures et pages placeholder
                        if any(x in u for x in ('-pdf', '-brochure', '-0-id')):
                            continue
                        if u.endswith('-0.html'):
                            continue
                        product_urls.append(u)
            except Exception:
                continue

        return product_urls

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        if self._is_soft_404(soup):
            return None

        out: Dict[str, Any] = {}

        self._extract_json_ld(soup, out)
        self._extract_css(soup, out)

        if not out.get('name'):
            h1 = soup.select_one('h1')
            if h1:
                out['name'] = h1.get_text(strip=True)

        if not out.get('name') and self._is_spa_page(html):
            out = self._extract_with_playwright(url) or {}


        if not out.get('image'):
            img = soup.select_one('img.product-image, .main-image img, img')
            if img:
                src = img.get('src') or img.get('src', '')
                if src:
                    out['image'] = src if src.startswith('http') else urljoin(url, src)

        return out if out.get('name') else None

    def _is_spa_page(self, html: str) -> bool:
        """Detecte si le HTML est une coquille SPA sans contenu reel."""
        text_len = len(re.sub(r'<[^>]+>', '', html).strip())
        return text_len < 2000 and len(html) > 50000

    def _extract_with_playwright(self, url: str) -> Optional[Dict]:
        """Fallback: rend la page avec Playwright et extrait le contenu."""
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None

        out: Dict[str, Any] = {}
        try:
            if not hasattr(self, '_pw_browser'):
                self._pw = sync_playwright().start()
                self._pw_browser = self._pw.chromium.launch(headless=True)
                self._pw_context = self._pw_browser.new_context(
                    user_agent=self.session.headers.get('User-Agent', ''),
                    locale='fr-CA',
                )

            page = self._pw_context.new_page()
            try:
                page.goto(url, timeout=20000, wait_until='networkidle')
            except Exception:
                try:
                    page.goto(url, timeout=20000, wait_until='domcontentloaded')
                    page.wait_for_timeout(3000)
                except Exception:
                    page.close()
                    return None

            rendered_html = page.content()
            page.close()

            soup_pw = BeautifulSoup(rendered_html, 'lxml')

            self._extract_json_ld(soup_pw, out)
            self._extract_css(soup_pw, out)

            if not out.get('name'):
                h1 = soup_pw.select_one('h1')
                if h1:
                    out['name'] = h1.get_text(strip=True)

            if not out.get('image'):
                img = soup_pw.select_one('img[src*="vehicle"], img[src*="inventory"], img.main-image, .gallery img')
                if img:
                    out['image'] = img.get('src', '')

        except Exception:
            pass

        return out if out.get('name') else None

    def _extract_json_ld(self, soup: BeautifulSoup, out: Dict) -> None:
        # Prioritiser les types Vehicle/Car pour avoir VIN et données complètes
        scripts = soup.find_all('script', type='application/ld+json')
        all_items = []
        for script in scripts:
            try:
                data = json.loads(script.string or '')
                items = data if isinstance(data, list) else [data]
                all_items.extend(items)
            except (json.JSONDecodeError, TypeError, ValueError):
                continue

        type_priority = ('Vehicle', 'Car', 'AutomotiveVehicle', 'MotorizedBicycle', 'Product', 'IndividualProduct')
        all_items.sort(key=lambda x: next((i for i, t in enumerate(type_priority) if x.get('@type') == t), 99))

        for item in all_items:
            t = item.get('@type', '')
            if t not in type_priority:
                if 'offers' not in item:
                    continue

            if item.get('name') and not out.get('name'):
                out['name'] = item['name']
            if item.get('description') and not out.get('description'):
                out['description'] = item['description']

            brand = item.get('brand', '')
            if not out.get('marque'):
                if isinstance(brand, dict):
                    out['marque'] = brand.get('name', '')
                elif brand:
                    out['marque'] = str(brand)

            if item.get('model') and not out.get('modele'):
                out['modele'] = item['model']

            # VIN: ne pas utiliser setdefault pour éviter de bloquer avec une valeur vide
            vin = item.get('vehicleIdentificationNumber') or item.get('vin') or ''
            if vin and not out.get('vin'):
                out['vin'] = str(vin)

            img = item.get('image', '')
            if isinstance(img, list) and img:
                img = img[0]
            if img and not out.get('image'):
                out['image'] = img

            for date_field in ('modelDate', 'vehicleModelDate', 'productionDate'):
                if item.get(date_field) and not out.get('annee'):
                    out['annee'] = self.clean_year(str(item[date_field]))

            mileage = item.get('mileageFromOdometer', item.get('mileage', ''))
            if mileage and not out.get('kilometrage'):
                if isinstance(mileage, dict):
                    out['kilometrage'] = self.clean_mileage(str(mileage.get('value', '')))
                else:
                    out['kilometrage'] = self.clean_mileage(str(mileage))

            offers = item.get('offers', {})
            if isinstance(offers, list) and offers:
                offers = offers[0]
            if isinstance(offers, dict):
                price = offers.get('price')
                if price and not out.get('prix'):
                    out['prix'] = float(price) if isinstance(price, (int, float)) else self.clean_price(str(price))

        # Extraire l'année depuis le nom si absente
        if not out.get('annee') and out.get('name'):
            m = re.search(r'\b(20\d{2}|19\d{2})\b', out['name'])
            if m:
                out['annee'] = int(m.group(1))

        # Extraire le modèle depuis le nom si absent (après année et marque)
        if not out.get('modele') and out.get('name') and out.get('marque'):
            name_clean = out['name']
            if out.get('annee'):
                name_clean = name_clean.replace(str(out['annee']), '').strip()
            name_clean = name_clean.replace(out['marque'], '').strip()
            if name_clean:
                out['modele'] = name_clean.split()[0] if name_clean else ''

    def _extract_css(self, soup: BeautifulSoup, out: Dict) -> None:
        for li in soup.find_all('li', class_='divListItem2'):
            text = li.get_text(strip=True)
            if not text:
                continue
            lower = text.lower()
            # Kilométrage (FR et EN)
            if ('kilometers:' in lower or 'kilométrage:' in lower or 'kilometrage:' in lower) and not out.get('kilometrage'):
                m = re.search(r'([\d\s,]+)\s*km', text, re.IGNORECASE)
                if m:
                    km_val = self.clean_mileage(m.group(1))
                    if km_val:
                        out['kilometrage'] = km_val
            # Couleur extérieure (FR et EN)
            elif any(kw in lower for kw in ('exterior colour:', 'couleur extérieure:', 'couleur exterieure:')) and not out.get('couleur'):
                val = text.split(':', 1)[-1].strip()
                if val:
                    out['couleur'] = val
            # Couleur intérieure (FR et EN)
            elif any(kw in lower for kw in ('interior colour:', 'couleur intérieure:', 'couleur interieure:')) and not out.get('couleur_int'):
                val = text.split(':', 1)[-1].strip()
                if val:
                    out['couleur_int'] = val

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()

        if categories is None:
            categories = ['inventaire', 'occasion']

        print(f"\n{'='*70}")
        print(f"  SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"  Site: {self.SITE_URL}")
        print(f"  Catégories: {categories}")

        products = self._try_api_then_pages(categories)

        for p in products:
            if not p.get('etat'):
                p['etat'] = self._classify_state(p)

        if inventory_only:
            products = [p for p in products if p.get('sourceCategorie') != 'catalogue']

        pre_group = len(products)
        products = self._group_identical_products(products)
        if pre_group != len(products):
            grouped = pre_group - len(products)
            print(f"\n  Regroupement: {pre_group} -> {len(products)} ({grouped} combinés)")

        elapsed = time.time() - start_time

        print(f"\n{'='*70}")
        print(f"  {self.SITE_NAME}: {len(products)} produits en {elapsed:.1f}s")
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
                'selectors': 'generated',
            }
        }

    def _try_api_then_pages(self, categories: List[str]) -> List[Dict]:
        """Essaie d'abord l'interception API, puis fallback sur extraction par page."""
        api_products = self._try_runtime_api_intercept()
        if api_products and len(api_products) >= 5:
            print(f"  API interceptée: {len(api_products)} produits")
            return api_products

        product_urls = self.discover_product_urls(categories)
        print(f"\n  {len(product_urls)} URLs de produits découvertes")

        if not product_urls:
            return []

        return self._extract_all(product_urls)

    def _try_runtime_api_intercept(self) -> List[Dict]:
        """Tente d'intercepter une API interne au runtime via Playwright."""
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return []

        inventory_urls = [self.SITE_URL]
        base = urlparse(self.SITE_URL)
        origin = f"{base.scheme}://{base.netloc}"
        for path in ['/new/inventory.html', '/used/search.html', '/en/new/inventory/',
                     '/fr/inventaire-neuf/', '/inventory/', '/inventaire/']:
            inventory_urls.append(origin + path)

        captured = []

        def on_response(response):
            try:
                ct = response.headers.get('content-type', '')
                if 'json' not in ct:
                    return
                if response.status != 200:
                    return
                url = response.url
                if any(skip in url for skip in ['google', 'facebook', 'analytics', 'fonts.', '.css', '.js']):
                    return
                body = response.text()
                if len(body) < 100:
                    return
                data = json.loads(body)
                captured.append(data)
            except Exception:
                pass

        products = []
        try:
            pw = sync_playwright().start()
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent=self.session.headers.get('User-Agent', ''),
                locale='fr-CA',
            )
            page = ctx.new_page()
            page.on('response', on_response)

            for inv_url in inventory_urls[:3]:
                captured.clear()
                try:
                    page.goto(inv_url, timeout=15000, wait_until='networkidle')
                except Exception:
                    continue

                page.wait_for_timeout(2000)

                for data in captured:
                    items = self._find_product_array(data)
                    if items and len(items) >= 2:
                        for raw in items:
                            p = self._map_raw_product(raw)
                            if p:
                                products.append(p)
                        if products:
                            break
                if products:
                    break

            browser.close()
            pw.stop()
        except Exception:
            pass

        return products

    def _find_product_array(self, data, depth=0):
        if depth > 4:
            return None
        if isinstance(data, list) and len(data) >= 2:
            if all(isinstance(x, dict) for x in data[:5]):
                return data
        if isinstance(data, dict):
            for v in data.values():
                result = self._find_product_array(v, depth + 1)
                if result:
                    return result
        return None

    def _map_raw_product(self, raw: Dict) -> Optional[Dict]:
        if not isinstance(raw, dict):
            return None
        out: Dict[str, Any] = {}
        field_map = {
            'name': ['name', 'nom', 'title', 'titre', 'vehicleName', 'vehicle_name'],
            'prix': ['prix', 'price', 'msrp', 'salePrice', 'sale_price', 'askingPrice'],
            'marque': ['brand', 'marque', 'make', 'manufacturer', 'brandName'],
            'modele': ['model', 'modele', 'modelName', 'model_name'],
            'annee': ['year', 'annee', 'modelYear', 'model_year'],
            'image': ['image', 'photo', 'thumbnail', 'img', 'imageUrl', 'image_url', 'mainPhoto'],
            'kilometrage': ['mileage', 'kilometrage', 'km', 'odometer'],
            'vin': ['vin', 'vinNumber', 'vin_number'],
            'couleur': ['color', 'colour', 'couleur', 'exteriorColor'],
        }
        for target, sources in field_map.items():
            for src in sources:
                val = raw.get(src)
                if val is not None and val != '':
                    if target == 'prix':
                        out[target] = float(val) if isinstance(val, (int, float)) else self._parse_price(str(val))
                    elif target == 'annee':
                        out[target] = int(val) if isinstance(val, (int, float)) else self.clean_year(str(val))
                    elif target == 'kilometrage':
                        out[target] = int(val) if isinstance(val, (int, float)) else self.clean_mileage(str(val))
                    elif target == 'image' and isinstance(val, list):
                        out[target] = val[0] if val else ''
                    else:
                        out[target] = str(val)
                    break

        if not out.get('name'):
            parts = [out.get('annee', ''), out.get('marque', ''), out.get('modele', '')]
            name = ' '.join(str(p) for p in parts if p)
            if name.strip():
                out['name'] = name

        if not out.get('name'):
            return None

        out['sourceUrl'] = raw.get('url', raw.get('detailUrl', raw.get('detail_url', self.SITE_URL)))
        out['sourceSite'] = self.SITE_URL
        out['quantity'] = 1
        out['groupedUrls'] = [out.get('sourceUrl', '')]
        return out

    def _group_identical_products(self, products: List[Dict]) -> List[Dict]:
        groups: Dict[str, Dict] = {}
        for p in products:
            # Chaque VIN identifie un véhicule unique — ne jamais fusionner
            vin = str(p.get('vin', '')).strip().upper()
            if vin and len(vin) >= 10:
                key = f"vin:{vin}"
            else:
                marque = str(p.get('marque', '')).lower().strip()
                modele = str(p.get('modele', '')).lower().strip()
                annee = str(p.get('annee', ''))
                etat = str(p.get('etat', ''))
                key = f"{marque}|{modele}|{annee}|{etat}" if marque and modele else f"{p.get('name', '')}|{annee}|{etat}"
                key = key.lower()

            if key in groups:
                existing = groups[key]
                existing['quantity'] = existing.get('quantity', 1) + 1
                existing['groupedUrls'] = existing.get('groupedUrls', []) + p.get('groupedUrls', [p.get('sourceUrl', '')])
                if p.get('prix') and (not existing.get('prix') or p['prix'] < existing['prix']):
                    existing['prix'] = p['prix']
            else:
                groups[key] = p

        return list(groups.values())

    def _parse_price(self, text: str) -> Optional[float]:
        if not text:
            return None
        text = text.strip()
        skip_patterns = [
            'prix sur demande', 'call for price', 'appelez', 'contactez',
            'nous contacter', 'request a quote', 'sur demande',
        ]
        if any(p in text.lower() for p in skip_patterns):
            return None

        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'PDSF|MSRP|Prix\s*:', '', text, flags=re.IGNORECASE)

        prices = re.findall(r'[\d\s,.]+', text.replace('\xa0', ' '))
        for raw in prices:
            cleaned = raw.strip().replace(' ', '').replace(',', '').replace('\xa0', '')
            if '.' in cleaned:
                parts = cleaned.split('.')
                if len(parts[-1]) > 2:
                    cleaned = cleaned.replace('.', '')
            try:
                val = float(cleaned)
                if 100 <= val <= 500000:
                    return val
            except (ValueError, TypeError):
                continue
        return None

    def _classify_state(self, product: Dict) -> str:
        signals = ' '.join([
            str(product.get('name', '')),
            str(product.get('sourceUrl', '')),
            str(product.get('sourceCategorie', '')),
            str(product.get('etat', '')),
        ]).lower()

        if any(w in signals for w in ['occasion', 'used', 'usagé', 'usages', 'pre-owned', 'préowned']):
            return 'occasion'
        if any(w in signals for w in ['demo', 'démo', 'demonstrateur', 'démonstrateur']):
            return 'demonstrateur'
        if any(w in signals for w in ['liquidation', 'clearance']):
            return 'neuf'
        return 'neuf'

    def _is_soft_404(self, soup: BeautifulSoup) -> bool:
        title = soup.find('title')
        if title:
            t = title.get_text(strip=True).lower()
            if any(w in t for w in ['404', 'introuvable', 'not found', 'page removed', 'erreur']):
                return True
        body_text = soup.get_text(separator=' ', strip=True)
        if len(body_text) < 500:
            return True
        h1 = soup.find('h1')
        if h1:
            h1_text = h1.get_text(strip=True).lower()
            if any(w in h1_text for w in ['404', 'not found', 'introuvable', 'page non trouvée']):
                return True
        return False

