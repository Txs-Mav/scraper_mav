"""
Core ingestion pipeline.

Flow:
    Source → Raw Listings → Normalize → Match → Upsert Catalog → Track History

This is the central data processing engine that transforms raw product data
from any source into normalized, deduplicated canonical products.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from ..matching.matcher import AUTO_MATCH_THRESHOLD, CANDIDATE_THRESHOLD, ProductMatcher
from ..matching.normalizer import ProductNormalizer
from ..models.product import CanonicalProduct, MatchCandidate, ProductListing
from ..models.source import IngestionRun, IngestionStatus

logger = logging.getLogger(__name__)


class IngestionPipeline:
    """
    Processes raw listings through normalization → matching → catalog update.

    Designed to work with any ProductCatalogStore implementation
    (Supabase, PostgreSQL, in-memory for testing).
    """

    def __init__(self, store: "CatalogStore"):
        self.store = store
        self.matcher = ProductMatcher()
        self.normalizer = ProductNormalizer()

    async def process_listing(
        self, listing: ProductListing, run: IngestionRun
    ) -> ProductListing:
        """
        Process a single listing through the full pipeline.

        Steps:
        1. Normalize raw fields
        2. Check for existing listing (by source_product_id or identifiers)
        3. Match to canonical product
        4. Create canonical product if no match and confidence is high enough
        5. Upsert listing
        6. Record price history if price changed
        """
        self._normalize_listing(listing)

        existing = await self.store.find_existing_listing(listing)
        if existing:
            return await self._update_existing(existing, listing, run)

        match = await self._find_canonical_match(listing)

        if match:
            listing.canonical_product_id = match.canonical_product.id
            listing.match_method = match.method
            listing.match_confidence = match.confidence

            if match.confidence >= AUTO_MATCH_THRESHOLD:
                run.products_matched += 1
            else:
                await self.store.save_match_candidate(
                    MatchCandidate(
                        listing_id=listing.id,
                        canonical_product_id=match.canonical_product.id,
                        confidence=match.confidence,
                        match_method=match.method,
                        match_details=match.details,
                    )
                )
                run.products_unmatched += 1
        else:
            canonical = self._create_canonical_from_listing(listing)
            if canonical:
                await self.store.upsert_canonical(canonical)
                listing.canonical_product_id = canonical.id
                listing.match_method = "new_canonical"
                listing.match_confidence = 1.0
            run.products_new += 1

        await self.store.upsert_listing(listing)
        return listing

    def _normalize_listing(self, listing: ProductListing) -> None:
        """Apply normalization to raw listing fields in-place."""
        listing.raw_brand = self.normalizer.normalize_brand(listing.raw_brand)
        listing.raw_category = self.normalizer.normalize_category(listing.raw_category)

        if not listing.raw_year and listing.raw_title:
            listing.raw_year = self.normalizer.extract_year(listing.raw_title)

        if not listing.raw_brand and listing.raw_title:
            listing.raw_brand = self.normalizer.extract_brand_from_title(listing.raw_title)

        for field in ["upc", "ean", "gtin", "mpn", "vin", "stock_number"]:
            val = getattr(listing, field, None)
            if val:
                setattr(listing, field, self.normalizer.normalize_identifier(val))

    async def _find_canonical_match(
        self, listing: ProductListing
    ) -> Optional["MatchResult"]:
        """Search the catalog for a matching canonical product."""
        # Phase 1: exact identifier lookup (fast)
        if listing.has_identifier():
            canonical = await self.store.find_by_identifier(listing)
            if canonical:
                from ..matching.matcher import MatchResult, IDENTIFIER_CONFIDENCE

                id_type = next(
                    t for t in ["gtin", "upc", "ean", "mpn", "vin"]
                    if getattr(listing, t, None)
                )
                return MatchResult(
                    canonical_product=canonical,
                    confidence=IDENTIFIER_CONFIDENCE,
                    method=f"identifier_{id_type}",
                    details={"value": getattr(listing, id_type)},
                )

        # Phase 2: narrow candidates by brand+category, then run full matcher
        candidates = await self.store.find_candidates(
            brand=listing.raw_brand,
            category=listing.raw_category,
            year=listing.raw_year,
            limit=100,
        )

        if not candidates:
            return None

        return self.matcher.match(listing, candidates)

    def _create_canonical_from_listing(
        self, listing: ProductListing
    ) -> Optional[CanonicalProduct]:
        """
        Create a new canonical product from a listing when no match is found.
        Only creates if we have enough data (at minimum brand + title).
        """
        if not listing.raw_brand:
            return None

        return CanonicalProduct(
            name=listing.raw_title,
            brand=listing.raw_brand,
            model=listing.raw_model,
            year=listing.raw_year,
            category=listing.raw_category,
            upc=listing.upc,
            ean=listing.ean,
            gtin=listing.gtin,
            mpn=listing.mpn,
            specs=listing.specs,
            images=listing.images,
            confidence=0.6,  # created from single listing
            msrp=listing.price if listing.condition.value == "neuf" else None,
        )

    async def _update_existing(
        self,
        existing: ProductListing,
        incoming: ProductListing,
        run: IngestionRun,
    ) -> ProductListing:
        """Update an existing listing with new data."""
        existing.last_seen_at = datetime.utcnow()

        if incoming.price and incoming.price != existing.price:
            existing.price = incoming.price

        existing.in_stock = incoming.in_stock
        existing.status = incoming.status

        if incoming.specs:
            existing.specs.update(incoming.specs)

        await self.store.upsert_listing(existing)
        run.products_updated += 1
        return existing


class CatalogStore:
    """
    Abstract interface for the product catalog storage.
    Implement with Supabase, PostgreSQL, or in-memory for testing.
    """

    async def find_existing_listing(
        self, listing: ProductListing
    ) -> Optional[ProductListing]:
        raise NotImplementedError

    async def find_by_identifier(
        self, listing: ProductListing
    ) -> Optional[CanonicalProduct]:
        raise NotImplementedError

    async def find_candidates(
        self,
        brand: Optional[str] = None,
        category: Optional[str] = None,
        year: Optional[int] = None,
        limit: int = 100,
    ) -> list[CanonicalProduct]:
        raise NotImplementedError

    async def upsert_canonical(self, product: CanonicalProduct) -> None:
        raise NotImplementedError

    async def upsert_listing(self, listing: ProductListing) -> None:
        raise NotImplementedError

    async def save_match_candidate(self, candidate: MatchCandidate) -> None:
        raise NotImplementedError
