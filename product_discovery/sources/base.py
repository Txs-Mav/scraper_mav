"""
Abstract base class for all product data sources.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import AsyncIterator

from ..models.product import ProductListing
from ..models.source import DataSource, IngestionRun, IngestionStatus

logger = logging.getLogger(__name__)


class BaseSource(ABC):
    """
    Contract for data source connectors.

    Each source implements:
    - fetch_listings(): yields ProductListing objects
    - test_connection(): validates credentials/connectivity
    """

    def __init__(self, source: DataSource):
        self.source = source
        self.config = source.config

    @abstractmethod
    async def fetch_listings(self) -> AsyncIterator[ProductListing]:
        """
        Yield product listings from this source.

        Implementations should handle pagination, rate limiting,
        and retries internally.
        """
        ...

    @abstractmethod
    async def test_connection(self) -> bool:
        """Verify that the source is reachable and credentials are valid."""
        ...

    async def run_ingestion(self) -> IngestionRun:
        """
        Execute a full ingestion run with tracking.
        Subclasses typically don't override this.
        """
        run = IngestionRun(data_source_id=self.source.id)
        logger.info(f"Starting ingestion from {self.source.name}")

        try:
            async for listing in self.fetch_listings():
                run.products_fetched += 1
                yield listing  # type: ignore[misc]
        except Exception as e:
            logger.error(f"Ingestion failed for {self.source.name}: {e}")
            run.errors.append({"error": str(e), "type": type(e).__name__})
            run.complete(IngestionStatus.FAILED)
            raise
        else:
            run.complete(IngestionStatus.COMPLETED)
            logger.info(
                f"Ingestion complete for {self.source.name}: "
                f"{run.products_fetched} products fetched"
            )
