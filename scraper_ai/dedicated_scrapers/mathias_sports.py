"""
Scraper dédié pour Mathias Sports (mathiassports.com).

Hérite de MotoplexScraper — même plateforme PowerGO (Next.js + SSR),
mêmes sélecteurs CSS, même structure JSON-LD (schema.org Vehicle).

NOTE: Mathias a migré de Magento 2 vers PowerGO début 2026.
Les anciennes URLs (.html) sont obsolètes.

Stratégie sitemap + détail:
  1. Sitemap XML (inventory-detail.xml) → ~2680 URLs produits (neuf + usagé)
  2. Pages détail (parallèle) → JSON-LD + specs HTML

Site: Next.js + PowerGO CDN (cdn.powergo.ca)
Domaine: mathiassports.com
Marques: Kawasaki, Indian Motorcycle, Slingshot, Polaris, GASGAS, Argo, etc.
Localisation: Ste-Dorothée (Laval), QC
"""
import re
from typing import Optional
from urllib.parse import urlparse

from .motoplex import MotoplexScraper


class MathiasSportsScraper(MotoplexScraper):

    SITE_NAME = "Mathias Sports"
    SITE_SLUG = "mathias-sports"
    SITE_URL = "https://mathiassports.com/"
    SITE_DOMAIN = "mathiassports.com"
    SITE_DOMAIN_ALT = "mathiassports.com"

    SITEMAP_URL = "https://mathiassports.com/sitemaps/inventory-detail.xml"

    WORKERS = 16

    def _extract_type_from_url(self, url: str) -> Optional[str]:
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
            'trois-roues': 'Trois-roues',
            'slingshot': 'Slingshot',
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
        name = re.sub(r'\s*\|\s*Mathias.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[-–]\s*Mathias\s*Sports.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
