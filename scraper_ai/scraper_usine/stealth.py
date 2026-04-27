"""
Helpers anti-détection pour scraper_usine et les scrapers générés.

  - Pool d'User-Agents réalistes (Chrome/Firefox/Safari récents)
  - Headers complets cohérents avec l'UA (sec-ch-ua, sec-fetch-*)
  - Application stealth à un contexte Playwright (mode navigateur)

Note : pas de dépendance à playwright-stealth (lib externe). On applique les
contournements manuellement.
"""
from __future__ import annotations

import random
from typing import Dict, List, Optional


# Pool d'User-Agents desktop Windows/Mac récents (mis à jour 2026-Q1)
USER_AGENT_POOL: List[str] = [
    # Chrome 131 Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    # Chrome 132 Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    # Chrome 131 Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    # Edge 131 Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    # Firefox 133 Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    # Safari 18 Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.1 Safari/605.1.15",
]


def random_user_agent() -> str:
    """Renvoie un User-Agent aléatoire du pool."""
    return random.choice(USER_AGENT_POOL)


def stealth_headers(user_agent: Optional[str] = None,
                    referer: Optional[str] = None,
                    locale: str = "fr-CA,fr;q=0.9,en-US;q=0.7,en;q=0.5") -> Dict[str, str]:
    """
    Construit un set de headers réaliste et cohérent avec l'UA donné.
    Inclut sec-ch-ua/sec-fetch-* pour passer les checks anti-bot soft.
    """
    ua = user_agent or random_user_agent()
    is_chrome_like = "Chrome/" in ua and "Edg/" not in ua
    is_edge = "Edg/" in ua
    is_firefox = "Firefox/" in ua
    is_safari = "Safari/" in ua and "Chrome/" not in ua

    headers: Dict[str, str] = {
        "User-Agent": ua,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8,"
            "application/signed-exchange;v=b3;q=0.7"
        ),
        "Accept-Language": locale,
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none" if not referer else "same-origin",
        "Sec-Fetch-User": "?1",
        "DNT": "1",
    }

    # Client Hints uniquement Chromium-based
    if is_chrome_like or is_edge:
        chrome_version = _extract_version(ua, "Chrome/")
        major = chrome_version.split(".")[0] if chrome_version else "131"
        if is_edge:
            sec_ch = (
                f'"Microsoft Edge";v="{major}", "Chromium";v="{major}", '
                f'"Not_A Brand";v="24"'
            )
        else:
            sec_ch = (
                f'"Google Chrome";v="{major}", "Chromium";v="{major}", '
                f'"Not_A Brand";v="24"'
            )
        headers["sec-ch-ua"] = sec_ch
        headers["sec-ch-ua-mobile"] = "?0"
        platform = '"Windows"' if "Windows" in ua else '"macOS"' if "Macintosh" in ua else '"Linux"'
        headers["sec-ch-ua-platform"] = platform

    if referer:
        headers["Referer"] = referer

    return headers


def apply_stealth_to_playwright_context(context) -> None:
    """
    Applique des contournements anti-détection courants à un contexte Playwright.
    Doit être appelé juste après la création du contexte (avant new_page).

    Couvre :
      - navigator.webdriver = undefined
      - navigator.plugins / languages plausibles
      - chrome runtime stub
      - WebGL vendor/renderer
    """
    init_script = r"""
    // 1) Cacher navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2) Plugins & mimeTypes plausibles
    Object.defineProperty(navigator, 'plugins', {
        get: () => [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'chrome-pdf-viewer' },
        ],
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-CA', 'fr', 'en-US', 'en'] });

    // 3) Stub chrome runtime
    if (!window.chrome) {
        window.chrome = { runtime: {} };
    }

    // 4) WebGL vendor/renderer (Intel par défaut)
    try {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(p) {
            if (p === 37445) return 'Intel Inc.';
            if (p === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.apply(this, [p]);
        };
    } catch (e) {}

    // 5) Permissions API plus réaliste
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
        window.navigator.permissions.query = (parameters) =>
            parameters && parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : origQuery(parameters);
    }
    """
    try:
        context.add_init_script(init_script)
    except Exception:
        pass


def _extract_version(ua: str, marker: str) -> str:
    """Extrait '131.0.0.0' depuis '...Chrome/131.0.0.0 Safari...'."""
    idx = ua.find(marker)
    if idx < 0:
        return ""
    rest = ua[idx + len(marker):]
    end = rest.find(" ")
    return rest[:end] if end > 0 else rest
