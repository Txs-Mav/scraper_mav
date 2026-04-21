"""
Phase 3 : ScraperCodeGenerator -- Génère le fichier Python du DedicatedScraper.

Utilise Jinja2 pour assembler des blocs de code (.py.j2) en un fichier
complet hérité de DedicatedScraper ou d'une classe plateforme.
Gère aussi la mise à jour de _generated_registry.py.
"""
from __future__ import annotations

import ast
import re
from datetime import date
from pathlib import Path
from typing import Any, Dict, Optional

from jinja2 import Environment, FileSystemLoader

from .models import (
    DiscoveryMethod, ExtractionMethod,
    GeneratedScraper, PaginationMethod, RenderingMethod,
    ScrapingStrategy, SiteAnalysis,
)

BLOCKS_DIR = Path(__file__).parent / "blocks"
DEDICATED_DIR = Path(__file__).resolve().parent.parent / "dedicated_scrapers"
GENERATED_REGISTRY_PATH = DEDICATED_DIR / "_generated_registry.py"


class ScraperCodeGenerator:
    """Génère un fichier DedicatedScraper complet à partir d'une SiteAnalysis + ScrapingStrategy."""

    def __init__(self, verbose: bool = True):
        self.verbose = verbose
        self.env = Environment(
            loader=FileSystemLoader(str(BLOCKS_DIR)),
            keep_trailing_newline=True,
            trim_blocks=True,
            lstrip_blocks=True,
        )

    def generate(self, analysis: SiteAnalysis, strategy: ScrapingStrategy) -> GeneratedScraper:
        slug = self._ensure_unique_slug(analysis.slug)
        class_name = self._slug_to_class(slug)
        module_name = slug.replace("-", "_")
        file_path = DEDICATED_DIR / f"{module_name}.py"

        context = self._build_context(analysis, strategy, slug, class_name)

        if strategy.base_class != "DedicatedScraper" and not strategy.needs_scrape_override:
            code = self._render_platform_child(context)
        else:
            code = self._render_full_scraper(context, strategy)

        self._validate_syntax(code, slug)

        file_path.write_text(code, encoding="utf-8")
        self._log(f"Scraper généré : {file_path}")

        self._update_generated_registry(slug, module_name, class_name, analysis.domain)

        return GeneratedScraper(
            slug=slug,
            class_name=class_name,
            module_name=module_name,
            file_path=str(file_path),
            code=code,
            strategy_summary=f"{strategy.discovery_method.value} + {strategy.extraction_method.value}",
        )

    # ------------------------------------------------------------------
    # Contexte pour les templates
    # ------------------------------------------------------------------

    def _build_context(self, analysis: SiteAnalysis, strategy: ScrapingStrategy,
                       slug: str, class_name: str) -> Dict[str, Any]:
        sel = strategy.selected_selectors

        listing_pages_dict = {}
        best_per_cat: Dict[str, int] = {}
        for lp in analysis.listing_pages:
            key = lp.source_categorie or "inventaire"
            if key not in best_per_cat or lp.estimated_products > best_per_cat[key]:
                best_per_cat[key] = lp.estimated_products
                listing_pages_dict[key] = {
                    "url": lp.url,
                    "etat": lp.etat,
                    "sourceCategorie": lp.source_categorie,
                }

        pagination_param = analysis.platform.default_pagination_param or "page"
        pagination_pattern = f"?{pagination_param}={{page_num}}"

        css_field_map = {
            "name": "detail_name",
            "prix": "detail_price",
            "marque": "detail_brand",
            "modele": "detail_model",
            "annee": "detail_year",
            "kilometrage": "detail_mileage",
            "couleur": "detail_color",
            "description": "detail_description",
        }
        css_selectors = {}
        for output_field, selector_attr in css_field_map.items():
            entry = getattr(sel, selector_attr, None)
            if entry and entry.selector:
                css_selectors[output_field] = entry.selector

        products_per_page = 12
        if analysis.platform.platform_type.value == "prestashop":
            products_per_page = 12
        elif analysis.platform.platform_type.value == "shopify":
            products_per_page = 24

        api_url = ""
        field_mapping = {}
        items_field = ""
        pagination_init = "page = 1"
        pagination_increment = "page += 1"
        pagination_url_part = ""
        api_page_size = 50

        if strategy.api_config:
            api = strategy.api_config
            api_url = api.url
            field_mapping = api.field_mapping
            items_field = api.items_field
            api_page_size = api.page_size or 50
            if api.pagination_param:
                pagination_url_part = f"&{api.pagination_param}={{page}}" if "?" in api_url else f"?{api.pagination_param}={{page}}"

        site_name = analysis.site_name or analysis.domain
        site_name = _fix_mojibake(site_name)

        return {
            "site_name": site_name,
            "site_domain": analysis.domain,
            "site_url": analysis.site_url,
            "slug": slug,
            "class_name": class_name,
            "base_class": strategy.base_class,
            "base_class_import": strategy.base_class_import,
            "platform_name": analysis.platform.name,
            "generation_date": date.today().isoformat(),
            "strategy_discovery": strategy.discovery_method.value,
            "strategy_extraction": strategy.extraction_method.value,

            "listing_pages_dict": listing_pages_dict,
            "products_per_page": products_per_page,
            "item_selector": sel.listing_item.selector or "article",
            "link_selector": sel.listing_link.selector or "a",
            "name_selector": sel.listing_name.selector or "",
            "price_selector": sel.listing_price.selector or "",
            "image_attr": sel.image_attr or "src",
            "pagination_pattern": pagination_pattern,
            "pagination_param": pagination_param,
            "request_delay": strategy.throttle_config.delay,
            "max_workers": strategy.throttle_config.max_workers,
            "http_timeout": strategy.throttle_config.http_timeout,

            "detail_name_selector": sel.detail_name.selector or "h1",
            "detail_image_selector": sel.detail_image.selector or "img.product-image, .main-image img, img",
            "css_selectors": css_selectors,

            "sitemap_candidates": repr([analysis.sitemap_xml_url]) if analysis.sitemap_xml_url else "[]",
            "sitemap_url": analysis.sitemap_xml_url or "",
            "language_filter": "fr" in analysis.language_versions and "en" in analysis.language_versions,

            "api_url": api_url,
            "field_mapping": field_mapping,
            "items_field": items_field,
            "pagination_init": pagination_init,
            "pagination_increment": pagination_increment,
            "pagination_url_part": pagination_url_part,
            "api_page_size": api_page_size,

            "extraction_method": strategy.extraction_method.value,
            "needs_state_classification": True,
            "warm_up": strategy.warm_up,
            "needs_mojibake_fix": analysis.needs_mojibake_fix,

            "extra_domain": "",
            "iframe_src": analysis.iframe_src or "",
        }

    # ------------------------------------------------------------------
    # Rendu
    # ------------------------------------------------------------------

    def _render_platform_child(self, ctx: Dict[str, Any]) -> str:
        tpl = self.env.get_template("platform_child.py.j2")
        return tpl.render(**ctx)

    def _render_full_scraper(self, ctx: Dict[str, Any], strategy: ScrapingStrategy) -> str:
        imports = self._build_imports(strategy)
        extra_attrs = self._build_extra_attrs(ctx, strategy)
        custom_init = self._build_custom_init(ctx, strategy)

        discovery_code = self._render_discovery(ctx, strategy)
        extraction_code = self._render_extraction(ctx, strategy)
        scrape_code = self._render_scrape_override(ctx, strategy)
        grouping_code = self.env.get_template("grouping.py.j2").render(**ctx)
        helpers_code = self.env.get_template("helpers.py.j2").render(**ctx)

        code = f'"""\nScraper dédié pour {ctx["site_name"]} ({ctx["site_domain"]}).\n'
        code += f'Généré par scraper_usine le {ctx["generation_date"]}.\n'
        code += f'Stratégie: {ctx["strategy_discovery"]} + {ctx["strategy_extraction"]}\n'
        code += f'Plateforme: {ctx["platform_name"]}\n"""\n'
        code += imports + "\n\n"
        code += f'{ctx["base_class_import"]}\n\n\n'
        code += f'class {ctx["class_name"]}({ctx["base_class"]}):\n\n'
        code += f'    SITE_NAME = "{ctx["site_name"]}"\n'
        code += f'    SITE_SLUG = "{ctx["slug"]}"\n'
        code += f'    SITE_URL = "{ctx["site_url"]}"\n'
        code += f'    SITE_DOMAIN = "{ctx["site_domain"]}"\n'
        code += extra_attrs + "\n"
        code += custom_init + "\n"
        code += discovery_code + "\n"
        code += extraction_code + "\n"
        code += scrape_code + "\n"
        code += grouping_code + "\n"
        code += helpers_code + "\n"

        return code

    def _build_imports(self, strategy: ScrapingStrategy) -> str:
        lines = [
            "import re",
            "import json",
            "import math",
            "import time",
        ]
        if strategy.rendering == RenderingMethod.REQUESTS:
            lines.append("import threading")
        lines += [
            "from typing import Dict, List, Optional, Any",
            "from urllib.parse import urljoin, urlparse",
            "from concurrent.futures import ThreadPoolExecutor, as_completed",
        ]
        if strategy.extraction_method != ExtractionMethod.API_JSON:
            lines.append("from bs4 import BeautifulSoup")

        return "\n".join(lines)

    def _build_extra_attrs(self, ctx: Dict, strategy: ScrapingStrategy) -> str:
        lines = []
        if strategy.discovery_method == DiscoveryMethod.LISTING:
            lines.append(f"\n    LISTING_PAGES = {_format_dict(ctx['listing_pages_dict'])}")
            lines.append(f"    PRODUCTS_PER_PAGE = {ctx['products_per_page']}")
        elif strategy.discovery_method == DiscoveryMethod.SITEMAP:
            if ctx.get("sitemap_url"):
                lines.append(f'    SITEMAP_URL = "{ctx["sitemap_url"]}"')
        elif strategy.discovery_method in (DiscoveryMethod.API, DiscoveryMethod.SCROLL_INTERCEPT):
            lines.append(f'    API_ENDPOINT = "{ctx["api_url"]}"')
            lines.append(f"    API_PAGE_SIZE = {ctx['api_page_size']}")
            if strategy.api_config and strategy.api_config.headers:
                safe_headers = {k: v for k, v in strategy.api_config.headers.items()
                                if k.lower() not in ("cookie", "host")}
                lines.append(f"    API_HEADERS = {repr(safe_headers)}")
            else:
                lines.append("    API_HEADERS = {}")
        if strategy.discovery_method == DiscoveryMethod.IFRAME and ctx.get("iframe_src"):
            lines.append(f'    IFRAME_SRC = "{ctx["iframe_src"]}"')
        lines.append(f"    WORKERS = {ctx['max_workers']}")
        lines.append(f"    HTTP_TIMEOUT = {ctx['http_timeout']}")
        return "\n".join(lines)

    def _build_custom_init(self, ctx: Dict, strategy: ScrapingStrategy) -> str:
        lines = ["    def __init__(self):", "        super().__init__()"]
        if strategy.rendering == RenderingMethod.REQUESTS:
            lines.append("        self._request_lock = threading.Lock()")
            lines.append("        self._last_request_time = 0.0")
        if ctx.get("warm_up"):
            lines.append("        self._warm_session()")
        return "\n".join(lines)

    def _render_discovery(self, ctx: Dict, strategy: ScrapingStrategy) -> str:
        dm = strategy.discovery_method
        if dm == DiscoveryMethod.SITEMAP:
            tpl = self.env.get_template("discovery_sitemap.py.j2")
        elif dm in (DiscoveryMethod.API, DiscoveryMethod.SCROLL_INTERCEPT):
            tpl = self.env.get_template("discovery_api.py.j2")
        elif dm == DiscoveryMethod.IFRAME:
            return self._render_iframe_discovery(ctx)
        else:
            tpl = self.env.get_template("discovery_listing.py.j2")
        return tpl.render(**ctx)

    def _render_iframe_discovery(self, ctx: Dict) -> str:
        iframe_src = ctx.get("iframe_src", "")
        return (
            "    def discover_product_urls(self, categories: List[str] = None) -> List[str]:\n"
            "        return []\n"
        )

    def _render_extraction(self, ctx: Dict, strategy: ScrapingStrategy) -> str:
        em = strategy.extraction_method
        if em == ExtractionMethod.API_JSON:
            tpl = self.env.get_template("extract_api.py.j2")
        elif em == ExtractionMethod.LISTING_ONLY:
            tpl = self.env.get_template("extract_listing_only.py.j2")
        else:
            tpl = self.env.get_template("extract_hybrid.py.j2")
        return tpl.render(**ctx)

    def _render_scrape_override(self, ctx: Dict, strategy: ScrapingStrategy) -> str:
        if not strategy.needs_scrape_override:
            return ""
        tpl = self.env.get_template("scrape_override.py.j2")
        return tpl.render(**ctx)

    # ------------------------------------------------------------------
    # Registry
    # ------------------------------------------------------------------

    def _update_generated_registry(self, slug: str, module: str, class_name: str, domain: str) -> None:
        header = "# AUTO-GENERE par scraper_usine. Ne pas modifier.\nGENERATED_SCRAPERS = {}\nGENERATED_DOMAINS = {}\n\n"

        entry = (
            f"try:\n"
            f"    from .{module} import {class_name}\n"
            f"    GENERATED_SCRAPERS['{slug}'] = {class_name}\n"
            f"    GENERATED_DOMAINS['{domain}'] = '{slug}'\n"
            f"except ImportError:\n"
            f"    pass\n\n"
        )

        if GENERATED_REGISTRY_PATH.exists():
            content = GENERATED_REGISTRY_PATH.read_text(encoding="utf-8")
            if f"from .{module} import" in content:
                self._log(f"Registry déjà à jour pour {slug}")
                return
            content += entry
        else:
            content = header + entry

        GENERATED_REGISTRY_PATH.write_text(content, encoding="utf-8")
        self._log(f"Registry mis à jour : {slug} -> {class_name}")

        self._ensure_registry_import()

    def _ensure_registry_import(self) -> None:
        registry_path = DEDICATED_DIR / "registry.py"
        if not registry_path.exists():
            return
        content = registry_path.read_text(encoding="utf-8")
        marker = "_generated_registry"
        if marker in content:
            return

        patch = (
            "\n\n# --- Scrapers générés par scraper_usine ---\n"
            "try:\n"
            "    from ._generated_registry import GENERATED_SCRAPERS, GENERATED_DOMAINS\n"
            "    _SCRAPERS.update(GENERATED_SCRAPERS)\n"
            "    _DOMAIN_MAP.update(GENERATED_DOMAINS)\n"
            "except ImportError:\n"
            "    pass\n"
        )
        content += patch
        registry_path.write_text(content, encoding="utf-8")
        self._log("registry.py patché pour importer _generated_registry")

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate_syntax(self, code: str, slug: str) -> None:
        try:
            compile(code, f"<generated:{slug}>", "exec")
        except SyntaxError as e:
            raise ValueError(f"Code généré invalide pour {slug}: {e}") from e

        tree = ast.parse(code)
        class_defs = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
        if not class_defs:
            raise ValueError(f"Aucune classe trouvée dans le code généré pour {slug}")

    # ------------------------------------------------------------------
    # Slugs
    # ------------------------------------------------------------------

    def _ensure_unique_slug(self, slug: str) -> str:
        existing = self._get_existing_slugs()
        if slug not in existing:
            return slug
        for i in range(2, 100):
            candidate = f"{slug}-{i}"
            if candidate not in existing:
                return candidate
        return slug

    def _get_existing_slugs(self) -> set:
        slugs = set()
        registry_path = DEDICATED_DIR / "registry.py"
        if registry_path.exists():
            for m in re.finditer(r"'([a-z0-9-]+)':\s*\w+Scraper", registry_path.read_text()):
                slugs.add(m.group(1))
        if GENERATED_REGISTRY_PATH.exists():
            for m in re.finditer(r"'([a-z0-9-]+)'", GENERATED_REGISTRY_PATH.read_text()):
                slugs.add(m.group(1))
        return slugs

    def _slug_to_class(self, slug: str) -> str:
        return "".join(word.capitalize() for word in slug.split("-")) + "Scraper"

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [Generator] {msg}")


def _format_dict(d: dict, indent: int = 8) -> str:
    """Formate un dict Python multi-lignes pour inclusion dans le code généré."""
    if not d:
        return "{}"
    pad = " " * indent
    lines = ["{"]
    for k, v in d.items():
        lines.append(f"{pad}'{k}': {repr(v)},")
    lines.append(f"{' ' * (indent - 4)}}}")
    return "\n".join(lines)


def _fix_mojibake(text: str) -> str:
    """Corrige les caracteres mojibake courants dans le texte."""
    fixes = [
        ("\xc3\xa9", "e"), ("\xc3\xa8", "e"), ("\xc3\xaa", "e"),
        ("\xc3\xa0", "a"), ("\xc3\xae", "i"), ("\xc3\xb4", "o"),
        ("\xc3\xb9", "u"), ("\xc3\xa7", "c"),
    ]
    for bad, good in fixes:
        text = text.replace(bad, good)
    try:
        text = text.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return text
