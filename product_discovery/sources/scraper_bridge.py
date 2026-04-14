"""
Bridge between the existing scraper system and the new product discovery pipeline.

This allows gradual migration: existing scrapers continue to work,
but their output is normalized and fed into the canonical product graph.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator

from ..matching.normalizer import ProductNormalizer
from ..models.product import Condition, ProductListing
from ..models.source import DataSource
from .base import BaseSource

logger = logging.getLogger(__name__)


class ScraperBridgeSource(BaseSource):
    """
    Wraps existing scraper output (from scraper_ai) and converts
    it into ProductListing objects for the discovery pipeline.

    Configuration:
    {
        "scraper_output": [...],    # list of product dicts from scraper_ai
        "site_url": "https://...",
        "site_name": "Dealer Name"
    }
    """

    def __init__(self, source: DataSource):
        super().__init__(source)
        self.normalizer = ProductNormalizer()

    async def test_connection(self) -> bool:
        return bool(self.config.get("scraper_output"))

    async def fetch_listings(self) -> AsyncIterator[ProductListing]:
        products = self.config.get("scraper_output", [])
        site_name = self.config.get("site_name", "Unknown")
        site_url = self.config.get("site_url", "")

        for product in products:
            listing = self._convert(product, site_name, site_url)
            if listing:
                yield listing

    def _convert(
        self, product: dict, site_name: str, site_url: str
    ) -> ProductListing | None:
        name = product.get("name") or product.get("nom")
        if not name:
            return None

        condition_map = {
            "neuf": Condition.NEUF,
            "occasion": Condition.OCCASION,
            "demonstrateur": Condition.DEMONSTRATEUR,
            "usagé": Condition.OCCASION,
            "usagee": Condition.OCCASION,
            "certifié": Condition.CERTIFIE,
        }
        raw_condition = (product.get("etat") or "").lower()
        condition = condition_map.get(raw_condition, Condition.INCONNU)

        brand = self.normalizer.normalize_brand(
            product.get("marque") or product.get("brand")
        )

        year = None
        raw_year = product.get("annee") or product.get("year")
        if raw_year:
            try:
                year = int(raw_year)
            except (ValueError, TypeError):
                year = self.normalizer.extract_year(str(raw_year))

        price = self.normalizer.normalize_price(
            product.get("prix") or product.get("price")
        )

        specs = {}
        for key in ["cylindree", "kilometrage", "couleur", "transmission", "poids"]:
            if product.get(key):
                specs[key] = product[key]

        images = []
        img = product.get("image")
        if img:
            images = [img] if isinstance(img, str) else img

        return ProductListing(
            raw_title=name,
            retailer_name=site_name,
            data_source_id=self.source.id,
            source_url=product.get("sourceUrl") or product.get("url"),
            retailer_url=site_url,
            raw_brand=brand,
            raw_model=product.get("modele") or product.get("model"),
            raw_year=year,
            raw_category=self.normalizer.normalize_category(
                product.get("category") or product.get("sourceCategorie")
            ),
            stock_number=product.get("inventaire") or product.get("stock_number"),
            vin=product.get("vin"),
            price=price,
            condition=condition,
            specs=specs,
            images=images,
            raw_data=product,
        )
