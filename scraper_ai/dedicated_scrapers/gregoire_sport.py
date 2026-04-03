"""
Scraper dédié pour Grégoire Sport (plateforme PowerGO / Next.js).

Concessionnaire Yamaha, KTM, Suzuki, Arctic Cat, GAS GAS, etc.
situé à Lourdes-de-Joliette, QC.

Stratégie sitemap + détail :
  1. Sitemap XML (inventory-detail.xml) → découverte de TOUTES les URLs produits
  2. Pages détail (parallèle) → JSON-LD Vehicle + specs HTML

La pagination de ce site Next.js est 100 % côté client (React Server
Components + recherche/filtrage JS local).  Le sitemap XML fournit la
liste complète des produits et contourne cette limitation.

Le sitemap contient des URLs en français (/fr/) ET en anglais (/en/).
On utilise les URLs françaises pour la cohérence avec les autres scrapers.

Types de véhicules : Motocyclette, VTT, Côte à côte, Motoneige,
Bateau, Motomarine, Vélo électrique, Remorque, Moteur hors-bord,
Équipement mécanique, Voiturette de golf.
"""
import re
import json
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class GregoireSportScraper(DedicatedScraper):

    SITE_NAME = "Grégoire Sport"
    SITE_SLUG = "gregoire-sport"
    SITE_URL = "https://www.gregoiresport.com/fr/"
    SITE_DOMAIN = "gregoiresport.com"

    SITEMAP_URL = "https://www.gregoiresport.com/sitemaps/inventory-detail.xml"

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    SEL_SPEC_VALUE = 'span.font-bold'

    _TYPE_MAP_FR = {
        'motocyclette': 'Motocyclette',
        'vtt': 'VTT',
        'cote-a-cote': 'Côte à côte',
        'motomarine': 'Motomarine',
        'motoneige': 'Motoneige',
        'bateau': 'Bateau',
        'ponton': 'Ponton',
        'moteur-hors-bord': 'Moteur hors-bord',
        'remorque': 'Remorque',
        'scooter': 'Scooter',
        'velo-electrique': 'Vélo électrique',
        'equipement-mecanique': 'Équipement mécanique',
        'voiturette-de-golf': 'Voiturette de golf',
    }

    _TYPE_MAP_EN = {
        'motorcycle': 'Motocyclette',
        'atv': 'VTT',
        'side-by-side': 'Côte à côte',
        'watercraft': 'Motomarine',
        'snowmobile': 'Motoneige',
        'boat': 'Bateau',
        'pontoon': 'Ponton',
        'outboard-motor': 'Moteur hors-bord',
        'trailer': 'Remorque',
        'scooter': 'Scooter',
        'electric-bike': 'Vélo électrique',
        'power-equipment': 'Équipement mécanique',
        'golf-carts': 'Voiturette de golf',
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

        url_map = self._discover_urls_from_sitemap(categories)

        if not url_map:
            print("   ⚠️ Aucune URL trouvée dans le sitemap")
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
    # PHASE 1 : DÉCOUVERTE DES URLs VIA SITEMAP XML
    # ================================================================

    def _discover_urls_from_sitemap(self, categories: List[str]) -> Dict[str, List[str]]:
        """Récupère le sitemap inventory-detail.xml et trie les URLs par catégorie.

        Le sitemap contient des URLs fr et en.  On priorise les URLs
        françaises (/fr/…/inventaire/…a-vendre-…) mais on accepte
        aussi les URLs anglaises (/en/…/inventory/…for-sale-…) si
        le pendant français n'existe pas.
        """
        try:
            resp = self.session.get(self.SITEMAP_URL, timeout=15)
            if resp.status_code != 200:
                print(f"   ⚠️ Sitemap indisponible ({resp.status_code})")
                return {}
        except Exception as e:
            print(f"   ⚠️ Erreur sitemap: {e}")
            return {}

        soup = BeautifulSoup(resp.text, 'xml')
        url_map: Dict[str, List[str]] = {}

        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_occasion = any(c in ('occasion', 'usage') for c in categories)

        seen_stocks: Dict[str, str] = {}

        for url_tag in soup.find_all('url'):
            loc = url_tag.find('loc')
            if not loc:
                continue

            raw_url = loc.text.strip()
            if not self._is_product_url(raw_url):
                continue

            stock = self._extract_stock_from_url(raw_url)
            is_fr = '/fr/' in raw_url

            if stock and stock in seen_stocks:
                if is_fr and '/en/' in seen_stocks[stock]:
                    self._remove_url_from_map(url_map, seen_stocks[stock])
                else:
                    continue

            if is_fr:
                is_new = '/neuf/' in raw_url
                is_used = '/usage/' in raw_url
            else:
                is_new = '/new/' in raw_url
                is_used = '/used/' in raw_url

            if is_new and want_neuf:
                url_map.setdefault('inventaire', []).append(raw_url)
                if stock:
                    seen_stocks[stock] = raw_url
            elif is_used and want_occasion:
                url_map.setdefault('occasion', []).append(raw_url)
                if stock:
                    seen_stocks[stock] = raw_url

        return url_map

    @staticmethod
    def _extract_stock_from_url(url: str) -> Optional[str]:
        """Extrait le numéro de stock depuis l'URL (ex: …for-sale-32090/ → 32090)."""
        match = re.search(r'(?:a-vendre|for-sale)-([a-zA-Z0-9_-]+)/?$', url)
        if match:
            return match.group(1).lower()
        return None

    @staticmethod
    def _remove_url_from_map(url_map: Dict[str, List[str]], url: str) -> None:
        for key in url_map:
            try:
                url_map[key].remove(url)
            except ValueError:
                pass

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        if '/fr/' in url_lower:
            return '/inventaire/' in url_lower and 'a-vendre-' in url_lower
        if '/en/' in url_lower:
            return '/inventory/' in url_lower and 'for-sale-' in url_lower
        return False

    # ================================================================
    # PHASE 2 : EXTRACTION DEPUIS LES PAGES DÉTAIL
    # ================================================================

    def _extract_from_detail_pages(self, url_map: Dict[str, List[str]]) -> List[Dict]:
        tasks: List[tuple] = []
        for cat_key, urls in url_map.items():
            etat = 'neuf' if cat_key == 'inventaire' else 'occasion'
            source_cat = 'inventaire' if cat_key == 'inventaire' else 'vehicules_occasion'
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
            self._fix_model_brand_prefix(product)

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
                    parts.append(str(product['annee']))
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
        """Extrait les données structurées JSON-LD (schema.org Vehicle)."""
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
                    if 'NewCondition' in condition:
                        out.setdefault('etat', 'neuf')
                    elif 'UsedCondition' in condition:
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
        """Extrait les specs depuis les éléments li.spec-* de la page détail."""
        spec_map = {
            'li.spec-make': 'marque',
            'li.spec-model': 'modele',
            'li.spec-year': 'annee',
            'li.spec-color': 'couleur',
            'li.spec-vin': 'vin',
            'li.spec-stock-number': 'inventaire',
            'li.spec-type': 'vehicule_type',
            'li.spec-category': 'vehicule_categorie',
            'li.spec-usage': 'kilometrage',
        }

        for selector, field in spec_map.items():
            el = soup.select_one(selector)
            if not el:
                continue

            value_el = el.select_one(self.SEL_SPEC_VALUE)
            if not value_el:
                continue

            text = value_el.get_text(strip=True)
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

        cond_el = soup.select_one('li.spec-condition')
        if cond_el:
            val_el = cond_el.select_one(self.SEL_SPEC_VALUE)
            if val_el:
                cond_text = val_el.get_text(strip=True).lower()
                if 'neuf' in cond_text or 'new' in cond_text:
                    out.setdefault('etat', 'neuf')
                elif 'usag' in cond_text or 'used' in cond_text:
                    out.setdefault('etat', 'occasion')
                elif 'démo' in cond_text or 'demo' in cond_text:
                    out.setdefault('etat', 'demonstrateur')

    def _extract_price_fallback(self, soup: BeautifulSoup, out: Dict) -> None:
        """Prix fallback via le DOM quand le JSON-LD n'a pas de prix."""
        price_el = soup.select_one(
            'div.pg-vehicle-price, div.pg-vehicle-mobile-price, '
            '[class*="price"]'
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
            if src:
                out['image'] = src if src.startswith('http') else urljoin(url, src)

    # ================================================================
    # DÉTECTION ÉTAT / KM DEPUIS LE TITRE
    # ================================================================

    @staticmethod
    def _detect_name_metadata(raw_name: str) -> Dict[str, Any]:
        meta: Dict[str, Any] = {}
        lower = raw_name.lower()

        if re.search(r'\b(d[ée]monstrateur|dmonstrateur|d[ée]mo|demo)\b', lower):
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

    _GROUP_COLOR_KEYWORDS = frozenset({
        'blanc', 'noir', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'rose', 'violet',
        'gris', 'argent', 'bronze', 'beige', 'marron', 'brun', 'turquoise',
        'brillant', 'mat', 'metallise', 'metallique', 'perle', 'nacre', 'satin',
        'chrome', 'carbone', 'fonce', 'clair', 'fluo', 'neon', 'acide',
        'ebene', 'graphite', 'anthracite', 'platine', 'titane',
        'phantom', 'midnight', 'cosmic', 'storm', 'combat', 'lime', 'sauge',
        'cristal', 'obsidian', 'racing',
        'white', 'black', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
        'gray', 'grey', 'silver', 'gold', 'brown', 'matte', 'glossy',
        'metallic', 'pearl', 'carbon', 'dark', 'light', 'bright',
    })

    _COLOR_PATTERNS = re.compile(
        r'\b(?:'
        r'noir(?:\s+(?:corbeau|ballistic|mat|m[ée]tallis[ée]|brillant|graphite|phantom|midnight|cosmic))*'
        r'|blanc(?:\s+(?:perle|[ée]blouissant|nacr[ée]|cristal|brillant|mat))*'
        r'|rouge(?:\s+(?:grand\s+prix|racing|candy|[ée]carlate|cerise|fluo|extr[eê]me))*'
        r'|bleu(?:\s+(?:team\s+yamaha|m[ée]tallis[ée]|mat|brillant|fonc[ée]|nuit|royal))*'
        r'|blue(?:\s+(?:team\s+yamaha))?'
        r'|vert(?:\s+(?:lime|sauge|fluo|racing|fonc[ée]|mat|m[ée]tallis[ée]))*'
        r'|gris(?:\s+(?:anthracite|m[ée]tallis[ée]|mat|fonc[ée]|storm|titanium))*'
        r'|jaune(?:\s+(?:fluo|racing|acide))*'
        r'|orange(?:\s+(?:fluo|racing|m[ée]tallis[ée]))*'
        r'|argent(?:\s+(?:m[ée]tallis[ée]))?'
        r'|bronze(?:\s+(?:m[ée]tallis[ée]))?'
        r')\b',
        re.I
    )

    @staticmethod
    def _fix_model_brand_prefix(product: Dict) -> None:
        """Strip brand prefix from model when PowerGO concatenates them,
        and remove PowerGO SEO suffixes (Custom, Edition)."""
        marque = product.get('marque', '')
        modele = product.get('modele', '')
        if not modele:
            return
        if marque:
            marque_lower = marque.lower()
            modele_lower = modele.lower()
            if modele_lower.startswith(marque_lower) and len(modele) > len(marque):
                cleaned = modele[len(marque):]
                if cleaned[0:1].isalnum():
                    modele = cleaned
        modele = re.sub(r'\s+(?:Custom|Edition)\b', '', modele, flags=re.I)
        modele = re.sub(r'\s+', ' ', modele).strip()
        product['modele'] = modele

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
            categories = ['inventaire', 'occasion']
        url_map = self._discover_urls_from_sitemap(categories)
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
        self._fix_model_brand_prefix(out)
        h1 = soup.select_one('h1')
        if h1:
            out.setdefault('name', self._clean_name(h1.get_text(strip=True)))
        return out if out else None

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

        Strips colors, anniversary/edition suffixes, pre-commande,
        and normalizes across EN/FR variants so identical products
        with cosmetic name differences get grouped together.
        """
        name = (product.get('name') or '').strip()
        marque = (product.get('marque') or '').strip()
        couleur = (product.get('couleur') or '').strip()
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

        if couleur:
            couleur_norm = self._deep_normalize(couleur)
            if couleur_norm:
                group_model = group_model.replace(couleur_norm, ' ').strip()

        words = group_model.split()
        words = [w for w in words if w not in self._GROUP_COLOR_KEYWORDS]
        group_model = ' '.join(words)

        group_model = re.sub(
            r'\b(\d+)\s*(?:th|st|nd|rd|e|eme)\s+(?:annivers\w*|anniv(?:ersary)?)\b',
            r'\1 anniversaire',
            group_model,
        )

        group_model = re.sub(r'\bpre\s*commande\b', '', group_model)
        group_model = re.sub(r'\bpre\s*order\b', '', group_model)
        group_model = re.sub(r'\bcustom\b', '', group_model)
        group_model = re.sub(r'\bedition\b', '', group_model)

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

            if marque_norm and group_model:
                key = (marque_norm, group_model, annee, etat)
            else:
                fallback = group_model or self._deep_normalize(product.get('name', ''))
                key = (fallback, annee, etat)

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
    # NETTOYAGE DES NOMS
    # ================================================================

    @staticmethod
    def _fix_mojibake(text: str) -> str:
        try:
            fixed = text.encode('latin-1').decode('utf-8')
            if fixed and not any(c in fixed for c in '\ufffd\x00'):
                return fixed
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass
        return text

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = GregoireSportScraper._fix_mojibake(name)
        name = re.sub(r'\*[^*]+\*', '', name)
        name = re.sub(r'\*\d+\s*km\b', '', name, flags=re.I)
        name = name.replace('*', '')
        name = re.sub(r'\([^)]*\)', '', name)
        name = re.sub(r'\bfull\s+load\b', '', name, flags=re.I)
        name = re.sub(
            r'\b(?:d[ée]monstrateur|dmonstrateur|d[ée]mo|demo'
            r'|location|usag[ée]e?'
            r'|liquidation|pour\s+pi[èe]ces?|bas\s+kil+om[ée]trage'
            r'|chenilles?\s+incluse?s?|cabine\s+incluse?'
            r'|avec\s+chenilles?|avec\s+cabine'
            r'|chenilles?|cabine)\b',
            '', name, flags=re.I)
        name = re.sub(r'(?<=\s)\d+\s*km\b', '', name, flags=re.I)
        name = re.sub(r'^(\w+)\s+\1\b', r'\1', name, flags=re.I)
        name = re.sub(r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Gr[ée]goire\s*Sport.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[-–]\s*Gr[ée]goire\s*Sport.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[-–]?\s*(?:Pr[ée]-?commande|Pre-?order)\s*[-–]?\s*', ' ', name, flags=re.I)
        name = re.sub(
            r'\b(\d+)\s*(?:th|st|nd|rd|e|[èe]me)\s+(?:annivers\w*|anniv(?:ersary)?)\b',
            r'\1th Anniversary', name, flags=re.I
        )
        name = re.sub(r'\s+(?:Custom|Edition)\b', '', name, flags=re.I)
        name = GregoireSportScraper._COLOR_PATTERNS.sub('', name)

        words = name.split()
        if len(words) >= 2:
            first_lower = words[0].lower()
            for i in range(1, len(words)):
                w_lower = words[i].lower()
                if (w_lower.startswith(first_lower)
                        and len(words[i]) > len(words[0])
                        and words[i][len(words[0]):][0:1].isalnum()):
                    words[i] = words[i][len(words[0]):]
                    break
            name = ' '.join(words)

        name = re.sub(r'\s*[-–]\s*$', '', name)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
