"""
Scraper dédié pour Excel Moto | Your Dealership in Montréal (excelmoto.com).
Généré par scraper_usine le 2026-05-17.
Stratégie: sitemap + hybrid
Plateforme: PowerGO / Next.js
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


class ExcelmotoScraper(DedicatedScraper):

    SITE_NAME = "Excel Moto | Your Dealership in Montréal"
    SITE_SLUG = "excelmoto"
    SITE_URL = "https://www.excelmoto.com/en/"
    SITE_DOMAIN = "excelmoto.com"
    SITEMAP_URL = "https://www.excelmoto.com/sitemaps/inventory-detail.xml"
    WORKERS = 8
    HTTP_TIMEOUT = 20
    def __init__(self):
        super().__init__()
    # ================================================================
    # PHASE 1 — Découverte d'URLs via sitemap XML
    # ================================================================

    # Patterns de catégorie injectés par le générateur.
    _SITEMAP_CATEGORY_PATTERNS = {
        'inventaire': ('/neuf/', '/neufs/', '/new/', '/inventaire-neuf/', '/inventaire/'),
        'occasion':   ('/usage/', '/usages/', '/occasion/', '/occasions/', '/used/',
                       '/pre-owned/', '/preowned/', '/certified/'),
    }

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['all']

        raw_urls = self._parse_sitemap_live()
        if not raw_urls:
            return []

        # Filtre 1 : règles _is_product_url (paramétrées par DomainProfile + Plateforme)
        product_urls = [u for u in raw_urls if self._is_product_url(u)]

        # Filtre 2 : catégories demandées (si patterns disponibles pour le profil)
        if categories and 'all' not in [c.lower() for c in categories]:
            wanted_patterns: List[str] = []
            cats_lower = {c.lower() for c in categories}
            for cat, patterns in self._SITEMAP_CATEGORY_PATTERNS.items():
                if cat in cats_lower or any(c in cat for c in cats_lower):
                    wanted_patterns.extend(patterns)
            if wanted_patterns:
                filtered = [u for u in product_urls
                            if any(p in u.lower() for p in wanted_patterns)]
                # Si le filtre tue tout, on retombe sur la liste large (le profil
                # n'a peut-être pas de marqueur catégorie clair pour ce site).
                if filtered:
                    product_urls = filtered

        # Filtre 3 : préférer FR sur EN
        product_urls = self._filter_language_duplicates(product_urls, prefer='fr')

        # Déduplication par ID produit (eDealer/PowerGO ont parfois /fr/.../id123 et
        # /en/.../id123 pour le même véhicule).
        id_map: Dict[str, str] = {}
        no_id: List[str] = []
        _FR_HINT = ('/fr/', '/neuf', '/usage', '/occasion')
        for u in product_urls:
            m = re.search(r'(?:-id|/id)(\d{2,})', u)
            if m:
                pid = m.group(1)
                existing = id_map.get(pid)
                if existing is None:
                    id_map[pid] = u
                else:
                    if any(h in u.lower() for h in _FR_HINT) and not any(
                            h in existing.lower() for h in _FR_HINT):
                        id_map[pid] = u
            else:
                no_id.append(u)

        seen = set()
        result: List[str] = list(id_map.values())
        for u in no_id:
            k = u.rstrip('/').lower()
            if k not in seen:
                seen.add(k)
                result.append(u)
        return result

    def _parse_sitemap_live(self) -> List[str]:
        """Récupère les URLs de tous les sitemaps connus (live, pas de cache).

        Étend la liste de candidats aux patterns Yoast (motorcycle-sitemap1.xml,
        atv-sitemap.xml, inventory-sitemap.xml, etc.) en plus des sitemaps standard.
        """
        base = self.SITE_URL.rstrip('/')
        parsed = urlparse(base)
        origin = f'{parsed.scheme}://{parsed.netloc}'

        candidates: List[str] = []
        if hasattr(self, 'SITEMAP_URL') and self.SITEMAP_URL:
            candidates.append(self.SITEMAP_URL)
        if hasattr(self, 'SITEMAPS') and self.SITEMAPS:
            try:
                candidates.extend(list(self.SITEMAPS.values()))
            except Exception:
                pass
        candidates += [
            origin + '/sitemaps/inventory-detail.xml',
            origin + '/sitemap-inventory.xml',
            origin + '/sitemap_inventory.xml',
            origin + '/inventory-sitemap.xml',
            origin + '/inventory-sitemap1.xml',
            origin + '/inventory-sitemap2.xml',
            origin + '/motorcycle-sitemap.xml',
            origin + '/motorcycle-sitemap1.xml',
            origin + '/motorcycle-sitemap2.xml',
            origin + '/atv-sitemap.xml',
            origin + '/power-equipment-sitemap.xml',
            origin + '/vehicle-sitemap.xml',
            origin + '/sitemap.xml',
            origin + '/sitemap_index.xml',
            origin + '/robots.txt',
        ]

        product_urls: List[str] = []
        seen_sitemaps: set = set()

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
                            if sm and sm not in seen_sitemaps:
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
                        if u:
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
            h1 = soup.select_one('h1.flex.flex-col.text-4xl.font-extrabold.uppercase.leading-none.text-main-color')
            if h1:
                out['name'] = h1.get_text(strip=True)

        if not out.get('name') and self._is_spa_page(html):
            out = self._extract_with_playwright(url) or {}

        if out:
            self._fix_mojibake_dict(out)

        if not out.get('image'):
            img = soup.select_one('img.product-image, .main-image img, img')
            if img:
                src = img.get('src') or img.get('src', '')
                if src:
                    out['image'] = src if src.startswith('http') else urljoin(url, src)

        # Dernier recours pour l'année : slug d'URL (couvre les pages où
        # productionDate, vehicleModelDate, H1 et title sont tous absents).
        if not out.get('annee'):
            year_from_url = self._extract_year_from_url(url)
            if year_from_url:
                out['annee'] = year_from_url

        return out if out.get('name') else None

    def _is_spa_page(self, html: str) -> bool:
        """Detecte si le HTML est une coquille SPA sans contenu reel."""
        text_len = len(re.sub(r'<[^>]+>', '', html).strip())
        return text_len < 2000 and len(html) > 50000

    def _extract_with_playwright(self, url: str) -> Optional[Dict]:
        """Fallback: rend la page via le BrowserRuntime partagé et extrait
        le contenu."""
        try:
            from ._browser_runtime import BrowserRuntime
        except ImportError:
            return None

        out: Dict[str, Any] = {}
        try:
            if not hasattr(self, '_pw_runtime'):
                self._pw_runtime = BrowserRuntime(
                    user_agent=self.session.headers.get('User-Agent') or None,
                ).start()

            result = self._pw_runtime.render(url)
            if not result.success or not result.html:
                return None

            soup_pw = BeautifulSoup(result.html, 'lxml')

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
        # Collecter tous les items JSON-LD et les trier par priorité de type
        # Vehicle/Car ont le VIN → doivent être traités avant Product
        # MotorVehicle / Motorcycle : variantes du template PowerGO Excel Moto
        # pour les motos, VTT, motoneiges, et équipements mécaniques.
        _TYPE_PRIORITY = ('Vehicle', 'Car', 'AutomotiveVehicle', 'MotorVehicle',
                          'Motorcycle', 'MotorizedBicycle', 'Product',
                          'IndividualProduct')
        all_items = []
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string or '')
            except (json.JSONDecodeError, TypeError, ValueError):
                continue

            # Déballer les structures imbriquées (@graph, listes)
            def _unpack(node):
                results = []
                if isinstance(node, list):
                    for sub in node:
                        results.extend(_unpack(sub))
                elif isinstance(node, dict):
                    if '@graph' in node and isinstance(node['@graph'], list):
                        for sub in node['@graph']:
                            results.extend(_unpack(sub))
                        # Inclure aussi le node de tête s'il a des données utiles
                        node_copy = {k: v for k, v in node.items() if k != '@graph'}
                        if node_copy.get('@type') or node_copy.get('name'):
                            results.append(node_copy)
                    else:
                        results.append(node)
                return results

            all_items.extend(_unpack(data))

        all_items.sort(key=lambda x: next(
            (i for i, t in enumerate(_TYPE_PRIORITY) if x.get('@type') == t), 99
        ))

        for item in all_items:
            if not isinstance(item, dict):
                continue
            t = item.get('@type', '')
            if t not in _TYPE_PRIORITY:
                if 'offers' not in item:
                    continue

            if item.get('name') and not out.get('name'):
                out['name'] = item['name']
            if item.get('description') and not out.get('description'):
                desc = item['description']
                if isinstance(desc, str):
                    out['description'] = self._clean_description(desc)

            brand = item.get('brand', '')
            if not out.get('marque'):
                if isinstance(brand, dict):
                    out['marque'] = brand.get('name', '')
                elif brand:
                    out['marque'] = str(brand)

            if item.get('model') and not out.get('modele'):
                out['modele'] = item['model']

            # VIN: utiliser if not out.get() pour ne jamais écraser une valeur non vide
            vin = item.get('vehicleIdentificationNumber') or item.get('vin') or ''
            if vin and not out.get('vin'):
                out['vin'] = str(vin)

            img = item.get('image', '')
            if isinstance(img, list) and img:
                img = img[0]
            if img and not out.get('image'):
                out['image'] = img

            # Année : PowerGO utilise plusieurs clés selon le type de produit.
            # - 'vehicleModelDate' : schema.org/Vehicle standard (motos, VTT)
            # - 'modelDate'        : schema.org/Product (catalogue, accessoires)
            # - 'productionDate'   : utilisé par Excel Moto et certains
            #   templates PowerGO récents pour les équipements mécaniques
            #   (souffleuses, génératrices, etc.).
            for date_field in ('vehicleModelDate', 'modelDate', 'productionDate'):
                if not out.get('annee') and item.get(date_field) is not None:
                    parsed_year = self.clean_year(str(item[date_field]))
                    if parsed_year and 1900 < parsed_year < 2100:
                        out['annee'] = parsed_year

            mileage = item.get('mileageFromOdometer', item.get('mileage', ''))
            if mileage and not out.get('kilometrage'):
                if isinstance(mileage, dict):
                    out['kilometrage'] = self.clean_mileage(str(mileage.get('value', '')))
                else:
                    out['kilometrage'] = self.clean_mileage(str(mileage))

            if not out.get('prix'):
                price = self._extract_price_from_offers(item.get('offers'))
                if price is not None:
                    out['prix'] = price

        # Extraire l'année depuis le nom puis le <title> quand absente
        # du JSON-LD (couvre les pages PowerGO sans aucune date dans les
        # données structurées).
        if not out.get('annee') and out.get('name'):
            m = re.search(r'\b(20\d{2}|19\d{2})\b', out['name'])
            if m:
                year = int(m.group(1))
                if 1900 < year < 2100:
                    out['annee'] = year
        if not out.get('annee'):
            title_tag = soup.find('title')
            if title_tag:
                m = re.search(r'\b(20\d{2}|19\d{2})\b', title_tag.get_text())
                if m:
                    year = int(m.group(1))
                    if 1900 < year < 2100:
                        out['annee'] = year

        # Extraire le modèle depuis le nom quand absent (après retrait de l'année et de la marque)
        if not out.get('modele') and out.get('name') and out.get('marque'):
            name_rest = out['name']
            if out.get('annee'):
                name_rest = name_rest.replace(str(out['annee']), '')
            name_rest = name_rest.replace(out['marque'], '').strip()
            if name_rest:
                out['modele'] = name_rest.split()[0]

    def _extract_price_from_offers(self, offers: Any) -> Optional[float]:
        """Retourne le prix le plus pertinent depuis offers (dict ou list).

        Gère :
          - ``offers`` en liste (showroom multi-couleurs) : on prend le min.
          - ``price`` numérique ou string (ex: "12 999 $").
          - Fallbacks ``lowPrice``, ``highPrice``, ``priceSpecification.price``.
          - Filtre les valeurs aberrantes via ``PRICE_MIN``/``PRICE_MAX``.
        """
        if not offers:
            return None
        items = offers if isinstance(offers, list) else [offers]
        candidates: List[float] = []
        for offer in items:
            if not isinstance(offer, dict):
                continue
            raw_values = []
            for key in ('price', 'lowPrice', 'highPrice'):
                if offer.get(key) is not None:
                    raw_values.append(offer[key])
            spec = offer.get('priceSpecification')
            if isinstance(spec, dict) and spec.get('price') is not None:
                raw_values.append(spec['price'])
            elif isinstance(spec, list):
                for s in spec:
                    if isinstance(s, dict) and s.get('price') is not None:
                        raw_values.append(s['price'])

            for raw in raw_values:
                if isinstance(raw, (int, float)):
                    val = float(raw)
                else:
                    parsed = self.clean_price(str(raw))
                    if parsed is None:
                        continue
                    val = parsed
                if self.PRICE_MIN < val <= self.PRICE_MAX:
                    candidates.append(val)
        return min(candidates) if candidates else None

    @staticmethod
    def _extract_year_from_url(url: str) -> Optional[int]:
        """Extrait une année depuis le slug d'URL.

        Gère les patterns PowerGO usuels :
          - /en/used/2023-yamaha-mt-09-id12345
          - /fr/neuf/yamaha-yfz450r-2024-a-vendre-id99
          - /honda/crf250l/2025/
        """
        if not url:
            return None
        m = re.search(r'[/-](19\d{2}|20\d{2})(?:[/-]|\.html?|$)', url)
        if m:
            year = int(m.group(1))
            if 1990 <= year <= 2100:
                return year
        return None

    @staticmethod
    def _clean_description(text: str) -> str:
        """Nettoie une description: décode entités HTML, retire tags, normalise
        les espaces (incluant &nbsp; en cascade)."""
        if not text:
            return ''
        try:
            import html as _html
            text = _html.unescape(text)
        except Exception:
            pass
        # Retirer tags HTML résiduels
        text = re.sub(r'<[^>]+>', ' ', text)
        # Normaliser nbsp et espaces multiples
        text = text.replace('\xa0', ' ').replace('\u00a0', ' ')
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n\s*\n+', '\n\n', text)
        text = text.strip()
        return text

    def _extract_css(self, soup: BeautifulSoup, out: Dict) -> None:
        if not out.get('name'):
            el = soup.select_one('h1.flex.flex-col.text-4xl.font-extrabold.uppercase.leading-none.text-main-color')
            if el:
                out['name'] = el.get_text(strip=True)
        if not out.get('prix'):
            el = soup.select_one('div.pg-vehicle-price.flex.items-center.font-bold.text-main-color')
            if el:
                out['prix'] = self._parse_price(el.get_text(strip=True))

        # Description: fallback CSS sur la section description PowerGO
        if not out.get('description'):
            desc_selectors = [
                'div.pg-vehicle-description div.prose',
                'div.pg-vehicle-description .prose',
                'div.pg-vehicle-description',
                'section.pg-vehicle-description',
                'div.prose.prose-sm',
                'div.prose',
                '[class*="vehicle-description"]',
                '[class*="product-description"]',
            ]
            for sel in desc_selectors:
                el = soup.select_one(sel)
                if el:
                    text = el.get_text(separator='\n', strip=True)
                    text = self._clean_description(text)
                    # Filtrer le titre "Description" seul
                    if text and len(text) > 20 and text.lower().strip() != 'description':
                        # Retirer un éventuel préfixe "Description\n"
                        text = re.sub(r'^description\s*\n+', '', text, flags=re.IGNORECASE)
                        out['description'] = text.strip()
                        break

        # Dernier recours: meta description
        if not out.get('description'):
            meta = soup.find('meta', attrs={'name': 'description'}) or \
                   soup.find('meta', attrs={'property': 'og:description'})
            if meta and meta.get('content'):
                content = self._clean_description(meta['content'])
                if content and len(content) > 20:
                    out['description'] = content

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()

        if categories is None:
            categories = ['all']

        print(f"\n{'='*70}")
        print(f"  SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"  Site: {self.SITE_URL}")
        print(f"  Catégories: {categories}")

        # Discovery URLs (sitemap/listing/api selon stratégie de génération)
        product_urls = self.discover_product_urls(categories)
        print(f"\n  {len(product_urls)} URLs de produits découvertes")

        if not product_urls:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        products = self._extract_all(product_urls)

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

    # ================================================================
    # Helpers — délégués au module partagé _usine_helpers
    # (source de vérité unique entre Phase 1 d'analyse et code généré)
    # ================================================================

    # Règles "URL produit" injectées par le générateur (DomainProfile +
    # PlatformRecipe). Recompilées en regex au premier appel.
    _IS_PRODUCT_URL_EXCLUDED_PATHS = ["/contact", "/about", "/a-propos", "/login", "/account", "/cart", "/panier", "/privacy", "/terms"]
    _IS_PRODUCT_URL_DETAIL_PATTERNS = ["/products/", "/product/", "/p/", "/item/", "/detail/"]
    _IS_PRODUCT_URL_EXTRA_SIGNALS = []

    # Alias bidirectionnels entre catégories logiques et clés de LISTING_PAGES.
    _CATEGORY_ALIASES = {
        'inventaire': ('inventaire', 'neuf', 'neufs', 'new'),
        'occasion':   ('occasion', 'occasions', 'usage', 'usages', 'used', 'pre-owned'),
        'catalogue':  ('catalogue', 'catalog', 'showroom'),
    }

    def _category_matches(self, cat_key: str, requested) -> bool:
        """True si cat_key correspond à au moins une des catégories demandées
        (ou si requested est vide)."""
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
        """Filtre une URL: fiche produit (True) ou page de service/contact/etc (False).
        Paramétré par DomainProfile + PlatformRecipe au moment de la génération."""
        from ._usine_helpers import is_product_url
        return is_product_url(
            url,
            domain=self.SITE_DOMAIN,
            excluded_paths=self._IS_PRODUCT_URL_EXCLUDED_PATHS,
            detail_url_patterns=self._IS_PRODUCT_URL_DETAIL_PATTERNS,
            extra_path_signals=self._IS_PRODUCT_URL_EXTRA_SIGNALS,
        )

    def _parse_price(self, text):
        """Parse un prix depuis du texte. Délègue à base.clean_price (bornes
        PRICE_MIN/PRICE_MAX cohérentes avec le reste du code)."""
        if not text:
            return None
        text = str(text).strip()
        skip_patterns = (
            'prix sur demande', 'call for price', 'appelez', 'contactez',
            'nous contacter', 'request a quote', 'sur demande',
            'price on request', 'a partir de', 'à partir de', 'starting at',
        )
        low = text.lower()
        if any(p in low for p in skip_patterns):
            return None
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'PDSF|MSRP|Prix\s*:|Price\s*:', '', text, flags=re.IGNORECASE)
        amounts = re.findall(r'[\d][\d\s,.]+', text.replace('\xa0', ' '))
        for raw in amounts:
            parsed = self.clean_price(raw)
            if parsed:
                return parsed
        return None

    def _classify_state(self, product: Dict) -> str:
        """Détecte 'neuf' | 'occasion' | 'demonstrateur' depuis les signaux d'un
        produit (name, sourceUrl, sourceCategorie, etat existant).

        Enrichit aussi 'sourceCategorie' si absente (in-place) avec une des
        valeurs : 'inventaire' | 'vehicules_occasion' | 'catalogue'.
        """
        from ._usine_helpers import classify_listing
        text_blob = ' '.join([
            str(product.get('name', '')),
            str(product.get('sourceCategorie', '')),
            str(product.get('etat', '')),
        ])
        url = str(product.get('sourceUrl', ''))
        etat, source_cat = classify_listing(text_blob, url)
        if not product.get('sourceCategorie'):
            product['sourceCategorie'] = source_cat
        return etat

    @staticmethod
    def _build_paginated_url(base_url: str, param: str, value) -> str:
        """Construit une URL avec pagination URL-safe (préserve query params existants)."""
        from ._usine_helpers import build_paginated_url
        return build_paginated_url(base_url, param, value)

    @staticmethod
    def _extract_path_field(data, path: str):
        """Extrait une valeur depuis un dict imbriqué via un chemin pointé."""
        from ._usine_helpers import extract_path_field
        return extract_path_field(data, path)

    @staticmethod
    def _normalize_url(url: str) -> str:
        """Enlève fragment + tracking params (utm_*, gclid, fbclid…)."""
        from ._usine_helpers import normalize_url
        return normalize_url(url, strip_tracking=True)

    @staticmethod
    def _filter_language_duplicates(urls, prefer: str = 'fr'):
        """Si /fr/ et /en/ existent, garde seulement la langue préférée."""
        from ._usine_helpers import filter_language_duplicates
        return filter_language_duplicates(urls, prefer=prefer)

    # Activé par le générateur si rendering=PLAYWRIGHT pour la découverte de
    # listings (sites SPA dont le HTML brut est vide).
    USE_PLAYWRIGHT_FOR_DISCOVERY = False

    def _fetch_listing_html(self, url: str):
        """Récupère le HTML d'une page listing. Utilise le BrowserRuntime
        partagé si la stratégie l'exige (USE_PLAYWRIGHT_FOR_DISCOVERY=True),
        sinon requests."""
        if not self.USE_PLAYWRIGHT_FOR_DISCOVERY:
            try:
                resp = self.session.get(url, timeout=self.HTTP_TIMEOUT)
                if resp.status_code != 200:
                    return None
                return resp.text
            except Exception:
                return None

        try:
            from ._browser_runtime import BrowserRuntime
        except ImportError:
            try:
                resp = self.session.get(url, timeout=self.HTTP_TIMEOUT)
                if resp.status_code != 200:
                    return None
                return resp.text
            except Exception:
                return None

        try:
            if not hasattr(self, '_pw_listing_runtime'):
                self._pw_listing_runtime = BrowserRuntime(
                    user_agent=self.session.headers.get('User-Agent') or None,
                ).start()
            result = self._pw_listing_runtime.render(url)
            return result.html if result.success else None
        except Exception:
            return None

    def _is_soft_404(self, soup: BeautifulSoup) -> bool:
        title = soup.find('title')
        if title:
            t = title.get_text(strip=True).lower()
            if any(w in t for w in ('404', 'introuvable', 'not found', 'page removed', 'erreur')):
                return True
        body_text = soup.get_text(separator=' ', strip=True)
        if len(body_text) < 500:
            return True
        h1 = soup.find('h1')
        if h1:
            h1_text = h1.get_text(strip=True).lower()
            if any(w in h1_text for w in ('404', 'not found', 'introuvable', 'page non trouvée')):
                return True
        return False

    @staticmethod
    def _fix_mojibake_dict(out: Dict) -> None:
        """Corrige le mojibake UTF-8 (Ã©→é, etc.) sur toutes les valeurs string
        d'un dict. Utilise encode('latin-1').decode('utf-8') quand possible."""
        from ._usine_helpers import fix_mojibake_dict
        fix_mojibake_dict(out)

    # Alias pour compat avec les templates existants.
    def _fix_mojibake(self, out: Dict) -> None:
        self._fix_mojibake_dict(out)
