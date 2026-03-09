"""
Scraper dédié pour Motosport 4 Saisons (motosport4saisons.com).

Hérite de MotoplexScraper (même plateforme PowerGO, mêmes sélecteurs).
Seules les constantes de site et quelques ajustements mineurs changent.

Site: Next.js + PowerGO CDN (cdn.powergo.ca)
Domaine: motosport4saisons.com
Marques: Polaris, KTM, GASGAS, Slingshot, Timbersled
Localisation: Trois-Rivières, QC

Sitemap: /sitemaps/inventory-detail.xml → toutes les URLs produits
Pages détail: JSON-LD Vehicle + specs HTML (li.spec-*)
URL pattern: /fr/{neuf|usage}/{type}/inventaire/{slug}-a-vendre-m-{id}/
"""
import re
from typing import Dict, Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .motoplex import MotoplexScraper


class Motosport4SaisonsScraper(MotoplexScraper):

    SITE_NAME = "Motosport 4 Saisons"
    SITE_SLUG = "motosport4saisons"
    SITE_URL = "https://www.motosport4saisons.com/fr/"
    SITE_DOMAIN = "motosport4saisons.com"
    SITE_DOMAIN_ALT = "motosport4saisons.com"

    SITEMAP_URL = "https://www.motosport4saisons.com/sitemaps/inventory-detail.xml"

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        """Déduit le type de véhicule depuis le chemin URL."""
        vtype = super()._extract_type_from_url(url)
        if vtype:
            return vtype

        path = urlparse(url).path.lower()
        extra_types = {
            'velo-electrique': 'Vélo électrique',
            'trois-roues': 'Trois-roues',
            'slingshot': 'Slingshot',
            'timbersled': 'Timbersled',
        }
        for slug, label in extra_types.items():
            if f'/{slug}/' in path:
                return label
        return None

    def _extract_html_specs(self, soup: BeautifulSoup, out: Dict) -> None:
        """Extrait les specs HTML avec support du poids (spec-weight)."""
        super()._extract_html_specs(soup, out)

        weight_el = soup.select_one('li.spec-weight')
        if weight_el:
            val_el = weight_el.select_one(self.SEL_SPEC_VALUE)
            if val_el:
                text = val_el.get_text(strip=True)
                if text and text not in ('-', 'N/A', '', 'null'):
                    out.setdefault('poids', text)

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Motosport.*$', '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Sicard.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[-–]\s*Motosport\s*4\s*Saisons.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
