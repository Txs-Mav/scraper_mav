"""Helpers HTTP partagés pour les scripts cron.

Fournit `request_with_retry` : un wrapper autour de requests qui retry
automatiquement sur les erreurs transitoires (timeout, 5xx, connexion
coupée). Essentiel pour les runners GitHub Actions où les cold starts
Supabase peuvent prendre >15 s.
"""

from __future__ import annotations

import time
from typing import Any, Optional

import requests
from requests import Response
from requests.exceptions import (
    ConnectionError as RequestsConnectionError,
    ReadTimeout,
    Timeout,
)

RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504, 520, 522, 524}
RETRYABLE_EXC = (ReadTimeout, Timeout, RequestsConnectionError)


def request_with_retry(
    method: str,
    url: str,
    *,
    max_attempts: int = 4,
    base_backoff: float = 2.0,
    timeout: float = 30.0,
    logger=None,
    **kwargs: Any,
) -> Optional[Response]:
    """Exécute une requête HTTP avec retry exponentiel sur erreurs transitoires.

    - max_attempts : nombre total de tentatives (1 = pas de retry).
    - base_backoff : délai initial (doublé à chaque retry, max 20 s).
    - timeout      : timeout de lecture par tentative (en secondes).

    Retourne la réponse (même si non-2xx et non-retryable) ou None si toutes
    les tentatives ont échoué sur exception.
    """
    last_exc: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        try:
            resp = requests.request(method, url, timeout=timeout, **kwargs)
        except RETRYABLE_EXC as e:
            last_exc = e
            if attempt >= max_attempts:
                if logger:
                    logger(f"   ❌ {method} {url.split('?')[0]}: {type(e).__name__} "
                           f"après {attempt} tentatives — abandon ({e})")
                return None
            delay = min(base_backoff * (2 ** (attempt - 1)), 20.0)
            if logger:
                logger(f"   ⏳ {method} {url.split('?')[0]}: {type(e).__name__} "
                       f"(tentative {attempt}/{max_attempts}) — retry dans {delay:.0f}s")
            time.sleep(delay)
            continue
        except Exception as e:
            if logger:
                logger(f"   ❌ {method} {url.split('?')[0]}: exception non-retryable — {e}")
            raise

        if resp.status_code in RETRYABLE_STATUS and attempt < max_attempts:
            delay = min(base_backoff * (2 ** (attempt - 1)), 20.0)
            if logger:
                logger(f"   ⏳ {method} {url.split('?')[0]}: HTTP {resp.status_code} "
                       f"(tentative {attempt}/{max_attempts}) — retry dans {delay:.0f}s")
            time.sleep(delay)
            continue

        return resp

    if last_exc and logger:
        logger(f"   ❌ {method} {url.split('?')[0]}: échec final — {last_exc}")
    return None


def get_with_retry(url: str, **kwargs: Any) -> Optional[Response]:
    return request_with_retry("GET", url, **kwargs)


def post_with_retry(url: str, **kwargs: Any) -> Optional[Response]:
    return request_with_retry("POST", url, **kwargs)
