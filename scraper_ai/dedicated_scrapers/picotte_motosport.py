"""
Scraper dédié pour Picotte Motosport (picottemotosport.com).

Concessionnaire Polaris, KTM, GASGAS, Suzuki, Husqvarna, Scootterre
situé à Granby, QC (Estrie).

Site: Next.js + PowerGO CDN (cdn.powergo.ca)
Domaine: picottemotosport.com

Stratégie de découverte (cascade) :
  1. Sitemap inventory-detail.xml (standard PowerGO)
  2. Fallback : crawl des pages listing par catégorie + tri multiple
     → extraction des liens <a href="...a-vendre-..."> depuis le HTML SSR

Pages détail : JSON-LD Vehicle + specs HTML (li.spec-*)
URL pattern : /fr/{neuf|usage}/{type}/inventaire/{slug}-a-vendre-{id}/

Types de véhicules : Motocyclette, Vélo électrique, VTT,
                     Côte à côte, Motoneige
"""
import re
import time
from typing import Dict, List, Optional, Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .motoplex import MotoplexScraper


class PicotteMotosportScraper(MotoplexScraper):

    SITE_NAME = "Picotte Motosport"
    SITE_SLUG = "picotte-motosport"
    SITE_URL = "https://www.picottemotosport.com/fr/"
    SITE_DOMAIN = "picottemotosport.com"
    SITE_DOMAIN_ALT = "picottemotosport.com"

    SITEMAP_URL = "https://www.picottemotosport.com/sitemaps/inventory-detail.xml"

    _LISTING_CATEGORIES = {
        'neuf': {
            'motocyclette': '/fr/neuf/motocyclette/inventaire/',
            'velo-electrique': '/fr/neuf/velo-electrique/inventaire/',
            'vtt': '/fr/neuf/vtt/inventaire/',
            'cote-a-cote': '/fr/neuf/cote-a-cote/inventaire/',
            'motoneige': '/fr/neuf/motoneige/inventaire/',
        },
        'usage': {
            'motocyclette': '/fr/usage/motocyclette/',
            'motoneige': '/fr/usage/motoneige/',
            'vtt': '/fr/usage/vtt/',
            'cote-a-cote': '/fr/usage/cote-a-cote/',
            'velo-electrique': '/fr/usage/velo-electrique/',
        },
    }

    _SORT_KEYS = ['price_asc', 'price_desc', 'year_asc', 'year_desc',
                   'usage_asc', 'usage_desc']

    def _discover_urls_from_sitemap(self, categories: List[str]) -> Dict[str, List[str]]:
        """Tente le sitemap standard puis fallback vers les pages de listing."""
        url_map = super()._discover_urls_from_sitemap(categories)
        if url_map:
            return url_map

        print("   🔄 Sitemap indisponible — fallback: crawl des pages listing")
        return self._discover_from_listing_pages(categories)

    def _discover_from_listing_pages(self, categories: List[str]) -> Dict[str, List[str]]:
        """Parcourt les pages de listing pour chaque catégorie/tri et extrait les URLs."""
        want_neuf = any(c in ('inventaire', 'neuf') for c in categories)
        want_usage = any(c in ('occasion', 'usage') for c in categories)

        url_map: Dict[str, List[str]] = {}
        seen: set = set()

        if want_neuf:
            for vtype, path in self._LISTING_CATEGORIES['neuf'].items():
                urls = self._crawl_listing_page(path, seen)
                if urls:
                    url_map.setdefault('inventaire', []).extend(urls)
                    print(f"      📋 neuf/{vtype}: {len(urls)} URLs")

        if want_usage:
            for vtype, path in self._LISTING_CATEGORIES['usage'].items():
                urls = self._crawl_listing_page(path, seen)
                if urls:
                    url_map.setdefault('occasion', []).extend(urls)
                    print(f"      📋 usage/{vtype}: {len(urls)} URLs")

        return url_map

    def _crawl_listing_page(self, path: str, seen: set) -> List[str]:
        """Fetch une page listing avec plusieurs ordres de tri pour maximiser
        la couverture des produits (le SSR ne rend que la première page)."""
        base = f"https://{self.SITE_DOMAIN}{path}"
        found: List[str] = []

        for sort_key in [None, *self._SORT_KEYS]:
            url = base if sort_key is None else f"{base}?sort={sort_key}"
            try:
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    continue
                new_urls = self._extract_product_links(resp.text, seen)
                found.extend(new_urls)
                if not new_urls and sort_key is not None:
                    break
            except Exception:
                continue
            time.sleep(0.3)

        return found

    def _extract_product_links(self, html: str, seen: set) -> List[str]:
        """Parse le HTML d'une page listing et extrait les URLs produit."""
        soup = BeautifulSoup(html, 'lxml')
        urls: List[str] = []

        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            if 'a-vendre' not in href:
                continue
            if '/inventaire/' not in href:
                continue

            full_url = href if href.startswith('http') else urljoin(
                f"https://{self.SITE_DOMAIN}", href)

            key = full_url.rstrip('/').lower()
            if key not in seen:
                seen.add(key)
                urls.append(full_url)

        return urls

    def _is_product_url(self, url: str) -> bool:
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        if '/inventaire/' in url_lower and 'a-vendre' in url_lower:
            skip = ('/service/', '/contact/', '/financement/', '/pieces/',
                    '/blogue/', '/equipe/', '/promotions/')
            return not any(s in url_lower for s in skip)
        return False

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        vtype = super()._extract_type_from_url(url)
        if vtype:
            return vtype

        path = urlparse(url).path.lower()
        extra_types = {
            'velo-electrique': 'Vélo électrique',
        }
        for slug, label in extra_types.items():
            if f'/{slug}/' in path:
                return label
        return None

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = MotoplexScraper._fix_mojibake(name)
        name = re.sub(r'\*[^*]+\*', '', name)
        name = re.sub(r'\*\d+\s*km\b', '', name, flags=re.I)
        name = name.replace('*', '').replace('+', '').replace('.', '')
        name = re.sub(r'\([^)]*\)', '', name)
        name = re.sub(r'\bfull\s+load\b', '', name, flags=re.I)
        name = re.sub(
            r'\b(?:d[ée]monstrateur|dmonstrateur|d[ée]mo|demo'
            r'|location|usag[ée]e?'
            r'|liquidation|pour\s+pi[èe]ces?|bas\s+kil+om[ée]trage)\b',
            '', name, flags=re.I)
        name = re.sub(r'(?<=\s)\d+\s*km\b', '', name, flags=re.I)
        name = re.sub(r'^(\w+)\s+\1\b', r'\1', name, flags=re.I)
        name = re.sub(
            r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$",
            '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Picotte.*$', '', name, flags=re.I)
        name = re.sub(
            r'\s*[-–|]\s*Picotte\s*Motosport.*$', '', name, flags=re.I)
        name = re.sub(r'\s+[àa]\s+Granby\s*$', '', name, flags=re.I)
        name = re.sub(r'\s*-\s*$', '', name)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
