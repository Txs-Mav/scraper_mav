"""
Cache TTL pour les inventaires scrapés.

Évite de re-scraper le même site à chaque recherche : le 1er hit pour un site
télécharge tout son inventaire et le stocke. Les recherches suivantes (dans la
fenêtre TTL) lisent depuis le cache.

Backend : fichiers JSON dans `scraper_cache/search_inventory/`, avec fallback
vers `scraped_site_data` (Supabase) rempli par le cron horaire.
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import requests
except Exception:  # pragma: no cover - garde si l'environnement minimal n'a pas requests
    requests = None

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "scraper_cache" / "search_inventory"

# TTL par défaut : 6h. Les inventaires de concessionnaires bougent peu intra-jour.
DEFAULT_TTL_SECONDS = 6 * 3600


class SearchCache:
    """Cache fichier thread-safe avec TTL."""

    _lock = threading.Lock()

    def __init__(self, ttl_seconds: int = DEFAULT_TTL_SECONDS):
        self.ttl_seconds = ttl_seconds
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def get(
        self,
        key: str,
        max_age_seconds: Optional[int] = None,
        aliases: Optional[List[str]] = None,
    ) -> Optional[List[Dict[str, Any]]]:
        """Lit le cache pour cette clé. Renvoie None si absent ou expiré."""
        path = self._path(key)
        cached: Optional[List[Dict[str, Any]]] = None
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                ts = float(data.get("timestamp", 0))
                ttl = max_age_seconds if max_age_seconds is not None else self.ttl_seconds
                if time.time() - ts <= ttl:
                    products = data.get("products", [])
                    cached = products if isinstance(products, list) else None
            except (json.JSONDecodeError, OSError, ValueError):
                cached = None
        if cached is not None:
            return cached

        supabase_entry = self._get_supabase_entry(
            self._candidate_keys(key, aliases),
            max_age_seconds=max_age_seconds if max_age_seconds is not None else self.ttl_seconds,
            include_products=True,
        )
        if supabase_entry is None:
            return None
        products, timestamp = supabase_entry
        self.set(key, products, timestamp=timestamp)
        return products

    def set(self, key: str, products: List[Dict[str, Any]], *, timestamp: Optional[float] = None) -> None:
        """Écrit le cache. Idempotent."""
        path = self._path(key)
        payload = {
            "key": key,
            "timestamp": timestamp if timestamp is not None else time.time(),
            "count": len(products),
            "products": products,
        }
        try:
            with self._lock:
                tmp = path.with_suffix(".tmp")
                tmp.write_text(
                    json.dumps(payload, ensure_ascii=False, default=str),
                    encoding="utf-8",
                )
                tmp.replace(path)
        except OSError:
            pass

    def age_seconds(self, key: str, aliases: Optional[List[str]] = None) -> Optional[float]:
        """Âge en secondes du cache pour cette clé. None si absent."""
        path = self._path(key)
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                ts = float(data.get("timestamp", 0))
                return time.time() - ts
            except Exception:
                pass

        supabase_entry = self._get_supabase_entry(
            self._candidate_keys(key, aliases),
            max_age_seconds=None,
            include_products=False,
        )
        if supabase_entry is None:
            return None
        _, timestamp = supabase_entry
        return time.time() - timestamp

    def invalidate(self, key: str) -> bool:
        """Supprime l'entrée. Renvoie True si supprimé."""
        path = self._path(key)
        if path.exists():
            try:
                path.unlink()
                return True
            except OSError:
                pass
        return False

    def list_keys(self) -> List[str]:
        return [p.stem for p in CACHE_DIR.glob("*.json")]

    def _path(self, key: str) -> Path:
        # Sanitize : seulement [a-z0-9-_]
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in key.lower())
        return CACHE_DIR / f"{safe}.json"

    def _candidate_keys(self, key: str, aliases: Optional[List[str]]) -> List[str]:
        candidates: List[str] = []
        for candidate in [key, *(aliases or [])]:
            if not candidate:
                continue
            normalized = str(candidate).strip().lower().replace("www.", "")
            if normalized and normalized not in candidates:
                candidates.append(normalized)
        return candidates

    def _get_supabase_entry(
        self,
        candidates: List[str],
        *,
        max_age_seconds: Optional[int],
        include_products: bool,
    ) -> Optional[tuple[List[Dict[str, Any]], float]]:
        """Lit le cache central `scraped_site_data` rempli par le cron horaire."""
        if requests is None or not candidates:
            return None

        supabase_url = (
            os.environ.get("SUPABASE_URL")
            or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
            or ""
        ).rstrip("/")
        supabase_key = (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_ANON_KEY")
            or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
            or ""
        )
        if not supabase_url or not supabase_key:
            return None

        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
        }
        select = "products,scraped_at,status" if include_products else "scraped_at,status"

        for candidate in candidates:
            try:
                resp = requests.get(
                    f"{supabase_url}/rest/v1/scraped_site_data",
                    params={
                        "select": select,
                        "site_domain": f"eq.{candidate}",
                        "limit": "1",
                    },
                    headers=headers,
                    timeout=10,
                )
                if resp.status_code != 200:
                    continue
                rows = resp.json()
                if not rows:
                    continue
                row = rows[0]
                if row.get("status") != "success":
                    continue

                timestamp = self._parse_timestamp(row.get("scraped_at"))
                if timestamp is None:
                    continue
                if max_age_seconds is not None and time.time() - timestamp > max_age_seconds:
                    continue

                if not include_products:
                    return [], timestamp

                products = row.get("products", [])
                if isinstance(products, list):
                    return products, timestamp
            except Exception:
                continue
        return None

    def _parse_timestamp(self, value: Any) -> Optional[float]:
        if not value:
            return None
        try:
            if isinstance(value, (int, float)):
                return float(value)
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except Exception:
            return None
