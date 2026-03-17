"""
Registre des scrapers dédiés.
Permet de trouver et instancier un scraper dédié à partir d'une URL ou d'un slug.
"""
from typing import Dict, Optional, Type
from urllib.parse import urlparse

from .base import DedicatedScraper
from .mvm_motosport import MvmMotosportScraper
from .motoplex import MotoplexScraper
from .motoplex_mirabel import MotoplexMirabelScraper
from .motosport4saisons import Motosport4SaisonsScraper
from .motos_illimitees import MotosIllimiteesScraper
from .motovanier import MotoVanierScraper
from .mathias_sports import MathiasSportsScraper
from .joliette_recreatif import JolietteRecreatifScraper


_SCRAPERS: Dict[str, Type[DedicatedScraper]] = {
    'mvm-motosport': MvmMotosportScraper,
    'motoplex': MotoplexScraper,
    'motoplex-mirabel': MotoplexMirabelScraper,
    'motosport4saisons': Motosport4SaisonsScraper,
    'motos-illimitees': MotosIllimiteesScraper,
    'motovanier': MotoVanierScraper,
    'mathias-sports': MathiasSportsScraper,
    'joliette-recreatif': JolietteRecreatifScraper,
}

_DOMAIN_MAP: Dict[str, str] = {
    'mvmmotosport.com': 'mvm-motosport',
    'motoplex.ca': 'motoplex',
    'motoplexsteustache.ca': 'motoplex',
    'motoplexmirabel.ca': 'motoplex-mirabel',
    'motoplexmirabel.com': 'motoplex-mirabel',
    'motosport4saisons.com': 'motosport4saisons',
    'motosillimitees.com': 'motos-illimitees',
    'motovanier.ca': 'motovanier',
    'mathiassports.com': 'mathias-sports',
    'jolietterecreatif.ca': 'joliette-recreatif',
}


class DedicatedScraperRegistry:
    """Registre central des scrapers dédiés."""

    @staticmethod
    def get_by_slug(slug: str) -> Optional[DedicatedScraper]:
        """Retourne une instance du scraper dédié par son slug."""
        scraper_class = _SCRAPERS.get(slug)
        if scraper_class:
            return scraper_class()
        return None

    @staticmethod
    def get_by_url(url: str) -> Optional[DedicatedScraper]:
        """Retourne un scraper dédié si l'URL correspond à un site connu."""
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')

        slug = _DOMAIN_MAP.get(domain)
        if slug:
            scraper_class = _SCRAPERS.get(slug)
            if scraper_class:
                return scraper_class()
        return None

    @staticmethod
    def has_dedicated_scraper(url: str) -> bool:
        """Vérifie si une URL a un scraper dédié."""
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        return domain in _DOMAIN_MAP

    @staticmethod
    def list_all() -> list:
        """Liste tous les scrapers dédiés disponibles."""
        result = []
        for slug, scraper_class in _SCRAPERS.items():
            result.append({
                'slug': slug,
                'site_name': scraper_class.SITE_NAME,
                'site_url': scraper_class.SITE_URL,
                'site_domain': scraper_class.SITE_DOMAIN,
            })
        return result

    @staticmethod
    def search(query: str) -> list:
        """Recherche un scraper dédié par mot-clé."""
        query_lower = query.lower().strip()
        results = []
        for slug, scraper_class in _SCRAPERS.items():
            searchable = f"{scraper_class.SITE_NAME} {slug} {scraper_class.SITE_DOMAIN}".lower()
            if query_lower in searchable:
                results.append({
                    'slug': slug,
                    'site_name': scraper_class.SITE_NAME,
                    'site_url': scraper_class.SITE_URL,
                    'site_domain': scraper_class.SITE_DOMAIN,
                })
        return results


def get_registry() -> DedicatedScraperRegistry:
    return DedicatedScraperRegistry()
