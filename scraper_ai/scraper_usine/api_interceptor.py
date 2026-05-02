"""
Interception des API internes via Playwright.

Navigue sur les pages listing, capture les requêtes réseau XHR/fetch,
identifie celles qui retournent des données produit, et mappe les champs.
Gère aussi les popups cookie, le scroll infini et les boutons Load More.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

from .models import DetectedAPI
from .stealth import (
    apply_stealth_to_playwright_context, random_user_agent, stealth_headers,
)
from .url_utils import extract_path_field

PRODUCT_FIELD_SIGNALS = {
    "name", "nom", "title", "titre", "vehiclename", "vehicle_name",
    "prix", "price", "msrp", "cost", "saleprice", "sale_price", "askingprice",
    "brand", "marque", "make", "manufacturer", "brandname",
    "model", "modele", "modèle", "modelname", "model_name",
    "year", "annee", "année", "modelyear", "model_year",
    "sku", "vin", "vinnumber", "vin_number", "stocknumber", "stock_number",
    "image", "photo", "thumbnail", "img", "imageurl", "image_url", "mainphoto",
    "mileage", "kilometrage", "kilométrage", "km", "odometer",
    "trim", "trimlevel", "trim_level",
    "bodytype", "body_type", "vehicletype",
    "exteriorcolor", "exterior_color", "color", "couleur",
    "transmission", "drivetrain", "engine",
    "newused", "condition", "certified",
}

COOKIE_DISMISS_SELECTORS = [
    # OneTrust
    "button#onetrust-accept-btn-handler",
    "#onetrust-accept-btn-handler",
    # Didomi
    "button#didomi-notice-agree-button",
    ".didomi-continue-without-agreeing",
    # Quantcast Choice
    "button.qc-cmp2-summary-buttons button[mode='primary']",
    "button.qc-cmp2-accept-all",
    # TrustArc
    "#truste-consent-button",
    ".trustarc-agree-btn",
    # Cookiebot
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    # Usercentrics
    "button[data-testid='uc-accept-all-button']",
    # CookieYes
    ".cky-btn-accept",
    # Generic patterns
    "button[id*='cookie']",
    "button[id*='accept']",
    "button[class*='accept']",
    "button[aria-label*='accept' i]",
    "button[aria-label*='accepter' i]",
    ".cookie-consent button",
    ".cookie-banner button",
    "#cookie-notice button",
    "button.cc-accept",
    "[data-action='accept-cookies']",
    "[data-cookie-accept]",
    # Texte FR/EN
    "button:has-text('Accepter')",
    "button:has-text('Tout accepter')",
    "button:has-text('Accept all')",
    "button:has-text('Accept All')",
    "button:has-text('I Accept')",
    "button:has-text(\"J'accepte\")",
    "button:has-text(\"J'ACCEPTE\")",
    "button:has-text('OK')",
    "button:has-text('Got it')",
    "button:has-text('Allow all')",
    "button:has-text('I agree')",
]


def intercept_apis(
    listing_urls: List[str],
    *,
    scroll: bool = False,
    load_more_selector: str = "",
    cookie_consent: bool = False,
    timeout_ms: int = 20000,
) -> List[DetectedAPI]:
    """
    Navigue sur les pages listing avec Playwright et intercepte les API internes.
    Retourne les DetectedAPI trouvées, triées par confiance décroissante.
    """
    import time as _time

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        _log_api(f"[APIInterceptor] Playwright non installé ({e}), skip")
        return []
    except Exception as e:
        _log_api(f"[APIInterceptor] Erreur import Playwright: {type(e).__name__}: {e}")
        return []

    captured: List[Dict[str, Any]] = []
    _capture_count = {"json": 0, "skipped": 0}

    def _on_response(response):
        try:
            ct = response.headers.get("content-type", "")
            if "json" not in ct and "javascript" not in ct:
                return
            url = response.url
            if any(skip in url for skip in [
                "google", "facebook", "analytics", "hotjar", "sentry",
                "cloudflare", "fonts.", "recaptcha", ".css", ".js",
                "gtm.", "doubleclick", "adsense", "segment.io", "amplitude",
                "mixpanel", "newrelic", "datadog",
            ]):
                _capture_count["skipped"] += 1
                return
            if response.status != 200:
                return
            body = response.text()
            if not body or len(body) < 50:
                return
            data = json.loads(body)
            _capture_count["json"] += 1
            req = response.request
            # Capture le body POST/GraphQL pour pouvoir rejouer
            req_body = None
            req_body_json = None
            try:
                req_body = req.post_data
                if req_body:
                    try:
                        req_body_json = json.loads(req_body)
                    except (json.JSONDecodeError, TypeError):
                        pass
            except Exception:
                pass
            captured.append({
                "url": url,
                "method": req.method,
                "headers": dict(req.headers),
                "request_body": req_body,
                "request_body_json": req_body_json,
                "data": data,
            })
        except Exception:
            pass

    apis: List[DetectedAPI] = []

    _log_api("[APIInterceptor] Lancement Playwright (headless)...")
    t_start = _time.time()

    with sync_playwright() as p:
        _log_api(f"[APIInterceptor] Playwright prêt ({_time.time()-t_start:.1f}s), lancement Chromium...")
        t_browser = _time.time()
        browser = p.chromium.launch(headless=True,
                                    args=["--disable-blink-features=AutomationControlled"])
        _log_api(f"[APIInterceptor] Chromium lancé ({_time.time()-t_browser:.1f}s)")
        context = browser.new_context(
            user_agent=random_user_agent(),
            locale="fr-CA",
            viewport={"width": 1366, "height": 800},
        )
        apply_stealth_to_playwright_context(context)
        page = context.new_page()
        page.on("response", _on_response)

        for i, listing_url in enumerate(listing_urls[:3]):
            captured.clear()
            _capture_count["json"] = 0
            _capture_count["skipped"] = 0
            _log_api(f"[APIInterceptor] Navigation {i+1}/{min(3,len(listing_urls))}: {listing_url[:80]}...")
            t_nav = _time.time()
            try:
                page.goto(listing_url, timeout=timeout_ms, wait_until="networkidle")
                _log_api(f"[APIInterceptor]   networkidle en {_time.time()-t_nav:.1f}s "
                         f"({_capture_count['json']} JSON capturés, {_capture_count['skipped']} skippés)")
            except Exception as e:
                _log_api(f"[APIInterceptor]   networkidle échoué ({type(e).__name__}), retry domcontentloaded...")
                try:
                    page.goto(listing_url, timeout=timeout_ms, wait_until="domcontentloaded")
                    _log_api(f"[APIInterceptor]   domcontentloaded en {_time.time()-t_nav:.1f}s")
                except Exception as e2:
                    _log_api(f"[APIInterceptor]   Navigation échouée: {type(e2).__name__}: {e2}")
                    continue

            _log_api("[APIInterceptor]   Dismiss cookies...")
            _dismiss_cookies(page)

            if scroll:
                _log_api("[APIInterceptor]   Scroll page...")
                _scroll_page(page, max_scrolls=5)
                if load_more_selector:
                    _log_api(f"[APIInterceptor]   Click Load More: {load_more_selector}")
                    _click_load_more(page, load_more_selector, max_clicks=3)

            _log_api("[APIInterceptor]   Attente 2s pour requêtes tardives...")
            page.wait_for_timeout(2000)

            _log_api(f"[APIInterceptor]   {len(captured)} réponses JSON capturées, analyse...")
            for cap in captured:
                api = _analyze_captured_response(cap)
                if api:
                    _log_api(f"[APIInterceptor]   -> API trouvée: {cap['url'][:80]} "
                             f"(confiance={api.confidence:.0%}, {api.page_size} items)")
                    apis.append(api)

        _log_api("[APIInterceptor] Fermeture browser...")
        browser.close()

    _log_api(f"[APIInterceptor] Dédup {len(apis)} APIs...")
    merged = _deduplicate_apis(apis)

    for api in merged:
        _log_api(f"[APIInterceptor] Test accès direct: {api.url[:60]}...")
        api.accessible_sans_browser = _test_direct_access(api)
        _log_api(f"[APIInterceptor]   -> direct={api.accessible_sans_browser}")

    merged.sort(key=lambda a: a.confidence, reverse=True)
    total_elapsed = _time.time() - t_start
    _log_api(f"[APIInterceptor] Terminé en {total_elapsed:.1f}s — {len(merged)} API(s)")
    return merged


def _log_api(msg: str) -> None:
    print(f"  {msg}")


def _dismiss_cookies(page) -> None:
    for sel in COOKIE_DISMISS_SELECTORS:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                el.click()
                page.wait_for_timeout(500)
                return
        except Exception:
            continue


def _scroll_page(page, max_scrolls: int = 5) -> None:
    for _ in range(max_scrolls):
        try:
            page.evaluate("window.scrollBy(0, window.innerHeight)")
            page.wait_for_timeout(1500)
        except Exception:
            break


def _click_load_more(page, selector: str, max_clicks: int = 3) -> None:
    for _ in range(max_clicks):
        try:
            btn = page.query_selector(selector)
            if btn and btn.is_visible():
                btn.click()
                page.wait_for_timeout(2000)
            else:
                break
        except Exception:
            break


def _analyze_captured_response(cap: Dict[str, Any]) -> Optional[DetectedAPI]:
    """Analyse une réponse capturée pour déterminer si elle contient des données produit.
    Supporte GET, POST et GraphQL."""
    data = cap["data"]
    items = _find_product_array(data)
    if not items:
        return None

    sample = items[0] if items else {}
    if not isinstance(sample, dict):
        return None

    fields = set(str(k).lower().replace("_", "").replace("-", "") for k in sample.keys())
    flat_signals = {s.replace("_", "").replace("-", "") for s in PRODUCT_FIELD_SIGNALS}
    overlap = fields & flat_signals
    if len(overlap) < 2:
        return None

    # Mapping multi-domaine : auto + ecommerce + immo + jobs
    field_mapping = {}
    for orig_key in sample.keys():
        lower = str(orig_key).lower()
        # Communs
        if lower in ("name", "nom", "title", "titre", "vehiclename", "vehicle_name", "productname", "jobtitle"):
            field_mapping["name"] = orig_key
        elif lower in ("prix", "price", "msrp", "saleprice", "sale_price", "askingprice", "amount", "currentprice"):
            field_mapping["prix"] = orig_key
        elif lower in ("brand", "marque", "make", "manufacturer", "vendor", "brandname"):
            field_mapping["marque"] = orig_key
        elif lower in ("model", "modele", "modèle", "modelname", "model_name"):
            field_mapping["modele"] = orig_key
        elif lower in ("year", "annee", "année", "modelyear", "model_year", "yearbuilt"):
            field_mapping["annee"] = orig_key
        elif lower in ("image", "photo", "thumbnail", "img", "picture", "imageurl", "image_url",
                       "mainphoto", "featured_image"):
            field_mapping["image"] = orig_key
        elif lower in ("mileage", "kilometrage", "kilométrage", "km", "odometer"):
            field_mapping["kilometrage"] = orig_key
        elif lower in ("vin", "vinnumber", "vin_number"):
            field_mapping["vin"] = orig_key
        elif lower in ("color", "couleur", "colour", "exteriorcolor"):
            field_mapping["couleur"] = orig_key
        elif lower in ("description", "desc", "summary", "remarks", "publicremarks"):
            field_mapping["description"] = orig_key
        elif lower in ("sku", "mpn", "gtin", "stocknumber", "stock_number"):
            field_mapping["sku"] = orig_key
        elif lower in ("address", "addresstext", "fulladdress"):
            field_mapping["address"] = orig_key
        elif lower in ("city", "ville", "addresslocality"):
            field_mapping["city"] = orig_key
        elif lower in ("bedrooms", "beds", "chambres", "nbchambres"):
            field_mapping["bedrooms"] = orig_key
        elif lower in ("bathrooms", "baths", "sallesdebain", "nbsallesdebain"):
            field_mapping["bathrooms"] = orig_key
        elif lower in ("sqft", "area", "size", "superficie", "livingarea"):
            field_mapping["area_sqft"] = orig_key
        elif lower in ("company", "employer", "hiringorganization", "companyname"):
            field_mapping["company"] = orig_key
        elif lower in ("location", "joblocation"):
            field_mapping["location"] = orig_key

    confidence = min(1.0, len(overlap) / 5.0) * min(1.0, len(items) / 3.0)

    items_field = _find_items_field_path(data, items)
    pagination_param, pagination_type = _detect_api_pagination(cap["url"], data)

    # Sanitize l'URL : on retire les params de pagination/cursor capturés au
    # vol pour que le scraper généré démarre toujours à page=1 (sinon le
    # template hérite d'un ?page=2 baked-in).
    canonical_url = _strip_pagination_params(cap["url"])

    # Détection GraphQL : POST avec body contenant 'query' + 'variables' (souvent)
    method = cap.get("method", "GET")
    req_body = cap.get("request_body")
    req_body_json = cap.get("request_body_json")
    is_graphql = False
    graphql_query = ""
    graphql_op = ""
    graphql_vars: Dict[str, Any] = {}
    graphql_pagination_var = ""
    if method == "POST" and isinstance(req_body_json, dict):
        if "query" in req_body_json or "operationName" in req_body_json:
            is_graphql = True
            graphql_query = str(req_body_json.get("query", ""))[:8000]
            graphql_op = str(req_body_json.get("operationName", ""))
            graphql_vars = req_body_json.get("variables", {}) or {}
            for var_name in ("after", "cursor", "first", "page", "offset", "skip"):
                if var_name in graphql_vars:
                    graphql_pagination_var = var_name
                    break

    # Détection pagination cursor depuis la réponse (page-info GraphQL ou similaire)
    next_cursor_field, has_next_field = _detect_cursor_fields(data)
    if next_cursor_field and pagination_type != "cursor":
        pagination_type = "cursor"

    return DetectedAPI(
        url=canonical_url,
        method=method,
        headers={k: v for k, v in cap["headers"].items()
                 if k.lower() not in ("host", "connection", "accept-encoding")},
        request_body=req_body if isinstance(req_body, str) else None,
        request_body_json=req_body_json if isinstance(req_body_json, dict) else None,
        field_mapping=field_mapping,
        items_field=items_field,
        next_cursor_field=next_cursor_field,
        has_next_field=has_next_field,
        response_sample={k: _truncate(v) for k, v in sample.items()},
        page_size=len(items),
        pagination_param=pagination_param,
        pagination_type=pagination_type,
        is_graphql=is_graphql,
        graphql_query=graphql_query,
        graphql_operation=graphql_op,
        graphql_variables=graphql_vars,
        graphql_pagination_var=graphql_pagination_var,
        confidence=confidence,
    )


def _detect_cursor_fields(data: Any) -> tuple:
    """Détecte les chemins du curseur 'next' dans une réponse (style GraphQL Relay).
    Retourne (next_cursor_field, has_next_field) ou ('', '')."""
    paths_to_try = [
        ("pageInfo.endCursor", "pageInfo.hasNextPage"),
        ("data.pageInfo.endCursor", "data.pageInfo.hasNextPage"),
        ("nextCursor", "hasMore"),
        ("next_cursor", "has_more"),
        ("cursor.next", "cursor.hasNext"),
    ]
    for cursor_path, has_next_path in paths_to_try:
        if extract_path_field(data, cursor_path) is not None:
            return cursor_path, has_next_path
    return "", ""


def _find_product_array(data: Any, depth: int = 0) -> Optional[List[dict]]:
    """Cherche récursivement un tableau d'objets ressemblant à des produits."""
    if depth > 4:
        return None
    if isinstance(data, list) and len(data) >= 2:
        if all(isinstance(x, dict) for x in data[:5]):
            return data
    if isinstance(data, dict):
        for val in data.values():
            result = _find_product_array(val, depth + 1)
            if result:
                return result
    return None


def _find_items_field_path(data: Any, target_list: list, path: str = "") -> str:
    """Trouve le chemin JSON vers la liste d'items (ex: 'data.results')."""
    if isinstance(data, list) and data is target_list:
        return path.lstrip(".")
    if isinstance(data, dict):
        for key, val in data.items():
            result = _find_items_field_path(val, target_list, f"{path}.{key}")
            if result:
                return result
    return ""


_PAGINATION_QUERY_KEYS: tuple = (
    "page", "p", "offset", "skip", "start", "from",
    "cursor", "after", "before", "next",
    "_t", "timestamp", "_ts",  # cache-busters fréquents
)


def _strip_pagination_params(url: str) -> str:
    """Retire les params de pagination/cache-bust de l'URL capturée pour que le
    scraper généré démarre toujours à page=1."""
    from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
    if not url:
        return url
    parsed = urlparse(url)
    if not parsed.query:
        return url
    qs = parse_qs(parsed.query, keep_blank_values=True)
    cleaned = {k: v for k, v in qs.items() if k.lower() not in _PAGINATION_QUERY_KEYS}
    new_query = urlencode(cleaned, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def _detect_api_pagination(url: str, data: Any) -> tuple:
    """Détecte le mécanisme de pagination de l'API."""
    parsed = urlparse(url)
    params = dict(p.split("=", 1) for p in parsed.query.split("&") if "=" in p)

    for key in ("page", "offset", "skip", "cursor", "after", "start"):
        if key in params:
            return key, "offset" if key in ("offset", "skip", "start") else "page"

    if isinstance(data, dict):
        for key in ("next", "nextPage", "next_page", "cursor", "hasMore", "has_more"):
            if key in data:
                return key, "cursor"
        for key in ("total", "totalCount", "total_count", "totalPages", "total_pages"):
            if key in data:
                return "page", "page"

    return "", ""


def _test_direct_access(api: DetectedAPI) -> bool:
    """Teste si l'API est accessible directement avec requests (GET/POST/GraphQL)."""
    try:
        headers = dict(api.headers)
        # Cookies souvent nécessaires pour APIs authentifiées — on garde par défaut
        # sauf pour les sites où ils sont restreints. Stratégie : essayer d'abord SANS
        # cookie, puis fallback avec.
        method = (api.method or "GET").upper()
        for keep_cookie in (False, True):
            test_headers = dict(headers)
            if not keep_cookie:
                test_headers.pop("cookie", None)
                test_headers.pop("Cookie", None)
            try:
                if method == "POST":
                    resp = requests.post(
                        api.url, headers=test_headers, data=api.request_body,
                        timeout=10,
                    )
                else:
                    resp = requests.get(api.url, headers=test_headers, timeout=10)
                if resp.status_code == 200 and "json" in resp.headers.get("content-type", "").lower():
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


def _deduplicate_apis(apis: List[DetectedAPI]) -> List[DetectedAPI]:
    """Déduplique les APIs par URL de base (sans query params)."""
    seen: Dict[str, DetectedAPI] = {}
    for api in apis:
        base = urlparse(api.url)._replace(query="", fragment="").geturl()
        if base not in seen or api.confidence > seen[base].confidence:
            seen[base] = api
    return list(seen.values())


def _truncate(val: Any, max_len: int = 100) -> Any:
    if isinstance(val, str) and len(val) > max_len:
        return val[:max_len] + "..."
    return val
