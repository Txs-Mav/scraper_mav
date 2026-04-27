"""
Dataclasses pour le Scraper Usine.
Définit les structures de données échangées entre les 4 phases.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class PlatformType(Enum):
    PRESTASHOP = "prestashop"
    POWERGO_NEXTJS = "powergo_nextjs"
    WOOCOMMERCE = "woocommerce"
    FACETWP = "facetwp"
    SHOPIFY = "shopify"
    MAGENTO = "magento"
    BIGCOMMERCE = "bigcommerce"
    SQUARESPACE = "squarespace"
    WIX = "wix"
    WEBFLOW = "webflow"
    DEALERSOCKET = "dealersocket"
    D2C_MEDIA = "d2c_media"
    DEALER_COM = "dealer_com"
    DEALERINSPIRE = "dealerinspire"
    EDEALER = "edealer"
    GENERIC = "generic"


class DiscoveryMethod(Enum):
    API = "api"
    SITEMAP = "sitemap"
    LISTING = "listing"
    SCROLL_INTERCEPT = "scroll_intercept"
    IFRAME = "iframe"


class PaginationMethod(Enum):
    API_OFFSET = "api_offset"
    QUERY_PARAM = "query_param"
    AJAX = "ajax"
    SITEMAP_ONLY = "sitemap_only"
    SCROLL_CAPTURE = "scroll_capture"
    NONE = "none"


class ExtractionMethod(Enum):
    API_JSON = "api_json"
    JSON_LD = "json_ld"
    CSS_SELECTORS = "css_selectors"
    HYBRID = "hybrid"
    LISTING_ONLY = "listing_only"


class RenderingMethod(Enum):
    REQUESTS = "requests"
    PLAYWRIGHT = "playwright"


class PriceDisplayMode(Enum):
    VISIBLE = "visible"
    CALL_FOR_PRICE = "call_for_price"
    MIXED = "mixed"
    NONE = "none"


# ---------------------------------------------------------------------------
# Phase 1 : Analyse du site
# ---------------------------------------------------------------------------

@dataclass
class PlatformSignature:
    """Signature de détection pour une plateforme."""
    meta_generators: List[str] = field(default_factory=list)
    css_classes: List[str] = field(default_factory=list)
    cookies: List[str] = field(default_factory=list)
    headers: Dict[str, str] = field(default_factory=dict)
    url_patterns: List[str] = field(default_factory=list)
    file_probes: List[str] = field(default_factory=list)
    html_markers: List[str] = field(default_factory=list)


@dataclass
class PlatformRecipe:
    """Recette pré-configurée pour une plateforme connue."""
    platform_type: PlatformType = PlatformType.GENERIC
    name: str = ""
    version: str = ""
    signature: PlatformSignature = field(default_factory=PlatformSignature)
    default_pagination_param: str = ""
    default_listing_selector: str = ""
    default_item_selector: str = ""
    default_price_selector: str = ""
    default_sitemap_path: str = ""
    inheritable_scraper_class: Optional[str] = None


@dataclass
class DetectedAPI:
    """Endpoint API interne découvert par interception."""
    url: str = ""
    method: str = "GET"
    headers: Dict[str, str] = field(default_factory=dict)
    query_params: Dict[str, str] = field(default_factory=dict)
    request_body: Optional[str] = None              # body brut (POST/GraphQL)
    request_body_json: Optional[Dict] = None        # body parsé en JSON si possible
    response_sample: Optional[Dict] = None
    field_mapping: Dict[str, str] = field(default_factory=dict)
    pagination_param: str = ""
    pagination_type: str = ""                       # 'page' | 'offset' | 'cursor' | 'link'
    page_size: int = 0
    total_items_field: str = ""
    items_field: str = ""                           # chemin pointé pour items (ex: 'data.products')
    next_cursor_field: str = ""                     # chemin du curseur "next" (ex: 'pageInfo.endCursor')
    has_next_field: str = ""                        # chemin booléen ex: 'pageInfo.hasNextPage'
    accessible_sans_browser: bool = False
    is_graphql: bool = False
    graphql_query: str = ""
    graphql_operation: str = ""                     # nom de l'opération GraphQL
    graphql_variables: Dict = field(default_factory=dict)
    graphql_pagination_var: str = ""                # variable GraphQL pour pagination (ex: 'after')
    confidence: float = 0.0


@dataclass
class ListingPage:
    """Page de listing/inventaire découverte."""
    url: str = ""
    etat: str = ""
    source_categorie: str = ""
    estimated_products: int = 0
    listing_data_completeness: float = 0.0


@dataclass
class SelectorEntry:
    """Un sélecteur CSS avec son score de fiabilité."""
    selector: str = ""
    attribute: str = ""
    reliability: float = 0.0
    sample_values: List[str] = field(default_factory=list)


@dataclass
class SelectorMap:
    """Carte des sélecteurs CSS pour listing et detail."""
    listing_container: SelectorEntry = field(default_factory=SelectorEntry)
    listing_item: SelectorEntry = field(default_factory=SelectorEntry)
    listing_link: SelectorEntry = field(default_factory=SelectorEntry)
    listing_name: SelectorEntry = field(default_factory=SelectorEntry)
    listing_price: SelectorEntry = field(default_factory=SelectorEntry)
    listing_image: SelectorEntry = field(default_factory=SelectorEntry)
    listing_stock: SelectorEntry = field(default_factory=SelectorEntry)

    detail_name: SelectorEntry = field(default_factory=SelectorEntry)
    detail_price: SelectorEntry = field(default_factory=SelectorEntry)
    detail_brand: SelectorEntry = field(default_factory=SelectorEntry)
    detail_model: SelectorEntry = field(default_factory=SelectorEntry)
    detail_year: SelectorEntry = field(default_factory=SelectorEntry)
    detail_mileage: SelectorEntry = field(default_factory=SelectorEntry)
    detail_vin: SelectorEntry = field(default_factory=SelectorEntry)
    detail_color: SelectorEntry = field(default_factory=SelectorEntry)
    detail_image: SelectorEntry = field(default_factory=SelectorEntry)
    detail_description: SelectorEntry = field(default_factory=SelectorEntry)
    detail_state: SelectorEntry = field(default_factory=SelectorEntry)
    detail_specs: SelectorEntry = field(default_factory=SelectorEntry)

    image_attr: str = "src"

    # Champs génériques pour profils non-auto (immo, jobs, ecommerce…).
    # Clé = nom du champ FieldSpec (ex: 'address', 'company', 'sku').
    extra_fields: Dict[str, SelectorEntry] = field(default_factory=dict)

    def get_selector(self, field_name: str) -> Optional[SelectorEntry]:
        """Récupère un sélecteur par nom de champ logique (auto + extra_fields)."""
        mapping = {
            "name": "detail_name", "prix": "detail_price",
            "marque": "detail_brand", "modele": "detail_model",
            "annee": "detail_year", "kilometrage": "detail_mileage",
            "vin": "detail_vin", "couleur": "detail_color",
            "image": "detail_image", "description": "detail_description",
        }
        attr = mapping.get(field_name)
        if attr:
            entry = getattr(self, attr, None)
            if entry and entry.selector:
                return entry
        return self.extra_fields.get(field_name)


@dataclass
class SiteAnalysis:
    """Résultat complet de la Phase 1 (analyse du site)."""
    site_url: str = ""
    site_name: str = ""
    slug: str = ""
    domain: str = ""

    platform: PlatformRecipe = field(default_factory=PlatformRecipe)

    detected_apis: List[DetectedAPI] = field(default_factory=list)
    listing_pages: List[ListingPage] = field(default_factory=list)
    sitemap_urls: List[str] = field(default_factory=list)
    sitemap_xml_url: str = ""
    sitemap_index_urls: List[str] = field(default_factory=list)
    detail_url_pattern: str = ""
    sample_products: List[Dict[str, Any]] = field(default_factory=list)

    selectors: SelectorMap = field(default_factory=SelectorMap)
    selectors_by_category: Dict[str, SelectorMap] = field(default_factory=dict)
    json_ld_available: bool = False
    json_ld_type: str = ""

    needs_playwright: bool = False
    has_infinite_scroll: bool = False
    has_load_more_button: bool = False
    load_more_selector: str = ""
    has_iframe_inventory: bool = False
    iframe_src: str = ""
    has_ajax_modals: bool = False

    price_display_mode: PriceDisplayMode = PriceDisplayMode.VISIBLE

    encoding: str = "utf-8"
    needs_mojibake_fix: bool = False
    language_versions: Dict[str, str] = field(default_factory=dict)

    anti_bot: Optional[str] = None
    cookie_consent: bool = False
    avg_response_time_ms: float = 0.0
    warm_up_required: bool = False

    # Profil de domaine détecté ('auto' | 'ecommerce' | 'real_estate' | 'jobs' | 'generic')
    domain_profile_key: str = "auto"
    # Sélecteur racine "item de listing" détecté statistiquement (peut compléter selectors.listing_item)
    statistical_listing_selector: str = ""
    statistical_listing_count: int = 0
    # Indique si l'analyse a dû passer en mode Playwright pour cartographier
    playwright_used_in_phase1: bool = False

    analysis_timestamp: str = ""

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = _to_serializable(asdict(self))
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "SiteAnalysis":
        data = json.loads(path.read_text(encoding="utf-8"))
        return _from_dict(cls, data)


# ---------------------------------------------------------------------------
# Phase 2 : Stratégie
# ---------------------------------------------------------------------------

@dataclass
class ThrottleConfig:
    """Configuration de throttling pour le scraper généré."""
    delay: float = 0.3
    max_workers: int = 8
    http_timeout: int = 20


@dataclass
class ScrapingStrategy:
    """Résultat de la Phase 2 (plan de scraping)."""
    discovery_method: DiscoveryMethod = DiscoveryMethod.LISTING
    pagination_method: PaginationMethod = PaginationMethod.QUERY_PARAM
    extraction_method: ExtractionMethod = ExtractionMethod.CSS_SELECTORS
    rendering: RenderingMethod = RenderingMethod.REQUESTS

    base_class: str = "DedicatedScraper"
    base_class_import: str = "from .base import DedicatedScraper"
    needs_scrape_override: bool = True
    needs_detail_pages: bool = True

    throttle_config: ThrottleConfig = field(default_factory=ThrottleConfig)
    selected_selectors: SelectorMap = field(default_factory=SelectorMap)
    api_config: Optional[DetectedAPI] = None

    language: str = "fr"
    warm_up: bool = False
    price_absent_expected: bool = False


# ---------------------------------------------------------------------------
# Phase 3 : Génération
# ---------------------------------------------------------------------------

@dataclass
class GeneratedScraper:
    """Résultat de la Phase 3 (code généré)."""
    slug: str = ""
    class_name: str = ""
    module_name: str = ""
    file_path: str = ""
    code: str = ""
    strategy_summary: str = ""


# ---------------------------------------------------------------------------
# Phase 4 : Validation
# ---------------------------------------------------------------------------

@dataclass
class FieldCoverage:
    """Couverture d'un champ sur l'échantillon testé."""
    field_name: str = ""
    present_count: int = 0
    total_count: int = 0
    coverage: float = 0.0
    expected: bool = True
    sample_values: List[str] = field(default_factory=list)


@dataclass
class ValidationReport:
    """Rapport de validation de la Phase 4."""
    site_url: str = ""
    site_name: str = ""
    scraper_file: str = ""
    score: int = 0
    grade: str = ""
    products_tested: int = 0
    urls_attempted: int = 0
    soft_404_detected: int = 0
    success_rate: float = 0.0
    price_display_mode: str = ""
    field_coverage: Dict[str, float] = field(default_factory=dict)
    field_details: List[FieldCoverage] = field(default_factory=list)
    sample_products: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    strategy_used: str = ""
    platform_detected: str = ""
    execution_time_seconds: float = 0.0
    analysis_file: str = ""

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = _to_serializable(asdict(self))
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Sérialisation helpers
# ---------------------------------------------------------------------------

def _to_serializable(obj: Any) -> Any:
    """Convertit les Enums et objets non-sérialisables en types JSON."""
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, dict):
        return {k: _to_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_serializable(v) for v in obj]
    if isinstance(obj, Path):
        return str(obj)
    return obj


_ENUM_FIELDS = {
    'PriceDisplayMode': PriceDisplayMode,
    'DiscoveryMethod': DiscoveryMethod,
    'ExtractionMethod': ExtractionMethod,
    'PaginationMethod': PaginationMethod,
    'RenderingMethod': RenderingMethod,
    'PlatformType': PlatformType,
}


def _from_dict(cls, data: dict) -> Any:
    """Reconstruction depuis un dict JSON avec support complet des enums et dataclasses."""
    if not isinstance(data, dict):
        return data

    field_types = {f.name: f.type for f in cls.__dataclass_fields__.values()} if hasattr(cls, '__dataclass_fields__') else {}
    kwargs = {}
    for key, val in data.items():
        if key not in field_types:
            continue
        ft = field_types[key]

        if ft == 'PlatformRecipe' and isinstance(val, dict):
            if 'platform_type' in val:
                try:
                    val['platform_type'] = PlatformType(val['platform_type'])
                except ValueError:
                    val['platform_type'] = PlatformType.GENERIC
            if 'signature' in val and isinstance(val['signature'], dict):
                val['signature'] = PlatformSignature(**val['signature'])
            kwargs[key] = PlatformRecipe(**val)
        elif ft == 'SelectorMap' and isinstance(val, dict):
            sm_kwargs = {}
            for sk, sv in val.items():
                if sk == 'extra_fields' and isinstance(sv, dict):
                    sm_kwargs[sk] = {
                        ek: SelectorEntry(**ev) if isinstance(ev, dict) and 'selector' in ev else ev
                        for ek, ev in sv.items()
                    }
                elif isinstance(sv, dict) and 'selector' in sv:
                    sm_kwargs[sk] = SelectorEntry(**sv)
                else:
                    sm_kwargs[sk] = sv
            kwargs[key] = SelectorMap(**sm_kwargs)
        elif ft == 'ThrottleConfig' and isinstance(val, dict):
            kwargs[key] = ThrottleConfig(**val)
        elif 'List[DetectedAPI]' in str(ft) and isinstance(val, list):
            kwargs[key] = [DetectedAPI(**v) if isinstance(v, dict) else v for v in val]
        elif 'List[ListingPage]' in str(ft) and isinstance(val, list):
            kwargs[key] = [ListingPage(**v) if isinstance(v, dict) else v for v in val]
        elif 'List[FieldCoverage]' in str(ft) and isinstance(val, list):
            kwargs[key] = [FieldCoverage(**v) if isinstance(v, dict) else v for v in val]
        elif isinstance(val, str) and ft in _ENUM_FIELDS:
            try:
                kwargs[key] = _ENUM_FIELDS[ft](val)
            except ValueError:
                kwargs[key] = val
        elif ft == 'Optional[DetectedAPI]' and isinstance(val, dict):
            kwargs[key] = DetectedAPI(**val)
        else:
            kwargs[key] = val

    return cls(**kwargs)
