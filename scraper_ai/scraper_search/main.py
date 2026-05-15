"""
CLI scraper_search — recherche fédérée multi-sites.

Usage simple (auto-détection) :
  python -m scraper_ai.scraper_search.main "KTM SX 150 2026"
  python -m scraper_ai.scraper_search.main "Sony WH-1000XM5" --amazon

Usage avec pré-tri par catégorie (recommandé) :
  python -m scraper_ai.scraper_search.main "KTM SX 150 2026" --category vehicule.moto
  python -m scraper_ai.scraper_search.main "iPhone 15 Pro" --category electronique.cellulaire
  python -m scraper_ai.scraper_search.main "casque Bell" --category accessoire.accessoire-moto

Mode interactif (parcours guidé de l'arbre catégories puis prompt pour la requête) :
  python -m scraper_ai.scraper_search.main --browse

Liste des catégories disponibles :
  python -m scraper_ai.scraper_search.main --list-categories
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import List, Optional

from .adapters.dedicated import build_all_dedicated_adapters
from .cache import DEFAULT_TTL_SECONDS, SearchCache
from .categories import (
    all_paths, children_of, detect_category_from_text, get_category,
    get_path, render_tree, root_categories,
)
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
    parser.add_argument("--total-timeout", type=int, default=None,
                        help="Timeout total (toutes sources confondues) en secondes. "
                             "Défaut = timeout * 2.")
    parser.add_argument("--workers", type=int, default=8,
                        help="Nb d'adapters en parallèle (défaut 8)")
    parser.add_argument("--only", metavar="SLUGS",
                        help="Liste de slugs séparés par virgules (ex: moto-ducharme,motoplex)")
    parser.add_argument("--exclude", metavar="SLUGS",
                        help="Slugs à exclure")
    parser.add_argument("--no-dedicated", action="store_true",
                        help="Ne pas charger les scrapers concessionnaires dédiés")
    parser.add_argument("--dedicated-cache-only", action="store_true",
                        help="Pour les concessionnaires, lire seulement le cache existant "
                             "sans lancer de scrape d'inventaire")
    parser.add_argument("--include-marketplaces", action="store_true",
                        help="Inclure TOUS les marketplaces e-commerce généralistes "
                             "(Amazon, eBay, Kijiji, Best Buy, Walmart, Costco, LesPAC)")
    parser.add_argument("--ebay", action="store_true",
                        help="eBay (requiert EBAY_CLIENT_ID/SECRET)")
    parser.add_argument("--amazon", action="store_true",
                        help="Amazon (.ca par défaut)")
    parser.add_argument("--amazon-region", default="ca",
                        choices=["ca", "com", "fr", "co.uk"],
                        help="Région Amazon (défaut: ca)")
    parser.add_argument("--kijiji", action="store_true",
                        help="Kijiji (Playwright requis)")
    parser.add_argument("--bestbuy", action="store_true",
                        help="Best Buy.ca (Playwright)")
    parser.add_argument("--walmart", action="store_true",
                        help="Walmart.ca (Playwright)")
    parser.add_argument("--costco", action="store_true",
                        help="Costco.ca (Playwright)")
    parser.add_argument("--lespac", action="store_true",
                        help="LesPAC.com (Playwright)")
    parser.add_argument("--autotrader", action="store_true",
                        help="AutoTrader.ca (Playwright, véhicules auto)")
    parser.add_argument("--cycletrader", action="store_true",
                        help="CycleTrader.com (Playwright, powersport)")
    parser.add_argument("--facebook", action="store_true",
                        help="Facebook Marketplace (requiert FB_COOKIES_FILE)")
    parser.add_argument("--shopify", metavar="DOMAINS",
                        help="Liste de domaines Shopify séparés par virgules "
                             "(ex: shop1.myshopify.com,boutique2.com)")
    parser.add_argument("--generic-dealers", metavar="DOMAINS",
                        help="Liste de domaines de concessionnaires sans scraper "
                             "dédié à interroger en mode générique (on-site "
                             "search + fallback Google). Séparés par virgules.")
    parser.add_argument("--no-google-fallback", action="store_true",
                        help="Désactive le fallback Google site: pour --generic-dealers")
    parser.add_argument("--category", metavar="PATH",
                        help="Pré-tri par catégorie (ex: 'vehicule.moto', "
                             "'electronique.cellulaire'). Liste : --list-categories.")
    parser.add_argument("--browse", action="store_true",
                        help="Mode interactif : parcours guidé de l'arbre puis prompt")
    parser.add_argument("--list-categories", action="store_true",
                        help="Affiche l'arbre complet des catégories et quitte")
    parser.add_argument("--auto-category", action="store_true",
                        help="Détecte automatiquement la catégorie depuis le texte "
                             "(meilleur routing sans interaction)")
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
    if args.list_categories:
        print("\nArbre des catégories disponibles :\n")
        print(render_tree())
        print("\nUsage : --category <path>  (ex: --category vehicule.moto)\n")
        return

    # --- Mode interactif ---
    if args.browse:
        category_path, raw_query = _interactive_browse()
    else:
        if not args.query:
            parser.print_help()
            sys.exit(1)
        raw_query = " ".join(args.query)
        category_path = args.category

    # Validation / normalisation de la catégorie
    if category_path:
        category_path = _resolve_category_path(category_path)
        if not category_path:
            print(f"⚠ Catégorie inconnue. Utilise --list-categories pour voir l'arbre.",
                  file=sys.stderr)
            sys.exit(2)

    # Auto-détection si demandée et pas pré-sélectionnée
    if not category_path and args.auto_category:
        category_path = detect_category_from_text(raw_query)
        if category_path and not args.quiet and not args.json:
            print(f"  → Catégorie auto-détectée : {category_path}")

    query = parse_query(raw_query)
    query.category_path = category_path
    query.max_results = args.max_results
    query.min_score = args.min_score

    if not args.quiet and not args.json:
        _print_parsed_query(query)

    # --- Adapters ---
    only_slugs = [s.strip() for s in args.only.split(",")] if args.only else None
    excl_slugs = [s.strip() for s in args.exclude.split(",")] if args.exclude else None
    adapters = []
    if not args.no_dedicated:
        adapters = build_all_dedicated_adapters(
            cache_ttl=args.max_age,
            cache_only=args.dedicated_cache_only,
            only_slugs=only_slugs,
            exclude_slugs=excl_slugs,
        )
    def _try_add(label: str, factory):
        try:
            adapters.append(factory())
        except Exception as e:
            print(f"  ⚠ {label} non chargé : {e}", file=sys.stderr)

    if args.include_marketplaces or args.ebay:
        from .adapters.ebay import EbayBrowseAdapter
        _try_add("eBay", lambda: EbayBrowseAdapter())
    if args.include_marketplaces or args.amazon:
        from .adapters.amazon import AmazonAdapter
        _try_add("Amazon", lambda: AmazonAdapter(region=args.amazon_region))
    if args.include_marketplaces or args.kijiji:
        from .adapters.kijiji import KijijiAdapter
        _try_add("Kijiji", lambda: KijijiAdapter())
    if args.include_marketplaces or args.bestbuy:
        from .adapters.bestbuy import BestBuyAdapter
        _try_add("Best Buy", lambda: BestBuyAdapter())
    if args.include_marketplaces or args.walmart:
        from .adapters.walmart import WalmartAdapter
        _try_add("Walmart", lambda: WalmartAdapter())
    if args.include_marketplaces or args.costco:
        from .adapters.costco import CostcoAdapter
        _try_add("Costco", lambda: CostcoAdapter())
    if args.include_marketplaces or args.lespac:
        from .adapters.lespac import LesPacAdapter
        _try_add("LesPAC", lambda: LesPacAdapter())
    if args.autotrader:
        from .adapters.autotrader import AutoTraderAdapter
        _try_add("AutoTrader", lambda: AutoTraderAdapter())
    if args.cycletrader:
        from .adapters.cycletrader import CycleTraderAdapter
        _try_add("CycleTrader", lambda: CycleTraderAdapter())
    if args.facebook:
        from .adapters.facebook_marketplace import FacebookMarketplaceAdapter
        _try_add("Facebook Marketplace", lambda: FacebookMarketplaceAdapter())
    if args.shopify:
        try:
            from .adapters.shopify import build_shopify_adapters_for
            domains = [d.strip() for d in args.shopify.split(",") if d.strip()]
            adapters.extend(build_shopify_adapters_for(domains))
        except Exception as e:
            print(f"  ⚠ Shopify non chargé : {e}", file=sys.stderr)

    if args.generic_dealers:
        try:
            from .adapters.generic_dealer import build_generic_dealer_adapters
            domains = [d.strip() for d in args.generic_dealers.split(",") if d.strip()]
            adapters.extend(build_generic_dealer_adapters(
                domains,
                enable_google_fallback=not args.no_google_fallback,
            ))
        except Exception as e:
            print(f"  ⚠ GenericDealer non chargé : {e}", file=sys.stderr)

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
    result = federation.search(query, total_timeout=args.total_timeout)

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
    if q.category_path:
        print(f"  Catégorie: {q.category_path}")
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


def _resolve_category_path(input_str: str) -> Optional[str]:
    """Accepte un slug court ('moto') OU un path complet ('vehicule.moto').
    Renvoie le path normalisé, ou None si introuvable."""
    s = input_str.strip().lower().strip(".")
    # Match exact sur un path complet
    if s in all_paths():
        return s
    # Match sur un slug → on prend le 1er path qui se termine par ce slug
    cat = get_category(s)
    if cat:
        return get_path(cat.slug)
    return None


def _interactive_browse() -> tuple:
    """Mode interactif : guide l'utilisateur dans l'arbre puis prompt pour la requête.
    Renvoie (category_path, raw_query)."""
    print("\n=== Recherche fédérée — sélection de catégorie ===\n")

    # 1) Sélection de la catégorie racine
    roots = root_categories()
    while True:
        print("Catégories principales :\n")
        for i, cat in enumerate(roots, 1):
            print(f"  {i:2d}. {cat.name}")
        print(f"   0. (aucune — interroger toutes les sources)\n")
        choice = input("→ Choix : ").strip()
        if not choice:
            continue
        if choice == "0":
            print()
            return None, _prompt_query()
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(roots):
                root = roots[idx]
                break
        except ValueError:
            pass
        print("  ⚠ Choix invalide.\n")

    # 2) Descente récursive dans l'arbre
    current = root
    while current.children:
        kids = children_of(current.slug)
        print(f"\nDans «{current.name}» — affine ta sélection :\n")
        for i, kid in enumerate(kids, 1):
            print(f"  {i:2d}. {kid.name}")
        print(f"   0. (rester sur «{current.name}» — pas de sous-catégorie)\n")
        choice = input("→ Choix : ").strip()
        if not choice or choice == "0":
            break
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(kids):
                current = kids[idx]
                continue
        except ValueError:
            pass
        print("  ⚠ Choix invalide, reste sur ce niveau.\n")
        break

    path = get_path(current.slug)
    print(f"\n✓ Catégorie sélectionnée : {current.name}  [{path}]\n")
    return path, _prompt_query()


def _prompt_query() -> str:
    """Demande à l'utilisateur de taper sa requête."""
    while True:
        q = input("Tape ta recherche : ").strip()
        if q:
            return q
        print("  ⚠ Requête vide, réessaye.\n")


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
