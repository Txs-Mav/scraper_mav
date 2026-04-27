"""
FederatedSearch — orchestrateur de recherche multi-adapters.

Lance les adapters en parallèle (ThreadPoolExecutor), avec timeout par adapter,
gère les erreurs proprement, agrège, déduplique et trie les résultats.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FutTimeout
from typing import Iterable, List, Optional

from .adapters.base import AdapterError, SearchAdapter
from .models import AdapterRunStats, SearchHit, SearchQuery, SearchResult


class FederatedSearch:
    """Orchestrateur principal."""

    def __init__(self, adapters: List[SearchAdapter], *,
                 max_workers: int = 8,
                 default_timeout_per_adapter: int = 60,
                 verbose: bool = True):
        self.adapters = adapters
        self.max_workers = max_workers
        self.default_timeout = default_timeout_per_adapter
        self.verbose = verbose

    # ------------------------------------------------------------------
    # API publique
    # ------------------------------------------------------------------

    def search(self, query: SearchQuery, *,
               timeout_per_adapter: Optional[int] = None,
               total_timeout: Optional[int] = None) -> SearchResult:
        timeout = timeout_per_adapter or self.default_timeout
        total = total_timeout or (timeout * 2)

        # Pré-filtrage des adapters par pertinence pour la requête
        relevant = [a for a in self.adapters if a.applies_to(query)]
        skipped = len(self.adapters) - len(relevant)

        result = SearchResult(query=query)
        start = time.time()

        self._log(f"Recherche '{query.signature()}' sur {len(relevant)} sources "
                  f"({skipped} skip), timeout={timeout}s/adapter, total={total}s")

        all_hits: List[SearchHit] = []

        if not relevant:
            result.elapsed_seconds = time.time() - start
            return result

        with ThreadPoolExecutor(max_workers=min(self.max_workers, len(relevant))) as ex:
            future_to_adapter = {
                ex.submit(self._run_one, adapter, query, timeout): adapter
                for adapter in relevant
            }
            try:
                for fut in as_completed(future_to_adapter, timeout=total):
                    adapter = future_to_adapter[fut]
                    try:
                        stats, hits = fut.result(timeout=5)
                        result.adapters_run.append(stats)
                        all_hits.extend(hits)
                    except Exception as e:
                        result.adapters_run.append(AdapterRunStats(
                            name=adapter.name or type(adapter).__name__,
                            site=adapter.site_url,
                            error=f"{type(e).__name__}: {str(e)[:200]}",
                        ))
            except FutTimeout:
                # Adapters non terminés → marqués en erreur
                done_adapters = {fa for fa in future_to_adapter
                                 if future_to_adapter[fa] in [s.name for s in result.adapters_run]}
                for fut, adapter in future_to_adapter.items():
                    if not fut.done():
                        result.adapters_run.append(AdapterRunStats(
                            name=adapter.name or type(adapter).__name__,
                            site=adapter.site_url,
                            error=f"Total timeout dépassé ({total}s)",
                        ))
                        fut.cancel()

        # Dédup + tri global
        deduped = _dedup_hits(all_hits)
        deduped.sort(key=lambda h: h.score, reverse=True)
        result.hits = deduped[:query.max_results]
        result.total = len(deduped)
        result.elapsed_seconds = time.time() - start

        self._log(f"Terminé en {result.elapsed_seconds:.1f}s : {result.total} hits "
                  f"({result.adapters_succeeded}/{len(relevant)} sources OK, "
                  f"{result.cache_hits} cache)")
        return result

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _run_one(self, adapter: SearchAdapter, query: SearchQuery,
                 timeout: int) -> tuple:
        """Exécute UN adapter et retourne (stats, hits)."""
        stats = AdapterRunStats(
            name=adapter.name or type(adapter).__name__,
            site=adapter.site_url,
        )
        t0 = time.time()
        try:
            # Détection cache pour les DedicatedScraperAdapter (avant exécution)
            cache_age = None
            if hasattr(adapter, "cached_age_seconds"):
                try:
                    cache_age = adapter.cached_age_seconds()
                    if cache_age is not None:
                        stats.cache_hit = True
                except Exception:
                    pass

            hits = adapter.search(query, max_results=query.max_results)
            stats.hits_returned = len(hits)
            stats.duration_seconds = round(time.time() - t0, 2)
            self._log(f"  ✓ {stats.name}: {stats.hits_returned} hits "
                      f"en {stats.duration_seconds:.1f}s"
                      + (f" [cache {cache_age:.0f}s]" if stats.cache_hit and cache_age else ""))
            return stats, hits
        except AdapterError as e:
            stats.duration_seconds = round(time.time() - t0, 2)
            stats.error = str(e)
            self._log(f"  ✗ {stats.name}: {stats.error}")
            return stats, []
        except Exception as e:
            stats.duration_seconds = round(time.time() - t0, 2)
            stats.error = f"{type(e).__name__}: {str(e)[:200]}"
            self._log(f"  ✗ {stats.name} (CRASH): {stats.error}")
            return stats, []

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(f"[FedSearch] {msg}")


# ---------------------------------------------------------------------------
# Dédup
# ---------------------------------------------------------------------------

def _dedup_hits(hits: List[SearchHit]) -> List[SearchHit]:
    """Déduplique par source_url ; en cas de doublon, garde le score max."""
    by_url: dict = {}
    no_url: List[SearchHit] = []
    for h in hits:
        if not h.source_url:
            no_url.append(h)
            continue
        key = h.source_url.split("?")[0].rstrip("/").lower()
        if key not in by_url or h.score > by_url[key].score:
            by_url[key] = h
    return list(by_url.values()) + no_url
