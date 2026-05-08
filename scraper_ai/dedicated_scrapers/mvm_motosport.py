"""
Scraper dédié pour MVM Moto Sport (mvmmotosport.com).

MVM est maintenant sur PowerGO/Next.js. Les anciennes pages WordPress/FacetWP
ne contiennent plus ``FWP_JSON`` ni ``.product-list``; la découverte passe donc
par le sitemap d'inventaire réel (``inventory-detail.xml``) exposé par PowerGO.

On n'active pas ``showroom-detail.xml`` ici : le cron global passe la
catégorie ``catalogue``, mais on veut rester limité à l'inventaire physique
en stock. Le sitemap inventaire FR contient 381 unités (335 neuves + 46
d'occasion), regroupées ensuite par marque/modèle/année/état via la logique
standard ``_group_identical_products`` héritée de ``MotoplexScraper``.
"""
import re
from typing import Optional
from urllib.parse import urlparse

from .motoplex import MotoplexScraper


class MvmMotosportScraper(MotoplexScraper):

    SITE_NAME = "MVM Moto Sport"
    SITE_SLUG = "mvm-motosport"
    SITE_URL = "https://www.mvmmotosport.com/fr/"
    SITE_DOMAIN = "mvmmotosport.com"
    SITE_DOMAIN_ALT = "mvmmotosport.com"

    SITEMAP_URL = "https://www.mvmmotosport.com/sitemaps/inventory-detail.xml"
    SHOWROOM_SITEMAP_URL = None

    WORKERS = 12
    DETAIL_TIMEOUT = 12

    def _extract_type_from_url(self, url: str) -> Optional[str]:
        vtype = super()._extract_type_from_url(url)
        if vtype:
            return vtype

        path = urlparse(url).path.lower()
        extra_types = {
            'velo-electrique': 'Vélo électrique',
            'tracteurs': 'Tracteur',
            'autres': 'Autre',
        }
        for slug, label in extra_types.items():
            if f'/{slug}/' in path:
                return label
        return None

    @staticmethod
    def _clean_name(name: str) -> str:
        if not name:
            return name
        name = MotoplexScraper._clean_name(name)
        name = re.sub(r'\s*\|\s*MVM.*$', '', name, flags=re.I)
        name = re.sub(r'\s*[-–]\s*MVM\s*Moto.*$', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name)
        return name.strip()
