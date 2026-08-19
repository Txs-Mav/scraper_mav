"""
Scraper dédié pour Évasion Sport / Évasion DR (evasion-sport.com) —
Laterrière (Saguenay). Concessionnaire Yamaha, Arctic Cat, Avalon, Legend,
Mercury, Argo, Adly, ScootTerre, Stark Varg…
Sélecteurs hardcodés — aucun appel Gemini.

Plateforme atypique : site « Simply Web Editor / TurnkeyWebSolutions » +
inventaire equipmentsearch.com. Les listings sont rendus côté serveur avec
des cartes COMPLÈTES (nom, stock #, prix/MSRP/solde, image, adid).

⚠️ ANTI-BOT DUR (leçons du 2026-08-19) : l'IP est bannie temporairement
(« temporarily blocked — JavaScript needs to be enabled ») après ~100
requêtes sans JS, quel que soit le rythme (vu : 8 workers ET 2 workers via
GitHub Actions — la découverte de ~91 pages passait, la phase détail de
577 fiches se faisait bannir à 9/577). D'où l'architecture LISTING-ONLY :

  1. EXTRACTION 100 % depuis les cartes des listings paginés
     /fr/Inventaire/page/N/ (58 pages ≈ 577 unités au 2026-08-19) —
     ~1 requête / 10 unités, jamais de fiche détail.
  2. Best-effort APRÈS la phase critique : /fr/Occasion/ (état) puis les
     10 listings par catégorie (adid → vehicule_type). Si l'anti-bot
     frappe ici, les produits restent complets, seuls etat/type de
     certains passent au défaut.
  3. Garde-fou anti-partiel : si la pagination du listing principal est
     interrompue avant la dernière page annoncée, échec FRANC (l'ancien
     cache est conservé) — jamais de sauvegarde tronquée « success ».
  4. Pacing REQUEST_DELAY_S entre chaque page + backoff long sur 403.

Champs indisponibles côté listing : km, couleur, VIN, description utile
(la description carte = écho du nom + boilerplate) → omis honnêtement.
L'adid (URL) est l'identifiant unique d'unité — clé de dédup sourceUrl.

Workflow manuel `.github/workflows/scraper-evasion-sport.yml` pour scraper
depuis une IP GitHub Actions fraîche si l'IP locale est bannie.

Écrit à la main le 2026-08-19.
"""
import html as html_lib
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class EvasionSportScraper(DedicatedScraper):

    SITE_NAME = "Évasion Sport"
    SITE_SLUG = "evasion-sport"
    SITE_URL = "https://evasion-sport.com/fr/"
    SITE_DOMAIN = "evasion-sport.com"

    # Jamais de fiches détail sur ce site (anti-bot) — listing-only.
    MAX_WORKERS = 1
    REQUEST_DELAY_S = 1.2
    BLOCK_BACKOFF_S = 45
    LISTING_MAX_PAGES = 200
    LISTING_MAX_CONSECUTIVE_FAILS = 3

    _PRODUCT_URL_RE = re.compile(r'/fr/Inventaire/adid/\d+/', re.I)

    # Page catégorie du site → type de véhicule lisible
    CATEGORY_PAGES = {
        'Motoneiges': 'Motoneige',
        'ATVs': 'VTT',
        'Côte-à-côte': 'Côte-à-côte',
        'Bateaux': 'Bateau',
        'Pontons': 'Ponton',
        'Moteurs-hors-bord': 'Moteur hors-bord',
        'Remorques': 'Remorque',
        'Vélos-électriques': 'Vélo électrique',
        'motocyclettes-&-Scooters': 'Moto',
        'Produit-énergétique': 'Équipement énergétique',
    }

    # Marques du concessionnaire (neuf + occasion) — parsing marque/modèle
    # depuis le nom de carte (« ARCTIC CAT BEARCAT 858 EPS LT 2027 »)
    _KNOWN_BRANDS = (
        'harley-davidson', 'arctic cat', 'can-am', 'sea-doo', 'ski-doo',
        'stark varg', 'seven peaks', 'yamaha', 'avalon', 'legend',
        'mercury', 'argo', 'adly', 'scootterre', 'slane', 'remeq',
        'bertcraft', 'kawasaki', 'polaris', 'honda', 'suzuki', 'cfmoto',
        'husqvarna', 'ktm', 'gasgas', 'triumph', 'kymco', 'segway',
        'princecraft', 'lund', 'starcraft', 'alumacraft', 'sportspal',
        'beta', 'sherco', 'indian', 'ducati', 'bmw', 'aprilia', 'vespa',
        'piaggio', 'stacyc',
    )

    def __init__(self):
        super().__init__()
        self._request_count = 0

    # ──────────────────────────────────────────────────────────────
    # PIPELINE LISTING-ONLY (surcharge complète de scrape)
    # ──────────────────────────────────────────────────────────────

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        start_time = time.time()

        print(f"\n{'='*70}")
        print(f"🔧 SCRAPER DÉDIÉ: {self.SITE_NAME} (listing-only, anti-bot)")
        print(f"{'='*70}")
        print(f"🌐 Site: {self.SITE_URL}")
        print(f"📦 Catégories: {categories or ['toutes']}")

        # Phase 1 (CRITIQUE, garde anti-partiel) : cartes de l'inventaire
        pages, complete = self._fetch_listing_pages('https://evasion-sport.com/fr/Inventaire/')
        if not complete:
            raise RuntimeError(
                "Pagination /fr/Inventaire/ interrompue avant la dernière page "
                "(anti-bot probable) — scrape annulé, ancien cache conservé")

        products_by_adid: Dict[str, Dict] = {}
        for page_html in pages:
            for adid, specs in self._parse_listing_cards(page_html):
                if adid not in products_by_adid:
                    products_by_adid[adid] = specs
        print(f"   📄 /fr/Inventaire/ : {len(pages)} pages, "
              f"{len(products_by_adid)} unités uniques — AUCUN plafond")

        # Phase 2 (best-effort) : état occasion puis catégories. Si l'anti-bot
        # frappe ici, les produits restent complets (defaults : neuf, sans type).
        occasion_adids = set()
        try:
            occ_pages, _ = self._fetch_listing_pages('https://evasion-sport.com/fr/Occasion/')
            for page_html in occ_pages:
                occasion_adids.update(re.findall(r'/adid/(\d+)/', page_html))
        except Exception:
            print("   ⚠️  Listing Occasion inaccessible — états par défaut (neuf)")

        category_by_adid: Dict[str, str] = {}
        mapped_categories = 0
        for segment, vtype in self.CATEGORY_PAGES.items():
            try:
                cat_pages, _ = self._fetch_listing_pages(
                    f"https://evasion-sport.com/fr/{quote(segment)}/")
            except Exception:
                continue
            mapped_categories += 1
            for page_html in cat_pages:
                for adid in re.findall(r'/adid/(\d+)/', page_html):
                    category_by_adid.setdefault(adid, vtype)
        print(f"   🏷️  {len(category_by_adid)} adids catégorisés "
              f"({mapped_categories}/{len(self.CATEGORY_PAGES)} listings catégorie), "
              f"{len(occasion_adids)} adids occasion — {self._request_count} requêtes au total")

        # Finalisation
        products: List[Dict] = []
        for adid, specs in products_by_adid.items():
            if not specs.get('etat'):
                specs['etat'] = 'occasion' if adid in occasion_adids else 'neuf'
            name = specs.get('name', '')
            if re.search(r'\b(démo|demo|démonstrateur)\b', name.lower()):
                specs['etat'] = 'demonstrateur'
            specs['sourceCategorie'] = (
                'vehicules_occasion' if specs['etat'] == 'occasion' else 'inventaire')
            vtype = category_by_adid.get(adid)
            if vtype:
                specs['vehicule_type'] = vtype
            specs['sourceSite'] = self.SITE_URL
            specs['quantity'] = 1
            specs['groupedUrls'] = [specs['sourceUrl']]
            products.append(specs)

        products = self._deduplicate(products)
        if inventory_only:
            products = [p for p in products if p.get('sourceCategorie') != 'catalogue']

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
                'urls_processed': self._request_count,
                'execution_time_seconds': round(elapsed, 2),
                'categories': categories or ['inventaire', 'occasion'],
                'cache_status': 'dedicated',
            },
            'scraper_info': {
                'type': 'dedicated',
                'module': self.SITE_SLUG,
                'selectors': 'hardcoded',
            }
        }

    # Compat pipeline de base (non utilisés en mode listing-only, mais
    # requis par l'ABC et utiles pour un test unitaire de fiche)
    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        pages, complete = self._fetch_listing_pages('https://evasion-sport.com/fr/Inventaire/')
        if not complete:
            raise RuntimeError("Pagination /fr/Inventaire/ interrompue (anti-bot probable)")
        urls: List[str] = []
        seen = set()
        for page_html in pages:
            for match in re.finditer(r'href="(/fr/Inventaire/adid/(\d+)/[^"]*)"', page_html):
                if match.group(2) not in seen:
                    seen.add(match.group(2))
                    urls.append('https://evasion-sport.com' + match.group(1))
        return urls

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        # Non utilisé en production (anti-bot) — le pipeline est listing-only.
        return None

    # ──────────────────────────────────────────────────────────────
    # FETCH LISTING (pacing + backoff 403)
    # ──────────────────────────────────────────────────────────────

    def _polite_get(self, url: str):
        """GET avec pacing systématique et backoff long sur 403 (anti-bot)."""
        if self._request_count:
            time.sleep(self.REQUEST_DELAY_S)
        self._request_count += 1
        resp = self.session.get(url, timeout=self.HTTP_TIMEOUT)
        if resp.status_code == 403:
            print(f"   🛑 403 anti-bot — backoff {self.BLOCK_BACKOFF_S}s puis nouvel essai")
            time.sleep(self.BLOCK_BACKOFF_S)
            resp = self.session.get(url, timeout=self.HTTP_TIMEOUT)
        return resp

    def _fetch_listing_pages(self, base_url: str) -> Tuple[List[str], bool]:
        """Pagine base_url + page/N/ en suivant le pager serveur. Retourne
        (pages_html, complete) — complete=False si interrompu avant la
        dernière page annoncée."""
        pages: List[str] = []
        max_page = 1
        fails = 0
        complete = True

        page = 1
        while page <= min(max_page, self.LISTING_MAX_PAGES) or page == 1:
            page_url = base_url if page == 1 else f"{base_url}page/{page}/"
            try:
                resp = self._polite_get(page_url)
                if resp.status_code != 200:
                    raise RuntimeError(f"HTTP {resp.status_code}")
                html = resp.text
                fails = 0
            except Exception:
                fails += 1
                if fails >= self.LISTING_MAX_CONSECUTIVE_FAILS:
                    complete = False
                    break
                page += 1
                continue

            pages.append(html)
            pager = [int(p) for p in re.findall(r'/page/(\d+)/', html)]
            if pager:
                max_page = max(max_page, max(pager))

            if page >= max_page:
                break
            page += 1

        if max_page > self.LISTING_MAX_PAGES:
            print(f"   ⚠️  Pager annonce {max_page} pages > plafond de sûreté "
                  f"{self.LISTING_MAX_PAGES} — pages au-delà NON visitées")
            complete = False

        return pages, complete

    # ──────────────────────────────────────────────────────────────
    # PARSING DES CARTES
    # ──────────────────────────────────────────────────────────────

    def _parse_listing_cards(self, html: str) -> List[Tuple[str, Dict]]:
        soup = BeautifulSoup(html, 'html.parser')
        results: List[Tuple[str, Dict]] = []

        for card in soup.select('.item.list-group-item'):
            title_link = card.select_one('a.model-title-link[href*="/adid/"]') \
                or card.select_one('a[href*="/adid/"]')
            if not title_link:
                continue
            href = title_link.get('href', '')
            adid_match = re.search(r'/adid/(\d+)/', href)
            if not adid_match:
                continue
            adid = adid_match.group(1)

            specs: Dict[str, Any] = {}
            name = self._clean_name(title_link.get_text(' ', strip=True))
            if not name:
                continue
            specs['name'] = name
            # URL canonique /fr/Inventaire/adid/… (les listings catégorie
            # émettent /fr/<Categorie>/adid/… pour la même unité)
            path = re.sub(r'^/fr/[^/]+/adid/', '/fr/Inventaire/adid/', href)
            specs['sourceUrl'] = 'https://evasion-sport.com' + path

            stock = card.select_one('.stock-num span.skip-auto-translate')
            if stock and stock.get_text(strip=True):
                specs['inventaire'] = stock.get_text(strip=True)

            img = card.select_one('img[src*="equipmentsearch.com"]')
            if img and img.get('src'):
                specs['image'] = img['src']

            # Prix : MSRP (« Prix en détail »), courant (« Prix: »), solde
            # (« Prix de vente ») — les blocs à 0 $ sont du bruit masqué.
            msrp = price = sale = None
            msrp_node = card.select_one('.msrp .ttl')
            if msrp_node and msrp_node.find_next_sibling('span'):
                msrp = self.clean_price(msrp_node.find_next_sibling('span').get_text())
            price_node = card.select_one('.price.show-item .price-val')
            if price_node:
                price = self.clean_price(price_node.get_text())
            sale_node = card.select_one('.sale-tag')
            if sale_node and sale_node.find_next_sibling('span'):
                sale = self.clean_price(sale_node.find_next_sibling('span').get_text())

            current = sale or price
            if current:
                specs['prix'] = current
                originals = [v for v in (price, msrp) if v and v > current]
                if originals:
                    specs['prix_original'] = min(originals)

            self._fill_from_name(specs)
            results.append((adid, specs))

        return results

    def _fill_from_name(self, specs: Dict[str, Any]) -> None:
        """Marque/modèle/année depuis le nom de carte
        (« ARCTIC CAT BEARCAT 858 EPS LT 2027 »)."""
        name = specs.get('name') or ''
        if not name:
            return
        low = name.lower()

        year_match = re.search(r'\b(19|20)\d{2}\s*$', name)
        if year_match:
            year = self.clean_year(year_match.group(0))
            if year:
                specs['annee'] = year

        rest = name
        for brand in sorted(self._KNOWN_BRANDS, key=len, reverse=True):
            if low.startswith(brand + ' ') or low == brand:
                specs['marque'] = name[:len(brand)]
                rest = name[len(brand):].strip()
                break

        if specs.get('marque'):
            rest = re.sub(r'\b(19|20)\d{2}\s*$', '', rest).strip(' -')
            if rest:
                specs['modele'] = rest

    # ──────────────────────────────────────────────────────────────
    # DÉDUP & NETTOYAGE
    # ──────────────────────────────────────────────────────────────

    def _deduplicate(self, products: List[Dict]) -> List[Dict]:
        """L'adid (dans l'URL) identifie l'unité : clé = sourceUrl UNIQUEMENT,
        jamais nom+prix (plusieurs unités identiques du même modèle)."""
        seen_urls: set = set()
        unique: List[Dict] = []
        for product in products:
            url = product.get('sourceUrl', '').rstrip('/')
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            unique.append(product)
        return unique

    @staticmethod
    def _fix_mojibake(text: str) -> str:
        if not text or ('Ã' not in text and 'Â' not in text and 'â' not in text):
            return text
        try:
            fixed = text.encode('latin-1', errors='ignore').decode('utf-8', errors='ignore')
            if fixed and ('Ã' not in fixed or len(fixed) < len(text)):
                return fixed
        except Exception:
            pass
        return text

    def _clean_name(self, name: str) -> str:
        if not name:
            return name
        name = html_lib.unescape(self._fix_mojibake(name))
        name = re.sub(r'\s+(neuf|usagé|usage)?\s*[àa]\s+(Laterri[èe]re|Saguenay|Chicoutimi).*$',
                      '', name, flags=re.I)
        name = re.sub(r'\s*[|–-]\s*[ÉE]vasion\s*(Sport|DR).*$', '', name, flags=re.I)
        name = re.sub(r'\s*[àa]\s+vendre.*$', '', name, flags=re.I)
        name = re.sub(r'\s*(\.{3}|…)\s*$', '', name)
        name = re.sub(r'\s+', ' ', name).strip(' -|')
        tokens = name.split(' ')
        deduped: List[str] = []
        for t in tokens:
            window = 2 if t.isalpha() else 1
            if any(t.casefold() == prev.casefold() for prev in deduped[-window:]):
                continue
            deduped.append(t)
        return ' '.join(deduped)

    @staticmethod
    def _valid(value) -> bool:
        if value is None:
            return False
        text = str(value).strip()
        return bool(text) and text.lower() not in ('s/o', 'n/a', 'null', '-', 'none')
