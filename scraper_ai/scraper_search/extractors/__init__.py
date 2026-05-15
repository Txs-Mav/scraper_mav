"""
Extracteurs de produits réutilisables (HTML brut → dict normalisé).

Le but : factoriser la logique d'extraction qui aujourd'hui est dispersée dans
chaque scraper dédié, et la rendre disponible aux marketplaces (Amazon, eBay,
Shopify, Kijiji, …) qui n'ont pas leurs propres scrapers d'inventaire.
"""

from .generic_product import (  # noqa: F401
    GenericProductExtractor,
    extract_product,
    extract_products_from_listing,
)
