"""
Phase 2 : StrategyPlanner -- Choisit la stratégie de scraping optimale.

Arbre de décision basé sur les résultats de l'analyse (Phase 1).
Priorité : API interne > JSON-LD > CSS > Gemini-assisted.
"""
from __future__ import annotations

from .models import (
    DiscoveryMethod, ExtractionMethod, PaginationMethod,
    PlatformType, PriceDisplayMode, RenderingMethod,
    ScrapingStrategy, SiteAnalysis, ThrottleConfig,
)


class StrategyPlanner:
    """Détermine la stratégie de scraping à partir d'un SiteAnalysis."""

    def __init__(self, verbose: bool = True):
        self.verbose = verbose

    def plan(self, analysis: SiteAnalysis) -> ScrapingStrategy:
        strategy = ScrapingStrategy()

        # --- Classe de base (héritage plateforme) ---
        strategy.base_class, strategy.base_class_import = self._pick_base_class(analysis)

        if strategy.base_class != "DedicatedScraper":
            strategy.needs_scrape_override = False
            strategy.needs_detail_pages = True
            strategy.discovery_method = DiscoveryMethod.SITEMAP
            strategy.pagination_method = PaginationMethod.SITEMAP_ONLY
            strategy.extraction_method = ExtractionMethod.JSON_LD
            strategy.rendering = RenderingMethod.REQUESTS
            self._log(f"Héritage plateforme → {strategy.base_class} (scraper minimal)")
            self._finalize(strategy, analysis)
            return strategy

        # --- Iframe inventaire tiers ---
        if analysis.has_iframe_inventory and analysis.iframe_src:
            strategy.discovery_method = DiscoveryMethod.IFRAME
            strategy.needs_scrape_override = True
            self._log("Iframe inventaire tiers détecté → IFRAME discovery")

        # --- API interne ---
        elif analysis.detected_apis:
            best_api = analysis.detected_apis[0]
            strategy.api_config = best_api
            strategy.discovery_method = DiscoveryMethod.API
            strategy.extraction_method = ExtractionMethod.API_JSON
            strategy.needs_scrape_override = True
            strategy.needs_detail_pages = False

            if best_api.pagination_param:
                strategy.pagination_method = PaginationMethod.API_OFFSET
            else:
                strategy.pagination_method = PaginationMethod.NONE

            if best_api.accessible_sans_browser:
                strategy.rendering = RenderingMethod.REQUESTS
                self._log(f"API interne détectée (accessible directement) → API_JSON via REQUESTS")
            else:
                strategy.rendering = RenderingMethod.PLAYWRIGHT
                self._log(f"API interne détectée (nécessite browser) → API_JSON via PLAYWRIGHT")

        # --- Scroll infini / Load More avec API interceptée ---
        elif (analysis.has_infinite_scroll or analysis.has_load_more_button) and analysis.detected_apis:
            best_api = analysis.detected_apis[0]
            strategy.api_config = best_api
            strategy.discovery_method = DiscoveryMethod.SCROLL_INTERCEPT
            strategy.pagination_method = PaginationMethod.SCROLL_CAPTURE
            strategy.extraction_method = ExtractionMethod.API_JSON
            strategy.rendering = RenderingMethod.PLAYWRIGHT
            strategy.needs_scrape_override = True
            strategy.needs_detail_pages = False
            self._log("Scroll/LoadMore + API interceptée → SCROLL_INTERCEPT")

        # --- Sitemap complet ---
        elif self._sitemap_is_complete(analysis):
            strategy.discovery_method = DiscoveryMethod.SITEMAP
            strategy.pagination_method = PaginationMethod.SITEMAP_ONLY
            strategy.needs_scrape_override = True
            strategy.needs_detail_pages = True

            if analysis.json_ld_available:
                strategy.extraction_method = ExtractionMethod.JSON_LD
                strategy.rendering = RenderingMethod.REQUESTS
            elif analysis.needs_playwright:
                strategy.extraction_method = ExtractionMethod.HYBRID
                strategy.rendering = RenderingMethod.PLAYWRIGHT
                self._log(f"  Site SPA avec sitemap: extraction Playwright requise pour pages detail")
            else:
                strategy.extraction_method = ExtractionMethod.CSS_SELECTORS
                strategy.rendering = RenderingMethod.REQUESTS

            self._log(f"Sitemap complet ({len(analysis.sitemap_urls)} URLs) → SITEMAP + "
                      f"{strategy.extraction_method.value} via {strategy.rendering.value}")

        # --- Listing-only (données VRAIMENT complètes, pas de JSON-LD dispo) ---
        elif self._listing_is_complete(analysis) and not analysis.json_ld_available:
            strategy.discovery_method = DiscoveryMethod.LISTING
            strategy.extraction_method = ExtractionMethod.LISTING_ONLY
            strategy.needs_scrape_override = True
            strategy.needs_detail_pages = False
            self._set_pagination(strategy, analysis)
            self._set_rendering(strategy, analysis)
            self._log("Données complètes sur listing (pas de JSON-LD) → LISTING_ONLY")

        # --- Listing + pages détail ---
        elif analysis.listing_pages:
            strategy.discovery_method = DiscoveryMethod.LISTING
            strategy.needs_scrape_override = True
            strategy.needs_detail_pages = True
            self._set_pagination(strategy, analysis)
            self._set_rendering(strategy, analysis)

            if analysis.json_ld_available:
                strategy.extraction_method = ExtractionMethod.JSON_LD
            elif analysis.selectors.detail_name.reliability >= 0.6:
                strategy.extraction_method = ExtractionMethod.CSS_SELECTORS
            else:
                strategy.extraction_method = ExtractionMethod.HYBRID

            self._log(f"Listing + détail → {strategy.extraction_method.value}")

        # --- Fallback ---
        else:
            strategy.discovery_method = DiscoveryMethod.LISTING
            strategy.extraction_method = ExtractionMethod.HYBRID
            strategy.rendering = RenderingMethod.PLAYWRIGHT
            strategy.needs_scrape_override = True
            self._log("Fallback → HYBRID + PLAYWRIGHT")

        self._finalize(strategy, analysis)
        return strategy

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _pick_base_class(self, analysis: SiteAnalysis) -> tuple:
        pt = analysis.platform.platform_type
        inheritable = analysis.platform.inheritable_scraper_class

        if pt == PlatformType.POWERGO_NEXTJS and inheritable:
            return inheritable, f"from .{_to_snake(inheritable)} import {inheritable}"

        return "DedicatedScraper", "from .base import DedicatedScraper"

    def _sitemap_is_complete(self, analysis: SiteAnalysis) -> bool:
        if len(analysis.sitemap_urls) < 5:
            return False
        total_estimated = sum(lp.estimated_products for lp in analysis.listing_pages)
        if total_estimated == 0:
            return len(analysis.sitemap_urls) >= 10
        return len(analysis.sitemap_urls) >= total_estimated * 0.8

    def _listing_is_complete(self, analysis: SiteAnalysis) -> bool:
        return any(lp.listing_data_completeness >= 0.8 for lp in analysis.listing_pages)

    def _set_pagination(self, strategy: ScrapingStrategy, analysis: SiteAnalysis) -> None:
        pt = analysis.platform.platform_type
        if pt == PlatformType.FACETWP:
            strategy.pagination_method = PaginationMethod.AJAX
        elif pt in (PlatformType.PRESTASHOP, PlatformType.WOOCOMMERCE, PlatformType.SHOPIFY):
            strategy.pagination_method = PaginationMethod.QUERY_PARAM
        elif analysis.has_infinite_scroll or analysis.has_load_more_button:
            strategy.pagination_method = PaginationMethod.SCROLL_CAPTURE
        else:
            strategy.pagination_method = PaginationMethod.QUERY_PARAM

    def _set_rendering(self, strategy: ScrapingStrategy, analysis: SiteAnalysis) -> None:
        if analysis.needs_playwright:
            strategy.rendering = RenderingMethod.PLAYWRIGHT
        elif strategy.pagination_method == PaginationMethod.SCROLL_CAPTURE:
            strategy.rendering = RenderingMethod.PLAYWRIGHT
        else:
            strategy.rendering = RenderingMethod.REQUESTS

    def _finalize(self, strategy: ScrapingStrategy, analysis: SiteAnalysis) -> None:
        strategy.selected_selectors = analysis.selectors
        strategy.language = "fr" if "fr" in analysis.language_versions else "fr"
        strategy.warm_up = analysis.warm_up_required

        if analysis.price_display_mode in (PriceDisplayMode.CALL_FOR_PRICE, PriceDisplayMode.NONE):
            strategy.price_absent_expected = True

        avg_ms = analysis.avg_response_time_ms
        if avg_ms > 3000:
            strategy.throttle_config = ThrottleConfig(delay=1.5, max_workers=3,
                                                      http_timeout=max(25, int(avg_ms * 3 / 1000)))
        elif avg_ms > 1000:
            strategy.throttle_config = ThrottleConfig(delay=0.5, max_workers=5,
                                                      http_timeout=max(20, int(avg_ms * 3 / 1000)))
        else:
            strategy.throttle_config = ThrottleConfig(delay=0.2, max_workers=8, http_timeout=20)

        self._log(f"Throttle: {strategy.throttle_config.max_workers} workers, "
                  f"{strategy.throttle_config.delay}s delay, {strategy.throttle_config.http_timeout}s timeout")

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [StrategyPlanner] {msg}")


def _to_snake(name: str) -> str:
    """PascalCase → snake_case (ex: MotoplexScraper → motoplex)."""
    s = name.replace("Scraper", "")
    return "".join(f"_{c.lower()}" if c.isupper() else c for c in s).lstrip("_")
