"""
Scraper dédié pour Morin Sports & Marine (morinsports.com).

Concessionnaire Arctic Cat, Kawasaki, Suzuki Marine, Widescape et Remeq
situé au 1695 Rue St-Maurice, Trois-Rivières, QC.

Plateforme : PowerGO / Next.js (cdn.powergo.ca)
Domaine    : morinsports.com

Hérite de MotoplexScraper qui gère nativement :
  - Sitemap inventory-detail.xml + showroom-detail.xml (via SHOWROOM_SITEMAP_URL)
  - JSON-LD Vehicle ET Product (remorques Remeq)
  - Format HTML 'Label:Value' pour les pages catalogue
  - Prix avec annotations "Épargnez X $" / "Save X $" / etc.
  - Codes constructeur (KLE650JSNN, KLZ1000DPSNN…) retirés du nom
  - Suffixe site dynamique '| Morin Sports & Marine' retiré du nom

Ce fichier ne définit que les attributs spécifiques au site :
  1. URLs sitemap inventory + showroom
  2. Filtre _is_product_url étendu pour accepter les URLs catalogue
     (/fr/neuf/<type>/<marque>/<modele>/)
  3. Types de véhicules supplémentaires (vélo électrique)
"""
from typing import Optional
from urllib.parse import urlparse

from .motoplex import MotoplexScraper


class MorinSportsScraper(MotoplexScraper):

    SITE_NAME = "Morin Sports & Marine"
    SITE_SLUG = "morin-sports"
    SITE_URL = "https://www.morinsports.com/fr/"
    SITE_DOMAIN = "morinsports.com"
    SITE_DOMAIN_ALT = "morinsports.com"

    SITEMAP_URL = "https://www.morinsports.com/sitemaps/inventory-detail.xml"
    SHOWROOM_SITEMAP_URL = "https://www.morinsports.com/sitemaps/showroom-detail.xml"

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    def _is_product_url(self, url: str) -> bool:
        """Filtre custom incluant les URLs showroom (sans 'a-vendre-')."""
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        skip = ('/service/', '/contact/', '/financement/', '/pieces/',
                '/blogue/', '/equipe/', '/promotions/', '/carrieres/')
        if any(s in url_lower for s in skip):
            return False
        if '/fr/' not in url_lower:
            return False
        if '/inventaire/' in url_lower and 'a-vendre-' in url_lower:
            return True
        if '/fr/neuf/' in url_lower and '/inventaire/' not in url_lower:
            path = urlparse(url_lower).path.strip('/').split('/')
            return len(path) >= 5
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
