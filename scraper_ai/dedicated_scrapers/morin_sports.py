"""
Scraper dédié pour Morin Sports & Marine (morinsports.com).

Concessionnaire Arctic Cat, Kawasaki, Suzuki Marine, Widescape et Remeq
situé au 1695 Rue St-Maurice, Trois-Rivières, QC.

Plateforme : PowerGO / Next.js (cdn.powergo.ca)
Domaine    : morinsports.com

Stratégie de découverte (cascade) :
  1. Sitemap inventory-detail.xml → URLs neuves + occasion à vendre
  2. Sitemap showroom-detail.xml  → catalogue complet des modèles (pré-commande)
  3. Pages détail (parallèle)     → JSON-LD Vehicle + specs HTML (li.spec-*)

URL patterns :
  - Inventaire neuf      : /fr/neuf/<type>/inventaire/<slug>-a-vendre-<sku>/
  - Inventaire occasion  : /fr/usage/<type>/inventaire/<slug>-a-vendre-<sku>/
  - Catalogue showroom   : /fr/neuf/<type>/<marque>/<modele>/

Types de véhicules : Motocyclette, VTT, Côte à côte, Motoneige,
                     Motomarine, Bateau, Moteur hors-bord, Remorque
"""
import re
import json
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from .motoplex import MotoplexScraper


class MorinSportsScraper(MotoplexScraper):

    SITE_NAME = "Morin Sports & Marine"
    SITE_SLUG = "morin-sports"
    SITE_URL = "https://www.morinsports.com/fr/"
    SITE_DOMAIN = "morinsports.com"
    SITE_DOMAIN_ALT = "morinsports.com"

    # Sitemaps PowerGO standard
    SITEMAP_URL = "https://www.morinsports.com/sitemaps/inventory-detail.xml"
    SHOWROOM_SITEMAP_URL = "https://www.morinsports.com/sitemaps/showroom-detail.xml"
    SITEMAP_INDEX_URL = "https://www.morinsports.com/sitemap-index.xml"

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    # ================================================================
    # PIPELINE PRINCIPAL
    # ================================================================

    def scrape(self, categories: List[str] = None,
               inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()

        if categories is None:
            categories = ['inventaire', 'occasion']

        print(f"\n{'='*70}")
        print(f"🔧 SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"🌐 Site: {self.SITE_URL}")
        print(f"📦 Catégories: {categories}")

        url_map = self._discover_urls_from_sitemap(categories)

        # Catalogue showroom : uniquement si demandé explicitement
        # (inventory_only=False ET catégorie 'catalogue' présente).
        want_catalogue = (
            not inventory_only and any(
                c in ('catalogue', 'showroom') for c in categories)
        )
        if want_catalogue:
            showroom_urls = self._discover_showroom_urls()
            if showroom_urls:
                url_map.setdefault('catalogue', []).extend(showroom_urls)

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
            products = [p for p in products
                        if p.get('sourceCategorie') != 'catalogue']

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
    # PHASE 1 : DÉCOUVERTE DES URLs
    # ================================================================

    def _discover_urls_from_sitemap(self,
                                     categories: List[str]) -> Dict[str, List[str]]:
        """Récupère le sitemap inventory-detail et trie les URLs par catégorie.

        Le sitemap contient les fiches d'inventaire neuf (/fr/neuf/) et
        d'occasion (/fr/usage/), avec le segment ``a-vendre-<sku>`` à la fin.
        """
        try:
            resp = self.session.get(self.SITEMAP_URL, timeout=15)
            if resp.status_code != 200:
                print(f"   ⚠️ Sitemap inventaire indisponible ({resp.status_code})")
                return {}
        except Exception as e:
            print(f"   ⚠️ Erreur sitemap inventaire: {e}")
            return {}

        raw_urls = self._parse_sitemap_locs(resp.text)
        if not raw_urls:
            print(f"   ⚠️ Sitemap récupéré ({len(resp.text)} chars) mais 0 <loc>")
            return {}

        url_map: Dict[str, List[str]] = {}
        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_occasion = any(c in ('occasion', 'usage') for c in categories)

        for raw_url in raw_urls:
            if '/fr/' not in raw_url:
                continue
            if '/inventaire/' not in raw_url or 'a-vendre-' not in raw_url:
                continue

            if '/neuf/' in raw_url and want_neuf:
                url_map.setdefault('inventaire', []).append(raw_url)
            elif '/usage/' in raw_url and want_occasion:
                url_map.setdefault('occasion', []).append(raw_url)

        return url_map

    def _discover_showroom_urls(self) -> List[str]:
        """Récupère les URLs de la gamme showroom (catalogue complet).

        Format des URLs : /fr/neuf/<type>/<marque>/<modele>/
        Exclut les URLs qui contiennent ``/inventaire/`` (déjà couvertes
        par le sitemap inventory-detail).
        """
        try:
            resp = self.session.get(self.SHOWROOM_SITEMAP_URL, timeout=15)
            if resp.status_code != 200:
                return []
        except Exception:
            return []

        raw_urls = self._parse_sitemap_locs(resp.text)
        if not raw_urls:
            return []

        urls: List[str] = []
        for raw_url in raw_urls:
            if '/fr/neuf/' not in raw_url:
                continue
            if '/inventaire/' in raw_url:
                continue
            urls.append(raw_url)
        return urls

    # ================================================================
    # PHASE 2 : EXTRACTION DES PAGES DÉTAIL
    # ================================================================

    def _extract_from_detail_pages(
            self, url_map: Dict[str, List[str]]) -> List[Dict]:
        """Fetch et parse toutes les pages détail en parallèle.

        Reproduit la logique parallèle de MotoplexScraper en ajoutant la
        catégorie 'catalogue' (showroom) qui n'existe pas dans la base.
        """
        tasks: List[tuple] = []
        for cat_key, urls in url_map.items():
            if cat_key == 'inventaire':
                etat, source_cat = 'neuf', 'inventaire'
            elif cat_key == 'occasion':
                etat, source_cat = 'occasion', 'vehicules_occasion'
            else:
                etat, source_cat = 'neuf', 'catalogue'
            for url in urls:
                tasks.append((url, etat, source_cat))

        total = len(tasks)
        workers = min(self.WORKERS, total) if total > 0 else 1
        products: List[Dict] = []
        errors = 0
        start = time.time()

        print(f"\n   🔍 Extraction: {total} pages détail ({workers} workers)...")

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(
                    self._fetch_and_parse_detail, url, etat, source_cat): url
                for url, etat, source_cat in tasks
            }

            processed = 0
            try:
                for future in as_completed(futures, timeout=900):
                    processed += 1
                    try:
                        product = future.result(
                            timeout=self.DETAIL_TIMEOUT + 5)
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
            except TimeoutError:
                pending = total - processed
                print(f"      ⚠️ Timeout — {pending}/{total} URL(s) abandonnée(s), "
                      f"{len(products)} produit(s) conservé(s)")
                for f in futures:
                    f.cancel()

        print(f"      ✅ {len(products)}/{total} produits extraits "
              f"({errors} erreurs)")
        return products

    def _fetch_and_parse_detail(self, url: str, etat: str,
                                  source_cat: str) -> Optional[Dict]:
        """Fetch une page détail et en extrait un produit complet."""
        try:
            resp = self.session.get(
                url, timeout=self.DETAIL_TIMEOUT, allow_redirects=True)
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
            self._extract_html_specs_label_value(soup, product)

            # Catalogue : pas d'inventaire/SKU réel, on retire le champ pour
            # éviter une fausse clé d'inventaire (placeholder showroom).
            if source_cat == 'catalogue':
                product.pop('inventaire', None)

            h1 = soup.select_one('h1')
            raw_title = h1.get_text(strip=True) if h1 else ''
            if raw_title:
                meta = self._detect_name_metadata(raw_title)
                # Ne pas écraser l'état 'neuf' du catalogue.
                if meta.get('etat') and source_cat != 'catalogue':
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
                desc_el = soup.select_one(
                    'div.pg-vehicle-description .prose, '
                    'div.pg-vehicle-description, '
                    '[class*="vehicle-description"] .prose')
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
    # OVERRIDES — JSON-LD enrichi pour gérer le showroom
    # ================================================================

    # Types JSON-LD acceptés. Inclut Product pour les remorques Remeq dont
    # le catalogue PowerGO n'utilise pas le schema Vehicle.
    _ACCEPTED_LD_TYPES = ('Vehicle', 'Product')

    def _extract_json_ld(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extraction JSON-LD étendue.

        Différences vs MotoplexScraper :
          - Accepte ``@type: Vehicle`` (inventaire) ET ``Product`` (catalogue
            remorques Remeq).
          - ``offers`` peut être une liste (showroom multi-couleurs) ou un dict.
          - ``itemCondition`` peut être ``schema.org/new`` (minuscule, showroom)
            ou ``schema.org/NewCondition`` (inventaire).
          - ``image`` peut être une liste, on prend la première URL valide.
          - Filtrage des prix aberrants via ``clean_price``.
        """
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string or '{}')
            except (json.JSONDecodeError, TypeError):
                continue

            graph = data.get('@graph', [data] if data.get('@type') else [])
            for item in graph:
                if item.get('@type') not in self._ACCEPTED_LD_TYPES:
                    continue

                if item.get('name'):
                    out.setdefault('name', self._clean_name(item['name']))
                if item.get('manufacturer'):
                    manuf = item['manufacturer']
                    if isinstance(manuf, dict):
                        manuf = manuf.get('name', '')
                    if manuf:
                        out.setdefault('marque', manuf)
                if item.get('brand') and not out.get('marque'):
                    brand = item['brand']
                    if isinstance(brand, dict):
                        brand = brand.get('name', '')
                    if brand:
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
                    out.setdefault('inventaire', str(item['sku']))

                condition = (item.get('itemCondition') or '').lower()
                if 'new' in condition:
                    out.setdefault('etat', 'neuf')
                elif 'used' in condition:
                    out.setdefault('etat', 'occasion')

                odometer = item.get('mileageFromOdometer')
                if isinstance(odometer, dict) and odometer.get('value') is not None:
                    try:
                        km = int(float(odometer['value']))
                        if km >= 0:
                            out.setdefault('kilometrage', km)
                    except (ValueError, TypeError):
                        pass

                offers = item.get('offers')
                price = self._extract_price_from_offers(offers)
                if price is not None:
                    out.setdefault('prix', price)

                img = item.get('image')
                img_url = self._first_image_url(img)
                if img_url:
                    out.setdefault('image', img_url)

                desc = item.get('description', '')
                if desc and len(desc) > 10:
                    out.setdefault('description', desc[:2000])

                # Premier Vehicle trouvé → on stoppe ce script et on continue.
                break

    @staticmethod
    def _extract_price_from_offers(offers: Any) -> Optional[float]:
        """Retourne le prix le plus pertinent depuis une offre (dict ou list).

        Priorise le prix le plus bas pour le showroom (multi-couleurs).
        """
        if not offers:
            return None

        candidates: List[float] = []
        items = offers if isinstance(offers, list) else [offers]
        for offer in items:
            if not isinstance(offer, dict):
                continue
            raw = offer.get('price')
            if raw is None:
                continue
            try:
                val = float(raw)
            except (ValueError, TypeError):
                continue
            if 0 < val <= 1_000_000:
                candidates.append(val)

        if not candidates:
            return None
        return min(candidates)

    # Mapping des libellés FR utilisés dans les specs PowerGO catalogue
    # (format "Label:Value" sans span.font-bold).
    _SPEC_LABEL_MAP = {
        'manufacturier': 'marque',
        'fabricant': 'marque',
        'marque': 'marque',
        'modèle': 'modele',
        'modele': 'modele',
        'année': 'annee',
        'annee': 'annee',
        'couleur': 'couleur',
        'no de stock': 'inventaire',
        'numéro de stock': 'inventaire',
        'numero de stock': 'inventaire',
        'stock': 'inventaire',
        'vin': 'vin',
        'nip': 'vin',
        'type': 'vehicule_type',
        'catégorie': 'vehicule_categorie',
        'categorie': 'vehicule_categorie',
        'utilisation': 'kilometrage',
        'kilométrage': 'kilometrage',
        'kilometrage': 'kilometrage',
    }

    def _extract_html_specs_label_value(
            self, soup: BeautifulSoup, out: Dict) -> None:
        """Fallback pour les pages catalogue où ``span.font-bold`` est absent.

        Sur ces pages, chaque ``li.spec-*`` contient simplement le texte
        ``Label:Value`` (ex: ``Manufacturier:Remeq``). On split sur ``:``
        et on mappe le label vers un champ canonique.
        """
        for li in soup.select('li[class*="spec-"]'):
            if li.select_one('span.font-bold'):
                continue

            text = li.get_text(strip=True)
            if not text or ':' not in text:
                continue

            label, _, value = text.partition(':')
            label_norm = label.strip().lower()
            value = value.strip()
            if not value or value in ('-', 'N/A', 'null'):
                continue

            field = self._SPEC_LABEL_MAP.get(label_norm)
            if not field or out.get(field):
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

    @staticmethod
    def _first_image_url(img: Any) -> Optional[str]:
        """Retourne la première URL d'image valide depuis un champ JSON-LD."""
        if not img:
            return None
        if isinstance(img, list):
            for entry in img:
                url = MorinSportsScraper._first_image_url(entry)
                if url:
                    return url
            return None
        if isinstance(img, str):
            return img if img.startswith('http') else None
        if isinstance(img, dict):
            url = img.get('url') or img.get('contentUrl')
            if isinstance(url, str) and url.startswith('http'):
                return url
        return None

    # ================================================================
    # FALLBACKS DOM (prix / image)
    # ================================================================

    # Annotations à retirer du texte avant parsing du prix.
    # PowerGO concatène le prix barré + "Épargnez X $" + prix final.
    _PRICE_NOISE_RE = re.compile(
        r'(?:Save|Épargnez|Economisez|Économisez|Rabais|Discount)'
        r'\s*\$?\s*[\d,.\s]+',
        re.I,
    )

    def _extract_price_fallback(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extraction du prix depuis le DOM si le JSON-LD n'a rien donné.

        PowerGO affiche couramment :
          - ``21 944 $Épargnez 2 400 $19 544 $`` (prix barré + rabais + final)
        On nettoie les annotations puis on tente d'extraire le dernier
        montant (= prix final).
        """
        price_el = soup.select_one(
            'div.pg-vehicle-price, div.pg-vehicle-mobile-price, '
            '[class*="vehicle-price"]')
        if not price_el:
            return

        original_el = price_el.select_one(
            's, del, .text-sale, .text-red, [class*="line-through"], '
            '[class*="original"]')
        if original_el:
            original_price = self.clean_price(
                original_el.get_text(strip=True))
            if original_price:
                out.setdefault('prix_original', original_price)

        raw_text = price_el.get_text(separator=' ', strip=True)
        cleaned = self._PRICE_NOISE_RE.sub(' ', raw_text)

        # On essaie d'abord le DERNIER montant (prix final après rabais).
        amounts = re.findall(
            r'(\d[\d\s,.]{2,}\s*\$|\$\s*\d[\d\s,.]+)', cleaned)
        for amount in reversed(amounts):
            parsed = self.clean_price(amount)
            if parsed:
                out.setdefault('prix', parsed)
                return

        parsed = self.clean_price(cleaned)
        if parsed:
            out.setdefault('prix', parsed)

    def _extract_image_fallback(
            self, soup: BeautifulSoup, url: str, out: Dict) -> None:
        """Image principale fallback quand le JSON-LD n'en contient pas."""
        img = soup.select_one(
            'img.pg-vehicle-image, .pg-vehicle-gallery img, '
            'img[src*="cdn.powergo.ca"], img[srcset*="cdn.powergo.ca"]')
        if not img:
            return

        src = img.get('src') or img.get('data-src', '')
        if not src:
            srcset = img.get('srcset', '')
            if srcset:
                src = srcset.split(',')[0].split()[0]
        if src:
            out['image'] = src if src.startswith('http') else urljoin(url, src)

    # ================================================================
    # FILTRES & HELPERS
    # ================================================================

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False

        # Exclusions transversales (formulaires, contact, etc.)
        skip = ('/service/', '/contact/', '/financement/', '/pieces/',
                '/blogue/', '/equipe/', '/promotions/', '/carrieres/')
        if any(s in url_lower for s in skip):
            return False

        if '/fr/' not in url_lower:
            return False

        if '/inventaire/' in url_lower and 'a-vendre-' in url_lower:
            return True

        # URL showroom : /fr/neuf/<type>/<marque>/<modele>/ (≥ 4 segments
        # après /fr/neuf/, sans /inventaire/).
        if '/fr/neuf/' in url_lower and '/inventaire/' not in url_lower:
            path = urlparse(url_lower).path.strip('/').split('/')
            return len(path) >= 5  # ['fr','neuf',type,marque,modele]

        return False

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        """Étend la table de types pour couvrir le catalogue Morin Sports."""
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
            'velo-electrique': 'Vélo électrique',
            'equipement-mecanique': 'Équipement mécanique',
        }
        path = urlparse(url).path.lower()
        for slug, label in type_map.items():
            if f'/{slug}/' in path:
                return label
        return None

    def discover_product_urls(self,
                                categories: List[str] = None) -> List[str]:
        if categories is None:
            categories = ['inventaire', 'occasion']
        url_map = self._discover_urls_from_sitemap(categories)
        if any(c in ('catalogue', 'showroom') for c in categories):
            showroom = self._discover_showroom_urls()
            if showroom:
                url_map.setdefault('catalogue', []).extend(showroom)

        all_urls: List[str] = []
        for urls in url_map.values():
            all_urls.extend(urls)

        seen: set = set()
        unique: List[str] = []
        for u in all_urls:
            key = u.rstrip('/').lower()
            if key not in seen:
                seen.add(key)
                unique.append(u)
        return unique

    # ================================================================
    # NETTOYAGE DU NOM (suffixe Morin Sports & Marine)
    # ================================================================

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = MotoplexScraper._fix_mojibake(name)
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
        name = re.sub(
            r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$",
            '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)

        # Suffixes spécifiques à Morin Sports & Marine.
        name = re.sub(
            r'\s*[|\-–]\s*Morin\s+Sports?(?:\s+(?:&|et)\s+Marine)?\s*$',
            '', name, flags=re.I)
        name = re.sub(
            r'\s+(?:Neuf|Usag[ée]e?)\s+à\s+Trois[\-–]?Rivi[èe]res\s*$',
            '', name, flags=re.I)
        name = re.sub(r'\s+à\s+Trois[\-–]?Rivi[èe]res\s*$', '', name, flags=re.I)

        # Codes internes constructeur Kawasaki/Suzuki concaténés au nom
        # par PowerGO (ex: "KLE650JSNN", "KLX140CSFNN", "KLZ1000DPSNN").
        # Pattern: 2+ lettres + 2+ chiffres + 4+ lettres consécutives.
        # On reste strict (4+ lettres finales) pour ne pas casser des
        # modèles légitimes comme "KLX140R", "ZX10R", "KLR650S".
        name = re.sub(
            r'\s+[A-Z]{2,}\d{2,}[A-Z]{4,}(?=\s|$)',
            '', name)

        name = re.sub(r'\s*-\s*$', '', name)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
