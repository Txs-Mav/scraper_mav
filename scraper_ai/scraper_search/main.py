"""
CLI scraper_search — recherche fédérée multi-sites.

Usage :
  python -m scraper_ai.scraper_search.main "KTM SX 150 2026"
  python -m scraper_ai.scraper_search.main "Honda Civic 2022 < 25000$"
  python -m scraper_ai.scraper_search.main "Yamaha YZ250F" --max-age 3600
  python -m scraper_ai.scraper_search.main "Ski-Doo MXZ 850" --json
  python -m scraper_ai.scraper_search.main "KTM SX 150" --only moto-ducharme,motoplex
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import List, Optional

from .adapters.dedicated import build_all_dedicated_adapters
from .cache import DEFAULT_TTL_SECONDS, SearchCache
from .federation import FederatedSearch
from .models import SearchQuery
from .query_parser import parse_query


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        prog="scraper_search",
        description="Recherche fédérée d'un produit sur tous les sites accessibles.",
    )
    parser.add_argument("query", nargs="*", help="Requête en langage naturel")
    parser.add_argument("--max-results", type=int, default=50,
                        help="Nombre max de résultats à retourner (défaut 50)")
    parser.add_argument("--min-score", type=float, default=0.3,
                        help="Score minimum de pertinence (0..1, défaut 0.3)")
    parser.add_argument("--max-age", type=int, default=DEFAULT_TTL_SECONDS,
                        help=f"Âge max du cache d'inventaire en secondes (défaut {DEFAULT_TTL_SECONDS}=6h)")
    parser.add_argument("--timeout", type=int, default=60,
                        help="Timeout par adapter en secondes (défaut 60)")
    parser.add_argument("--workers", type=int, default=8,
                        help="Nb d'adapters en parallèle (défaut 8)")
    parser.add_argument("--only", metavar="SLUGS",
                        help="Liste de slugs séparés par virgules (ex: moto-ducharme,motoplex)")
    parser.add_argument("--exclude", metavar="SLUGS",
                        help="Slugs à exclure")
    parser.add_argument("--include-marketplaces", action="store_true",
                        help="Inclure les marketplaces (AutoTrader, Kijiji, …)")
    parser.add_argument("--json", action="store_true",
                        help="Sortie JSON brute (pour intégrations)")
    parser.add_argument("--quiet", action="store_true", help="Mode silencieux")
    parser.add_argument("--cache-info", action="store_true",
                        help="Affiche l'état du cache d'inventaire et quitte")
    parser.add_argument("--cache-clear", metavar="SLUG",
                        help="Invalide le cache d'un slug (ou 'all') et quitte")
    args = parser.parse_args(argv)

    # --- Commandes de maintenance ---
    if args.cache_info:
        _print_cache_info()
        return
    if args.cache_clear:
        _clear_cache(args.cache_clear)
        return

    if not args.query:
        parser.print_help()
        sys.exit(1)

    raw_query = " ".join(args.query)
    query = parse_query(raw_query)
    query.max_results = args.max_results
    query.min_score = args.min_score

    if not args.quiet and not args.json:
        _print_parsed_query(query)

    # --- Adapters ---
    only_slugs = [s.strip() for s in args.only.split(",")] if args.only else None
    excl_slugs = [s.strip() for s in args.exclude.split(",")] if args.exclude else None
    adapters = build_all_dedicated_adapters(
        cache_ttl=args.max_age, only_slugs=only_slugs, exclude_slugs=excl_slugs,
    )
    if args.include_marketplaces:
        from .adapters.marketplace import AutoTraderAdapter
        adapters.append(AutoTraderAdapter())

    if not adapters:
        print("Aucun adapter disponible. Vérifie le DedicatedScraperRegistry.", file=sys.stderr)
        sys.exit(2)

    # --- Recherche ---
    federation = FederatedSearch(
        adapters,
        max_workers=args.workers,
        default_timeout_per_adapter=args.timeout,
        verbose=not args.quiet and not args.json,
    )
    result = federation.search(query)

    # --- Sortie ---
    if args.json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2, default=str))
    else:
        _print_human(result)


# ---------------------------------------------------------------------------
# Affichage
# ---------------------------------------------------------------------------

def _print_parsed_query(q: SearchQuery) -> None:
    print(f"\n  Requête  : '{q.raw_text}'")
    parts = []
    if q.marque: parts.append(f"marque={q.marque}")
    if q.modele: parts.append(f"modele={q.modele}")
    if q.annee: parts.append(f"annee={q.annee}")
    if q.annee_min or q.annee_max:
        parts.append(f"annee=[{q.annee_min or '?'}-{q.annee_max or '?'}]")
    if q.prix_min or q.prix_max:
        parts.append(f"prix=[{q.prix_min or 0}-{q.prix_max or '∞'}$]")
    if q.type_vehicule: parts.append(f"type={q.type_vehicule}")
    if q.etat: parts.append(f"etat={q.etat}")
    if q.couleur: parts.append(f"couleur={q.couleur}")
    if q.keywords: parts.append(f"keywords={'+'.join(q.keywords)}")
    print(f"  Parsée   : {' · '.join(parts) if parts else '(aucun critère structuré)'}")
    print()


def _print_human(result) -> None:
    print()
    print("=" * 78)
    print(f"  {result.total} résultat(s) trouvé(s) sur "
          f"{result.adapters_succeeded} site(s) "
          f"({result.elapsed_seconds:.1f}s)")
    print("=" * 78)

    if not result.hits:
        print("  Aucun résultat correspondant.")
        if result.adapters_failed:
            print(f"\n  Sources en erreur ({len(result.adapters_failed)}) :")
            for a in result.adapters_run:
                if a.error:
                    print(f"    - {a.name}: {a.error[:120]}")
        return

    for i, h in enumerate(result.hits, 1):
        prix_str = f"{int(h.prix):,}$".replace(",", " ") if h.prix else "—"
        annee_str = str(h.annee) if h.annee else "—"
        km = f" · {h.kilometrage} km" if h.kilometrage else ""
        print(f"\n  [{i:2d}] ({h.score:.2f}) {h.name}")
        print(f"       {annee_str} · {prix_str}{km} · {h.source_site}")
        if h.source_url:
            print(f"       → {h.source_url}")
        if h.match_reason:
            print(f"       match: {h.match_reason}")

    if result.adapters_failed:
        print(f"\n  Sources en erreur : {', '.join(result.adapters_failed)}")
    print()


def _print_cache_info() -> None:
    cache = SearchCache()
    keys = cache.list_keys()
    if not keys:
        print("Cache vide.")
        return
    print(f"\n  {len(keys)} entrée(s) en cache :\n")
    for key in sorted(keys):
        age = cache.age_seconds(key)
        if age is None:
            continue
        if age < 60:
            age_str = f"{age:.0f}s"
        elif age < 3600:
            age_str = f"{age/60:.0f}min"
        else:
            age_str = f"{age/3600:.1f}h"
        print(f"    {key:30s}  {age_str}")
    print()


def _clear_cache(slug: str) -> None:
    cache = SearchCache()
    if slug == "all":
        keys = cache.list_keys()
        for k in keys:
            cache.invalidate(k)
        print(f"  {len(keys)} entrée(s) supprimée(s).")
    else:
        ok = cache.invalidate(slug)
        print(f"  Cache pour '{slug}' : {'supprimé' if ok else 'introuvable'}.")


if __name__ == "__main__":
    main()
