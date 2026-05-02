"""
url_filters — façade scraper_usine vers les helpers partagés.

Les fonctions canoniques vivent dans scraper_ai.dedicated_scrapers._usine_helpers
pour rester importables depuis le code généré sans dépendance circulaire.

Ce module expose la même API et ajoute des helpers propres à la Phase 1 d'analyse
(qui dépendent de SiteAnalysis / DomainProfile / PlatformRecipe).
"""
from __future__ import annotations

from typing import Iterable, List, Optional

from scraper_ai.dedicated_scrapers._usine_helpers import (
    build_paginated_url,
    classify_listing,
    classify_source_category,
    classify_state,
    extract_path_field,
    filter_language_duplicates,
    fix_mojibake,
    fix_mojibake_dict,
    is_product_url,
    normalize_url,
)

from .domain_profiles import DomainProfile
from .models import PlatformRecipe


def is_product_url_for_site(
    url: str,
    *,
    domain: str,
    profile: DomainProfile,
    platform: PlatformRecipe,
) -> bool:
    """Variant de is_product_url qui dérive automatiquement les paramètres
    depuis un DomainProfile + PlatformRecipe."""
    excluded = list(profile.excluded_paths or [])
    detail_patterns = list(profile.detail_url_patterns or [])
    extra_signals = list(platform.signature.url_patterns or [])
    return is_product_url(
        url,
        domain=domain,
        excluded_paths=excluded,
        detail_url_patterns=detail_patterns,
        extra_path_signals=extra_signals,
    )


def build_is_product_url_rules(
    profile: DomainProfile,
    platform: PlatformRecipe,
) -> dict:
    """Sérialise les règles 'URL produit' en JSON injectable dans un template
    Jinja. Le code généré reconstruira un _is_product_url paramétré.

    Retourne:
        {
            'excluded_paths': [...],
            'detail_url_patterns': [...],
            'extra_path_signals': [...],
        }
    """
    return {
        "excluded_paths": list(profile.excluded_paths or []),
        "detail_url_patterns": list(profile.detail_url_patterns or []),
        "extra_path_signals": list(platform.signature.url_patterns or []),
    }


__all__ = [
    "is_product_url",
    "is_product_url_for_site",
    "build_is_product_url_rules",
    "filter_language_duplicates",
    "classify_state",
    "classify_source_category",
    "classify_listing",
    "fix_mojibake",
    "fix_mojibake_dict",
    "build_paginated_url",
    "extract_path_field",
    "normalize_url",
]
