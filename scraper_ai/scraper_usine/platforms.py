"""
Signatures et recettes pré-configurées pour les plateformes connues.
Chaque plateforme a des marqueurs de détection et des valeurs par défaut
pour la pagination, les sélecteurs, etc.
"""
from __future__ import annotations

import re
from typing import List, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from .models import (
    PlatformType, PlatformRecipe, PlatformSignature,
)

# ---------------------------------------------------------------------------
# Définitions des recettes
# ---------------------------------------------------------------------------

PLATFORM_RECIPES: List[PlatformRecipe] = [
    PlatformRecipe(
        platform_type=PlatformType.POWERGO_NEXTJS,
        name="PowerGO / Next.js",
        signature=PlatformSignature(
            html_markers=["__NEXT_DATA__", "cdn.powergo.ca", "pg-vehicle"],
            css_classes=["pg-vehicle-card", "pg-vehicle-price", "pg-vehicle-image"],
            file_probes=["/_next/data/", "/sitemaps/inventory-detail.xml"],
        ),
        default_sitemap_path="/sitemaps/inventory-detail.xml",
        default_listing_selector="div.pg-vehicle-card",
        default_item_selector="a.pg-vehicle-card",
        default_price_selector="div.pg-vehicle-price",
        inheritable_scraper_class="MotoplexScraper",
    ),
    PlatformRecipe(
        platform_type=PlatformType.PRESTASHOP,
        name="PrestaShop",
        signature=PlatformSignature(
            meta_generators=["PrestaShop"],
            css_classes=["product-miniature", "product-price-and-shipping"],
            cookies=["PrestaShop-"],
            url_patterns=["/module/", "/index.php?controller="],
        ),
        default_pagination_param="page",
        default_listing_selector="section#products",
        default_item_selector="article.product-miniature",
        default_price_selector=".product-price-and-shipping .price",
    ),
    PlatformRecipe(
        platform_type=PlatformType.FACETWP,
        name="FacetWP (WordPress)",
        signature=PlatformSignature(
            html_markers=["FWP_JSON", "fwp_paged", "facetwp-"],
            css_classes=["facetwp-facet", "facetwp-template"],
            url_patterns=["fwp_paged=", "fwp_per_page="],
        ),
        default_pagination_param="fwp_paged",
        default_listing_selector=".facetwp-template",
        default_item_selector=".product-list .item, .facetwp-template .item",
    ),
    PlatformRecipe(
        platform_type=PlatformType.WOOCOMMERCE,
        name="WooCommerce",
        signature=PlatformSignature(
            html_markers=["woocommerce", "wp-content"],
            css_classes=["woocommerce", "products", "product"],
            url_patterns=["/wp-json/wc/", "/product-category/", "/shop/"],
            file_probes=["/wp-json/wc/v3/products"],
        ),
        default_pagination_param="paged",
        default_listing_selector="ul.products",
        default_item_selector="li.product",
        default_price_selector=".price .woocommerce-Price-amount",
    ),
    PlatformRecipe(
        platform_type=PlatformType.SHOPIFY,
        name="Shopify",
        signature=PlatformSignature(
            html_markers=["Shopify.theme", "cdn.shopify.com"],
            css_classes=["shopify-section"],
            url_patterns=["/collections/", "/products/"],
            file_probes=["/products.json"],
        ),
        default_pagination_param="page",
        default_listing_selector=".collection-products",
        default_item_selector=".product-card",
        default_price_selector=".price",
    ),
    PlatformRecipe(
        platform_type=PlatformType.MAGENTO,
        name="Magento / Adobe Commerce",
        signature=PlatformSignature(
            html_markers=["Magento", "mage/cookies", "mage-init", "checkout/cart"],
            css_classes=["product-item-info", "products-grid", "product-image-wrapper"],
            cookies=["mage-cache-storage", "X-Magento-Vary", "PHPSESSID"],
            url_patterns=["/catalog/", "/customer/account/", "?p="],
            file_probes=["/rest/V1/products"],
        ),
        default_pagination_param="p",
        default_listing_selector="ol.products",
        default_item_selector="li.item.product",
        default_price_selector=".price-wrapper .price",
        default_sitemap_path="/sitemap.xml",
    ),
    PlatformRecipe(
        platform_type=PlatformType.BIGCOMMERCE,
        name="BigCommerce",
        signature=PlatformSignature(
            html_markers=["BCData", "bigcommerce.com/s-", "stencil-utils", "cdn11.bigcommerce.com"],
            css_classes=["card-figure", "productView", "productGrid"],
            url_patterns=["/products/", "/categories/"],
            file_probes=["/api/storefront/categories"],
        ),
        default_pagination_param="page",
        default_listing_selector="ul.productGrid",
        default_item_selector="li.product",
        default_price_selector=".price--withTax, .price--main",
        default_sitemap_path="/sitemap.xml",
    ),
    PlatformRecipe(
        platform_type=PlatformType.SQUARESPACE,
        name="Squarespace",
        signature=PlatformSignature(
            html_markers=["squarespace.com", "static1.squarespace.com",
                          "Static.SQUARESPACE_CONTEXT", "sqs-block"],
            css_classes=["sqs-block", "ProductList", "ProductItem", "product-block"],
            url_patterns=["/shop/", "/store/"],
        ),
        default_pagination_param="page",
        default_listing_selector=".ProductList",
        default_item_selector=".ProductList-item",
        default_price_selector=".product-price",
        default_sitemap_path="/sitemap.xml",
    ),
    PlatformRecipe(
        platform_type=PlatformType.WIX,
        name="Wix Stores",
        signature=PlatformSignature(
            html_markers=["wix.com", "wixstatic.com", "_wix_browser_sess",
                          "wixCodeBootstrap", "data-mesh-id"],
            css_classes=["wixui-", "data-product-gallery"],
            cookies=["XSRF-TOKEN", "ssr-caching", "svSession"],
            url_patterns=["/product-page/"],
        ),
        default_pagination_param="",
        default_listing_selector="[data-hook='product-list']",
        default_item_selector="[data-hook='product-list-grid-item']",
        default_price_selector="[data-hook='product-item-price-to-pay']",
    ),
    PlatformRecipe(
        platform_type=PlatformType.WEBFLOW,
        name="Webflow E-commerce",
        signature=PlatformSignature(
            html_markers=["webflow.com", "wf-loaded", "data-wf-page",
                          "uploads-ssl.webflow.com"],
            css_classes=["w-commerce-commerceaddtocartform",
                         "w-commerce-commercelayoutmain",
                         "w-dyn-list", "w-dyn-item"],
            url_patterns=["/product/", "/category/"],
        ),
        default_pagination_param="",
        default_listing_selector=".w-dyn-list",
        default_item_selector=".w-dyn-item",
        default_price_selector=".w-commerce-commerceproductprice",
        default_sitemap_path="/sitemap.xml",
    ),
    PlatformRecipe(
        platform_type=PlatformType.D2C_MEDIA,
        name="D2C Media / eDealer",
        signature=PlatformSignature(
            html_markers=["d2cmedia", "edealer", "d2c-", "edealer-"],
            css_classes=["vehicle-card", "inventory-listing", "vdp-", "srp-"],
            url_patterns=["/new/", "/used/", "/inventory/"],
        ),
    ),
    PlatformRecipe(
        platform_type=PlatformType.DEALER_COM,
        name="Dealer.com",
        signature=PlatformSignature(
            html_markers=["dealer.com", "dealercom", "ddc-"],
            css_classes=["ddc-content", "inventory-listing"],
            url_patterns=["dealer.com"],
        ),
    ),
    PlatformRecipe(
        platform_type=PlatformType.DEALERINSPIRE,
        name="DealerInspire",
        signature=PlatformSignature(
            html_markers=["dealerinspire", "di-page", "flavor-"],
            css_classes=["di-page", "flavor-inventory"],
        ),
    ),
    PlatformRecipe(
        platform_type=PlatformType.EDEALER,
        name="eDealer",
        signature=PlatformSignature(
            html_markers=["edealer", "e-dealer"],
            url_patterns=["/inventory/", "/new/", "/used/"],
        ),
    ),
    PlatformRecipe(
        platform_type=PlatformType.DEALERSOCKET,
        name="DealerSocket / Iframe tiers",
        signature=PlatformSignature(
            html_markers=["dealersocket", "dealercity", "dealer.com", "iframe"],
        ),
    ),
    PlatformRecipe(
        platform_type=PlatformType.GENERIC,
        name="Générique",
        signature=PlatformSignature(),
    ),
]

KNOWN_IFRAME_DOMAINS = [
    "dealersocket.com",
    "dealercity.com",
    "dealer.com",
    "cfrg.ca",
    "powergo.ca",
]


# ---------------------------------------------------------------------------
# Détection
# ---------------------------------------------------------------------------

def detect_platform(html: str, response_headers: dict, url: str) -> PlatformRecipe:
    """Détecte la plateforme du site à partir du HTML, des headers et de l'URL."""
    html_lower = html.lower()

    powergo_recipe = next((r for r in PLATFORM_RECIPES if r.platform_type == PlatformType.POWERGO_NEXTJS), None)
    if powergo_recipe:
        has_next = "__next_data__" in html_lower or "_next/static" in html_lower
        has_powergo = "powergo" in html_lower or "pg-vehicle" in html_lower
        if has_next and has_powergo:
            return powergo_recipe

    best_recipe = None
    best_score_ratio = 0.0

    for recipe in PLATFORM_RECIPES:
        if recipe.platform_type in (PlatformType.GENERIC, PlatformType.POWERGO_NEXTJS):
            continue
        sig = recipe.signature
        score = 0
        checks = 0

        for marker in sig.html_markers:
            checks += 1
            if marker.lower() in html_lower:
                score += 1

        for cls in sig.css_classes:
            checks += 1
            if cls.lower() in html_lower:
                score += 1

        for gen in sig.meta_generators:
            checks += 1
            if f'generator" content="{gen.lower()}' in html_lower or f"generator' content='{gen.lower()}" in html_lower:
                score += 1
            elif gen.lower() in html_lower:
                score += 0.5

        for cookie_prefix in sig.cookies:
            checks += 1
            cookie_header = response_headers.get("set-cookie", "")
            if cookie_prefix.lower() in cookie_header.lower():
                score += 1

        for pat in sig.url_patterns:
            checks += 1
            if pat.lower() in html_lower or pat.lower() in url.lower():
                score += 1

        if checks > 0:
            ratio = score / checks
            if ratio > best_score_ratio:
                best_score_ratio = ratio
                best_recipe = recipe

    if best_recipe and best_score_ratio >= 0.2:
        return best_recipe

    return PLATFORM_RECIPES[-1]  # GENERIC


def detect_iframe_inventory(soup: BeautifulSoup) -> Optional[str]:
    """Détecte si l'inventaire est dans un iframe tiers. Retourne le src ou None."""
    for iframe in soup.find_all("iframe"):
        src = iframe.get("src", "")
        if not src:
            continue
        parsed = urlparse(src)
        domain = parsed.netloc.replace("www.", "")
        for known in KNOWN_IFRAME_DOMAINS:
            if known in domain:
                return src
        if any(kw in src.lower() for kw in ["inventory", "inventaire", "vehicle", "vehicule"]):
            return src
    return None


def probe_sitemap(session: requests.Session, base_url: str, recipe: PlatformRecipe) -> tuple:
    """Essaie de trouver un sitemap utilisable. Retourne (product_urls, sitemap_xml_url)."""
    import time as _time

    parsed = urlparse(base_url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    candidates = []
    if recipe.default_sitemap_path:
        candidates.append(base + recipe.default_sitemap_path)
    candidates += [
        base + "/sitemap.xml",
        base + "/sitemap_index.xml",
        base + "/sitemaps/sitemap.xml",
        base + "/sitemap-inventory.xml",
        base + "/sitemaps/inventory.xml",
        base + "/sitemaps/inventory-detail.xml",
        base + "/sitemaps/vehicles.xml",
        base + "/sitemap-vehicles.xml",
        base + "/sitemap_vehicles.xml",
        base + "/robots.txt",
    ]

    product_urls = []
    found_xml_url = ""
    seen_sitemaps = set()

    for sitemap_url in candidates:
        if sitemap_url in seen_sitemaps:
            continue
        seen_sitemaps.add(sitemap_url)
        print(f"    [Sitemap] Probe: {sitemap_url[:80]}...")
        t0 = _time.time()
        try:
            resp = session.get(sitemap_url, timeout=15)
            if resp.status_code != 200:
                print(f"    [Sitemap]   -> {resp.status_code} ({_time.time()-t0:.1f}s)")
                continue
            ct = resp.headers.get("content-type", "")

            if sitemap_url.endswith("robots.txt"):
                for line in resp.text.splitlines():
                    line = line.strip()
                    if line.lower().startswith("sitemap:"):
                        sm_url = line.split(":", 1)[1].strip()
                        if sm_url and not sm_url.startswith("http"):
                            sm_url = base + ("" if sm_url.startswith("/") else "/") + sm_url
                        if sm_url and sm_url not in seen_sitemaps:
                            print(f"    [Sitemap]   -> robots.txt: trouvé {sm_url[:60]}")
                            candidates.append(sm_url)
                continue

            if "xml" not in ct and "<" not in resp.text[:100]:
                print(f"    [Sitemap]   -> pas XML (content-type={ct}) ({_time.time()-t0:.1f}s)")
                continue

            print(f"    [Sitemap]   -> 200 OK, {len(resp.text)} chars ({_time.time()-t0:.1f}s), parsing...")
            soup = BeautifulSoup(resp.text, "lxml-xml")

            sitemapindex = soup.find_all("sitemap")
            if sitemapindex:
                sub_urls = []
                for sm in sitemapindex:
                    loc = sm.find("loc")
                    if loc:
                        loc_url = loc.text.strip()
                        if loc_url and not loc_url.startswith("http"):
                            loc_url = base + ("" if loc_url.startswith("/") else "/") + loc_url
                        sub_urls.append(loc_url)

                prioritized = _prioritize_sitemaps(sub_urls)
                print(f"    [Sitemap]   -> sitemap-index avec {len(sub_urls)} sous-sitemaps, "
                      f"{len(prioritized)} retenus après filtrage")
                for su in prioritized:
                    if su not in seen_sitemaps:
                        candidates.append(su)
                continue

            url_tags = soup.find_all("url")
            before = len(product_urls)
            for url_tag in url_tags:
                loc = url_tag.find("loc")
                if loc:
                    u = loc.text.strip()
                    if _is_likely_product_url(u):
                        product_urls.append(u)
            added = len(product_urls) - before
            if added > 0 and not found_xml_url:
                found_xml_url = sitemap_url
            print(f"    [Sitemap]   -> {len(url_tags)} URLs totales, {added} produit(s) filtrées")
        except Exception as e:
            print(f"    [Sitemap]   -> Erreur: {type(e).__name__}: {e} ({_time.time()-t0:.1f}s)")
            continue

    result = list(dict.fromkeys(product_urls))
    result = _filter_language_duplicates(result)
    print(f"    [Sitemap] Total: {len(result)} URLs produit uniques (xml={found_xml_url[:60] if found_xml_url else 'none'})")
    return result, found_xml_url


def _prioritize_sitemaps(urls: List[str]) -> List[str]:
    """Filtre et priorise les sous-sitemaps d'un sitemap-index.
    Garde les sitemaps d'inventaire, exclut les comparaisons et doublons."""
    priority = []
    normal = []
    excluded = []

    for url in urls:
        url_lower = url.lower()
        if any(skip in url_lower for skip in ["compare", "comparison"]):
            excluded.append(url)
            continue
        if any(kw in url_lower for kw in [
            "inventory", "inventaire", "vehicle", "newinventory",
            "usedinventory", "demo",
        ]):
            priority.append(url)
        else:
            normal.append(url)

    if excluded:
        print(f"    [Sitemap]     Exclus: {len(excluded)} sitemaps de comparaison")

    return priority + normal


def _filter_language_duplicates(urls: List[str]) -> List[str]:
    """Si des URLs existent en /fr/ et /en/, garder seulement /fr/."""
    fr_urls = set()
    en_urls = set()
    other_urls = []

    for url in urls:
        path = urlparse(url).path.lower()
        if "/fr/" in path:
            fr_urls.add(url)
        elif "/en/" in path:
            en_urls.add(url)
        else:
            other_urls.append(url)

    if fr_urls and en_urls:
        print(f"    [Sitemap]   Langue: {len(fr_urls)} FR + {len(en_urls)} EN -> garder FR")
        return list(fr_urls) + other_urls
    elif en_urls and not fr_urls:
        return list(en_urls) + other_urls

    return urls


def _is_likely_product_url(url: str) -> bool:
    """Heuristique : l'URL ressemble-t-elle a une page produit/vehicule ?"""
    path = urlparse(url).path.lower()

    exclude = [
        "/blog", "/contact", "/about", "/a-propos", "/politique",
        "/privacy", "/terms", "/emploi", "/carrieres", "/nouvelles",
        "/news", "/tag/", "/category/", "/wp-content/", "/page/",
        "/css/", "/js/", "/images/", "/assets/", "/fonts/",
        "/login", "/account", "/cart", "/panier",
        ".pdf", ".jpg", ".png", ".gif", ".svg",
    ]
    for ex in exclude:
        if ex in path:
            return False

    include_signals = [
        # Powersports / motos
        "/neuf/", "/neufs/", "/occasion/", "/usage/", "/usages/",
        "/inventory/", "/inventaire/", "/vehicle/", "/vehicule/",
        "/moto/", "/motoneige/", "/vtt/", "/quad/", "/side-by-side/",
        "/product/", "/produit/", "/detail/",
        # Automobile dealers
        "/new/", "/used/", "/certified/", "/pre-owned/",
        "/cars/", "/trucks/", "/suv/", "/sedan/",
        "/voiture/", "/camion/", "/vus/",
        "/listing/", "/stock/", "/vin/",
    ]
    for sig in include_signals:
        if sig in path:
            return True

    if re.search(r'/(?:new|used|neuf|occasion)/\d{4}-', path):
        return True

    if re.search(r'/(?:new|used|neuf|occasion)/[A-Za-z]+-[A-Za-z]', path):
        return True

    segments = [s for s in path.split("/") if s]
    if len(segments) >= 2:
        last = segments[-1]
        if re.search(r'\d', last) and len(last) > 5:
            return True

    if path.endswith(".html") and re.search(r'\d{4}', path):
        return True

    return False
