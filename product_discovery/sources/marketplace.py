"""
Marketplace API connectors (Amazon, eBay, Facebook Marketplace).

These discover products by querying marketplace APIs,
then map listings back to canonical products.

Configuration example (Amazon SP-API):
    {
        "marketplace": "amazon",
        "region": "CA",
        "credentials": {
            "client_id": "...",
            "client_secret": "...",
            "refresh_token": "..."
        },
        "search_queries": ["yamaha mt-07", "can-am outlander"],
        "categories": ["Automotive", "Powersports"]
    }

Configuration example (eBay Browse API):
    {
        "marketplace": "ebay",
        "app_id": "...",
        "cert_id": "...",
        "country": "EBAY_CA",
        "search_queries": ["yamaha mt-07 2024"],
        "categories": ["6024"]  # eBay category IDs for motorcycles
    }
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Optional

import aiohttp

from ..matching.normalizer import ProductNormalizer
from ..models.product import Condition, ProductListing
from ..models.source import DataSource
from .base import BaseSource

logger = logging.getLogger(__name__)


class MarketplaceSource(BaseSource):
    """
    Discovers products from major marketplaces.

    Supported marketplaces:
    - Amazon (SP-API / Product Advertising API)
    - eBay (Browse API)
    - Facebook Marketplace (via scraping bridge)
    - Kijiji (via scraping bridge)
    """

    def __init__(self, source: DataSource):
        super().__init__(source)
        self.marketplace = self.config.get("marketplace", "amazon")
        self.search_queries = self.config.get("search_queries", [])
        self.normalizer = ProductNormalizer()

    async def test_connection(self) -> bool:
        handlers = {
            "amazon": self._test_amazon,
            "ebay": self._test_ebay,
        }
        handler = handlers.get(self.marketplace)
        if handler:
            return await handler()
        return False

    async def fetch_listings(self) -> AsyncIterator[ProductListing]:
        handlers = {
            "amazon": self._fetch_amazon,
            "ebay": self._fetch_ebay,
        }
        handler = handlers.get(self.marketplace)
        if not handler:
            logger.error(f"Unsupported marketplace: {self.marketplace}")
            return

        async for listing in handler():
            yield listing

    # ------------------------------------------------------------------
    # Amazon SP-API
    # ------------------------------------------------------------------
    async def _test_amazon(self) -> bool:
        # Would authenticate via LWA (Login With Amazon) OAuth2
        logger.info("Amazon SP-API connection test — requires real credentials")
        return bool(self.config.get("credentials", {}).get("client_id"))

    async def _fetch_amazon(self) -> AsyncIterator[ProductListing]:
        """
        Amazon Product Advertising API v5 (PA-API 5).

        Provides:
        - ASIN, UPC/EAN/GTIN
        - Pricing, availability
        - Product specs, images
        - Category hierarchy

        Rate limit: 1 req/sec, max 8640/day for new associates.
        """
        credentials = self.config.get("credentials", {})
        if not credentials.get("client_id"):
            logger.error("Amazon credentials not configured")
            return

        async with aiohttp.ClientSession() as session:
            for query in self.search_queries:
                try:
                    # PA-API 5 search endpoint
                    # In production, use the official amazon-paapi5 SDK
                    items = await self._amazon_search(session, query, credentials)
                    for item in items:
                        listing = self._amazon_to_listing(item)
                        if listing:
                            yield listing
                except Exception as e:
                    logger.error(f"Amazon search failed for '{query}': {e}")

    async def _amazon_search(
        self, session: aiohttp.ClientSession, query: str, credentials: dict
    ) -> list[dict]:
        """Placeholder for Amazon PA-API 5 search. Replace with real SDK call."""
        logger.info(f"Amazon search: {query} (requires PA-API 5 implementation)")
        return []

    def _amazon_to_listing(self, item: dict) -> Optional[ProductListing]:
        title = item.get("title")
        if not title:
            return None

        identifiers = item.get("identifiers", {})
        brand = self.normalizer.extract_brand_from_title(title)

        return ProductListing(
            raw_title=title,
            retailer_name="Amazon.ca",
            data_source_id=self.source.id,
            source_product_id=item.get("asin"),
            source_url=item.get("detail_page_url"),
            raw_brand=brand or item.get("brand"),
            upc=identifiers.get("upc"),
            ean=identifiers.get("ean"),
            gtin=identifiers.get("gtin"),
            price=self.normalizer.normalize_price(item.get("price")),
            condition=Condition.NEUF,
            images=item.get("images", []),
            raw_data=item,
        )

    # ------------------------------------------------------------------
    # eBay Browse API
    # ------------------------------------------------------------------
    async def _test_ebay(self) -> bool:
        return bool(self.config.get("app_id"))

    async def _fetch_ebay(self) -> AsyncIterator[ProductListing]:
        """
        eBay Browse API.

        Provides:
        - Item ID, GTIN/MPN/UPC
        - Pricing, condition, seller info
        - Item specifics (year, make, model for vehicles)
        - Category

        Rate limit: 5000 calls/day for production keys.
        """
        app_id = self.config.get("app_id")
        country = self.config.get("country", "EBAY_CA")
        if not app_id:
            logger.error("eBay app_id not configured")
            return

        async with aiohttp.ClientSession() as session:
            token = await self._get_ebay_token(session, app_id)
            if not token:
                return

            for query in self.search_queries:
                try:
                    headers = {
                        "Authorization": f"Bearer {token}",
                        "X-EBAY-C-MARKETPLACE-ID": country,
                        "Content-Type": "application/json",
                    }
                    params = {
                        "q": query,
                        "limit": 50,
                        "fieldgroups": "EXTENDED",
                    }
                    categories = self.config.get("categories", [])
                    if categories:
                        params["category_ids"] = ",".join(categories)

                    async with session.get(
                        "https://api.ebay.com/buy/browse/v1/item_summary/search",
                        headers=headers,
                        params=params,
                    ) as resp:
                        resp.raise_for_status()
                        data = await resp.json()

                    for item in data.get("itemSummaries", []):
                        listing = self._ebay_to_listing(item)
                        if listing:
                            yield listing
                except Exception as e:
                    logger.error(f"eBay search failed for '{query}': {e}")

    async def _get_ebay_token(
        self, session: aiohttp.ClientSession, app_id: str
    ) -> Optional[str]:
        """Get eBay OAuth token via client credentials grant."""
        import base64

        cert_id = self.config.get("cert_id", "")
        encoded = base64.b64encode(f"{app_id}:{cert_id}".encode()).decode()
        try:
            async with session.post(
                "https://api.ebay.com/identity/v1/oauth2/token",
                headers={
                    "Authorization": f"Basic {encoded}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={
                    "grant_type": "client_credentials",
                    "scope": "https://api.ebay.com/oauth/api_scope",
                },
            ) as resp:
                data = await resp.json()
                return data.get("access_token")
        except Exception as e:
            logger.error(f"eBay token request failed: {e}")
            return None

    def _ebay_to_listing(self, item: dict) -> Optional[ProductListing]:
        title = item.get("title")
        if not title:
            return None

        price_data = item.get("price", {})
        price = self.normalizer.normalize_price(price_data.get("value"))
        brand = self.normalizer.extract_brand_from_title(title)
        year = self.normalizer.extract_year(title)

        condition_map = {
            "NEW": Condition.NEUF,
            "USED_EXCELLENT": Condition.OCCASION,
            "USED_GOOD": Condition.OCCASION,
            "USED_ACCEPTABLE": Condition.OCCASION,
        }
        condition = condition_map.get(
            item.get("condition", ""), Condition.INCONNU
        )

        gtin = None
        mpn = None
        if "additionalProductIdentities" in item:
            for ident in item["additionalProductIdentities"]:
                for val in ident.get("productIdentity", []):
                    if val.get("identifierType") == "GTIN":
                        gtin = val.get("identifierValue")
                    elif val.get("identifierType") == "MPN":
                        mpn = val.get("identifierValue")

        return ProductListing(
            raw_title=title,
            retailer_name=item.get("seller", {}).get("username", "eBay"),
            data_source_id=self.source.id,
            source_product_id=item.get("itemId"),
            source_url=item.get("itemWebUrl"),
            raw_brand=brand,
            raw_year=year,
            gtin=gtin,
            mpn=mpn,
            price=price,
            currency=price_data.get("currency", "CAD"),
            condition=condition,
            images=[img.get("imageUrl") for img in item.get("image", {}).get("imageUrl", []) if img] if isinstance(item.get("image"), dict) else [],
            raw_data=item,
        )
