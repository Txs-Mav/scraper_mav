"""
Runtime navigateur pour les scrapers dédiés générés.

Pendant à `scraper_ai.scraper_usine.browser_agent.BrowserAgent` mais sans
dépendance à scraper_usine — un scraper généré peut importer ce module en
production sans embarquer toute la machinerie d'analyse.

Stratégie clé (identique à BrowserAgent) :
  - `wait_until="domcontentloaded"` en premier (timeout court),
  - `wait_for_load_state("networkidle", timeout=…)` ensuite en best-effort.

Évite de payer 20-25 s de timeout `networkidle` quand le site a des
heartbeats permanents (analytics, websockets, chat widgets).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"
)


_TRACKER_PATTERNS: tuple = (
    "google-analytics", "googletagmanager", "googletagservices",
    "google.com/ads", "doubleclick", "googlesyndication",
    "facebook.com/tr", "facebook.net", "connect.facebook",
    "hotjar", "sentry.io", "newrelic", "datadog",
    "segment.io", "segment.com", "amplitude.com",
    "mixpanel.com", "fullstory", "intercom.io",
    "tagmanager", "gtm.js", "fbevents",
    "clarity.ms", "bing.com/bat", "linkedin.com/px",
)


_STEALTH_INIT_SCRIPT = r"""
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'plugins', {
    get: () => [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'chrome-pdf-viewer' },
    ],
});
Object.defineProperty(navigator, 'languages', { get: () => ['fr-CA', 'fr', 'en-US', 'en'] });
if (!window.chrome) { window.chrome = { runtime: {} }; }
"""


@dataclass
class CapturedResponse:
    url: str
    method: str
    headers: Dict[str, str]
    request_body: Optional[str]
    request_body_json: Optional[Dict[str, Any]]
    data: Any


@dataclass
class RenderResult:
    html: str = ""
    final_url: str = ""
    status: int = 0
    success: bool = False
    elapsed_ms: int = 0
    captured_responses: List[CapturedResponse] = field(default_factory=list)
    error: str = ""


class BrowserRuntime:
    """Couche de rendu pour un scraper dédié.

    Usage typique dans un scraper généré :

        if not hasattr(self, '_browser'):
            self._browser = BrowserRuntime().start()
        html = self._browser.render(url).html
    """

    DEFAULT_TIMEOUT_MS = 15000
    DEFAULT_NETWORKIDLE_MS = 4000
    POST_LOAD_WAIT_MS = 1500

    def __init__(
        self,
        *,
        block_assets: bool = True,
        locale: str = "fr-CA",
        user_agent: Optional[str] = None,
        proxy: Optional[Dict[str, str]] = None,
        log_fn: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.block_assets = block_assets
        self.locale = locale
        self.user_agent = user_agent or _USER_AGENT
        self.proxy = proxy or self._proxy_from_env()
        self._log = log_fn or (lambda _msg: None)

        self._pw = None
        self._browser = None
        self._context = None
        self._started = False

    def start(self) -> "BrowserRuntime":
        if self._started:
            return self
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise RuntimeError(f"Playwright non installé: {e}") from e

        self._pw = sync_playwright().start()
        launch_kwargs: Dict[str, Any] = {
            "headless": True,
            "args": ["--disable-blink-features=AutomationControlled"],
        }
        if self.proxy:
            launch_kwargs["proxy"] = self.proxy

        self._browser = self._pw.chromium.launch(**launch_kwargs)
        self._context = self._browser.new_context(
            user_agent=self.user_agent,
            locale=self.locale,
            viewport={"width": 1366, "height": 800},
        )
        try:
            self._context.add_init_script(_STEALTH_INIT_SCRIPT)
        except Exception:
            pass
        self._started = True
        return self

    def close(self) -> None:
        if not self._started:
            return
        for closer in (self._context, self._browser):
            try:
                if closer is not None:
                    closer.close()
            except Exception:
                pass
        try:
            if self._pw is not None:
                self._pw.stop()
        except Exception:
            pass
        self._pw = None
        self._browser = None
        self._context = None
        self._started = False

    def __enter__(self) -> "BrowserRuntime":
        return self.start()

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    @property
    def started(self) -> bool:
        return self._started

    def render(
        self,
        url: str,
        *,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        networkidle_ms: int = DEFAULT_NETWORKIDLE_MS,
        capture_responses: bool = False,
        scroll: bool = False,
        max_scrolls: int = 5,
        load_more_selector: str = "",
        max_load_more_clicks: int = 3,
        post_load_wait_ms: Optional[int] = None,
    ) -> RenderResult:
        if not self._started:
            self.start()

        import time as _time

        result = RenderResult()
        post_load_wait_ms = (
            self.POST_LOAD_WAIT_MS if post_load_wait_ms is None else post_load_wait_ms
        )

        captured: List[Dict[str, Any]] = []
        page = self._context.new_page()

        try:
            if self.block_assets:
                self._install_blocking_route(page)
            if capture_responses:
                page.on("response", lambda r: self._on_response(r, captured))

            t0 = _time.time()
            try:
                response = page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
            except Exception as e:
                result.error = f"DCL failed: {type(e).__name__}: {e}"
                result.elapsed_ms = int((_time.time() - t0) * 1000)
                return result

            if networkidle_ms > 0:
                try:
                    page.wait_for_load_state("networkidle", timeout=networkidle_ms)
                except Exception:
                    pass

            if scroll:
                _scroll_page(page, max_scrolls=max_scrolls)
                if load_more_selector:
                    _click_load_more(page, load_more_selector, max_clicks=max_load_more_clicks)

            if post_load_wait_ms > 0:
                page.wait_for_timeout(post_load_wait_ms)

            try:
                result.html = page.content()
            except Exception as e:
                result.error = f"content failed: {type(e).__name__}: {e}"

            try:
                result.final_url = page.url
            except Exception:
                result.final_url = url

            result.status = response.status if response and hasattr(response, "status") else 0
            result.success = bool(result.html)
            result.elapsed_ms = int((_time.time() - t0) * 1000)

            if capture_responses:
                result.captured_responses = [
                    CapturedResponse(
                        url=c["url"], method=c["method"], headers=c["headers"],
                        request_body=c.get("request_body"),
                        request_body_json=c.get("request_body_json"),
                        data=c["data"],
                    ) for c in captured
                ]
            return result
        finally:
            try:
                page.close()
            except Exception:
                pass

    def _install_blocking_route(self, page) -> None:
        def _route_handler(route):
            try:
                req = route.request
                if req.resource_type in ("image", "font", "media"):
                    return route.abort()
                if any(pat in req.url for pat in _TRACKER_PATTERNS):
                    return route.abort()
                return route.continue_()
            except Exception:
                try:
                    return route.continue_()
                except Exception:
                    return None

        try:
            page.route("**/*", _route_handler)
        except Exception:
            pass

    def _on_response(self, response, captured: List[Dict[str, Any]]) -> None:
        try:
            ct = response.headers.get("content-type", "")
            if "json" not in ct and "javascript" not in ct:
                return
            url = response.url
            if any(skip in url for skip in (
                "google", "facebook", "analytics", "hotjar", "sentry",
                "cloudflare", "fonts.", "recaptcha", ".css", ".js",
                "gtm.", "doubleclick", "adsense", "segment.io", "amplitude",
                "mixpanel", "newrelic", "datadog",
            )):
                return
            if response.status != 200:
                return
            body = response.text()
            if not body or len(body) < 50:
                return
            data = json.loads(body)
            req = response.request
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
                "url": url, "method": req.method, "headers": dict(req.headers),
                "request_body": req_body, "request_body_json": req_body_json,
                "data": data,
            })
        except Exception:
            pass

    @staticmethod
    def _proxy_from_env() -> Optional[Dict[str, str]]:
        raw = os.environ.get("SCRAPER_PROXY_URL", "").strip()
        if not raw:
            return None
        proxy: Dict[str, str] = {"server": raw}
        user = os.environ.get("SCRAPER_PROXY_USER", "").strip()
        pwd = os.environ.get("SCRAPER_PROXY_PASS", "").strip()
        if user:
            proxy["username"] = user
        if pwd:
            proxy["password"] = pwd
        return proxy


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
