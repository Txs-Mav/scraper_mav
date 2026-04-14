"""
Pipeline orchestrator — coordinates multi-source ingestion runs.

Responsible for:
- Scheduling and running ingestion from all active sources
- Parallelizing independent source fetches
- Aggregating results and updating stats
- Error handling and retry logic
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

from ..models.source import DataSource, IngestionRun, IngestionStatus, SourceType
from ..sources.base import BaseSource
from ..sources.google_shopping import GoogleShoppingSource
from ..sources.manufacturer_feed import ManufacturerFeedSource
from ..sources.marketplace import MarketplaceSource
from ..sources.scraper_bridge import ScraperBridgeSource
from .ingestion import CatalogStore, IngestionPipeline

logger = logging.getLogger(__name__)

SOURCE_CONNECTORS: dict[SourceType, type[BaseSource]] = {
    SourceType.MANUFACTURER_FEED: ManufacturerFeedSource,
    SourceType.GOOGLE_SHOPPING: GoogleShoppingSource,
    SourceType.MARKETPLACE: MarketplaceSource,
    SourceType.SCRAPER: ScraperBridgeSource,
}


class PipelineOrchestrator:
    """
    Top-level controller for the product discovery pipeline.

    Usage:
        store = SupabaseCatalogStore(supabase_client)
        orchestrator = PipelineOrchestrator(store)

        # Run all active sources
        results = await orchestrator.run_all()

        # Run a specific source
        result = await orchestrator.run_source(source)
    """

    def __init__(
        self,
        store: CatalogStore,
        max_concurrent: int = 5,
    ):
        self.store = store
        self.pipeline = IngestionPipeline(store)
        self.max_concurrent = max_concurrent

    async def run_all(
        self, sources: list[DataSource]
    ) -> list[IngestionRun]:
        """Run ingestion for all provided sources with concurrency control."""
        active = [s for s in sources if s.is_active]
        logger.info(f"Starting pipeline for {len(active)} active sources")

        semaphore = asyncio.Semaphore(self.max_concurrent)
        tasks = [self._run_with_semaphore(semaphore, source) for source in active]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        runs = []
        for source, result in zip(active, results):
            if isinstance(result, Exception):
                logger.error(f"Source {source.name} failed: {result}")
                run = IngestionRun(data_source_id=source.id)
                run.errors.append({"error": str(result)})
                run.complete(IngestionStatus.FAILED)
                runs.append(run)
            else:
                runs.append(result)

        total_fetched = sum(r.products_fetched for r in runs)
        total_matched = sum(r.products_matched for r in runs)
        total_new = sum(r.products_new for r in runs)
        logger.info(
            f"Pipeline complete: {total_fetched} fetched, "
            f"{total_matched} matched, {total_new} new products"
        )

        return runs

    async def run_source(self, source: DataSource) -> IngestionRun:
        """Run ingestion for a single source."""
        connector_cls = SOURCE_CONNECTORS.get(source.source_type)
        if not connector_cls:
            raise ValueError(
                f"No connector for source type: {source.source_type}"
            )

        connector = connector_cls(source)

        connected = await connector.test_connection()
        if not connected:
            logger.error(f"Cannot connect to source: {source.name}")
            run = IngestionRun(data_source_id=source.id)
            run.errors.append({"error": "Connection test failed"})
            run.complete(IngestionStatus.FAILED)
            return run

        run = IngestionRun(data_source_id=source.id)

        try:
            async for listing in connector.fetch_listings():
                run.products_fetched += 1
                try:
                    await self.pipeline.process_listing(listing, run)
                except Exception as e:
                    logger.warning(
                        f"Failed to process listing '{listing.raw_title}': {e}"
                    )
                    run.errors.append({
                        "listing_title": listing.raw_title,
                        "error": str(e),
                    })
        except Exception as e:
            logger.error(f"Fetch failed for {source.name}: {e}")
            run.errors.append({"error": str(e), "phase": "fetch"})
            run.complete(IngestionStatus.FAILED)
            return run

        status = (
            IngestionStatus.COMPLETED
            if not run.errors
            else IngestionStatus.PARTIAL
        )
        run.complete(status)
        source.last_sync_at = datetime.utcnow()
        source.total_products = run.products_fetched

        return run

    async def _run_with_semaphore(
        self, semaphore: asyncio.Semaphore, source: DataSource
    ) -> IngestionRun:
        async with semaphore:
            return await self.run_source(source)

    async def run_scraper_bridge(
        self,
        products: list[dict],
        site_name: str,
        site_url: str,
    ) -> IngestionRun:
        """
        Convenience method to feed existing scraper output into the pipeline.
        Bridges the current scraper_ai system with the new product graph.
        """
        source = DataSource(
            name=f"scraper_{site_name}",
            source_type=SourceType.SCRAPER,
            base_url=site_url,
            config={
                "scraper_output": products,
                "site_name": site_name,
                "site_url": site_url,
            },
        )
        return await self.run_source(source)
