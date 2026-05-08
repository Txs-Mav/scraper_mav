"""
Scraper dédié pour DB Moto (dbmoto.ca).

DB Moto est maintenant sur PowerGO/Next.js. L'ancienne API REST WordPress
``/wp-json/wp/v2`` et les anciens sitemaps Yoast retournent 404; la découverte
passe donc par le sitemap d'inventaire réel (``inventory-detail.xml``) exposé
par PowerGO.

On n'active pas ``showroom-detail.xml`` ici : le cron global passe la
catégorie ``catalogue``, mais on veut rester limité à l'inventaire physique
en stock. Le sitemap inventaire FR contient 50 unités (27 neuves + 23
d'occasion), regroupées ensuite par marque/modèle/année/état via la logique
standard ``_group_identical_products`` héritée de ``MotoplexScraper``.
"""
import re
from typing import Optional
from urllib.parse import urlparse

from .motoplex import MotoplexScraper


class DBMotoScraper(MotoplexScraper):

    SITE_NAME = "DB Moto"
    SITE_SLUG = "db-moto"
    SITE_URL = "https://www.dbmoto.ca/fr/"
    SITE_DOMAIN = "dbmoto.ca"
    SITE_DOMAIN_ALT = "dbmoto.ca"

    SITEMAP_URL = "https://www.dbmoto.ca/sitemaps/inventory-detail.xml"
    SHOWROOM_SITEMAP_URL = None

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        vtype = super()._extract_type_from_url(url)
        if vtype:
            return vtype

        path = urlparse(url).path.lower()
        if '/cote-a-cotes/' in path:
            return 'Côte à côte'
        return None

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = MotoplexScraper._clean_name(name)
        name = re.sub(r'\s*(?:\||-|–)\s*DB\s*Moto.*$', '', name, flags=re.I)
        name = re.sub(r'\s+en\s+vente\s+.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
