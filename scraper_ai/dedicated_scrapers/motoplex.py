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
    # Optionnel : sitemap catalogue/showroom (modèles non en stock).
    # Quand défini, la catégorie 'catalogue' devient disponible dans scrape().
    SHOWROOM_SITEMAP_URL: Optional[str] = None

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    SEL_SPEC_VALUE = 'span.font-bold'

    # Types JSON-LD acceptés. PowerGO utilise majoritairement 'Vehicle' pour
    # l'inventaire mais 'Product' pour le catalogue (remorques, pièces…).
    _ACCEPTED_LD_TYPES = ('Vehicle', 'Product')

    # Mapping FR → champ canonique pour le fallback HTML 'Label:Value'
    # (pages catalogue PowerGO sans span.font-bold).
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

    # Annotations à retirer du texte avant parsing du prix.
    # PowerGO concatène prix barré + 'Épargnez X $' + prix final.
    _PRICE_NOISE_RE = re.compile(
        r'(?:Save|Épargnez|Economisez|Économisez|Rabais|Discount)'
        r'\s*\$?\s*[\d,.\s]+',
        re.I,
    )

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

        # Catalogue/showroom : seulement si SHOWROOM_SITEMAP_URL est défini
        # ET que la catégorie est demandée (et inventory_only=False).
        want_catalogue = (
            not inventory_only
            and self.SHOWROOM_SITEMAP_URL
            and any(c in ('catalogue', 'showroom') for c in categories)
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
        """Récupère le sitemap inventory-detail.xml et trie les URLs par catégorie.

        Utilise plusieurs stratégies de parsing en cascade pour tolérer
        les différences d'environnement (lxml XML, lxml HTML, html.parser, regex).
        """
        try:
            resp = self.session.get(self.SITEMAP_URL, timeout=15)
            if resp.status_code != 200:
                print(f"   ⚠️ Sitemap indisponible ({resp.status_code})")
                return {}
        except Exception as e:
            print(f"   ⚠️ Erreur sitemap: {e}")
            return {}

        raw_urls = self._parse_sitemap_locs(resp.text)

        if not raw_urls:
            print(f"   ⚠️ Sitemap récupéré ({len(resp.text)} chars) mais 0 <loc> extraits")
            return {}

        url_map: Dict[str, List[str]] = {}
        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_occasion = any(c in ('occasion', 'usage') for c in categories)

        for raw_url in raw_urls:
            if '/fr/' not in raw_url or '/inventaire/' not in raw_url:
                continue
            if 'a-vendre-' not in raw_url:
                continue

            if '/neuf/' in raw_url and want_neuf:
                url_map.setdefault('inventaire', []).append(raw_url)
            elif '/usage/' in raw_url and want_occasion:
                url_map.setdefault('occasion', []).append(raw_url)

        return url_map

    def _discover_showroom_urls(self) -> List[str]:
        """Récupère les URLs du sitemap showroom (catalogue de modèles).

        Format PowerGO : ``/fr/neuf/<type>/<marque>/<modele>/`` (4+ segments
        après /fr/neuf/, sans ``/inventaire/``). Skip silencieusement si
        ``SHOWROOM_SITEMAP_URL`` est absent ou inaccessible.
        """
        if not self.SHOWROOM_SITEMAP_URL:
            return []
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

    @staticmethod
    def _parse_sitemap_locs(xml_text: str) -> List[str]:
        """Extrait les URLs <loc> d'un sitemap XML avec fallback multi-parsers.

        Cascade: xml → lxml → html.parser → regex.
        """
        parsers = ['xml', 'lxml', 'html.parser']
        for parser_name in parsers:
            try:
                soup = BeautifulSoup(xml_text, parser_name)
                locs = soup.find_all('loc')
                if locs:
                    urls = [loc.get_text(strip=True) for loc in locs if loc.get_text(strip=True)]
                    if urls:
                        return urls
            except Exception:
                continue

        loc_pattern = re.compile(r'<loc>\s*(https?://[^<]+?)\s*</loc>', re.I)
        matches = loc_pattern.findall(xml_text)
        if matches:
            return [u.strip() for u in matches]

        return []

    # ================================================================
    # PHASE 2 : EXTRACTION DEPUIS LES PAGES DÉTAIL
    # ================================================================

    def _extract_from_detail_pages(self, url_map: Dict[str, List[str]]) -> List[Dict]:
        """Fetch et parse toutes les pages détail en parallèle."""
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
            except TimeoutError:
                pending = total - processed
                print(f"      ⚠️ Timeout — {pending}/{total} URL(s) abandonnée(s), "
                      f"{len(products)} produit(s) conservé(s)")
                for f in futures:
                    f.cancel()

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
            self._extract_html_specs_label_value(soup, product)

            # Catalogue : pas d'inventaire/SKU réel — on retire le placeholder
            # showroom pour éviter une fausse clé d'inventaire.
            if source_cat == 'catalogue':
                product.pop('inventaire', None)

            # Titre brut (h1) : détecter état/km AVANT nettoyage
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

            # Nom : JSON-LD name > h1 > construction depuis marque+modele+annee
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
                img = soup.select_one(
                    'img.pg-vehicle-image, .pg-vehicle-gallery img, '
                    'img[src*="cdn.powergo.ca"], img[srcset*="cdn.powergo.ca"]')
                if img:
                    src = img.get('src') or img.get('data-src', '')
                    if not src:
                        srcset = img.get('srcset', '')
                        if srcset:
                            src = srcset.split(',')[0].split()[0]
                    if src:
                        product['image'] = src if src.startswith('http') else urljoin(url, src)

            if not product.get('description'):
                desc_el = soup.select_one(
                    'div.pg-vehicle-description .prose, '
                    'div.pg-vehicle-description, '
                    '[class*="vehicle-description"] .prose')
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
        """Extrait les données structurées JSON-LD (schema.org Vehicle/Product).

        Robustifié pour tolérer les variations PowerGO :
          - ``@type`` : 'Vehicle' (inventaire) ET 'Product' (catalogue)
          - ``manufacturer`` / ``brand`` : str ou dict {name: ...}
          - ``offers`` : dict ou liste (showroom multi-couleurs → prix min)
          - ``itemCondition`` : 'NewCondition'/'UsedCondition' OU
                                'schema.org/new'/'schema.org/used'
          - ``image`` : str, dict {url|contentUrl} ou liste
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

                manuf = item.get('manufacturer')
                if isinstance(manuf, dict):
                    manuf = manuf.get('name', '')
                if manuf:
                    out.setdefault('marque', manuf)

                if not out.get('marque'):
                    brand = item.get('brand')
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

                price = self._extract_price_from_offers(item.get('offers'))
                if price is not None:
                    out.setdefault('prix', price)

                img_url = self._first_image_url(item.get('image'))
                if img_url:
                    out.setdefault('image', img_url)

                desc = item.get('description', '')
                if isinstance(desc, str) and len(desc) > 10:
                    out.setdefault('description', desc[:2000])

                break

    @staticmethod
    def _extract_price_from_offers(offers: Any) -> Optional[float]:
        """Retourne le prix le plus pertinent depuis offers (dict ou list).

        Pour le showroom multi-couleurs (offers en liste), on prend le
        prix le plus bas. Filtre les valeurs aberrantes (>1M, ≤0).
        """
        if not offers:
            return None
        items = offers if isinstance(offers, list) else [offers]
        candidates: List[float] = []
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
        return min(candidates) if candidates else None

    @staticmethod
    def _first_image_url(img: Any) -> Optional[str]:
        """Retourne la première URL d'image valide depuis un champ JSON-LD."""
        if not img:
            return None
        if isinstance(img, list):
            for entry in img:
                url = MotoplexScraper._first_image_url(entry)
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

    def _extract_html_specs_label_value(self, soup: BeautifulSoup, out: Dict) -> None:
        """Fallback pour les pages catalogue où ``span.font-bold`` est absent.

        Sur ces pages PowerGO showroom, chaque ``li.spec-*`` contient
        directement le texte ``Label:Value`` (ex: ``Manufacturier:Remeq``).
        On split sur le premier ``:`` et on mappe le label vers un champ
        canonique via ``_SPEC_LABEL_MAP``. Skip si le ``span.font-bold``
        existe (auquel cas ``_extract_html_specs`` a déjà fait le travail).
        """
        for li in soup.select('li[class*="spec-"]'):
            if li.select_one(self.SEL_SPEC_VALUE):
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

    def _extract_price_fallback(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extraction du prix depuis le DOM si JSON-LD n'a rien donné.

        PowerGO affiche couramment la concaténation :
          ``21 944 $Épargnez 2 400 $19 544 $`` (prix barré + rabais + final)
        On nettoie les annotations de rabais puis on prend le DERNIER
        montant du texte (= prix final). Stocke aussi ``prix_original``
        si un élément barré (``<s>``, ``<del>``, ``line-through``) est
        détecté séparément.
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
            original_price = self.clean_price(original_el.get_text(strip=True))
            if original_price:
                out.setdefault('prix_original', original_price)

        raw_text = price_el.get_text(separator=' ', strip=True)
        cleaned = self._PRICE_NOISE_RE.sub(' ', raw_text)

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

    # ================================================================
    # DÉTECTION ÉTAT / KM DEPUIS LE TITRE
    # ================================================================

    @staticmethod
    def _detect_name_metadata(raw_name: str) -> Dict[str, Any]:
        """Détecte l'état et le kilométrage depuis le titre brut (avant nettoyage)."""
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
        """Interface requise par la classe de base.

        Inclut automatiquement le sitemap showroom si ``SHOWROOM_SITEMAP_URL``
        est défini et la catégorie 'catalogue'/'showroom' est demandée.
        """
        if categories is None:
            categories = ['inventaire', 'occasion']
        url_map = self._discover_urls_from_sitemap(categories)

        if self.SHOWROOM_SITEMAP_URL and any(
                c in ('catalogue', 'showroom') for c in categories):
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

    @classmethod
    def _clean_name(cls, name: str) -> str:
        """Nettoyage générique des noms produits PowerGO.

        Classmethod (pas staticmethod) pour pouvoir lire ``cls.SITE_NAME``
        et retirer dynamiquement le suffixe ``| {SITE_NAME}`` quel que
        soit le concessionnaire. Compatible avec ``self._clean_name(...)``
        et ``MotoplexScraper._clean_name(...)``.
        """
        if not name:
            return name
        name = cls._fix_mojibake(name)
        # Annotations entre astérisques: *LIQUIDATION*, *BAS KILOMÉTRAGE*, *744 KM*, etc.
        name = re.sub(r'\*[^*]+\*', '', name)
        # Annotations sans astérisques mais avec astérisque ouvrante orpheline: *744 KM
        name = re.sub(r'\*\d+\s*km\b', '', name, flags=re.I)
        name = name.replace('*', '').replace('.', '')
        # Contenu entre parenthèses: (2025), (xxx), (Full Load), etc.
        name = re.sub(r'\([^)]*\)', '', name)
        # "full load" standalone
        name = re.sub(r'\bfull\s+load\b', '', name, flags=re.I)
        # Mots-clés état/dealer à retirer du nom
        name = re.sub(
            r'\b(?:d[ée]monstrateur|dmonstrateur|d[ée]mo|demo'
            r'|location|usag[ée]e?'
            r'|liquidation|pour\s+pi[èe]ces?|bas\s+kil+om[ée]trage'
            r'|chenilles?\s+incluse?s?|cabine\s+incluse?'
            r'|avec\s+chenilles?|avec\s+cabine'
            r'|chenilles?|cabine)\b',
            '', name, flags=re.I)
        # Annotations km standalone: "744 KM", "1200 KM"
        name = re.sub(r'(?<=\s)\d+\s*km\b', '', name, flags=re.I)
        # Marque dupliquée: "BMW BMW R1200" → "BMW R1200"
        name = re.sub(r'^(\w+)\s+\1\b', r'\1', name, flags=re.I)
        name = re.sub(r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)

        # Suffixe site dynamique : "| Motoplex...", "| Morin Sports...",
        # "| Picotte..." etc. Construit depuis cls.SITE_NAME (premier
        # mot significatif), avec rétro-compat pour 'Motoplex'.
        site_tokens = re.split(r'[\s|&\-]+', (cls.SITE_NAME or ''))
        first_token = next((t for t in site_tokens if len(t) >= 3), '')
        if first_token:
            pattern = (r'\s*[|\-–]\s*' + re.escape(first_token) + r'.*$')
            name = re.sub(pattern, '', name, flags=re.I)
        else:
            name = re.sub(r'\s*\|\s*Motoplex.*$', '', name, flags=re.I)

        # Codes internes constructeur Kawasaki/Suzuki concaténés au nom
        # (ex: 'KLE650JSNN', 'KLZ1000DPSNN'). Pattern strict (4+ lettres
        # finales) pour préserver les modèles légitimes type 'KLX140R'.
        name = re.sub(r'\s+[A-Z]{2,}\d{2,}[A-Z]{4,}(?=\s|$)', '', name)

        # Tirets orphelins après nettoyage
        name = re.sub(r'\s*-\s*$', '', name)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
