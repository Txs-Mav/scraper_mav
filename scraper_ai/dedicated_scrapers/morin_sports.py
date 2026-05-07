"""
Scraper dédié pour Morin Sports & Marine (morinsports.com).

Concessionnaire Arctic Cat, Kawasaki, Suzuki Marine, Widescape et Remeq
situé au 1695 Rue St-Maurice, Trois-Rivières, QC.

Plateforme : PowerGO / Next.js (cdn.powergo.ca)
Domaine    : morinsports.com

Hérite de MotoplexScraper qui gère nativement :
  - Sitemap inventory-detail.xml (uniquement, pas le showroom)
  - JSON-LD Vehicle ET Product (remorques Remeq)
  - Format HTML 'Label:Value' pour les pages catalogue
  - Prix avec annotations "Épargnez X $" / "Save X $" / etc.
  - Codes constructeur (KLE650JSNN, KLZ1000DPSNN…) retirés du nom
  - Suffixe site dynamique '| Morin Sports & Marine' retiré du nom

Ce fichier ne définit que les attributs spécifiques au site :
  1. URL sitemap inventory (showroom volontairement exclu)
  2. Filtre _is_product_url restreint aux URLs d'inventaire
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
    # Showroom/catalogue désactivé : on ne veut que les produits réellement
    # présents dans les inventaires (URLs contenant 'a-vendre-').
    SHOWROOM_SITEMAP_URL = None

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    def _is_product_url(self, url: str) -> bool:
        """N'accepte que les URLs d'inventaire (/inventaire/ + 'a-vendre-')."""
        url_lower = url.lower()
        if self.SITE_DOMAIN not in url_lower:
            return False
        skip = ('/service/', '/contact/', '/financement/', '/pieces/',
                '/blogue/', '/equipe/', '/promotions/', '/carrieres/')
        if any(s in url_lower for s in skip):
            return False
        if '/fr/' not in url_lower:
            return False
        return '/inventaire/' in url_lower and 'a-vendre-' in url_lower

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        """Étend la table de types pour couvrir l'inventaire Morin Sports."""
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
