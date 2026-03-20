"""
Scraper dédié pour les sites Motoplex (plateforme PowerGO).

Stratégie sitemap + détail:
  1. Sitemap XML (inventory-detail.xml) → découverte de TOUTES les URLs produits
  2. Pages détail (parallèle) → JSON-LD + specs HTML (nom, marque, modèle, année,
     couleur, VIN, km, état, prix, type, catégorie, description, image)

La pagination de ces sites Next.js est 100% client-side JavaScript,
rendant la pagination serveur impossible. Le sitemap contourne ce problème
en fournissant la liste complète des produits.

Ce fichier définit MotoplexScraper (St-Eustache), classe de base pour tout
site PowerGO Motoplex. Mirabel et autres succursales en héritent.
"""
import re
import json
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class MotoplexScraper(DedicatedScraper):

    SITE_NAME = "Motoplex St-Eustache"
    SITE_SLUG = "motoplex"
    SITE_URL = "https://www.motoplex.ca/fr/"
    SITE_DOMAIN = "motoplex.ca"
    SITE_DOMAIN_ALT = "motoplexsteustache.ca"

    SITEMAP_URL = "https://www.motoplexsteustache.ca/sitemaps/inventory-detail.xml"

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    SEL_SPEC_VALUE = 'span.font-bold'

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

        # Phase 1 : découverte via sitemap
        url_map = self._discover_urls_from_sitemap(categories)

        if not url_map:
            print("   ⚠️ Aucune URL trouvée dans le sitemap")
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        total_urls = sum(len(urls) for urls in url_map.values())
        for cat, urls in url_map.items():
            print(f"   📋 [{cat}]: {len(urls)} URLs")

        # Phase 2 : extraction depuis les pages détail (source unique de données)
        products = self._extract_from_detail_pages(url_map)

        if not products:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        if inventory_only:
            products = [p for p in products if p.get('sourceCategorie') != 'catalogue']

        # Phase 3 : regroupement
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
        """Récupère le sitemap inventory-detail.xml et trie les URLs par catégorie."""
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

        for url_tag in soup.find_all('url'):
            loc = url_tag.find('loc')
            if not loc:
                continue

            raw_url = loc.text.strip()

            if '/fr/' not in raw_url or '/inventaire/' not in raw_url:
                continue
            if 'a-vendre-' not in raw_url:
                continue

            if '/neuf/' in raw_url and want_neuf:
                url_map.setdefault('inventaire', []).append(raw_url)
            elif '/usage/' in raw_url and want_occasion:
                url_map.setdefault('occasion', []).append(raw_url)

        return url_map

    # ================================================================
    # PHASE 2 : EXTRACTION DEPUIS LES PAGES DÉTAIL
    # ================================================================

    def _extract_from_detail_pages(self, url_map: Dict[str, List[str]]) -> List[Dict]:
        """Fetch et parse toutes les pages détail en parallèle."""
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
                url = futures[future]
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
        """Fetch une page détail et en extrait un produit complet."""
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

            # Prix fallback : div.pg-vehicle-price (quand JSON-LD n'a pas de prix)
            if not product.get('prix'):
                price_el = soup.select_one('div.pg-vehicle-price, div.pg-vehicle-mobile-price')
                if price_el:
                    price_text = price_el.get_text(strip=True)
                    parsed = self.clean_price(price_text)
                    if parsed:
                        product['prix'] = parsed

            # Nom : JSON-LD name > h1 > construction depuis marque+modele+annee
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

            # Image principale
            if not product.get('image'):
                img = soup.select_one('img.pg-vehicle-image, .pg-vehicle-gallery img, '
                                      'img[src*="cdn.powergo.ca"]')
                if img:
                    src = img.get('src') or img.get('data-src', '')
                    if src:
                        product['image'] = src if src.startswith('http') else urljoin(url, src)

            # Description
            if not product.get('description'):
                desc_el = soup.select_one('div.pg-vehicle-description .prose')
                if desc_el:
                    desc_text = desc_el.get_text(separator=' ', strip=True)
                    if desc_text and len(desc_text) > 10:
                        product['description'] = desc_text[:2000]

            # Type véhicule depuis l'URL (/neuf/motocyclette/... ou /usage/vtt/...)
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
                        out.setdefault('annee', int(item['vehicleModelDate']))
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
                    if isinstance(offers, dict) and offers.get('price'):
                        try:
                            out.setdefault('prix', float(offers['price']))
                        except (ValueError, TypeError):
                            pass

                    img = item.get('image')
                    if isinstance(img, str) and img.startswith('http'):
                        out.setdefault('image', img)
                    elif isinstance(img, dict) and img.get('url', '').startswith('http'):
                        out.setdefault('image', img['url'])

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

    # ================================================================
    # HELPERS
    # ================================================================

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        """Déduit le type de véhicule depuis le chemin URL."""
        type_map = {
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
            'equipement-mecanique': 'Équipement mécanique',
        }
        path = urlparse(url).path.lower()
        for slug, label in type_map.items():
            if f'/{slug}/' in path:
                return label
        return None

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        """Interface requise par la classe de base."""
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
        """Interface requise par la classe de base."""
        out: Dict[str, Any] = {}
        self._extract_json_ld(soup, out)
        self._extract_html_specs(soup, out)
        h1 = soup.select_one('h1')
        if h1:
            out.setdefault('name', self._clean_name(h1.get_text(strip=True)))
        return out if out else None

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower and self.SITE_DOMAIN_ALT not in url_lower:
            return False
        if '/inventaire/' in url_lower and 'a-vendre-' in url_lower:
            if any(x in url_lower for x in ['/service/', '/contact/', '/financement/', '/pieces/']):
                return False
            return True
        return False

    def _group_identical_products(self, products: List[Dict]) -> List[Dict]:
        """Regroupe les produits identiques (marque+modèle+année+état, couleurs ignorées)."""
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
    def _fix_mojibake(text: str) -> str:
        """Corrige le mojibake UTF-8 (ex: 'GÃ©NÃ©RATRICE' → 'GÉNÉRATRICE')."""
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
        name = MotoplexScraper._fix_mojibake(name)
        # Annotations entre astérisques: *LIQUIDATION*, *BAS KILOMÉTRAGE*, *744 KM*, etc.
        name = re.sub(r'\*[^*]+\*', '', name)
        # Annotations sans astérisques mais avec astérisque ouvrante orpheline: *744 KM
        name = re.sub(r'\*\d+\s*km\b', '', name, flags=re.I)
        # Mots-clés dealer standalone (sans astérisques)
        name = re.sub(
            r'\b(?:liquidation|pour\s+pi[èe]ces?|bas\s+kil+om[ée]trage'
            r'|chenilles?\s+incluse?s?|cabine\s+incluse?'
            r'|avec\s+chenilles?|avec\s+cabine'
            r'|chenilles?|cabine)\b',
            '', name, flags=re.I)
        # Annotations km standalone: "744 KM", "1200 KM" (seulement si précédé de espace/début)
        name = re.sub(r'(?<=\s)\d+\s*km\b', '', name, flags=re.I)
        # Marque dupliquée: "BMW BMW R1200" → "BMW R1200"
        name = re.sub(r'^(\w+)\s+\1\b', r'\1', name, flags=re.I)
        name = re.sub(r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Motoplex.*$', '', name, flags=re.I)
        # Tirets orphelins après nettoyage
        name = re.sub(r'\s*-\s*$', '', name)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
