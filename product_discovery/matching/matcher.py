"""
Multi-strategy product matcher.

Matches incoming product listings against the canonical product catalog
using a cascade of strategies from deterministic (identifiers) to
probabilistic (fuzzy title + specs).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional

from ..models.product import CanonicalProduct, MatchCandidate, ProductListing
from .normalizer import ProductNormalizer

logger = logging.getLogger(__name__)


@dataclass
class MatchResult:
    canonical_product: CanonicalProduct
    confidence: float
    method: str
    details: dict


# Confidence thresholds
AUTO_MATCH_THRESHOLD = 0.85    # auto-link without human review
CANDIDATE_THRESHOLD = 0.50     # add to review queue
IDENTIFIER_CONFIDENCE = 0.99   # exact identifier match


class ProductMatcher:
    """
    Cascading matcher that tries strategies in order of reliability:

    1. Exact identifier match (GTIN/UPC/EAN/MPN) → 0.99 confidence
    2. VIN match → 0.99 confidence
    3. Brand + model + year exact → 0.90 confidence
    4. Fuzzy title similarity → variable confidence
    5. Specs-based matching → variable confidence
    6. Composite score (weighted blend of title + specs + brand) → variable

    The first strategy that produces a result above AUTO_MATCH_THRESHOLD
    short-circuits the cascade and returns immediately.
    """

    def __init__(self):
        self.normalizer = ProductNormalizer()

    def match(
        self,
        listing: ProductListing,
        candidates: list[CanonicalProduct],
    ) -> Optional[MatchResult]:
        """Find the best canonical product match for a listing."""

        strategies = [
            self._match_by_identifier,
            self._match_by_vin,
            self._match_by_brand_model_year,
            self._match_by_title_similarity,
            self._match_composite,
        ]

        best: Optional[MatchResult] = None

        for strategy in strategies:
            result = strategy(listing, candidates)
            if result and result.confidence >= AUTO_MATCH_THRESHOLD:
                return result
            if result and (best is None or result.confidence > best.confidence):
                best = result

        return best

    def find_candidates(
        self,
        listing: ProductListing,
        catalog: list[CanonicalProduct],
    ) -> list[MatchCandidate]:
        """Return all potential matches above CANDIDATE_THRESHOLD for human review."""
        results: list[MatchCandidate] = []

        for canonical in catalog:
            result = self.match(listing, [canonical])
            if result and result.confidence >= CANDIDATE_THRESHOLD:
                results.append(
                    MatchCandidate(
                        listing_id=listing.id,
                        canonical_product_id=result.canonical_product.id,
                        confidence=result.confidence,
                        match_method=result.method,
                        match_details=result.details,
                    )
                )

        results.sort(key=lambda c: c.confidence, reverse=True)
        return results

    # ------------------------------------------------------------------
    # Strategy 1: Exact identifier match
    # ------------------------------------------------------------------
    def _match_by_identifier(
        self, listing: ProductListing, candidates: list[CanonicalProduct]
    ) -> Optional[MatchResult]:
        if not listing.has_identifier():
            return None

        id_pairs = [
            ("gtin", listing.gtin),
            ("upc", listing.upc),
            ("ean", listing.ean),
            ("mpn", listing.mpn),
        ]

        for id_type, listing_val in id_pairs:
            if not listing_val:
                continue
            norm_val = self.normalizer.normalize_identifier(listing_val)
            for candidate in candidates:
                candidate_val = self.normalizer.normalize_identifier(
                    getattr(candidate, id_type, None)
                )
                if candidate_val and norm_val == candidate_val:
                    return MatchResult(
                        canonical_product=candidate,
                        confidence=IDENTIFIER_CONFIDENCE,
                        method=f"identifier_{id_type}",
                        details={"identifier_type": id_type, "value": norm_val},
                    )
        return None

    # ------------------------------------------------------------------
    # Strategy 2: VIN match
    # ------------------------------------------------------------------
    def _match_by_vin(
        self, listing: ProductListing, candidates: list[CanonicalProduct]
    ) -> Optional[MatchResult]:
        if not listing.vin:
            return None

        norm_vin = self.normalizer.normalize_identifier(listing.vin)
        # VIN prefix (first 11 chars) encodes manufacturer + model + year
        vin_prefix = norm_vin[:11] if norm_vin and len(norm_vin) >= 11 else None
        if not vin_prefix:
            return None

        for candidate in candidates:
            if not candidate.specs:
                continue
            candidate_vin = candidate.specs.get("vin_prefix")
            if candidate_vin and candidate_vin == vin_prefix:
                return MatchResult(
                    canonical_product=candidate,
                    confidence=IDENTIFIER_CONFIDENCE,
                    method="vin_prefix",
                    details={"vin_prefix": vin_prefix},
                )
        return None

    # ------------------------------------------------------------------
    # Strategy 3: Brand + Model + Year
    # ------------------------------------------------------------------
    def _match_by_brand_model_year(
        self, listing: ProductListing, candidates: list[CanonicalProduct]
    ) -> Optional[MatchResult]:
        l_brand = self.normalizer.normalize_brand(listing.raw_brand)
        l_model = (listing.raw_model or "").strip().lower()
        l_year = listing.raw_year

        if not (l_brand and l_model):
            return None

        best: Optional[MatchResult] = None

        for candidate in candidates:
            c_brand = self.normalizer.normalize_brand(candidate.brand)
            c_model = (candidate.model or "").strip().lower()
            c_year = candidate.year

            if l_brand != c_brand:
                continue

            model_sim = SequenceMatcher(None, l_model, c_model).ratio()
            if model_sim < 0.80:
                continue

            year_match = (l_year == c_year) if (l_year and c_year) else True
            if not year_match:
                model_sim *= 0.7  # penalize year mismatch

            confidence = min(0.95, 0.70 + model_sim * 0.25)
            if year_match and model_sim > 0.95:
                confidence = 0.92

            if best is None or confidence > best.confidence:
                best = MatchResult(
                    canonical_product=candidate,
                    confidence=confidence,
                    method="brand_model_year",
                    details={
                        "brand": l_brand,
                        "model_similarity": round(model_sim, 3),
                        "year_match": year_match,
                    },
                )
        return best

    # ------------------------------------------------------------------
    # Strategy 4: Fuzzy title similarity
    # ------------------------------------------------------------------
    def _match_by_title_similarity(
        self, listing: ProductListing, candidates: list[CanonicalProduct]
    ) -> Optional[MatchResult]:
        norm_title = self.normalizer.normalize_title(listing.raw_title)
        if not norm_title:
            return None

        best: Optional[MatchResult] = None

        for candidate in candidates:
            candidate_title = self.normalizer.normalize_title(candidate.name)
            ratio = SequenceMatcher(None, norm_title, candidate_title).ratio()

            # Token overlap bonus: measures how many meaningful tokens are shared
            listing_tokens = set(norm_title.split())
            candidate_tokens = set(candidate_title.split())
            if listing_tokens and candidate_tokens:
                overlap = len(listing_tokens & candidate_tokens)
                total = len(listing_tokens | candidate_tokens)
                jaccard = overlap / total
            else:
                jaccard = 0.0

            confidence = ratio * 0.6 + jaccard * 0.4

            if confidence >= CANDIDATE_THRESHOLD and (
                best is None or confidence > best.confidence
            ):
                best = MatchResult(
                    canonical_product=candidate,
                    confidence=round(confidence, 3),
                    method="title_similarity",
                    details={
                        "sequence_ratio": round(ratio, 3),
                        "jaccard_similarity": round(jaccard, 3),
                        "normalized_listing_title": norm_title,
                        "normalized_candidate_title": candidate_title,
                    },
                )
        return best

    # ------------------------------------------------------------------
    # Strategy 5: Composite score
    # ------------------------------------------------------------------
    def _match_composite(
        self, listing: ProductListing, candidates: list[CanonicalProduct]
    ) -> Optional[MatchResult]:
        """
        Weighted combination of multiple signals. Used as fallback when
        no single strategy reaches AUTO_MATCH_THRESHOLD alone.
        """
        best: Optional[MatchResult] = None

        for candidate in candidates:
            scores: dict[str, float] = {}

            # Brand score
            l_brand = self.normalizer.normalize_brand(listing.raw_brand)
            c_brand = self.normalizer.normalize_brand(candidate.brand)
            scores["brand"] = 1.0 if (l_brand and c_brand and l_brand == c_brand) else 0.0

            # Model score
            l_model = (listing.raw_model or "").strip().lower()
            c_model = (candidate.model or "").strip().lower()
            scores["model"] = (
                SequenceMatcher(None, l_model, c_model).ratio()
                if l_model and c_model
                else 0.0
            )

            # Year score
            if listing.raw_year and candidate.year:
                diff = abs(listing.raw_year - candidate.year)
                scores["year"] = max(0, 1.0 - diff * 0.5)
            else:
                scores["year"] = 0.5  # neutral when unknown

            # Title score
            norm_l = self.normalizer.normalize_title(listing.raw_title)
            norm_c = self.normalizer.normalize_title(candidate.name)
            scores["title"] = SequenceMatcher(None, norm_l, norm_c).ratio() if norm_l and norm_c else 0.0

            # Specs overlap score
            scores["specs"] = self._specs_similarity(listing.specs, candidate.specs)

            # Category score
            l_cat = self.normalizer.normalize_category(listing.raw_category)
            c_cat = self.normalizer.normalize_category(candidate.category)
            scores["category"] = 1.0 if (l_cat and c_cat and l_cat == c_cat) else 0.0

            # Weighted combination
            weights = {
                "brand": 0.25,
                "model": 0.25,
                "year": 0.15,
                "title": 0.15,
                "specs": 0.10,
                "category": 0.10,
            }
            confidence = sum(scores[k] * weights[k] for k in weights)

            if confidence >= CANDIDATE_THRESHOLD and (
                best is None or confidence > best.confidence
            ):
                best = MatchResult(
                    canonical_product=candidate,
                    confidence=round(confidence, 3),
                    method="composite",
                    details={
                        "scores": {k: round(v, 3) for k, v in scores.items()},
                        "weights": weights,
                    },
                )
        return best

    @staticmethod
    def _specs_similarity(specs_a: dict, specs_b: dict) -> float:
        if not specs_a or not specs_b:
            return 0.0
        common_keys = set(specs_a.keys()) & set(specs_b.keys())
        if not common_keys:
            return 0.0
        matches = sum(
            1
            for k in common_keys
            if str(specs_a[k]).strip().lower() == str(specs_b[k]).strip().lower()
        )
        return matches / len(common_keys)
