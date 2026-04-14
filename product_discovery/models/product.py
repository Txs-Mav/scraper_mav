"""
Domain models for the Product Discovery system.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class Condition(str, Enum):
    NEUF = "neuf"
    OCCASION = "occasion"
    DEMONSTRATEUR = "demonstrateur"
    CERTIFIE = "certifie"
    INCONNU = "inconnu"


class ListingStatus(str, Enum):
    ACTIVE = "active"
    SOLD = "sold"
    EXPIRED = "expired"
    REMOVED = "removed"
    DRAFT = "draft"


@dataclass
class CanonicalProduct:
    """Single source of truth for a unique product across all sources."""

    name: str
    brand: str
    model: Optional[str] = None
    year: Optional[int] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None

    upc: Optional[str] = None
    ean: Optional[str] = None
    gtin: Optional[str] = None
    mpn: Optional[str] = None
    manufacturer_sku: Optional[str] = None

    specs: dict = field(default_factory=dict)
    primary_image: Optional[str] = None
    images: list[str] = field(default_factory=list)

    confidence: float = 0.0
    verified: bool = False
    listing_count: int = 0

    avg_price: Optional[float] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    msrp: Optional[float] = None

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def has_identifier(self) -> bool:
        return any([self.upc, self.ean, self.gtin, self.mpn, self.manufacturer_sku])

    def canonical_key(self) -> str:
        """Deterministic key for deduplication when no universal identifier exists."""
        parts = [
            (self.brand or "").strip().lower(),
            (self.model or "").strip().lower(),
            str(self.year or ""),
        ]
        return "|".join(parts)


@dataclass
class ProductListing:
    """A single product listing from a specific retailer/source."""

    raw_title: str
    retailer_name: str
    data_source_id: str

    canonical_product_id: Optional[str] = None
    source_product_id: Optional[str] = None
    source_url: Optional[str] = None
    retailer_url: Optional[str] = None
    retailer_location: Optional[str] = None

    raw_brand: Optional[str] = None
    raw_model: Optional[str] = None
    raw_year: Optional[int] = None
    raw_category: Optional[str] = None

    upc: Optional[str] = None
    ean: Optional[str] = None
    gtin: Optional[str] = None
    mpn: Optional[str] = None
    stock_number: Optional[str] = None
    vin: Optional[str] = None

    price: Optional[float] = None
    currency: str = "CAD"
    original_price: Optional[float] = None

    condition: Condition = Condition.INCONNU
    status: ListingStatus = ListingStatus.ACTIVE
    in_stock: bool = True
    quantity: int = 1

    description: Optional[str] = None
    specs: dict = field(default_factory=dict)
    images: list[str] = field(default_factory=list)
    raw_data: dict = field(default_factory=dict)

    match_method: Optional[str] = None
    match_confidence: float = 0.0

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    first_seen_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None

    def has_identifier(self) -> bool:
        return any([self.upc, self.ean, self.gtin, self.mpn, self.vin])


@dataclass
class ProductIdentifier:
    """Cross-reference entry linking an identifier to a canonical product."""

    canonical_product_id: str
    identifier_type: str   # 'upc', 'ean', 'gtin', 'mpn', 'sku', 'vin'
    identifier_value: str
    source: Optional[str] = None
    id: str = field(default_factory=lambda: str(uuid.uuid4()))


@dataclass
class MatchCandidate:
    """Proposed match between a listing and a canonical product, pending review."""

    listing_id: str
    canonical_product_id: str
    confidence: float
    match_method: str
    match_details: dict = field(default_factory=dict)
    reviewed: bool = False
    approved: Optional[bool] = None
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
