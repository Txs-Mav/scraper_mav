"""
Scraper dédié pour Motos Illimitées (motosillimitees.com).

Hérite de MotoplexScraper — même plateforme PowerGO, mêmes sélecteurs CSS,
même structure JSON-LD (schema.org Vehicle).

Stratégie sitemap + détail:
  1. Sitemap XML (inventory-detail.xml) → ~1900+ URLs produits (neuf + usagé)
  2. Pages détail (parallèle) → JSON-LD + specs HTML

Site: Next.js + PowerGO CDN (cdn.powergo.ca)
Domaine: motosillimitees.com
Inventaire: motocyclettes, VTT, côte-à-côte, motoneiges, motomarines,
            vélos électriques, remorques, équipement mécanique, timbersled
"""
import re
from typing import Optional

from .motoplex import MotoplexScraper


class MotosIllimiteesScraper(MotoplexScraper):

    SITE_NAME = "Motos Illimitées"
    SITE_SLUG = "motos-illimitees"
    SITE_URL = "https://www.motosillimitees.com/fr/"
    SITE_DOMAIN = "motosillimitees.com"
    SITE_DOMAIN_ALT = "motosillimitees.com"

    SITEMAP_URL = "https://www.motosillimitees.com/sitemaps/inventory-detail.xml"

    WORKERS = 16

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        from urllib.parse import urlparse

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
            'velo-electrique': 'Vélo électrique',
            'timbersled': 'Timbersled',
        }
        path = urlparse(url).path.lower()
        for slug, label in type_map.items():
            if f'/{slug}/' in path:
                return label
        return None

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = re.sub(r"\s+(?:neuf|usag[ée]+)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+.*$", '', name, flags=re.I)
        name = re.sub(r'\s*\|\s*Motos?\s*Illimit[ée]+s?.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
