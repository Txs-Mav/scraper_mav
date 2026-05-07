"""
BrowserAgent — couche unique de rendu Playwright pour scraper_usine.

Inspirée de l'« Unlocker / Browser API » de Bright Data : un seul point d'entrée
qui encapsule rendering JS, stealth, retries, cookie consent et resource
blocking. Tous les callers (analyzer, api_interceptor, scrapers générés) tapent
cette couche au lieu de lancer Chromium eux-mêmes.

Pourquoi c'est nécessaire : la stratégie historique `wait_until="networkidle"`
timeoute systématiquement (20-25 s) sur les sites avec heartbeats permanents
(GA4, chat widgets, websockets). Ici on inverse — DCL d'abord, networkidle
bornée ensuite — et on borne le coût à ~12-16 s/page.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .stealth import (
    apply_stealth_to_playwright_context,
    random_user_agent,
)


# Liste centralisée — auparavant dans api_interceptor.py
COOKIE_DISMISS_SELECTORS: List[str] = [
    "button#onetrust-accept-btn-handler",
    "#onetrust-accept-btn-handler",
    "button#didomi-notice-agree-button",
    ".didomi-continue-without-agreeing",
    "button.qc-cmp2-summary-buttons button[mode='primary']",
    "button.qc-cmp2-accept-all",
    "#truste-consent-button",
    ".trustarc-agree-btn",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    "button[data-testid='uc-accept-all-button']",
    ".cky-btn-accept",
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


# Hostname fragments utilisés pour bloquer les requêtes tierces inutiles.
# Réduit le temps de rendu et augmente les chances d'atteindre networkidle.
TRACKER_PATTERNS: tuple = (
    "google-analytics", "googletagmanager", "googletagservices",
    "google.com/ads", "doubleclick", "googlesyndication",
    "facebook.com/tr", "facebook.net", "connect.facebook",
    "hotjar", "sentry.io", "newrelic", "datadog",
    "segment.io", "segment.com", "amplitude.com",
    "mixpanel.com", "fullstory", "intercom.io",
    "tagmanager", "gtm.js", "fbevents",
    "clarity.ms", "bing.com/bat", "linkedin.com/px",
)


@dataclass
class CapturedResponse:
    """Une réponse JSON capturée pendant un rendu (équivalent à ce que
    api_interceptor consomme)."""
    url: str
    method: str
    headers: Dict[str, str]
    request_body: Optional[str]
    request_body_json: Optional[Dict[str, Any]]
    data: Any


@dataclass
class RenderResult:
    """Résultat d'un appel à BrowserAgent.render()."""
    html: str = ""
    final_url: str = ""
    status: int = 0
    success: bool = False
    elapsed_ms: int = 0
    captured_responses: List[CapturedResponse] = field(default_factory=list)
    error: str = ""


class BrowserAgent:
    """Couche unique de rendu navigateur.

    Usage en context manager :

        with BrowserAgent() as agent:
            result = agent.render("https://example.com/", capture_responses=True)
            print(result.html)
            for cap in result.captured_responses:
                ...

    Usage manuel :

        agent = BrowserAgent()
        agent.start()
        try:
            result = agent.render(url)
        finally:
            agent.close()
    """

    DEFAULT_TIMEOUT_MS = 15000
    DEFAULT_NETWORKIDLE_MS = 4000
    POST_LOAD_WAIT_MS = 1500   # marge pour les requêtes XHR tardives

    def __init__(
        self,
        *,
        block_assets: bool = True,
        locale: str = "fr-CA",
        viewport: Optional[Dict[str, int]] = None,
        user_agent: Optional[str] = None,
        proxy: Optional[Dict[str, str]] = None,
        log_fn: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.block_assets = block_assets
        self.locale = locale
        self.viewport = viewport or {"width": 1366, "height": 800}
        self.user_agent = user_agent or random_user_agent()
        # Proxy : explicite > variable d'env > None
        self.proxy = proxy or self._proxy_from_env()
        self._log = log_fn or (lambda _msg: None)

        self._pw = None
        self._browser = None
        self._context = None
        self._started = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> "BrowserAgent":
        """Lance Playwright + Chromium + un BrowserContext stealth.
        Idempotent : ne fait rien si déjà démarré."""
        if self._started:
            return self
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise RuntimeError(f"Playwright non installé: {e}") from e

        t0 = time.time()
        self._pw = sync_playwright().start()
        self._log(f"[BrowserAgent] Playwright prêt ({time.time()-t0:.1f}s)")

        launch_kwargs: Dict[str, Any] = {
            "headless": True,
            "args": ["--disable-blink-features=AutomationControlled"],
        }
        if self.proxy:
            launch_kwargs["proxy"] = self.proxy

        t0 = time.time()
        self._browser = self._pw.chromium.launch(**launch_kwargs)
        self._log(f"[BrowserAgent] Chromium lancé ({time.time()-t0:.1f}s)")

        self._context = self._browser.new_context(
            user_agent=self.user_agent,
            locale=self.locale,
            viewport=self.viewport,
        )
        apply_stealth_to_playwright_context(self._context)
        self._started = True
        return self

    def close(self) -> None:
        """Ferme le browser et arrête Playwright. Idempotent."""
        if not self._started:
            return
        try:
            if self._context is not None:
                self._context.close()
        except Exception:
            pass
        try:
            if self._browser is not None:
                self._browser.close()
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

    def __enter__(self) -> "BrowserAgent":
        return self.start()

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    @property
    def started(self) -> bool:
        return self._started

    # ------------------------------------------------------------------
    # Rendu
    # ------------------------------------------------------------------

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
        dismiss_cookies: bool = True,
        post_load_wait_ms: Optional[int] = None,
    ) -> RenderResult:
        """Rend une URL avec stratégie DCL-first et retourne un RenderResult.

        Args:
            url : URL à rendre.
            timeout_ms : timeout dur pour la navigation (DCL).
            networkidle_ms : best-effort networkidle après DCL (0 = skip).
            capture_responses : si True, capture les réponses JSON pendant la nav.
            scroll : déclenche un scroll progressif (utile pour scroll infini).
            load_more_selector : si fourni, clique max_load_more_clicks fois.
            dismiss_cookies : tente de cliquer un bouton cookie consent.
            post_load_wait_ms : attente fixe après load (par défaut POST_LOAD_WAIT_MS).
        """
        if not self._started:
            self.start()

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

            t0 = time.time()
            response = self._smart_goto(
                page, url, timeout_ms=timeout_ms, networkidle_ms=networkidle_ms,
            )
            if response is None:
                result.error = "navigation failed"
                result.elapsed_ms = int((time.time() - t0) * 1000)
                return result

            result.status = response.status if hasattr(response, "status") else 0

            if dismiss_cookies:
                _dismiss_cookies(page)

            if scroll:
                _scroll_page(page, max_scrolls=max_scrolls)
                if load_more_selector:
                    _click_load_more(
                        page, load_more_selector, max_clicks=max_load_more_clicks,
                    )

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

            result.success = bool(result.html)
            result.elapsed_ms = int((time.time() - t0) * 1000)

            if capture_responses:
                result.captured_responses = [
                    CapturedResponse(
                        url=c["url"],
                        method=c["method"],
                        headers=c["headers"],
                        request_body=c.get("request_body"),
                        request_body_json=c.get("request_body_json"),
                        data=c["data"],
                    )
                    for c in captured
                ]

            return result
        finally:
            try:
                page.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Internes
    # ------------------------------------------------------------------

    def _smart_goto(self, page, url: str, *, timeout_ms: int, networkidle_ms: int):
        """Stratégie de navigation : DCL d'abord (rapide et fiable), puis
        networkidle bornée en best-effort. Évite le piège classique où
        networkidle timeoute pour son timeout complet."""
        try:
            response = page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        except Exception as e:
            self._log(f"[BrowserAgent] DCL échoué: {type(e).__name__}: {e}")
            return None

        if networkidle_ms > 0:
            try:
                page.wait_for_load_state("networkidle", timeout=networkidle_ms)
            except Exception:
                # networkidle non atteint : ce n'est pas une erreur, on continue
                # avec ce qu'on a déjà chargé.
                pass

        return response

    def _install_blocking_route(self, page) -> None:
        """Bloque images, fonts, médias et trackers tiers."""
        def _route_handler(route):
            try:
                req = route.request
                rtype = req.resource_type
                if rtype in ("image", "font", "media"):
                    return route.abort()
                url = req.url
                if any(pat in url for pat in TRACKER_PATTERNS):
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
        """Listener Playwright : capture les réponses JSON utiles."""
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
                "url": url,
                "method": req.method,
                "headers": dict(req.headers),
                "request_body": req_body,
                "request_body_json": req_body_json,
                "data": data,
            })
        except Exception:
            # On ne laisse jamais une erreur d'analyse de réponse couler le rendu.
            pass

    @staticmethod
    def _proxy_from_env() -> Optional[Dict[str, str]]:
        """Lit SCRAPER_PROXY_URL depuis l'environnement.
        Format attendu : http://user:pass@host:port (ou simple http://host:port).
        Retourne None si vide → pas de proxy."""
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


# ---------------------------------------------------------------------------
# Helpers page-level (réutilisés par render() et accessibles en standalone)
# ---------------------------------------------------------------------------


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
