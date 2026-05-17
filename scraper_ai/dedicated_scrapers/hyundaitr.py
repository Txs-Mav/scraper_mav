"""
Scraper dédié pour hyundaitr.com (hyundaitr.com).
Généré par scraper_usine le 2026-05-16.
Stratégie: home productList JS + listing pages + détail HTML
Plateforme: Hyundai Electronics Turquie (TV, Klimalar, Su Arıtma, Scooter)
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


class HyundaitrScraper(DedicatedScraper):

    SITE_NAME = "hyundaitr.com"
    SITE_SLUG = "hyundaitr"
    SITE_URL = "https://hyundaitr.com/"
    SITE_DOMAIN = "hyundaitr.com"

    # Pages de listing réelles du site Hyundai Electronics TR
    LISTING_PAGES = {
        'televizyonlar': {
            'url': 'https://hyundaitr.com/televizyonlar/',
            'category': 'Televizyon',
        },
        'klimalar': {
            'url': 'https://hyundaitr.com/klimalar/',
            'category': 'Klima',
        },
        'su-aritma': {
            'url': 'https://hyundaitr.com/su-aritma-su-sebili/',
            'category': 'Su Arıtma',
        },
        'scooter': {
            'url': 'https://hyundaitr.com/scooter/',
            'category': 'Scooter',
        },
        'home': {
            'url': 'https://hyundaitr.com/',
            'category': 'Home',
        },
    }
    PRODUCTS_PER_PAGE = 50
    WORKERS = 5
    HTTP_TIMEOUT = 20

    # Site statique => pas besoin de Playwright
    USE_PLAYWRIGHT_FOR_DISCOVERY = False

    def __init__(self):
        super().__init__()
        self._product_labels: Dict[str, str] = {}

    # ================================================================
    # PHASE 1 — Découverte d'URLs
    # ================================================================

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['all']

        all_urls: List[str] = []

        # 1) Extraction depuis la home (window.productList contient TOUS les produits)
        try:
            home_html = self._fetch_listing_html(self.SITE_URL)
            if home_html:
                js_urls = self._extract_urls_from_productlist_js(home_html)
                all_urls.extend(js_urls)
        except Exception:
            pass

        # 2) Parcours des pages de listing pour récupérer les liens manquants
        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key == 'home':
                continue
            if not self._category_matches(cat_key, categories):
                continue

            listing_url = config['url']
            try:
                html = self._fetch_listing_html(listing_url)
                if not html:
                    continue
                soup = BeautifulSoup(html, 'lxml')

                # productList JS aussi présent dans les pages de listing
                js_urls = self._extract_urls_from_productlist_js(html)
                all_urls.extend(js_urls)

                # Liens CSS
                all_urls.extend(self._extract_urls_from_listing(soup, listing_url))

                # Pagination éventuelle
                total = self._parse_total_products(soup)
                if total > 0:
                    total_pages = max(1, math.ceil(total / self.PRODUCTS_PER_PAGE))
                    for page_num in range(2, total_pages + 1):
                        page_url = self._build_paginated_url(listing_url, 'page', page_num)
                        time.sleep(0.3)
                        html_p = self._fetch_listing_html(page_url)
                        if not html_p:
                            break
                        soup_p = BeautifulSoup(html_p, 'lxml')
                        all_urls.extend(self._extract_urls_from_listing(soup_p, listing_url))
            except Exception:
                continue

        # Dédup en conservant l'ordre
        seen = set()
        unique: List[str] = []
        for u in all_urls:
            u_norm = self._normalize_url(u)
            key = u_norm.rstrip('/').lower()
            if key not in seen and self._is_product_url(u_norm):
                seen.add(key)
                unique.append(u_norm)
        return unique

    def _extract_urls_from_productlist_js(self, html: str) -> List[str]:
        """Extrait les URLs depuis window.productList = [...] dans le HTML."""
        urls: List[str] = []
        if not html:
            return urls
        # On cherche le bloc JS
        match = re.search(r'window\.productList\s*=\s*(\[.*?\])\s*;', html, re.DOTALL)
        if not match:
            return urls
        raw = match.group(1)
        try:
            data = json.loads(raw)
        except Exception:
            return urls
        if not isinstance(data, list):
            return urls
        for entry in data:
            if not isinstance(entry, dict):
                continue
            url = entry.get('value') or ''
            label = entry.get('label') or ''
            if url:
                url_norm = self._normalize_url(url)
                urls.append(url_norm)
                if label:
                    self._product_labels[url_norm.rstrip('/').lower()] = label
        return urls

    def _parse_total_products(self, soup: BeautifulSoup) -> int:
        candidates = (
            '.total-products', '.result-count', '.products-count',
            '[data-total]', '.results-count', '.product-count',
        )
        for sel in candidates:
            el = soup.select_one(sel)
            if not el:
                continue
            text = el.get_text(' ', strip=True)
            m = re.search(r'(\d{1,6})', text.replace(',', '').replace(' ', ''))
            if m:
                return int(m.group(1))
        return 0

    def _extract_urls_from_listing(self, soup: BeautifulSoup, base_url: str) -> List[str]:
        urls: List[str] = []
        selectors = [
            'a[href*="/televizyonlar/"]',
            'a[href*="/klimalar/"]',
            'a[href*="/su-aritma-su-sebili/"]',
            'a[href*="/scooter/"]',
            '.product a[href]',
            '.product-card a[href]',
            'article a[href]',
            '[class*="product"] a[href]',
        ]
        for sel in selectors:
            for link in soup.select(sel):
                href = link.get('href')
                if not href:
                    continue
                if href.startswith(('#', 'javascript:', 'mailto:', 'tel:')):
                    continue
                full = urljoin(base_url, href)
                full = self._normalize_url(full)
                if self._is_product_url(full):
                    urls.append(full)
        return urls

    # ================================================================
    # PHASE 2 — Extraction page détail
    # ================================================================

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        if self._is_soft_404(soup):
            return None

        out: Dict[str, Any] = {}

        self._extract_json_ld(soup, out)
        self._extract_css(soup, out)
        self._extract_meta_tags(soup, out)
        self._extract_regex_fallback(html, out)

        # Nom : utiliser productList label si dispo
        url_key = url.rstrip('/').lower()
        if not out.get('name') and url_key in self._product_labels:
            out['name'] = self._product_labels[url_key]

        if not out.get('name'):
            for sel in ('h1.product-title', 'h1.title', 'h1', '.product-name',
                        '.model-title', '[class*="product-title"]',
                        'meta[property="og:title"]', 'title'):
                el = soup.select_one(sel)
                if not el:
                    continue
                if el.name == 'meta':
                    txt = el.get('content', '').strip()
                else:
                    txt = el.get_text(strip=True)
                if txt and 3 < len(txt) < 250 and 'HYUNDAI ELECTRONICS' not in txt.upper():
                    out['name'] = txt
                    break
                elif txt and 'HYUNDAI ELECTRONICS' in txt.upper() and not out.get('name'):
                    # Pire des cas, on garde mais on essaie autre chose après
                    pass

        # Image
        if not out.get('image'):
            for sel in ('meta[property="og:image"]', '.product-image img',
                        '.main-image img', '.gallery img', '.product-gallery img',
                        '.swiper-slide img', 'img.img-fluid'):
                el = soup.select_one(sel)
                if not el:
                    continue
                if el.name == 'meta':
                    src = el.get('content', '')
                else:
                    src = (el.get('src') or el.get('data-src')
                           or el.get('data-lazy-src') or '')
                if src and not src.startswith('data:') and 'logo' not in src.lower():
                    out['image'] = src if src.startswith('http') else urljoin(url, src)
                    break

        # Marque par défaut
        if not out.get('marque'):
            out['marque'] = 'Hyundai'

        # Catégorie depuis URL
        if not out.get('categorie'):
            out['categorie'] = self._extract_category_from_url(url)

        # Modèle depuis URL si manquant
        if not out.get('modele'):
            out['modele'] = self._extract_model_from_url(url, out.get('name', ''))

        out['sourceUrl'] = url

        # On accepte si nom OU label disponible
        return out if out.get('name') else None

    def _extract_category_from_url(self, url: str) -> Optional[str]:
        path = urlparse(url).path.lower()
        if '/televizyonlar/' in path:
            return 'Televizyon'
        if '/klimalar/' in path:
            return 'Klima'
        if '/su-aritma' in path or '/su-sebili' in path:
            return 'Su Arıtma & Su Sebili'
        if '/scooter/' in path:
            return 'Scooter'
        return None

    def _extract_model_from_url(self, url: str, name: str = '') -> Optional[str]:
        path = urlparse(url).path.strip('/').lower()
        segments = [s for s in path.split('/') if s]
        if segments:
            slug = segments[-1]
            # Référence type 32hyn2000, q55hyn2205, m65hyn2205
            m = re.match(r'^([qm]?\d{2,3}hyn\d{3,5})$', slug)
            if m:
                return m.group(1).upper()
            # Sinon slug nettoyé
            if slug and len(slug) < 80:
                return slug.replace('-', ' ').title()
        # Fallback : extraire reference depuis le nom
        if name:
            m = re.search(r'\b([QM]?\d{2,3}HYN\d{3,5})\b', name, re.IGNORECASE)
            if m:
                return m.group(1).upper()
        return None

    def _extract_meta_tags(self, soup: BeautifulSoup, out: Dict) -> None:
        """Récupère depuis les meta og:* / description."""
        if not out.get('name'):
            el = soup.select_one('meta[property="og:title"], meta[name="og:title"]')
            if el:
                txt = (el.get('content') or '').strip()
                if txt and 'HYUNDAI ELECTRONICS' != txt.upper():
                    out['name'] = txt

        if not out.get('description'):
            for sel in ('meta[property="og:description"]',
                        'meta[name="og:description"]',
                        'meta[name="description"]',
                        'meta[itemprop="description"]'):
                el = soup.select_one(sel)
                if el:
                    txt = (el.get('content') or '').strip()
                    if txt and txt.upper() != 'HYUNDAI ELECTRONICS':
                        out['description'] = txt[:1000]
                        break

        if not out.get('image'):
            el = soup.select_one('meta[property="og:image"], meta[name="og:image"]')
            if el:
                src = (el.get('content') or '').strip()
                if src and 'logo' not in src.lower():
                    out['image'] = src

    def _extract_json_ld(self, soup: BeautifulSoup, out: Dict) -> None:
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string or '')
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    continue
                t = item.get('@type', '')
                if isinstance(t, list):
                    t = t[0] if t else ''
                if t not in ('Product', 'IndividualProduct', 'Offer'):
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

                if item.get('sku') and not out.get('sku'):
                    out['sku'] = str(item['sku'])

                img = item.get('image', '')
                if isinstance(img, list) and img:
                    img = img[0]
                if img and not out.get('image'):
                    out['image'] = img if isinstance(img, str) else (
                        img.get('url') if isinstance(img, dict) else '')

                offers = item.get('offers', {})
                if isinstance(offers, list) and offers:
                    offers = offers[0]
                if isinstance(offers, dict):
                    price = offers.get('price')
                    if price and not out.get('prix'):
                        try:
                            out['prix'] = (float(price) if isinstance(price, (int, float))
                                           else self.clean_price(str(price)))
                        except (ValueError, TypeError):
                            pass

    def _extract_css(self, soup: BeautifulSoup, out: Dict) -> None:
        # Nom
        if not out.get('name'):
            for sel in ('h1.product-title', 'h1.title', '.product-name h1',
                        '.product-detail h1', 'h1'):
                el = soup.select_one(sel)
                if el:
                    txt = el.get_text(strip=True)
                    if txt and len(txt) < 250:
                        out['name'] = txt
                        break

        # Prix
        if not out.get('prix'):
            for sel in ('.price', '.product-price', '[itemprop="price"]',
                        '.fiyat', '[class*="fiyat"]', '[class*="price"]'):
                el = soup.select_one(sel)
                if el:
                    parsed = self._parse_price(el.get_text(' ', strip=True))
                    if parsed:
                        out['prix'] = parsed
                        break

        # Description
        if not out.get('description'):
            for sel in ('.product-description', '.description',
                        '.product-detail-description', '[itemprop="description"]',
                        '.product-content', '.detail-content'):
                el = soup.select_one(sel)
                if not el:
                    continue
                txt = el.get_text(' ', strip=True)
                if txt and len(txt) > 30:
                    out['description'] = txt[:1000]
                    break

        # Specs / features (texte libre)
        if not out.get('features'):
            features = []
            for sel in ('.product-features li', '.features li',
                        '.product-specs li', '.specs li', '.spec-list li'):
                for el in soup.select(sel):
                    txt = el.get_text(' ', strip=True)
                    if txt and len(txt) < 200:
                        features.append(txt)
                if features:
                    break
            if features:
                out['features'] = features[:30]

    def _extract_regex_fallback(self, html: str, out: Dict) -> None:
        if not html:
            return

        if not out.get('prix'):
            m = re.search(r'(?:₺|TL|TRY)\s*([\d.,\s]{3,20})', html)
            if not m:
                m = re.search(r'([\d.,\s]{3,20})\s*(?:₺|TL|TRY)', html)
            if m:
                parsed = self.clean_price(m.group(1))
                if parsed:
                    out['prix'] = parsed

    # ================================================================
    # SCRAPE principal
    # ================================================================

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()

        if categories is None:
            categories = ['all']

        print(f"\n{'='*70}")
        print(f"  SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"  Site: {self.SITE_URL}")
        print(f"  Catégories: {categories}")

        product_urls = self.discover_product_urls(categories)
        print(f"\n  {len(product_urls)} URLs de produits découvertes")

        if not product_urls:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        products = self._extract_all(product_urls)

        for p in products:
            if not p.get('etat'):
                p['etat'] = 'neuf'

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

    def _group_identical_products(self, products: List[Dict]) -> List[Dict]:
        groups: Dict[str, Dict] = {}
        for p in products:
            sku = str(p.get('sku', '')).strip().upper()
            modele = str(p.get('modele', '')).strip().lower()
            if sku:
                key = f"sku:{sku}"
            elif modele:
                key = f"mod:{modele}"
            else:
                key = f"name:{str(p.get('name', '')).lower()}"

            if key in groups:
                existing = groups[key]
                existing['quantity'] = existing.get('quantity', 1) + 1
                existing['groupedUrls'] = existing.get('groupedUrls', []) + \
                    p.get('groupedUrls', [p.get('sourceUrl', '')])
            else:
                groups[key] = p
        return list(groups.values())

    # ================================================================
    # Helpers
    # ================================================================

    _IS_PRODUCT_URL_EXCLUDED_PATHS = [
        "/iletisim", "/kurumsal", "/destek", "/destek-formu",
        "/basinda-biz", "/servis-noktalarimiz", "/kullanim-kilavuzu",
        "/onemli-bilgiler", "/cerez", "/kvkk",
        "/login", "/account", "/cart", "/sepet",
        "/uploads/", "/assets/",
    ]
    _IS_PRODUCT_URL_DETAIL_PATTERNS = [
        "/televizyonlar/", "/klimalar/", "/su-aritma-su-sebili/", "/scooter/",
    ]
    _IS_PRODUCT_URL_EXTRA_SIGNALS: List[str] = []

    _CATEGORY_ALIASES = {
        'televizyonlar': ('televizyonlar', 'tv', 'television', 'televisions'),
        'klimalar':      ('klimalar', 'klima', 'air-conditioner', 'ac'),
        'su-aritma':     ('su-aritma', 'su-sebili', 'water', 'water-purifier'),
        'scooter':       ('scooter', 'scooters'),
    }

    def _category_matches(self, cat_key: str, requested) -> bool:
        if not requested:
            return True
        cat_lower = (cat_key or '').lower()
        for r in requested:
            r_lower = (r or '').lower()
            if r_lower == cat_lower or r_lower == 'all':
                return True
            for canon, aliases in self._CATEGORY_ALIASES.items():
                if r_lower in aliases and cat_lower in aliases:
                    return True
        return False

    def _is_product_url(self, url: str) -> bool:
        try:
            parsed = urlparse(url)
            if self.SITE_DOMAIN not in parsed.netloc.lower():
                return False
            path = parsed.path.lower()
            if not path or path == '/':
                return False
            for excl in self._IS_PRODUCT_URL_EXCLUDED_PATHS:
                if excl in path:
                    return False
            # Page de listing (sans détail) => exclure
            listing_only = (
                '/televizyonlar/', '/klimalar/',
                '/su-aritma-su-sebili/', '/scooter/',
            )
            # On veut au moins un segment APRÈS la catégorie
            for cat in self._IS_PRODUCT_URL_DETAIL_PATTERNS:
                if cat in path:
                    # Récupérer ce qui vient après
                    after = path.split(cat, 1)[1].strip('/')
                    if after and '/' not in after.strip('/'):
                        # un seul segment = slug produit
                        return True
                    if after:
                        return True
            return False
        except Exception:
            return False

    def _parse_price(self, text):
        if not text:
            return None
        text = str(text).strip()
        skip_patterns = (
            'fiyat sorunuz', 'bilgi alin', 'sur demande',
            'price on request', 'call for price',
        )
        low = text.lower()
        if any(p in low for p in skip_patterns):
            return None
        text = re.sub(r'<[^>]+>', '', text)
        amounts = re.findall(r'[\d][\d\s,.]+', text.replace('\xa0', ' '))
        for raw in amounts:
            parsed = self.clean_price(raw)
            if parsed:
                return parsed
        return None

    @staticmethod
    def _build_paginated_url(base_url: str, param: str, value) -> str:
        try:
            from ._usine_helpers import build_paginated_url
            return build_paginated_url(base_url, param, value)
        except Exception:
            sep = '&' if '?' in base_url else '?'
            return f"{base_url}{sep}{param}={value}"

    @staticmethod
    def _normalize_url(url: str) -> str:
        try:
            from ._usine_helpers import normalize_url
            return normalize_url(url, strip_tracking=True)
        except Exception:
            return url

    def _fetch_listing_html(self, url: str):
        try:
            resp = self.session.get(url, timeout=self.HTTP_TIMEOUT)
            if resp.status_code != 200:
                return None
            return resp.text
        except Exception:
            return None

    def _is_soft_404(self, soup: BeautifulSoup) -> bool:
        title = soup.find('title')
        if title:
            t = title.get_text(strip=True).lower()
            if any(w in t for w in ('404', 'not found', 'bulunamadi', 'bulunamadı', 'sayfa bulunamadi')):
                return True
        body_text = soup.get_text(separator=' ', strip=True)
        if len(body_text) < 200:
            return True
        h1 = soup.find('h1')
        if h1:
            h1_text = h1.get_text(strip=True).lower()
            if any(w in h1_text for w in ('404', 'not found', 'bulunamadi', 'bulunamadı')):
                return True
        return False
