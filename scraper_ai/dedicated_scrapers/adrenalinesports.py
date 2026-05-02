"""
Scraper dédié pour Adrenaline Sports | Multi-concessionnaire au Quebec (adrenalinesports.ca).
Généré par scraper_usine le 2026-04-30.
Stratégie: héritage MotoplexScraper (même plateforme)
"""
from .motoplex import MotoplexScraper


class AdrenalinesportsScraper(MotoplexScraper):

    SITE_NAME = "Adrenaline Sports | Multi-concessionnaire au Quebec"
    SITE_SLUG = "adrenalinesports"
    SITE_URL = "https://www.adrenalinesports.ca/fr/"
    SITE_DOMAIN = "adrenalinesports.ca"
    SITEMAP_URL = "https://www.adrenalinesports.ca/sitemaps/inventory-detail.xml"

    # ----------------------------------------------------------------
    # Hooks override-friendly disponibles si besoin (héritage de la
    # plateforme MotoplexScraper couvre la majorité du cas général) :
    #
    #   - _clean_name(name)                  → nettoyage spécifique du nom
    #                                          (suffixes ville, marque dupliquée...)
    #   - _is_product_url(url)               → règles "URL produit" custom
    #   - _extract_extra_json_ld_fields(...) → champs JSON-LD supplémentaires
    #
    # Le scraper généré n'a RIEN à faire par défaut. Surcharger uniquement
    # quand un test sur le site révèle un cas non couvert par le parent.
    # ----------------------------------------------------------------
