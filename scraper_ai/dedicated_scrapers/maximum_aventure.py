"""
Scraper dédié pour Maximum Aventure (WordPress + PowerGO CDN).

Concessionnaire bateaux, pontons et moteurs hors-bord
situé à Shawinigan, QC (Mauricie).

Stratégie multi-sitemap + détail :
  1. 4 sitemaps Yoast (boat, pontoon, outboard-motor, inventory)
     → découverte de TOUTES les URLs produits
  2. Pages détail (parallèle) → HTML specs (li.make/.model/.year) + OG meta

Le site utilise WordPress 5.9.4 avec le thème PowerGO et Yoast SEO.
Les pages catalogue (boats/pontoons/outboard-motors) sont des fiches
techniques sans prix.  Les pages inventaire sont les produits physiques
en stock (neufs et occasion) avec prix, état et numéro de stock.

Marques : Starcraft, Smoker Craft, Montego Bay, MirroCraft, Armada,
Suzuki, Mercury, Land N Sea.

Types de produits : Bateau, Ponton, Moteur hors-bord, Quai, Accessoire.
"""
import re
import json
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class MaximumAventureScraper(DedicatedScraper):

    SITE_NAME = "Maximum Aventure"
    SITE_SLUG = "maximum-aventure"
    SITE_URL = "https://www.maximumaventure.com/en/"
    SITE_DOMAIN = "maximumaventure.com"

    SITEMAPS = {
        'boat': 'https://www.maximumaventure.com/boat-sitemap.xml',
        'pontoon': 'https://www.maximumaventure.com/pontoon-sitemap.xml',
        'outboard-motor': 'https://www.maximumaventure.com/outboard-motor-sitemap.xml',
        'inventory': 'https://www.maximumaventure.com/inventory-sitemap.xml',
    }

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    _TYPE_MAP = {
        'boat': 'Bateau',
        'bateau': 'Bateau',
        'pontoon': 'Ponton',
        'ponton': 'Ponton',
        'outboard-motor': 'Moteur hors-bord',
        'moteur-hors-bord': 'Moteur hors-bord',
        'inventory': 'Inventaire',
        'inventaire': 'Inventaire',
    }

    _INVENTORY_TYPE_MAP = {
        'bateaux': 'Bateau',
        'boats': 'Bateau',
        'pontons': 'Ponton',
        'pontoons': 'Ponton',
        'moteurs-hors-bord': 'Moteur hors-bord',
        'outboard-motors': 'Moteur hors-bord',
        'quais': 'Quai',
        'docks': 'Quai',
        'remorques': 'Remorque',
        'trailers': 'Remorque',
        'accessoires': 'Accessoire',
        'accessories': 'Accessoire',
    }

    _NORMALIZE_TYPE = {
        'bateau': 'Bateau',
        'boat': 'Bateau',
        'bateau ponté': 'Bateau',
        'deckboat': 'Bateau',
        'runabout': 'Bateau',
        'fishing': 'Bateau',
        'pêche': 'Bateau',
        'aluminum': 'Bateau',
        'aluminium': 'Bateau',
        'jet boat': 'Bateau',
        'ponton': 'Ponton',
        'pontoon': 'Ponton',
        'moteur hors-bord': 'Moteur hors-bord',
        'moteurs hors-bord': 'Moteur hors-bord',
        'outboard motors': 'Moteur hors-bord',
        'outboard motor': 'Moteur hors-bord',
        'quai': 'Quai',
        'quais': 'Quai',
        'dock': 'Quai',
        'docks': 'Quai',
        'remorque': 'Remorque',
        'trailer': 'Remorque',
        'accessoire': 'Accessoire',
        'accessory': 'Accessoire',
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
        """Parse les 4 sitemaps Yoast et trie les URLs par catégorie.

        On priorise les URLs françaises (/fr/) pour la cohérence.
        Les URLs anglaises (/en/) servent de fallback.
        """
        want_inventory = any(c in ('inventaire', 'occasion', 'neuf') for c in categories)
        want_catalog = any(c in ('catalogue', 'catalog') for c in categories)

        url_map: Dict[str, List[str]] = {}
        seen_slugs: Dict[str, str] = {}

        sitemaps_to_fetch = []
        if want_catalog:
            sitemaps_to_fetch.extend(['boat', 'pontoon', 'outboard-motor'])
        if want_inventory:
            sitemaps_to_fetch.append('inventory')

        for sitemap_type in sitemaps_to_fetch:
            sitemap_url = self.SITEMAPS.get(sitemap_type)
            if not sitemap_url:
                continue

            urls = self._parse_sitemap(sitemap_url)
            if not urls:
                continue

            for raw_url in urls:
                if self.SITE_DOMAIN not in raw_url:
                    continue

                is_fr = '/fr/' in raw_url
                slug = self._extract_slug(raw_url)

                if slug and slug in seen_slugs:
                    if is_fr and '/en/' in seen_slugs[slug]:
                        self._remove_url_from_map(url_map, seen_slugs[slug])
                    else:
                        continue

                if sitemap_type == 'inventory':
                    cat_key = 'inventaire'
                else:
                    cat_key = 'catalogue'

                url_map.setdefault(cat_key, []).append(raw_url)
                if slug:
                    seen_slugs[slug] = raw_url

        return url_map

    def _parse_sitemap(self, sitemap_url: str) -> List[str]:
        """Récupère et parse un sitemap XML Yoast."""
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
        """Extrait le slug normalisé pour dédupliquer FR/EN."""
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
            source_cat = cat_key
            for url in urls:
                tasks.append((url, source_cat))

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

                if processed % 50 == 0 or processed == total:
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
            self._extract_html_specs(soup, product, is_inventory)
            self._extract_price(soup, product)
            self._extract_images(soup, url, product)
            self._extract_description(soup, product)
            self._detect_etat(soup, resp.text, product, is_inventory)
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
        """Extrait les métadonnées OG (image seulement; le nom vient du h1)."""
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content', '').startswith('http'):
            out.setdefault('image', og_image['content'])

    def _extract_html_specs(self, soup: BeautifulSoup, out: Dict, is_inventory: bool) -> None:
        """Extrait les specs depuis les <li> de la section Overview/Specifications."""
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
            'hp': 'puissance',
            'fuel': 'carburant',
            'weight': 'poids',
            'mileage': 'kilometrage',
            'hours': 'heures',
            'vin': 'vin',
            'vehicle-id': '_vehicle_id',
            'transmission': 'transmission',
            'drive': 'entrainement',
        }

        for li in spec_section.find_all('li', recursive=False):
            classes = li.get('class', [])
            if not classes:
                continue

            li_class = classes[0] if classes else ''

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
                text_lower = text.lower()
                if 'new' in text_lower or 'neuf' in text_lower:
                    out.setdefault('etat', 'neuf')
                elif 'used' in text_lower or 'usag' in text_lower:
                    out.setdefault('etat', 'occasion')
                elif 'demo' in text_lower or 'démo' in text_lower:
                    out.setdefault('etat', 'demonstrateur')
                continue

            if field == '_vehicle_id':
                continue

            if field == 'vehicule_type':
                normalized = self._NORMALIZE_TYPE.get(text.lower().strip())
                if normalized:
                    out.setdefault(field, normalized)
                else:
                    out.setdefault(field, text)
                continue

            if field == 'annee':
                parsed = self.clean_year(text)
                if parsed:
                    out.setdefault(field, parsed)
            elif field == 'kilometrage':
                parsed = self.clean_mileage(text)
                if parsed is not None:
                    out.setdefault(field, parsed)
            elif field == 'heures':
                parsed = self.clean_mileage(text)
                if parsed is not None:
                    out.setdefault(field, parsed)
            else:
                out.setdefault(field, text)

    def _extract_custom_field(self, li, out: Dict) -> None:
        """Extrait un champ custom_fields (label/value) pour les pages catalogue."""
        label_el = li.select_one('span.label')
        value_el = li.select_one('span.value')
        if not label_el or not value_el:
            return

        label = label_el.get_text(strip=True).rstrip(':').lower()
        value = value_el.get_text(strip=True)
        if not value or value in ('-', 'N/A'):
            return

        custom_map = {
            'max horsepower': 'puissance_max',
            'puissance max': 'puissance_max',
            'beam': 'largeur',
            'largeur': 'largeur',
            'dry weight': 'poids',
            'poids sec': 'poids',
            'max persons': 'capacite_personnes',
            'personnes max': 'capacite_personnes',
            'interior depth': 'profondeur_interieure',
            'profondeur intérieure': 'profondeur_interieure',
            'transom height': 'hauteur_tableau_arriere',
            'transom width': 'largeur_tableau_arriere',
            'max capacity': 'capacite_max',
            'capacité max': 'capacite_max',
            'fuel capacity': 'capacite_carburant',
            'capacité carburant': 'capacite_carburant',
            'length': 'longueur',
            'longueur': 'longueur',
            'hp': 'puissance',
            'weight': 'poids',
        }

        field = custom_map.get(label)
        if field:
            out.setdefault(field, value)

    def _extract_price(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait le prix depuis la section #product-price."""
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
        """Extrait l'image principale depuis la galerie."""
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

        img = soup.select_one('img[src*="cdn.powergo.ca"]')
        if img:
            src = img.get('src', '')
            if src.startswith('http'):
                out['image'] = src

    def _extract_description(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait la description depuis la section Notes."""
        desc_section = soup.select_one('#product-notes .text, #product-description .text')
        if not desc_section:
            return

        text = desc_section.get_text(separator=' ', strip=True)
        if text and len(text) > 10:
            out.setdefault('description', text[:2000])

    def _detect_etat(self, soup: BeautifulSoup, html: str, out: Dict, is_inventory: bool) -> None:
        """Détermine l'état du produit (neuf/occasion/catalogue)."""
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
        """Déduit le type de véhicule depuis l'URL."""
        if out.get('vehicule_type'):
            return

        path = urlparse(url).path.lower()

        for slug, label in self._TYPE_MAP.items():
            if f'/{slug}/' in path:
                out['vehicule_type'] = label
                return

        if '/inventory/' in path or '/inventaire/' in path:
            first_segment = path.split('/')[-1].split('-')[0] if '/' in path else ''
            for prefix, label in self._INVENTORY_TYPE_MAP.items():
                if first_segment == prefix or path.split('/')[-1].startswith(prefix + '-'):
                    out['vehicule_type'] = label
                    return

    # ================================================================
    # INTERFACE DedicatedScraper (compatibilité pipeline de base)
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
        is_inventory = '/inventory/' in url.lower() or '/inventaire/' in url.lower()
        self._extract_og_meta(soup, out)
        self._extract_html_specs(soup, out, is_inventory)
        self._extract_price(soup, out)
        self._extract_images(soup, url, out)
        self._extract_description(soup, out)
        self._detect_etat(soup, html, out, is_inventory)
        self._extract_type_from_url(url, out)

        h1 = soup.select_one('h1')
        if h1:
            out.setdefault('name', self._clean_name(h1.get_text(strip=True)))
        return out if out.get('name') else None

    # ================================================================
    # REGROUPEMENT
    # ================================================================

    @staticmethod
    def _deep_normalize(text: str) -> str:
        import unicodedata
        if not text:
            return ''
        text = text.lower().strip()
        text = unicodedata.normalize('NFKD', text)
        text = ''.join(c for c in text if not unicodedata.category(c).startswith('M'))
        text = re.sub(r'([a-z])(\d)', r'\1 \2', text)
        text = re.sub(r'(\d)([a-z])', r'\1 \2', text)
        text = re.sub(r'[^a-z0-9\s]', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _normalize_group_model(self, product: Dict) -> str:
        """Build a normalized model key for grouping.

        Strips engine specs, equipment packages, quille configs, colors
        so identical boat models group regardless of configuration.
        """
        name = (product.get('name') or '').strip()
        marque = (product.get('marque') or '').strip()
        raw_modele = (product.get('modele') or '').strip()

        spec_model = self._deep_normalize(raw_modele) if raw_modele else ''

        name_model = ''
        if name:
            name_norm = self._deep_normalize(name)
            marque_norm = self._deep_normalize(marque) if marque else ''

            if marque_norm and name_norm.startswith(marque_norm + ' '):
                name_model = name_norm[len(marque_norm):].strip()
            elif marque_norm and name_norm.startswith(marque_norm):
                name_model = name_norm[len(marque_norm):].strip()
            else:
                name_model = name_norm

            name_model = re.sub(r'\b(?:19|20)\d{2}\b', '', name_model).strip()
            name_model = re.sub(r'\s+', ' ', name_model).strip()

        group_model = name_model if len(name_model) > len(spec_model) else spec_model
        if not group_model:
            group_model = name_model or spec_model

        group_model = re.sub(r'\b\d+\s*hp\s*\w*\b', '', group_model)
        group_model = re.sub(r'\b(?:full|avec)?\s*\d*\s*quilles?\b', '', group_model)
        group_model = re.sub(r'\bse\s+package\b', '', group_model)
        group_model = re.sub(r'\blocation\b', '', group_model)

        return re.sub(r'\s+', ' ', group_model).strip()

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
            vtype = (product.get('vehicule_type') or '').lower().strip()

            if marque_norm and group_model:
                key = (marque_norm, group_model, annee, etat, vtype)
            else:
                fallback = group_model or self._deep_normalize(product.get('name', ''))
                key = (fallback, annee, etat, vtype)

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

    _MODEL_TOKENS_UPPER = frozenset({
        'SLS', 'EXS', 'QDH', 'TL', 'DC', 'DH', 'SB', 'SC', 'SE',
        'HP', 'II', 'III', 'IV', 'LE', 'LX', 'GT', 'GTS', 'SS',
        'XL', 'XS', 'XT', 'RS', 'FS', 'DX', 'EX', 'FX', 'CX',
        'ST', 'DLX', 'DL', 'PRO', 'EFI', 'CT', 'SVX', 'LTD',
    })

    @classmethod
    def _title_case_name(cls, name: str) -> str:
        """Title-case a boat name, keeping model codes uppercase."""
        words = name.split()
        result = []
        for w in words:
            if w.upper() in cls._MODEL_TOKENS_UPPER:
                result.append(w.upper())
            elif re.match(r'^[A-Z0-9]+[-/][A-Z0-9]+$', w, re.I):
                result.append(w.upper())
            elif re.match(r'^\d+\w*$', w):
                result.append(w)
            elif len(w) <= 2 and w.upper() in ('Q', 'S', 'A'):
                result.append(w.upper())
            else:
                result.append(w.capitalize())
        return ' '.join(result)

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r'\s*[-–]\s*Maximum\s*Aventure.*$', '', name, flags=re.I)
        name = re.sub(
            r'\s+(?:en\s+vente|neuf|usag[ée]+|occasion|à\s+vendre)'
            r'(?:\s+[àa]\s+[\w\s-]+)?$',
            '', name, flags=re.I
        )
        name = re.sub(r'\s+[àa]\s+Shawinigan\s*$', '', name, flags=re.I)

        name = re.sub(
            r'\s*[-–]\s*(?:'
            r'(?:FULL\s+)?\d*\s*QUILLES?'
            r'|\d+\s*HP\s+[A-Z]+'
            r'|SE\s+PACKAGE'
            r'|LOCATION'
            r'|SB'
            r'|AVEC\s+.+'
            r')\s*$',
            '', name, flags=re.I
        )

        name = re.sub(r'\s*\([^)]*\)', '', name)

        name = re.sub(r'\s*[-–]\s*$', '', name)

        name = re.sub(r'\s+', ' ', name).strip()

        name = MaximumAventureScraper._title_case_name(name)

        return name
