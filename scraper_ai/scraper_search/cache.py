"""
Cache TTL pour les inventaires scrapés.

Évite de re-scraper le même site à chaque recherche : le 1er hit pour un site
télécharge tout son inventaire et le stocke. Les recherches suivantes (dans la
fenêtre TTL) lisent depuis le cache.

Backend : fichiers JSON dans `scraper_cache/search_inventory/`.
Suffisant pour 50-200 sites. Pour scaler, remplacer par Redis ou Supabase.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "scraper_cache" / "search_inventory"

# TTL par défaut : 6h. Les inventaires de concessionnaires bougent peu intra-jour.
DEFAULT_TTL_SECONDS = 6 * 3600


class SearchCache:
    """Cache fichier thread-safe avec TTL."""

    _lock = threading.Lock()

    def __init__(self, ttl_seconds: int = DEFAULT_TTL_SECONDS):
        self.ttl_seconds = ttl_seconds
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def get(self, key: str, max_age_seconds: Optional[int] = None) -> Optional[List[Dict[str, Any]]]:
        """Lit le cache pour cette clé. Renvoie None si absent ou expiré."""
        path = self._path(key)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            ts = float(data.get("timestamp", 0))
            ttl = max_age_seconds if max_age_seconds is not None else self.ttl_seconds
            if time.time() - ts > ttl:
                return None
            products = data.get("products", [])
            return products if isinstance(products, list) else None
        except (json.JSONDecodeError, OSError, ValueError):
            return None

    def set(self, key: str, products: List[Dict[str, Any]]) -> None:
        """Écrit le cache. Idempotent."""
        path = self._path(key)
        payload = {
            "key": key,
            "timestamp": time.time(),
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

    def age_seconds(self, key: str) -> Optional[float]:
        """Âge en secondes du cache pour cette clé. None si absent."""
        path = self._path(key)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            ts = float(data.get("timestamp", 0))
            return time.time() - ts
        except Exception:
            return None

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
