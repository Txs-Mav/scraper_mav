"""
Google Shopping / SerpAPI / Content API connector.

Two approaches:
1. Google Content API for Shopping (requires Merchant Center account)
2. SerpAPI Google Shopping search (pay-per-query, no merchant account needed)

Configuration example (SerpAPI):
    {
        "provider": "serpapi",
        "api_key": "...",
        "queries": [
            "yamaha mt-07 2024 concessionnaire québec",
            "can-am outlander 2024 prix",
            "ski-doo renegade 2025"
        ],
        "country": "ca",
        "language": "fr"
    }

Configuration example (Content API):
    {
        "provider": "content_api",
        "service_account_json": "...",
        "merchant_id": "123456"
    }
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Optional

import aiohttp

from ..matching.normalizer import ProductNormalizer
from ..models.product import ProductListing
from ..models.source import DataSource
from .base import BaseSource

logger = logging.getLogger(__name__)


class GoogleShoppingSource(BaseSource):
    """
    Discovers products via Google Shopping results.

    Best for:
    - Finding which retailers carry a specific product
    - Discovering market prices across dealers
    - Finding products by identifier (GTIN search)
    """

    def __init__(self, source: DataSource):
        super().__init__(source)
        self.provider = self.config.get("provider", "serpapi")
        self.api_key = self.config.get("api_key", "")
        self.queries = self.config.get("queries", [])
        self.country = self.config.get("country", "ca")
        self.language = self.config.get("language", "fr")
        self.normalizer = ProductNormalizer()

    async def test_connection(self) -> bool:
        if self.provider == "serpapi":
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        "https://serpapi.com/account",
                        params={"api_key": self.api_key},
                    ) as resp:
                        return resp.status == 200
            except Exception:
                return False
        return False

    async def fetch_listings(self) -> AsyncIterator[ProductListing]:
        if self.provider == "serpapi":
            async for listing in self._fetch_serpapi():
                yield listing
        elif self.provider == "content_api":
            async for listing in self._fetch_content_api():
                yield listing

    async def _fetch_serpapi(self) -> AsyncIterator[ProductListing]:
        """Query Google Shopping via SerpAPI."""
        async with aiohttp.ClientSession() as session:
            for query in self.queries:
                try:
                    params = {
                        "engine": "google_shopping",
                        "q": query,
                        "gl": self.country,
                        "hl": self.language,
                        "api_key": self.api_key,
                    }
                    async with session.get(
                        "https://serpapi.com/search", params=params
                    ) as resp:
                        resp.raise_for_status()
                        data = await resp.json()

                    for result in data.get("shopping_results", []):
                        listing = self._serpapi_to_listing(result, query)
                        if listing:
                            yield listing

                except Exception as e:
                    logger.error(f"SerpAPI query failed for '{query}': {e}")

    def _serpapi_to_listing(
        self, result: dict, query: str
    ) -> Optional[ProductListing]:
        title = result.get("title")
        if not title:
            return None

        price = self.normalizer.normalize_price(
            result.get("extracted_price") or result.get("price")
        )
        brand = self.normalizer.extract_brand_from_title(title)
        year = self.normalizer.extract_year(title)

        return ProductListing(
            raw_title=title,
            retailer_name=result.get("source", "Google Shopping"),
            data_source_id=self.source.id,
            source_product_id=result.get("product_id"),
            source_url=result.get("link") or result.get("product_link"),
            retailer_url=result.get("link"),
            raw_brand=brand,
            raw_year=year,
            price=price,
            images=[result["thumbnail"]] if result.get("thumbnail") else [],
            raw_data=result,
        )

    async def _fetch_content_api(self) -> AsyncIterator[ProductListing]:
        """
        Query Google Content API for Shopping.
        Requires a Google Merchant Center account.
        """
        logger.warning("Content API connector not yet implemented — use SerpAPI provider")
        return
        yield  # make this a generator
