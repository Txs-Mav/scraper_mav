"""
Manufacturer product feed connector.

Supports:
- XML/JSON product feeds (Yamaha, Honda, Kawasaki, BRP, Polaris, etc.)
- OEM catalog APIs
- Structured data files (CSV, XLSX)

Configuration example:
    {
        "feed_url": "https://api.manufacturer.com/products/feed.xml",
        "format": "xml",           # xml, json, csv
        "auth_method": "api_key",  # api_key, oauth2, basic, none
        "api_key": "...",
        "brand": "Yamaha",
        "mapping": {
            "title": "product_name",
            "mpn": "part_number",
            "price": "msrp",
            "category": "vehicle_type",
            "year": "model_year",
            "model": "model_name",
            "specs": {
                "cylindree": "displacement",
                "puissance": "horsepower",
                "poids": "weight"
            }
        }
    }
"""
from __future__ import annotations

import csv
import io
import json
import logging
from typing import AsyncIterator, Optional
from xml.etree import ElementTree

import aiohttp

from ..models.product import ProductListing
from ..models.source import DataSource
from .base import BaseSource

logger = logging.getLogger(__name__)


class ManufacturerFeedSource(BaseSource):
    """
    Ingests products from manufacturer feeds.

    Powersports manufacturers that provide data feeds:
    - BRP (Can-Am, Ski-Doo, Sea-Doo, Lynx): Dealer Portal API
    - Yamaha: YMUS Dealer Portal, XML feed
    - Honda: PowerSports dealer extranet
    - Kawasaki: K-Dealer portal
    - Polaris: Dealer portal API
    - Suzuki: Dealer network portal
    - KTM/Husqvarna: myKTM dealer API
    - Harley-Davidson: H-D Dealer portal

    Most provide at minimum: model name, year, MSRP, category, specs.
    """

    def __init__(self, source: DataSource):
        super().__init__(source)
        self.feed_url = self.config.get("feed_url")
        self.feed_format = self.config.get("format", "json")
        self.brand = self.config.get("brand", "")
        self.mapping = self.config.get("mapping", {})

    async def test_connection(self) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                headers = self._build_headers()
                async with session.head(self.feed_url, headers=headers) as resp:
                    return resp.status < 400
        except Exception as e:
            logger.error(f"Connection test failed for {self.source.name}: {e}")
            return False

    async def fetch_listings(self) -> AsyncIterator[ProductListing]:
        async with aiohttp.ClientSession() as session:
            headers = self._build_headers()
            async with session.get(self.feed_url, headers=headers) as resp:
                resp.raise_for_status()
                raw = await resp.text()

        if self.feed_format == "json":
            products = self._parse_json(raw)
        elif self.feed_format == "xml":
            products = self._parse_xml(raw)
        elif self.feed_format == "csv":
            products = self._parse_csv(raw)
        else:
            raise ValueError(f"Unsupported feed format: {self.feed_format}")

        for product_data in products:
            listing = self._map_to_listing(product_data)
            if listing:
                yield listing

    def _build_headers(self) -> dict:
        headers = {"User-Agent": "ProductDiscovery/1.0"}
        auth = self.config.get("auth_method", "none")
        if auth == "api_key":
            key_header = self.config.get("api_key_header", "X-API-Key")
            headers[key_header] = self.config.get("api_key", "")
        elif auth == "basic":
            import base64
            creds = base64.b64encode(
                f"{self.config['username']}:{self.config['password']}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {creds}"
        elif auth == "bearer":
            headers["Authorization"] = f"Bearer {self.config.get('token', '')}"
        return headers

    def _parse_json(self, raw: str) -> list[dict]:
        data = json.loads(raw)
        items_path = self.config.get("items_path", "")
        if items_path:
            for key in items_path.split("."):
                data = data[key]
        return data if isinstance(data, list) else [data]

    def _parse_xml(self, raw: str) -> list[dict]:
        root = ElementTree.fromstring(raw)
        item_tag = self.config.get("item_tag", "product")
        items = []
        for elem in root.iter(item_tag):
            item = {}
            for child in elem:
                tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                item[tag] = child.text
            items.append(item)
        return items

    def _parse_csv(self, raw: str) -> list[dict]:
        reader = csv.DictReader(io.StringIO(raw))
        return list(reader)

    def _map_to_listing(self, data: dict) -> Optional[ProductListing]:
        """Map source fields to ProductListing using the configured mapping."""
        mapping = self.mapping

        def get_mapped(field: str) -> Optional[str]:
            source_field = mapping.get(field, field)
            return data.get(source_field)

        title = get_mapped("title")
        if not title:
            return None

        specs = {}
        spec_mapping = mapping.get("specs", {})
        for our_key, their_key in spec_mapping.items():
            val = data.get(their_key)
            if val:
                specs[our_key] = val

        price_str = get_mapped("price")
        price = None
        if price_str:
            try:
                price = float(str(price_str).replace(",", "").replace("$", ""))
            except ValueError:
                pass

        year = None
        year_str = get_mapped("year")
        if year_str:
            try:
                year = int(year_str)
            except ValueError:
                pass

        return ProductListing(
            raw_title=title,
            retailer_name=self.brand,
            data_source_id=self.source.id,
            source_product_id=get_mapped("id") or get_mapped("mpn"),
            raw_brand=self.brand,
            raw_model=get_mapped("model"),
            raw_year=year,
            raw_category=get_mapped("category"),
            mpn=get_mapped("mpn"),
            gtin=get_mapped("gtin"),
            upc=get_mapped("upc"),
            ean=get_mapped("ean"),
            price=price,
            specs=specs,
            raw_data=data,
        )
