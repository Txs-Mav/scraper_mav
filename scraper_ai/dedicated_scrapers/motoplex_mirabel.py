"""
Scraper dédié pour Motoplex Mirabel (motoplexmirabel.ca).

Hérite de MotoplexScraper (même plateforme PowerGO, mêmes sélecteurs).
Seules les constantes de site changent.

Site: Next.js + PowerGO CDN (cdn.powergo.ca)
Domaine: motoplexmirabel.ca
"""
from .motoplex import MotoplexScraper


class MotoplexMirabelScraper(MotoplexScraper):

    SITE_NAME = "Motoplex Mirabel"
    SITE_SLUG = "motoplex-mirabel"
    SITE_URL = "https://www.motoplexmirabel.ca/fr/"
    SITE_DOMAIN = "motoplexmirabel.ca"
    SITE_DOMAIN_ALT = "motoplexmirabel.com"

    SITEMAP_URL = "https://www.motoplexmirabel.ca/sitemaps/inventory-detail.xml"
