"""
Pre-configured data source definitions for the powersports industry.

Each entry defines a data source with its connector type, expected
feed format, and field mapping. API keys and credentials are loaded
from environment variables at runtime.
"""
from __future__ import annotations

import os

from ..models.source import DataSource, SourceType


def get_configured_sources() -> list[DataSource]:
    """
    Return all pre-configured data sources.
    Credentials are loaded from environment variables.
    """
    sources: list[DataSource] = []

    # ─── Google Shopping via SerpAPI ─────────────────────────────────
    serpapi_key = os.getenv("SERPAPI_API_KEY")
    if serpapi_key:
        sources.append(
            DataSource(
                name="Google Shopping (CA)",
                source_type=SourceType.GOOGLE_SHOPPING,
                config={
                    "provider": "serpapi",
                    "api_key": serpapi_key,
                    "country": "ca",
                    "language": "fr",
                    "queries": [
                        # Motos
                        "yamaha mt-07 2024 concessionnaire québec",
                        "yamaha mt-09 2024 prix canada",
                        "honda cbr600rr 2024 dealer",
                        "kawasaki z900 2024 prix",
                        "suzuki gsx-s750 2024",
                        # Can-Am
                        "can-am outlander 2024 prix québec",
                        "can-am maverick 2024",
                        "can-am ryker 2024",
                        "can-am spyder 2024",
                        # Ski-Doo
                        "ski-doo renegade 2025 prix",
                        "ski-doo summit 2025",
                        "ski-doo mxz 2025",
                        # Sea-Doo
                        "sea-doo spark 2024",
                        "sea-doo rxt 2024",
                        # Polaris
                        "polaris rzr 2024 prix",
                        "polaris sportsman 2024",
                    ],
                },
            )
        )

    # ─── eBay Canada ─────────────────────────────────────────────────
    ebay_app_id = os.getenv("EBAY_APP_ID")
    ebay_cert_id = os.getenv("EBAY_CERT_ID")
    if ebay_app_id:
        sources.append(
            DataSource(
                name="eBay Canada",
                source_type=SourceType.MARKETPLACE,
                base_url="https://api.ebay.com",
                config={
                    "marketplace": "ebay",
                    "app_id": ebay_app_id,
                    "cert_id": ebay_cert_id or "",
                    "country": "EBAY_CA",
                    "search_queries": [
                        "yamaha mt-07",
                        "can-am outlander",
                        "ski-doo renegade",
                        "honda crf",
                        "polaris rzr",
                        "kawasaki ninja",
                        "harley-davidson sportster",
                    ],
                    "categories": ["6024", "6723", "100693"],
                    # 6024=Motorcycles, 6723=Snowmobiles, 100693=ATVs
                },
            )
        )

    # ─── BRP Dealer Portal (placeholder) ─────────────────────────────
    brp_api_key = os.getenv("BRP_DEALER_API_KEY")
    if brp_api_key:
        sources.append(
            DataSource(
                name="BRP Dealer Portal",
                source_type=SourceType.MANUFACTURER_FEED,
                base_url="https://dealer.brp.com/api",
                config={
                    "feed_url": "https://dealer.brp.com/api/v1/products",
                    "format": "json",
                    "auth_method": "bearer",
                    "token": brp_api_key,
                    "brand": "BRP",
                    "items_path": "data.products",
                    "mapping": {
                        "title": "productName",
                        "model": "modelName",
                        "year": "modelYear",
                        "category": "vehicleType",
                        "price": "msrp",
                        "mpn": "partNumber",
                        "gtin": "gtin",
                        "id": "productId",
                        "specs": {
                            "cylindree": "displacement",
                            "puissance": "horsepower",
                            "poids": "dryWeight",
                            "transmission": "transmission",
                        },
                    },
                },
            )
        )

    # ─── Yamaha Dealer Feed (placeholder) ────────────────────────────
    yamaha_api_key = os.getenv("YAMAHA_DEALER_API_KEY")
    if yamaha_api_key:
        sources.append(
            DataSource(
                name="Yamaha Motor Canada",
                source_type=SourceType.MANUFACTURER_FEED,
                base_url="https://dealer.yamaha-motor.ca",
                config={
                    "feed_url": "https://dealer.yamaha-motor.ca/api/products/feed.xml",
                    "format": "xml",
                    "auth_method": "api_key",
                    "api_key": yamaha_api_key,
                    "brand": "Yamaha",
                    "item_tag": "product",
                    "mapping": {
                        "title": "name",
                        "model": "model",
                        "year": "year",
                        "category": "category",
                        "price": "msrp",
                        "mpn": "partNumber",
                        "specs": {
                            "cylindree": "engineDisplacement",
                            "puissance": "maxPower",
                            "poids": "curbWeight",
                        },
                    },
                },
            )
        )

    return sources
