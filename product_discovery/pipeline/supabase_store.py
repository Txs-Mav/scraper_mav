"""
Supabase implementation of CatalogStore.

Provides persistent storage for canonical products, listings,
and matching candidates using Supabase (PostgreSQL).
"""
from __future__ import annotations

import logging
from typing import Optional

from ..models.product import CanonicalProduct, MatchCandidate, ProductListing
from .ingestion import CatalogStore

logger = logging.getLogger(__name__)


class SupabaseCatalogStore(CatalogStore):
    """
    Supabase-backed catalog store.

    Uses the supabase-py client for CRUD operations and
    relies on the pg_trgm extension for fuzzy text matching.
    """

    def __init__(self, client):
        """
        Args:
            client: Initialized Supabase client (from supabase import create_client)
        """
        self.client = client

    async def find_existing_listing(
        self, listing: ProductListing
    ) -> Optional[ProductListing]:
        """Find a listing that already exists in the database."""
        query = self.client.table("product_listings").select("*")

        if listing.source_product_id and listing.data_source_id:
            result = (
                query
                .eq("source_product_id", listing.source_product_id)
                .eq("data_source_id", listing.data_source_id)
                .limit(1)
                .execute()
            )
            if result.data:
                return self._row_to_listing(result.data[0])

        if listing.vin:
            result = (
                self.client.table("product_listings")
                .select("*")
                .eq("vin", listing.vin)
                .limit(1)
                .execute()
            )
            if result.data:
                return self._row_to_listing(result.data[0])

        return None

    async def find_by_identifier(
        self, listing: ProductListing
    ) -> Optional[CanonicalProduct]:
        """Look up a canonical product by any of its identifiers."""
        for id_type in ["gtin", "upc", "ean", "mpn"]:
            value = getattr(listing, id_type, None)
            if not value:
                continue

            result = (
                self.client.table("product_identifiers")
                .select("canonical_product_id")
                .eq("identifier_type", id_type)
                .eq("identifier_value", value)
                .limit(1)
                .execute()
            )
            if result.data:
                cp_id = result.data[0]["canonical_product_id"]
                return await self._get_canonical(cp_id)

            result = (
                self.client.table("canonical_products")
                .select("*")
                .eq(id_type, value)
                .limit(1)
                .execute()
            )
            if result.data:
                return self._row_to_canonical(result.data[0])

        return None

    async def find_candidates(
        self,
        brand: Optional[str] = None,
        category: Optional[str] = None,
        year: Optional[int] = None,
        limit: int = 100,
    ) -> list[CanonicalProduct]:
        """Find canonical product candidates for matching."""
        query = self.client.table("canonical_products").select("*")

        if brand:
            query = query.ilike("brand", brand)
        if category:
            query = query.eq("category", category)
        if year:
            query = query.gte("year", year - 1).lte("year", year + 1)

        result = query.limit(limit).execute()
        return [self._row_to_canonical(row) for row in result.data]

    async def upsert_canonical(self, product: CanonicalProduct) -> None:
        """Insert or update a canonical product."""
        data = {
            "id": product.id,
            "name": product.name,
            "brand": product.brand,
            "model": product.model,
            "year": product.year,
            "category": product.category,
            "subcategory": product.subcategory,
            "upc": product.upc,
            "ean": product.ean,
            "gtin": product.gtin,
            "mpn": product.mpn,
            "manufacturer_sku": product.manufacturer_sku,
            "specs": product.specs,
            "primary_image": product.primary_image,
            "images": product.images,
            "confidence": product.confidence,
            "verified": product.verified,
            "msrp": float(product.msrp) if product.msrp else None,
        }
        data = {k: v for k, v in data.items() if v is not None}

        self.client.table("canonical_products").upsert(data).execute()

        for id_type in ["upc", "ean", "gtin", "mpn", "manufacturer_sku"]:
            value = getattr(product, id_type, None)
            if value:
                self.client.table("product_identifiers").upsert(
                    {
                        "canonical_product_id": product.id,
                        "identifier_type": id_type,
                        "identifier_value": value,
                        "source": "canonical",
                    },
                    on_conflict="identifier_type,identifier_value",
                ).execute()

    async def upsert_listing(self, listing: ProductListing) -> None:
        """Insert or update a product listing."""
        data = {
            "id": listing.id,
            "canonical_product_id": listing.canonical_product_id,
            "data_source_id": listing.data_source_id,
            "source_product_id": listing.source_product_id,
            "source_url": listing.source_url,
            "retailer_name": listing.retailer_name,
            "retailer_url": listing.retailer_url,
            "retailer_location": listing.retailer_location,
            "raw_title": listing.raw_title,
            "raw_brand": listing.raw_brand,
            "raw_model": listing.raw_model,
            "raw_year": listing.raw_year,
            "raw_category": listing.raw_category,
            "upc": listing.upc,
            "ean": listing.ean,
            "gtin": listing.gtin,
            "mpn": listing.mpn,
            "stock_number": listing.stock_number,
            "vin": listing.vin,
            "price": float(listing.price) if listing.price else None,
            "currency": listing.currency,
            "original_price": float(listing.original_price) if listing.original_price else None,
            "condition": listing.condition.value,
            "status": listing.status.value,
            "in_stock": listing.in_stock,
            "quantity": listing.quantity,
            "description": listing.description,
            "specs": listing.specs,
            "images": listing.images,
            "raw_data": listing.raw_data,
            "match_method": listing.match_method,
            "match_confidence": listing.match_confidence,
        }
        data = {k: v for k, v in data.items() if v is not None}

        self.client.table("product_listings").upsert(data).execute()

    async def save_match_candidate(self, candidate: MatchCandidate) -> None:
        """Save a matching candidate for human review."""
        self.client.table("matching_candidates").upsert(
            {
                "id": candidate.id,
                "listing_id": candidate.listing_id,
                "canonical_product_id": candidate.canonical_product_id,
                "confidence": candidate.confidence,
                "match_method": candidate.match_method,
                "match_details": candidate.match_details,
                "reviewed": candidate.reviewed,
                "approved": candidate.approved,
            },
            on_conflict="listing_id,canonical_product_id",
        ).execute()

    async def _get_canonical(self, cp_id: str) -> Optional[CanonicalProduct]:
        result = (
            self.client.table("canonical_products")
            .select("*")
            .eq("id", cp_id)
            .limit(1)
            .execute()
        )
        if result.data:
            return self._row_to_canonical(result.data[0])
        return None

    @staticmethod
    def _row_to_canonical(row: dict) -> CanonicalProduct:
        return CanonicalProduct(
            id=row["id"],
            name=row["name"],
            brand=row["brand"],
            model=row.get("model"),
            year=row.get("year"),
            category=row.get("category"),
            subcategory=row.get("subcategory"),
            upc=row.get("upc"),
            ean=row.get("ean"),
            gtin=row.get("gtin"),
            mpn=row.get("mpn"),
            manufacturer_sku=row.get("manufacturer_sku"),
            specs=row.get("specs", {}),
            primary_image=row.get("primary_image"),
            images=row.get("images", []),
            confidence=row.get("confidence", 0.0),
            verified=row.get("verified", False),
            listing_count=row.get("listing_count", 0),
            avg_price=row.get("avg_price"),
            min_price=row.get("min_price"),
            max_price=row.get("max_price"),
            msrp=row.get("msrp"),
        )

    @staticmethod
    def _row_to_listing(row: dict) -> ProductListing:
        from ..models.product import Condition, ListingStatus

        return ProductListing(
            id=row["id"],
            raw_title=row["raw_title"],
            retailer_name=row["retailer_name"],
            data_source_id=row["data_source_id"],
            canonical_product_id=row.get("canonical_product_id"),
            source_product_id=row.get("source_product_id"),
            source_url=row.get("source_url"),
            retailer_url=row.get("retailer_url"),
            retailer_location=row.get("retailer_location"),
            raw_brand=row.get("raw_brand"),
            raw_model=row.get("raw_model"),
            raw_year=row.get("raw_year"),
            raw_category=row.get("raw_category"),
            upc=row.get("upc"),
            ean=row.get("ean"),
            gtin=row.get("gtin"),
            mpn=row.get("mpn"),
            stock_number=row.get("stock_number"),
            vin=row.get("vin"),
            price=row.get("price"),
            currency=row.get("currency", "CAD"),
            original_price=row.get("original_price"),
            condition=Condition(row.get("condition", "inconnu")),
            status=ListingStatus(row.get("status", "active")),
            in_stock=row.get("in_stock", True),
            quantity=row.get("quantity", 1),
            description=row.get("description"),
            specs=row.get("specs", {}),
            images=row.get("images", []),
            raw_data=row.get("raw_data", {}),
            match_method=row.get("match_method"),
            match_confidence=row.get("match_confidence", 0.0),
        )
