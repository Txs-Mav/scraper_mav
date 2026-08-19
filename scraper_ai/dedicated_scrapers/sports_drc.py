"""
Scraper dédié pour Sports DRC (sportsdrc.com) — Alma (Lac-Saint-Jean).
Gros concessionnaire BRP (Ski-Doo, Can-Am, Sea-Doo) + marine (Princecraft…).
Sélecteurs hardcodés — aucun appel Gemini.

Stratégie :
  1. Découverte via sitemap_index.xml → sous-sitemaps used-product-sitemapN.xml
     (le plugin WordPress « wp-pgs-brp-smart-site » appelle TOUTES les unités
     d'inventaire « produit-occasion », même les neuves). URLs
     /fr/produit-occasion/<categorie>-<marque>-<modele>-<annee>-a-vendre-<stock>/
     SANS CAP — 1330 URLs FR au 2026-08-19, vérifié = union des listings
     FacetWP paginés (1312 neuf sur 110 pages + 18 occasion), zéro écart.
  2. Pages détail (parallèle, pipeline de base) → extraction 100 % DOM :
     AUCUN JSON-LD Vehicle sur cette plateforme. Specs dans
     .overview .specs li.<champ> (make/model/year/stock/km/vin/ext-color/
     category), prix dans .infos .price .main, description dans .description.

Pièges connus de cette plateforme (WordPress + FacetWP, thème BRP) :
  - Pas de JSON-LD produit (seulement WebSite/WebPage) → tout vient du DOM
  - Le carrousel « véhicules similaires » (.listWImgsContent) a ses propres
    blocs .specs et .price → scoper à .overview / .infos
  - N° de stock 100 % libres (« foyer-flottant », « vogue_289759 »,
    « 22-0840U ») → la regex d'URL n'exige PAS de chiffre ; suffixe U = usagé
  - Sitemap FR + EN en double (2660 locs pour 1330 unités FR)
  - km affiché uniquement sur l'usagé (li.km) — ne pas émettre sur le neuf
  - La description commence souvent par un écho du nom en MAJUSCULES

Écrit à la main le 2026-08-19.
"""
import html as html_lib
import re
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from .base import DedicatedScraper


class SportsDrcScraper(DedicatedScraper):

    SITE_NAME = "Sports DRC"
    SITE_SLUG = "sports-drc"
    SITE_URL = "https://sportsdrc.com/fr/"
    SITE_DOMAIN = "sportsdrc.com"

    MAX_WORKERS = 10

    SITEMAP_CANDIDATES = (
        "https://sportsdrc.com/sitemap_index.xml",
        "https://sportsdrc.com/used-product-sitemap1.xml",
    )

    # Stock 100 % libre après « a-vendre- » (« foyer-flottant »,
    # « vogue_289759 », « 22-0840u ») — aucun chiffre requis.
    _PRODUCT_URL_RE = re.compile(
        r'/fr/produit-occasion/[a-z0-9_-]+-a-vendre-[a-z0-9_-]+/?$')

    # Valeur du li.category (hidden) → type de véhicule lisible
    CATEGORY_MAP = {
        'motocyclettes': 'Moto',
        'motos trois roues': 'Moto trois roues',
        'côtes-à-côtes': 'Côte-à-côte',
        'cotes-a-cotes': 'Côte-à-côte',
        'vtt': 'VTT',
        'motoneiges': 'Motoneige',
        'motomarines': 'Motomarine',
        'bateaux': 'Bateau',
        'pontons': 'Ponton',
        'quais': 'Quai',
        'remorques': 'Remorque',
        'autres': 'Autre',
    }

    # Préfixe du slug d'URL → catégorie (fallback si li.category absent)
    _URL_PREFIX_MAP = {
        'motocyclettes': 'Moto',
        'motos-trois-roues': 'Moto trois roues',
        'cotes-a-cotes': 'Côte-à-côte',
        'vtt': 'VTT',
        'motoneiges': 'Motoneige',
        'motomarines': 'Motomarine',
        'bateaux': 'Bateau',
        'pontons': 'Ponton',
        'quais': 'Quai',
        'remorques': 'Remorque',
        'autres': 'Autre',
    }

    # Correspondance classe CSS du li de specs → champ du schéma maison
    _SPEC_FIELDS = {
        'make': 'marque',
        'model': 'modele',
        'year': 'annee',
        'stock': 'inventaire',
        'km': 'kilometrage',
        'vin': 'vin',
        'ext-color': 'couleur',
    }

    # ──────────────────────────────────────────────────────────────
    # DÉCOUVERTE (sitemap index → used-product-sitemapN)
    # ──────────────────────────────────────────────────────────────

    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        urls: List[str] = []
        seen = set()

        for sitemap_url in self.SITEMAP_CANDIDATES:
            try:
                resp = self.session.get(sitemap_url, timeout=30)
                if resp.status_code != 200 or '<loc>' not in resp.text:
                    continue
            except Exception:
                continue

            locs = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', resp.text)

            if '<sitemapindex' in resp.text:
                # Ne suivre QUE les sous-sitemaps d'inventaire (used-product) :
                # l'index a 18 sous-sitemaps dont la plupart sont des pages
                # vitrine catalogue sans unités.
                subs = [s for s in locs if 'used-product' in s] or locs
                sub_locs = []
                for sub in subs[:15]:
                    try:
                        sub_resp = self.session.get(sub, timeout=30)
                        if sub_resp.status_code == 200:
                            sub_locs.extend(re.findall(
                                r'<loc>\s*([^<\s]+)\s*</loc>', sub_resp.text))
                    except Exception:
                        continue
                locs = sub_locs

            for url in locs:
                norm = url.rstrip('/').lower()
                if norm in seen:
                    continue
                if self._is_product_url(url):
                    seen.add(norm)
                    urls.append(url)

            if urls:
                print(f"   🗺️  Sitemap {sitemap_url}: {len(urls)} URLs produit "
                      f"(/fr/ uniquement, doublons EN exclus) — AUCUN plafond "
                      f"(1330 = union listings FacetWP vérifiée au 2026-08-19)")
                break

        return urls

    def _is_product_url(self, url: str) -> bool:
        if not url or self.SITE_DOMAIN not in url.lower():
            return False
        low = url.lower()
        # Le sitemap liste chaque unité en FR et en EN : on ne garde que FR.
        if '/fr/produit-occasion/' not in low:
            return False
        return bool(self._PRODUCT_URL_RE.search(low.rstrip('/') + '/'))

    # ──────────────────────────────────────────────────────────────
    # EXTRACTION PAGE DÉTAIL (100 % DOM — pas de JSON-LD ici)
    # ──────────────────────────────────────────────────────────────

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        specs: Dict[str, Any] = {}

        # Nom : h1 (déjà propre), fallback og:title (avec suffixe à retirer)
        h1 = soup.select_one('h1')
        if h1 and h1.get_text(strip=True):
            specs['name'] = self._clean_name(h1.get_text(' ', strip=True))
        if not specs.get('name'):
            og_title = soup.select_one('meta[property="og:title"]')
            if og_title and og_title.get('content'):
                specs['name'] = self._clean_name(og_title['content'])

        # Specs : bloc .overview .specs (le plus riche : stock/vin/km/couleur/
        # category) puis .main .specs en complément. JAMAIS .listWImgsContent
        # (carrousel « similaires »).
        category_raw = None
        for li in (soup.select('.overview .specs li') or []) + (soup.select('.wrap .main .specs li') or []):
            if li.find_parent(class_='listWImgsContent') or li.find_parent(class_='item'):
                continue
            classes = li.get('class', [])
            value_node = li.select_one('.value')
            if value_node:
                value = value_node.get_text(' ', strip=True)
            else:
                text = li.get_text(' ', strip=True)
                value = text.split(':', 1)[1].strip() if ':' in text else text
            if not self._valid(value):
                continue
            if 'category' in classes:
                category_raw = value
                continue
            for cls, field in self._SPEC_FIELDS.items():
                if cls in classes and field not in specs:
                    if field == 'annee':
                        year = self.clean_year(value)
                        if year:
                            specs['annee'] = year
                    elif field == 'kilometrage':
                        km = self.clean_mileage(value)
                        if km:
                            specs['kilometrage'] = km
                    elif field == 'vin':
                        if len(value) >= 11:
                            specs['vin'] = value
                    else:
                        specs[field] = self._fix_mojibake(value)
                    break

        # Prix : bloc principal .infos .price .main. Structure rabais :
        # <del><span class="value">3 145 $</span></del>
        # <span class="value" data-price>1 995 $</span>
        # → le prix courant est le .value HORS <del>, jamais du remplacement
        # de texte (les espaces diffèrent entre get_text et le HTML).
        price_box = soup.select_one('.infos .price')
        if price_box:
            main_node = price_box.select_one('.main') or price_box
            strike = main_node.select_one('del, s, [class*="line-through"], [class*="strike"], .old-price')
            if strike:
                old_price = self.clean_price(strike.get_text(' ', strip=True))
                if old_price:
                    specs['prix_original'] = old_price
            current_node = None
            for value_node in main_node.select('.value'):
                if value_node.find_parent('del') or value_node.find_parent('s'):
                    continue
                current_node = value_node
                break
            if current_node:
                price = self.clean_price(current_node.get_text(' ', strip=True))
            else:
                price_text = re.sub(r'prix\s*:?', '', main_node.get_text(' ', strip=True), flags=re.I)
                if strike:
                    price_text = price_text.replace(strike.get_text(' ', strip=True), '')
                price = self.clean_price(price_text)
            if price:
                specs['prix'] = price
            if specs.get('prix_original') == specs.get('prix'):
                specs.pop('prix_original', None)

        # Image : galerie principale (cdn.powergo), jamais le carrousel
        img = soup.select_one('.wrap .main img[src*="cdn.powergo.ca/media/inventory"]') \
            or soup.select_one('img[src*="cdn.powergo.ca/media/inventory"]')
        if img and img.get('src'):
            specs['image'] = img['src']
        if not specs.get('image'):
            og_image = soup.select_one('meta[property="og:image"]')
            if og_image and og_image.get('content'):
                specs['image'] = og_image['content']

        # État : le titre porte « neuf à Alma » / « d'occasion à Alma ».
        # Fallback : suffixe U du n° d'inventaire (« 22-0840U » = usagé).
        title_tag = soup.select_one('title')
        title_text = (title_tag.get_text() if title_tag else '').lower()
        if re.search(r"\b(usag[eé]|d'occasion|occasion)\b", title_text):
            specs['etat'] = 'occasion'
        elif re.search(r'\bneuf\b', title_text):
            specs['etat'] = 'neuf'
        else:
            stock = str(specs.get('inventaire', ''))
            specs['etat'] = 'occasion' if stock.upper().endswith('U') else 'neuf'
        specs['sourceCategorie'] = (
            'vehicules_occasion' if specs['etat'] == 'occasion' else 'inventaire')

        # km affiché seulement sur l'usagé — un km résiduel sur du neuf
        # serait un placebo (leçon evolutionxjonquiere.ca, même famille de
        # plugin) : on ne le garde que hors neuf.
        if specs.get('etat') == 'neuf':
            specs.pop('kilometrage', None)

        # Type de véhicule : li.category (hidden) prioritaire, sinon préfixe
        # du slug d'URL.
        if category_raw:
            specs['vehicule_type'] = self.CATEGORY_MAP.get(
                self._fix_mojibake(category_raw).strip().lower(),
                self._fix_mojibake(category_raw).strip())
        else:
            slug_match = re.search(r'/fr/produit-occasion/([a-z0-9-]+)/?$', url.lower())
            if slug_match:
                slug = slug_match.group(1)
                for prefix in sorted(self._URL_PREFIX_MAP, key=len, reverse=True):
                    if slug.startswith(prefix + '-') or slug == prefix:
                        specs['vehicule_type'] = self._URL_PREFIX_MAP[prefix]
                        break

        # Description : bloc .description (retirer l'en-tête « Description »
        # et l'écho du nom en tête/fin)
        desc_node = soup.select_one('.overview .description, .description')
        if desc_node:
            desc = desc_node.get_text(' ', strip=True)
            desc = re.sub(r'^\s*Description\s*:?\s*', '', desc, flags=re.I)
            cleaned = self._clean_description(desc, specs.get('name', ''))
            if cleaned:
                specs['description'] = cleaned

        # Année manquante : depuis le nom (« … 2025 » en fin)
        if not specs.get('annee') and specs.get('name'):
            year_match = re.search(r'\b(19|20)\d{2}\s*$', specs['name'])
            if year_match:
                year = self.clean_year(year_match.group(0))
                if year:
                    specs['annee'] = year

        name = specs.get('name', '')
        if name and re.search(r'\b(démo|demo|démonstrateur)\b', name.lower()):
            specs['etat'] = 'demonstrateur'

        return specs if specs.get('name') else None

    # ──────────────────────────────────────────────────────────────
    # DÉDUP & NETTOYAGE
    # ──────────────────────────────────────────────────────────────

    def _deduplicate(self, products: List[Dict]) -> List[Dict]:
        """Chaque unité a une URL unique (…-a-vendre-<stock>) : clé =
        sourceUrl UNIQUEMENT, jamais nom+prix (plusieurs unités identiques
        du même modèle coexistent)."""
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
        """Répare l'UTF-8 double-encodé éventuel des champs PowerGO."""
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
        name = re.sub(r"\s+(neuf|usagé|usage|d'occasion)?\s*[àa]\s+Alma.*$", '', name, flags=re.I)
        name = re.sub(r'\s*[|–-]\s*Sports?\s*DRC.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[àa]\s+vendre.*$', '', name, flags=re.I)
        name = re.sub(r'\s*(\.{3}|…)\s*$', '', name)
        name = re.sub(r'\s+', ' ', name).strip(' -|')
        # Tokens dupliqués : adjacents pour tous + fenêtre de 2 pour les
        # alphabétiques (écho de marque non adjacent)
        tokens = name.split(' ')
        deduped: List[str] = []
        for t in tokens:
            window = 2 if t.isalpha() else 1
            if any(t.casefold() == prev.casefold() for prev in deduped[-window:]):
                continue
            deduped.append(t)
        return ' '.join(deduped)

    def _clean_description(self, description: str, name: str = '') -> str:
        description = html_lib.unescape(html_lib.unescape(
            self._fix_mojibake(description)))
        description = re.sub(r'\s+', ' ', description).strip()
        # Écho du nom en tête ET en fin de description
        if name:
            echo = re.escape(re.sub(r'\s+', ' ', name).strip())
            description = re.sub(r'^(?:\s*' + echo + r'\s*)+', '', description, flags=re.I).strip()
            description = re.sub(r'(?:\s*' + echo + r'\s*)+$', '', description, flags=re.I).strip()
        return description[:2000]

    @staticmethod
    def _valid(value) -> bool:
        if value is None:
            return False
        text = str(value).strip()
        return bool(text) and text.lower() not in ('s/o', 'n/a', 'null', '-', 'none')
