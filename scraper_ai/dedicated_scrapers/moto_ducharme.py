"""
Scraper dédié pour Moto Ducharme (motoducharme.com).
Sélecteurs CSS hardcodés — aucun appel Gemini.

Stratégie hybride (Magento 2):
  1. Pages listing paginées (?p=N, 36/page) → URLs produits + prix partiels
  2. Pages détail (parallèle) → marque, modèle, année, prix, inventaire,
     kilométrage, type, couleur, specs moteur/châssis, description, image

Sections:
  - /fr/vehicules-neufs                        (inventaire neuf, ~850 produits)
  - /fr/vehicules-d-occasion/motocyclettes      (occasion motos)
  - /fr/vehicules-d-occasion/vtt                (occasion VTT)
  - /fr/vehicules-d-occasion/cotes-a-cotes      (occasion côtes-à-côtes)
  - /fr/vehicules-d-occasion/motoneiges         (occasion motoneiges)

Marques: Honda, Kawasaki, Husqvarna, Polaris, Talaria, E-Bike
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


class MotoDucharmeScraper(DedicatedScraper):

    SITE_NAME = "Moto Ducharme"
    SITE_SLUG = "moto-ducharme"
    SITE_URL = "https://www.motoducharme.com/"
    SITE_DOMAIN = "motoducharme.com"

    LISTING_PAGES = {
        'inventaire': {
            'url': 'https://www.motoducharme.com/fr/vehicules-neufs',
            'etat': 'neuf',
            'sourceCategorie': 'inventaire',
        },
        'occasion_moto': {
            'url': 'https://www.motoducharme.com/fr/vehicules-d-occasion/motocyclettes',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
        'occasion_vtt': {
            'url': 'https://www.motoducharme.com/fr/vehicules-d-occasion/vtt',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
        'occasion_cac': {
            'url': 'https://www.motoducharme.com/fr/vehicules-d-occasion/cotes-a-cotes',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
        'occasion_motoneige': {
            'url': 'https://www.motoducharme.com/fr/vehicules-d-occasion/motoneiges',
            'etat': 'occasion',
            'sourceCategorie': 'vehicules_occasion',
        },
    }

    PRODUCTS_PER_PAGE = 36
    WORKERS = 6
    LISTING_MAX_RETRIES = 3
    LISTING_RETRY_DELAY = 4
    TIME_BUDGET_SECONDS = 1050  # ~17.5 min — marge avant le timeout cron de 20 min

    SPEC_FIELD_MAP = {
        'cylindrée': 'cylindree',
        'cylindree': 'cylindree',
        'boîte de vitesses': 'transmission',
        'boite de vitesses': 'transmission',
        'puissance en kw': 'puissance',
        'consommation de carburant': 'consommation',
        'course': 'course',
        'alésage': 'alesage',
        'alesage': 'alesage',
        'type de moteur': 'type_moteur',
        'système de refroidissement': 'refroidissement',
        'systeme de refroidissement': 'refroidissement',
        'démarreur': 'demarreur',
        'demarreur': 'demarreur',
        'embrayage': 'embrayage',
        'lubrification': 'lubrification',
        'émissions de co2': 'emissions_co2',
        'ems': 'ems',
        'modèle cadre': 'cadre',
        'modele cadre': 'cadre',
        'abs': 'abs',
        'suspension avant': 'suspension_avant',
        'suspension arrière': 'suspension_arriere',
        'suspension arriere': 'suspension_arriere',
        'angle de chasse': 'angle_chasse',
        'diamètre disque de frein avant': 'frein_avant_diametre',
        'diametre disque de frein avant': 'frein_avant_diametre',
        'diamètre disque de frein arrière': 'frein_arriere_diametre',
        'diametre disque de frein arriere': 'frein_arriere_diametre',
        'débattement avant': 'debattement_avant',
        'debattement avant': 'debattement_avant',
        'débattement arrière': 'debattement_arriere',
        'debattement arriere': 'debattement_arriere',
        'garde au sol': 'garde_au_sol',
        'hauteur de selle': 'hauteur_selle',
        'chaîne': 'chaine',
        'chaine': 'chaine',
        'frein avant': 'frein_avant',
        'frein arrière': 'frein_arriere',
        'frein arriere': 'frein_arriere',
        'capacité du réservoir': 'reservoir',
        'capacite du reservoir': 'reservoir',
        'poids': 'poids',
        'couleur': 'couleur',
        'kilométrage': 'kilometrage',
        'kilometrage': 'kilometrage',
    }

    OCCASION_CATS = ['occasion', 'occasion_moto', 'occasion_vtt',
                     'occasion_cac', 'occasion_motoneige']

    def __init__(self):
        super().__init__()
        self._request_lock = threading.Lock()
        self._last_request_time = 0.0
        self._min_request_interval = 0.35
        self._scrape_start_time = 0.0
        self._shutdown = threading.Event()

    # ================================================================
    # PIPELINE PRINCIPAL (override)
    # ================================================================

    def _time_remaining(self) -> float:
        return max(0, self.TIME_BUDGET_SECONDS - (time.time() - self._scrape_start_time))

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()
        self._scrape_start_time = start_time
        self._shutdown.clear()

        if categories is None:
            categories = ['inventaire', 'occasion']

        print(f"\n{'='*70}")
        print(f"🔧 SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"🌐 Site: {self.SITE_URL}")
        print(f"📦 Catégories: {categories}")
        print(f"⏱️  Budget temps: {self.TIME_BUDGET_SECONDS}s ({self.TIME_BUDGET_SECONDS/60:.1f} min)")

        product_urls = self._discover_all_product_urls(categories)

        if not product_urls:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        products = self._extract_from_detail_pages(product_urls)

        extracted_urls = {p.get('sourceUrl', '').rstrip('/').lower() for p in products}
        listing_fallback = 0
        for entry in product_urls:
            url_norm = entry['url'].rstrip('/').lower()
            if url_norm not in extracted_urls and entry.get('name'):
                fb = {
                    'sourceUrl': entry['url'],
                    'sourceSite': self.SITE_URL,
                    'name': entry['name'],
                    'etat': entry.get('etat', 'neuf'),
                    'sourceCategorie': entry.get('sourceCategorie', 'inventaire'),
                    'quantity': 1,
                    'groupedUrls': [entry['url']],
                }
                if entry.get('prix'):
                    fb['prix'] = entry['prix']
                if entry.get('image'):
                    fb['image'] = entry['image']
                year = self.clean_year(entry['name'])
                if year:
                    fb['annee'] = year
                brand = self._guess_brand(entry['name'], entry['url'])
                if brand:
                    fb['marque'] = brand
                vtype = self._extract_type_from_url(entry['url'])
                if vtype:
                    fb['vehicule_type'] = vtype
                products.append(fb)
                listing_fallback += 1

        if listing_fallback > 0:
            print(f"\n   📋 Fallback listing: {listing_fallback} produits récupérés sans page détail")

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
                'urls_processed': len(product_urls),
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
    # PHASE 1: DÉCOUVERTE DES URLs PRODUITS VIA LISTINGS PAGINÉS
    # ================================================================

    def _discover_all_product_urls(self, categories: List[str]) -> List[Dict]:
        """Parcourt toutes les pages listing et collecte les URLs + métadonnées."""
        all_entries: List[Dict] = []
        seen_urls: set = set()

        active_pages = self._resolve_listing_pages(categories)

        for cat_key, config in active_pages.items():
            print(f"\n   📋 [{cat_key}]: {config['url']}")
            entries = self._crawl_listing_pages(config)

            fresh = 0
            for entry in entries:
                url_norm = entry['url'].rstrip('/').lower()
                if url_norm not in seen_urls:
                    seen_urls.add(url_norm)
                    all_entries.append(entry)
                    fresh += 1

            print(f"      ✅ {fresh} URLs produits découvertes")

        print(f"\n   ✅ Total: {len(all_entries)} URLs produits uniques")
        return all_entries

    def _resolve_listing_pages(self, categories: List[str]) -> Dict[str, Dict]:
        """Résout les catégories demandées vers les pages listing correspondantes."""
        active = {}
        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_occasion = any(c in ('occasion',) for c in categories)

        for cat_key, config in self.LISTING_PAGES.items():
            if cat_key == 'inventaire' and want_neuf:
                active[cat_key] = config
            elif cat_key in self.OCCASION_CATS and want_occasion:
                active[cat_key] = config
            elif cat_key in categories:
                active[cat_key] = config

        return active

    def _crawl_listing_pages(self, config: Dict) -> List[Dict]:
        """Parcourt toutes les pages d'un listing Magento paginé."""
        listing_url = config['url']
        etat = config['etat']
        source_cat = config['sourceCategorie']
        all_entries: List[Dict] = []

        resp = self._fetch_with_retry(listing_url)
        if not resp:
            return []

        soup = BeautifulSoup(resp.text, 'lxml')

        total_products = self._parse_total_products(soup)
        total_pages = max(1, math.ceil(total_products / self.PRODUCTS_PER_PAGE))
        print(f"      📊 {total_products} produits, {total_pages} page(s)")

        entries_p1 = self._extract_urls_from_listing(resp.text, etat, source_cat)
        all_entries.extend(entries_p1)

        for page in range(2, total_pages + 1):
            if self._time_remaining() < 120:
                print(f"      ⏱️  Budget temps bas — arrêt pagination à page {page}/{total_pages}")
                break
            page_url = f"{listing_url}?p={page}"
            time.sleep(0.25)
            try:
                resp_p = self._fetch_with_retry(page_url)
                if not resp_p:
                    print(f"      ⚠️ Page {page} inaccessible, arrêt pagination")
                    break
                entries_p = self._extract_urls_from_listing(resp_p.text, etat, source_cat)
                if not entries_p:
                    break
                all_entries.extend(entries_p)
            except Exception:
                break

        return all_entries

    def _parse_total_products(self, soup: BeautifulSoup) -> int:
        """Extrait le nombre total de produits depuis le toolbar Magento."""
        toolbar = soup.select_one('#toolbar-amount')
        if toolbar:
            text = toolbar.get_text(strip=True)
            match = re.search(r'de\s+(\d+)', text)
            if match:
                return int(match.group(1))
            match = re.search(r'(\d+)\s+Produit', text, re.I)
            if match:
                return int(match.group(1))

        amount_el = soup.select_one('.toolbar-number:last-child')
        if amount_el:
            try:
                return int(amount_el.get_text(strip=True))
            except ValueError:
                pass

        count_el = soup.select_one('.toolbar-products .toolbar-amount')
        if count_el:
            nums = re.findall(r'\d+', count_el.get_text())
            if nums:
                return int(nums[-1])

        products_on_page = soup.select('li.product-item, div.product-item, .product-item-info')
        return len(products_on_page)

    def _extract_urls_from_listing(self, html: str, etat: str, source_cat: str) -> List[Dict]:
        """Extrait les URLs et prix partiels depuis une page listing Magento."""
        soup = BeautifulSoup(html, 'lxml')
        entries = []

        product_items = soup.select('li.product-item, div.product-item')
        if not product_items:
            product_items = soup.select('.product-item-info')

        for item in product_items:
            entry = self._parse_listing_item(item, etat, source_cat)
            if entry:
                entries.append(entry)

        if not entries:
            links = soup.select('a.product-item-link, a[href*="vehicules-neufs/"], a[href*="vehicules-d-occasion/"]')
            for link in links:
                href = link.get('href', '')
                if href and self._is_product_url(href):
                    text = link.get_text(strip=True)
                    if text and text.lower() != 'en savoir plus':
                        entries.append({
                            'url': href,
                            'etat': etat,
                            'sourceCategorie': source_cat,
                            'name': self._clean_name(text),
                        })

        return entries

    def _parse_listing_item(self, item: Tag, etat: str, source_cat: str) -> Optional[Dict]:
        """Parse un item produit depuis la grille listing Magento."""
        link = item.select_one('a.product-item-link')
        if not link:
            link = item.select_one('a[href*="vehicules-"]')
        if not link:
            all_links = item.select('a[href]')
            for a in all_links:
                href = a.get('href', '')
                if self._is_product_url(href):
                    link = a
                    break

        if not link:
            return None

        href = link.get('href', '')
        if not href or not self._is_product_url(href):
            return None

        entry: Dict[str, Any] = {
            'url': href,
            'etat': etat,
            'sourceCategorie': source_cat,
        }

        name = link.get_text(strip=True)
        if name and name.lower() not in ('en savoir plus', ''):
            entry['name'] = self._clean_name(name)

        price_box = item.select_one('.price-box')
        if price_box:
            special = price_box.select_one('.special-price .price')
            regular = price_box.select_one('.old-price .price, .regular-price .price')
            if special:
                entry['prix'] = self.clean_price(special.get_text(strip=True))
            elif regular:
                entry['prix'] = self.clean_price(regular.get_text(strip=True))

        prices_text = item.get_text()
        if 'prix' not in entry or not entry.get('prix'):
            prix_match = re.search(r'Prix\s+(?:Moto\s+Ducharme\s+)?(\d[\d\s]*)\s*\$', prices_text)
            if prix_match:
                entry['prix'] = self.clean_price(prix_match.group(1) + '$')

        img = item.select_one('img.product-image-photo, img')
        if img:
            src = img.get('src') or img.get('data-src') or img.get('data-original', '')
            if src and not src.endswith('placeholder'):
                entry['image'] = src if src.startswith('http') else urljoin(self.SITE_URL, src)

        return entry

    # ================================================================
    # PHASE 2: EXTRACTION DEPUIS LES PAGES DÉTAIL
    # ================================================================

    def _extract_from_detail_pages(self, url_entries: List[Dict]) -> List[Dict]:
        """Fetch et parse toutes les pages détail en parallèle avec budget temps."""
        total = len(url_entries)
        workers = min(self.WORKERS, total)
        products: List[Dict] = []
        errors = 0
        consecutive_errors = 0
        start = time.time()

        remaining = self._time_remaining()
        detail_budget = max(120, remaining - 30)
        print(f"\n   🔍 Extraction: {total} pages détail ({workers} workers, "
              f"budget {detail_budget:.0f}s)")

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._fetch_and_parse_detail, entry): entry['url']
                for entry in url_entries
            }

            processed = 0
            try:
                for future in as_completed(futures, timeout=detail_budget):
                    processed += 1
                    try:
                        product = future.result(timeout=15)
                        if product:
                            products.append(product)
                            consecutive_errors = 0
                        else:
                            errors += 1
                            consecutive_errors += 1
                    except Exception:
                        errors += 1
                        consecutive_errors += 1

                    if consecutive_errors >= 30:
                        pending = total - processed
                        error_pct = errors / processed * 100
                        print(f"      ⚠️ Trop d'erreurs consécutives ({consecutive_errors}) — "
                              f"{error_pct:.0f}% erreurs, {pending} URL(s) abandonnées")
                        self._shutdown.set()
                        for f in futures:
                            f.cancel()
                        break

                    if processed % 100 == 0 or processed == total:
                        elapsed = time.time() - start
                        rate = processed / elapsed if elapsed > 0 else 0
                        print(f"      📊 [{processed}/{total}] {len(products)} ok, "
                              f"{errors} erreurs — {rate:.1f}/s")

                    if self._time_remaining() < 20:
                        pending = total - processed
                        print(f"      ⏱️  Budget temps épuisé — {pending} URL(s) restantes ignorées")
                        self._shutdown.set()
                        for f in futures:
                            f.cancel()
                        break
            except TimeoutError:
                pending = total - processed
                print(f"      ⚠️ Timeout extraction — {pending} URL(s) abandonnée(s)")
                self._shutdown.set()
                for f in futures:
                    f.cancel()

        elapsed = time.time() - start
        print(f"      ✅ {len(products)}/{total} produits extraits "
              f"({errors} erreurs) en {elapsed:.1f}s")
        return products

    def _fetch_and_parse_detail(self, entry: Dict) -> Optional[Dict]:
        """Fetch une page détail et en extrait un produit complet."""
        url = entry['url']
        try:
            resp = self._throttled_get(url, timeout=10, allow_redirects=True)
            if resp.status_code != 200:
                return None

            resp.encoding = resp.apparent_encoding or 'utf-8'
            soup = BeautifulSoup(resp.text, 'lxml')

            product: Dict[str, Any] = {
                'sourceUrl': resp.url,
                'sourceSite': self.SITE_URL,
                'etat': entry.get('etat', 'neuf'),
                'sourceCategorie': entry.get('sourceCategorie', 'inventaire'),
                'quantity': 1,
                'groupedUrls': [resp.url],
            }

            if entry.get('prix'):
                product['prix'] = entry['prix']
            if entry.get('image'):
                product['image'] = entry['image']

            self._extract_magento_product_info(soup, product)
            self._extract_magento_prices(soup, product)
            self._extract_specs_tables(soup, product)
            self._extract_description(soup, product)
            self._extract_main_image(soup, product)

            if not product.get('name'):
                h1 = soup.select_one('h1.page-title span, h1.page-title, h1')
                if h1:
                    product['name'] = self._clean_name(h1.get_text(strip=True))

            if not product.get('name'):
                if entry.get('name'):
                    product['name'] = entry['name']
                else:
                    return None

            if not product.get('annee'):
                year = self.clean_year(product.get('name', ''))
                if year:
                    product['annee'] = year

            if not product.get('marque'):
                brand = self._guess_brand(product.get('name', ''), url)
                if brand:
                    product['marque'] = brand

            if not product.get('vehicule_type'):
                vtype = self._extract_type_from_url(url)
                if vtype:
                    product['vehicule_type'] = vtype

            return product

        except Exception:
            return None

    # ================================================================
    # EXTRACTEURS MAGENTO
    # ================================================================

    def _extract_magento_product_info(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait les informations produit depuis le bloc info Magento."""
        info_rows = soup.select('.product-info-main .product.attribute, '
                                '.product-info-main .product-attribute')

        label_map = {
            'fabricant': 'marque',
            'manufacturer': 'marque',
            'marque': 'marque',
            'année': 'annee',
            'annee': 'annee',
            'year': 'annee',
            'type': 'vehicule_type',
            'modèle': 'modele',
            'modele': 'modele',
            'model': 'modele',
            "numéro d'inventaire": 'inventaire',
            "numero d'inventaire": 'inventaire',
            'stock number': 'inventaire',
            'inventaire': 'inventaire',
            'odomètre': 'kilometrage',
            'odometer': 'kilometrage',
            'kilomètrage': 'kilometrage',
            'kilometrage': 'kilometrage',
        }

        for row in info_rows:
            label_el = row.select_one('.type, .label, dt')
            value_el = row.select_one('.value, dd')
            if not label_el or not value_el:
                continue

            label = label_el.get_text(strip=True).lower().rstrip(':').strip()
            value = value_el.get_text(strip=True)
            if not value or value in ('-', 'N/A', ''):
                continue

            field = label_map.get(label)
            if not field:
                continue

            if field == 'annee':
                parsed = self.clean_year(value)
                if parsed:
                    out.setdefault(field, parsed)
            elif field == 'kilometrage':
                parsed = self.clean_mileage(value)
                if parsed is not None:
                    out.setdefault(field, parsed)
            else:
                out.setdefault(field, value)

        text_block = soup.select_one('.product-info-main')
        if not text_block:
            return

        full_text = text_block.get_text(separator='\n')
        patterns = [
            (r'Fabricant:\s*\n?\s*(.+)', 'marque'),
            (r'Ann[ée]e:\s*\n?\s*(.+)', 'annee'),
            (r'Type:\s*\n?\s*(.+)', 'vehicule_type'),
            (r'Mod[èe]le:\s*\n?\s*(.+)', 'modele'),
            (r"Num[ée]ro d'inventaire:\s*\n?\s*(.+)", 'inventaire'),
            (r'Odom[èe]tre:\s*\n?\s*(.+)', 'kilometrage'),
        ]

        for pattern, field in patterns:
            if out.get(field):
                continue
            match = re.search(pattern, full_text, re.I)
            if match:
                value = match.group(1).strip()
                if not value or value in ('-', 'N/A'):
                    continue
                if field == 'annee':
                    parsed = self.clean_year(value)
                    if parsed:
                        out[field] = parsed
                elif field == 'kilometrage':
                    parsed = self.clean_mileage(value)
                    if parsed is not None:
                        out[field] = parsed
                else:
                    out[field] = value

    def _extract_magento_prices(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait les prix depuis le bloc prix Magento."""
        if out.get('prix'):
            return

        price_box = soup.select_one('.product-info-main .price-box, .product-info-price .price-box')
        if price_box:
            special = price_box.select_one('.special-price .price')
            if special:
                p = self.clean_price(special.get_text(strip=True))
                if p:
                    out.setdefault('prix', p)
                    regular = price_box.select_one('.old-price .price')
                    if regular:
                        rp = self.clean_price(regular.get_text(strip=True))
                        if rp:
                            out.setdefault('prix_regulier', rp)
                    return

            regular = price_box.select_one('.price')
            if regular:
                p = self.clean_price(regular.get_text(strip=True))
                if p:
                    out.setdefault('prix', p)
                    return

        info = soup.select_one('.product-info-main')
        if not info:
            return
        text = info.get_text()

        ducharme_match = re.search(r'Prix\s+Moto\s+Ducharme\s+(\d[\d\s]*)\s*\$', text)
        if ducharme_match:
            p = self.clean_price(ducharme_match.group(1) + '$')
            if p:
                out.setdefault('prix', p)
                reg_match = re.search(r'Prix\s+R[ée]gulier\s+(\d[\d\s]*)\s*\$', text)
                if reg_match:
                    rp = self.clean_price(reg_match.group(1) + '$')
                    if rp:
                        out.setdefault('prix_regulier', rp)
                return

        reg_match = re.search(r'Prix\s+R[ée]gulier\s+(\d[\d\s]*)\s*\$', text)
        if reg_match:
            p = self.clean_price(reg_match.group(1) + '$')
            if p:
                out.setdefault('prix', p)

    def _extract_specs_tables(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait les spécifications depuis les tableaux Magento."""
        spec_tables = soup.select('table.data.table.additional-attributes, '
                                  'table.data-table, '
                                  '.product.data.items table, '
                                  '#product-attribute-specs-table')

        if not spec_tables:
            spec_tables = soup.select('.product-info-detailed table, '
                                      '.additional-attributes-wrapper table')

        for table in spec_tables:
            rows = table.select('tr')
            for row in rows:
                cells = row.select('th, td')
                if len(cells) < 2:
                    continue

                label = cells[0].get_text(strip=True).lower().strip()
                value = cells[1].get_text(strip=True)

                if not value or value in ('-', 'N/A', '', 'null'):
                    continue

                field = self.SPEC_FIELD_MAP.get(label)
                if field:
                    if field == 'kilometrage':
                        parsed = self.clean_mileage(value)
                        if parsed is not None:
                            out.setdefault(field, parsed)
                    elif field == 'couleur':
                        out.setdefault(field, value)
                    else:
                        out.setdefault(field, value)

        tab_content = soup.select('.product.data.items .data.item.content, '
                                  '#tab-label-additional, '
                                  '.product-info-detailed')
        for content in tab_content:
            dts = content.select('dt, .col.label')
            for dt in dts:
                dd = dt.find_next_sibling('dd') or dt.find_next_sibling(class_='col data')
                if not dd:
                    continue
                label = dt.get_text(strip=True).lower().strip()
                value = dd.get_text(strip=True)
                if not value or value in ('-', 'N/A', ''):
                    continue
                field = self.SPEC_FIELD_MAP.get(label)
                if field:
                    out.setdefault(field, value)

    def _extract_description(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait la description produit."""
        if out.get('description'):
            return

        desc_selectors = [
            '.product.attribute.description .value',
            '.product-info-detailed .description .value',
            '#description .value',
            '.product.attribute.overview .value',
        ]

        for sel in desc_selectors:
            desc_el = soup.select_one(sel)
            if desc_el:
                text = desc_el.get_text(separator=' ', strip=True)
                text = self._clean_description(text)
                if text and len(text) > 20:
                    out['description'] = text[:3000]
                    return

    def _extract_main_image(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait l'image principale du produit."""
        if out.get('image'):
            return

        gallery_img = soup.select_one('.fotorama__stage img, '
                                      '.gallery-placeholder img, '
                                      '.product.media img')
        if gallery_img:
            src = gallery_img.get('src') or gallery_img.get('data-src', '')
            if src and src.startswith('http'):
                out['image'] = src
                return

        json_config = soup.select_one('[data-gallery-role="gallery-placeholder"]')
        if json_config:
            config_data = json_config.get('data-mage-init', '')
            img_match = re.search(r'"img":\s*"(https?://[^"]+)"', config_data)
            if img_match:
                out['image'] = img_match.group(1)
                return

        og_image = soup.select_one('meta[property="og:image"]')
        if og_image:
            content = og_image.get('content', '')
            if content and content.startswith('http'):
                out['image'] = content

    # ================================================================
    # INTERFACE ABSTRAITE
    # ================================================================

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']
        entries = self._discover_all_product_urls(categories)
        return [e['url'] for e in entries]

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        out: Dict[str, Any] = {}
        self._extract_magento_product_info(soup, out)
        self._extract_magento_prices(soup, out)
        self._extract_specs_tables(soup, out)
        self._extract_description(soup, out)
        self._extract_main_image(soup, out)

        h1 = soup.select_one('h1.page-title span, h1.page-title, h1')
        if h1:
            out.setdefault('name', self._clean_name(h1.get_text(strip=True)))

        return out if out else None

    # ================================================================
    # HELPERS
    # ================================================================

    def _throttled_get(self, url: str, **kwargs) -> requests.Response:
        if self._shutdown.is_set() or self._time_remaining() < 5:
            self._shutdown.set()
            raise TimeoutError("Budget temps épuisé")
        with self._request_lock:
            now = time.monotonic()
            interval = self._min_request_interval + random.uniform(0, 0.15)
            elapsed = now - self._last_request_time
            if elapsed < interval:
                time.sleep(interval - elapsed)
            self._last_request_time = time.monotonic()
        return self.session.get(url, **kwargs)

    def _fetch_with_retry(self, url: str) -> Optional[requests.Response]:
        for attempt in range(1, self.LISTING_MAX_RETRIES + 1):
            try:
                resp = self.session.get(url, timeout=30)
                if resp.status_code == 200:
                    return resp
                if resp.status_code >= 500 and attempt < self.LISTING_MAX_RETRIES:
                    wait = self.LISTING_RETRY_DELAY * (2 ** (attempt - 1))
                    print(f"      ⏳ HTTP {resp.status_code} — retry dans {wait}s ({attempt}/{self.LISTING_MAX_RETRIES})")
                    time.sleep(wait)
                    continue
                print(f"      ⚠️ HTTP {resp.status_code} pour {url}")
                return None
            except requests.exceptions.RequestException as e:
                if attempt < self.LISTING_MAX_RETRIES:
                    wait = self.LISTING_RETRY_DELAY * (2 ** (attempt - 1))
                    print(f"      ⏳ Erreur réseau — retry dans {wait}s ({attempt}/{self.LISTING_MAX_RETRIES})")
                    time.sleep(wait)
                else:
                    print(f"      ⚠️ Erreur après {self.LISTING_MAX_RETRIES} tentatives: {e}")
                    return None
        return None

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        if '/vehicules-neufs/' in url_lower or '/vehicules-d-occasion/' in url_lower:
            excludes = ['/customer/', '/checkout/', '/financement/', '/contacts/',
                        '/newsletter/', '/review/', '/wishlist/', '/catalogsearch/',
                        '?p=', '?price=', '?manufacturer=', '?year=',
                        '?category_ids=', '?is_onsale=', '?mpp_model_ld=']
            if any(x in url_lower for x in excludes):
                return False
            path = url_lower.split('?')[0]
            segments = [s for s in path.split('/') if s]
            return len(segments) >= 4
        return False

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        """Déduit le type de véhicule depuis le slug URL Magento."""
        path = url.lower()
        type_map = {
            'moto-standard': 'Moto standard',
            'moto-sport': 'Moto sport',
            'moto-custom': 'Moto custom',
            'moto-trail': 'Moto trail',
            'moto-competition': 'Moto compétition',
            'moto-double-usag': 'Moto double usage',
            'moto-grand-touri': 'Moto grand tourisme',
            'moto-sport-touri': 'Moto sport touring',
            'moto-retro-stand': 'Moto rétro standard',
            'moto-enfant': 'Moto enfant',
            'motoneige': 'Motoneige',
            'vtt': 'VTT',
            'cote-a-cote': 'Côte à côte',
            'motomarine': 'Motomarine',
            'e-bike': 'E-Bike',
        }
        for slug, label in type_map.items():
            if slug in path:
                return label
        return None

    KNOWN_BRANDS = {
        'honda': 'Honda', 'kawasaki': 'Kawasaki', 'husqvarna': 'Husqvarna',
        'polaris': 'Polaris', 'talaria': 'Talaria', 'yamaha': 'Yamaha',
        'suzuki': 'Suzuki', 'bmw': 'BMW', 'ktm': 'KTM',
        'can-am': 'Can-Am', 'harley': 'Harley-Davidson',
        'indian': 'Indian', 'aprilia': 'Aprilia',
    }

    def _guess_brand(self, name: str, url: str) -> Optional[str]:
        combined = f"{name} {url}".lower()
        for slug, brand_name in self.KNOWN_BRANDS.items():
            if slug in combined:
                return brand_name
        return None

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
        name = re.sub(r'\s*\|\s*Moto\s*Ducharme.*$', '', name, flags=re.I)
        name = re.sub(r'\s*-\s*Moto\s*Ducharme.*$', '', name, flags=re.I)
        name = re.sub(r'\s*CS-[\w-]+\s*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()

    @staticmethod
    def _clean_description(text: str) -> str:
        if not text:
            return text
        boilerplate = (
            "Le prix de vente inclut les frais de TRANSPORT et de PRÉPARATION"
        )
        idx = text.find(boilerplate)
        if idx > 0:
            text = text[:idx]
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
