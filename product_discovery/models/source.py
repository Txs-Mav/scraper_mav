"""
Data source and ingestion run models.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional


class SourceType(str, Enum):
    MANUFACTURER_FEED = "manufacturer_feed"
    DISTRIBUTOR_API = "distributor_api"
    MARKETPLACE = "marketplace"
    GOOGLE_SHOPPING = "google_shopping"
    SCRAPER = "scraper"
    MANUAL = "manual"
    INDUSTRY_DATABASE = "industry_database"


class IngestionStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


@dataclass
class DataSource:
    """Represents an external data source for product discovery."""

    name: str
    source_type: SourceType
    base_url: Optional[str] = None
    config: dict = field(default_factory=dict)
    sync_frequency: timedelta = field(default_factory=lambda: timedelta(hours=24))
    is_active: bool = True
    total_products: int = 0
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    last_sync_at: Optional[datetime] = None


@dataclass
class IngestionRun:
    """Audit record for a single ingestion run from a data source."""

    data_source_id: str
    status: IngestionStatus = IngestionStatus.RUNNING

    products_fetched: int = 0
    products_new: int = 0
    products_updated: int = 0
    products_matched: int = 0
    products_unmatched: int = 0

    started_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None

    errors: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def complete(self, status: IngestionStatus = IngestionStatus.COMPLETED):
        self.status = status
        self.completed_at = datetime.utcnow()
        self.duration_seconds = (self.completed_at - self.started_at).total_seconds()
