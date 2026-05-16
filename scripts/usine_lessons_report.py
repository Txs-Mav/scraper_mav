#!/usr/bin/env python3
"""Rapport agrégé des leçons Claude (Phase 2 du plan usine-bench-cron-lessons).

Lit ``usine_lessons`` sur une fenêtre temporelle et produit un rapport
markdown listant :

  - top error_signature (volume + plateformes concernées)
  - top platforms qui requièrent des corrections
  - top field_fixed (price/name/year/...)
  - top combinaisons (platform, field) avec une recommandation explicite
    vers le template/recette concerné

Le rapport est écrit dans ``scraper_cache/lessons/report_<YYYY-MM>.md``.

Usage:
    python scripts/usine_lessons_report.py
    python scripts/usine_lessons_report.py --since 2026-04-01
    python scripts/usine_lessons_report.py --top 20 --out-dir reports/

Cron mensuel : voir .github/workflows/usine-lessons-monthly.yml
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DEFAULT_OUT_DIR = PROJECT_ROOT / "scraper_cache" / "lessons"


# ---------------------------------------------------------------------------
# Recommandations heuristiques (platform, field) -> fichier à modifier
# ---------------------------------------------------------------------------
RECOMMENDATIONS: Dict[tuple, str] = {
    ("shopify", "price"): (
        "Mettre à jour `scraper_ai/scraper_usine/blocks/extract_jsonld.py.j2` "
        "pour ajouter le sélecteur `meta[property='product:price:amount']` "
        "+ fallback `<script type='application/ld+json'>Product.offers.price`."
    ),
    ("shopify", "image"): (
        "Privilégier `meta[property='og:image']` puis `product__media img` "
        "(`blocks/extract_*.py.j2`)."
    ),
    ("woocommerce", "price"): (
        "Ajouter `p.price ins .woocommerce-Price-amount` "
        "(prix soldé) avant le prix barré dans extract_hybrid.py.j2."
    ),
    ("powergo_nextjs", "year"): (
        "Étendre `MotoplexScraper._extract_year_from_url` avec un fallback "
        "regex sur le slug. Cf. `dedicated_scrapers/motoplex.py` _clean_name."
    ),
    ("powergo_nextjs", "mileage"): (
        "Ajouter parsing du champ `vehicleMileage` JSON-LD dans "
        "`MotoplexScraper.extract_from_detail_page`."
    ),
    ("edealer", "price"): (
        "Compléter `dedicated_scrapers/st_onge_ford.py` ou la recette eDealer "
        "dans `platforms.py` avec sélecteurs `[data-price]`."
    ),
    ("facetwp", "name"): (
        "Vérifier les selectors du listing FacetWP dans "
        "`blocks/extract_listing_only.py.j2`."
    ),
    ("magento", "price"): (
        "Ajouter `meta[itemprop='price']` + fallback `[data-price-amount]` "
        "dans extract_hybrid.py.j2."
    ),
}


def _recommendation_for(platform: Optional[str], field: Optional[str]) -> Optional[str]:
    if not platform or not field:
        return None
    key = (platform.lower(), field.lower())
    if key in RECOMMENDATIONS:
        return RECOMMENDATIONS[key]
    # Fallback générique
    return (
        f"Examiner `scraper_ai/scraper_usine/blocks/` pour le champ `{field}` "
        f"sur la plateforme `{platform}` — pas encore de recette dédiée. "
        f"Voir aussi `platforms.py:PLATFORM_RECIPES`."
    )


# ---------------------------------------------------------------------------
# Fetch Supabase
# ---------------------------------------------------------------------------

def _fetch_lessons(since_iso: str, until_iso: str) -> List[Dict[str, Any]]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(
            "ERREUR : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis."
        )
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    # PostgREST paginates par 1000 par défaut
    all_rows: List[Dict[str, Any]] = []
    offset = 0
    page = 1000
    while True:
        params = {
            "select": (
                "id,created_at,slug,url,platform,phase,error_signature,"
                "field_fixed,tokens_used,iterations,applied_to_template"
            ),
            "created_at": f"gte.{since_iso}",
            "and": f"(created_at.lt.{until_iso})",
            "order": "created_at.asc",
            "limit": str(page),
            "offset": str(offset),
        }
        try:
            resp = requests.get(
                f"{url}/rest/v1/usine_lessons",
                headers=headers, params=params, timeout=30,
            )
        except Exception as e:
            raise SystemExit(f"Supabase erreur réseau : {e}")
        if resp.status_code != 200:
            raise SystemExit(
                f"Supabase {resp.status_code} : {resp.text[:300]}"
            )
        data = resp.json() or []
        if not data:
            break
        all_rows.extend(data)
        if len(data) < page:
            break
        offset += page
    return all_rows


# ---------------------------------------------------------------------------
# Agrégation
# ---------------------------------------------------------------------------

def _aggregate(rows: List[Dict[str, Any]], top: int) -> Dict[str, Any]:
    sig_counter: Counter = Counter()
    plat_counter: Counter = Counter()
    field_counter: Counter = Counter()
    plat_field_counter: Counter = Counter()
    phase_counter: Counter = Counter()
    pending_template: int = 0
    total_tokens: int = 0
    total_iterations: int = 0
    plat_field_examples: Dict[tuple, List[Dict[str, Any]]] = defaultdict(list)

    for r in rows:
        sig = r.get("error_signature") or "(no_signature)"
        plat = (r.get("platform") or "unknown").lower()
        field = (r.get("field_fixed") or "unspecified").lower()
        phase = r.get("phase") or "unknown"
        sig_counter[sig] += 1
        plat_counter[plat] += 1
        field_counter[field] += 1
        plat_field_counter[(plat, field)] += 1
        phase_counter[phase] += 1
        if not r.get("applied_to_template"):
            pending_template += 1
        if r.get("tokens_used"):
            try:
                total_tokens += int(r["tokens_used"])
            except Exception:
                pass
        if r.get("iterations"):
            try:
                total_iterations += int(r["iterations"])
            except Exception:
                pass
        if len(plat_field_examples[(plat, field)]) < 3:
            plat_field_examples[(plat, field)].append({
                "slug": r.get("slug"),
                "url": r.get("url"),
                "created_at": r.get("created_at"),
                "signature": sig,
            })

    return {
        "total": len(rows),
        "pending_template": pending_template,
        "total_tokens": total_tokens,
        "total_iterations": total_iterations,
        "top_signatures": sig_counter.most_common(top),
        "top_platforms": plat_counter.most_common(top),
        "top_fields": field_counter.most_common(top),
        "top_plat_field": plat_field_counter.most_common(top),
        "phases": phase_counter.most_common(),
        "plat_field_examples": plat_field_examples,
    }


# ---------------------------------------------------------------------------
# Rendu markdown
# ---------------------------------------------------------------------------

def _render(rows: List[Dict[str, Any]], agg: Dict[str, Any],
            since_iso: str, until_iso: str) -> str:
    lines: List[str] = []
    lines.append(f"# Leçons Claude — {since_iso[:10]} → {until_iso[:10]}")
    lines.append("")
    lines.append(f"_Généré le {datetime.now(timezone.utc).isoformat()}_")
    lines.append("")
    lines.append("## Résumé")
    lines.append("")
    lines.append(f"- Corrections totales : **{agg['total']}**")
    lines.append(f"- En attente d'intégration template : **{agg['pending_template']}**")
    lines.append(f"- Tokens Claude cumulés : ~{agg['total_tokens']:,}")
    lines.append(f"- Itérations cumulées : {agg['total_iterations']}")
    if agg["phases"]:
        lines.append("- Répartition par phase :")
        for phase, n in agg["phases"]:
            lines.append(f"  - `{phase}` : {n}")
    lines.append("")

    if agg["total"] == 0:
        lines.append("_Aucune leçon enregistrée sur la fenêtre. Rien à reporter._")
        return "\n".join(lines)

    lines.append("## Top 10 — Signatures d'erreur")
    lines.append("")
    lines.append("| # | Signature | Occurrences |")
    lines.append("|---|-----------|-------------|")
    for i, (sig, n) in enumerate(agg["top_signatures"], start=1):
        lines.append(f"| {i} | `{sig}` | {n} |")
    lines.append("")

    lines.append("## Top — Plateformes corrigées")
    lines.append("")
    lines.append("| Plateforme | Corrections |")
    lines.append("|------------|-------------|")
    for plat, n in agg["top_platforms"]:
        lines.append(f"| {plat} | {n} |")
    lines.append("")

    lines.append("## Top — Champs corrigés")
    lines.append("")
    lines.append("| Champ | Corrections |")
    lines.append("|-------|-------------|")
    for field, n in agg["top_fields"]:
        lines.append(f"| {field} | {n} |")
    lines.append("")

    lines.append("## Recommandations actionnables")
    lines.append("")
    lines.append(
        "Pour chaque couple `(plateforme, champ)` récurrent, une "
        "recommandation est proposée. Marquer les leçons comme "
        "`applied_to_template=true` une fois le template mis à jour."
    )
    lines.append("")
    for (plat, field), n in agg["top_plat_field"]:
        rec = _recommendation_for(plat, field) or "Pas de recommandation automatique."
        lines.append(f"### `{plat}` × `{field}` — {n} occurrence(s)")
        lines.append("")
        lines.append(rec)
        lines.append("")
        examples = agg["plat_field_examples"].get((plat, field), [])
        if examples:
            lines.append("Exemples récents :")
            for ex in examples:
                slug = ex.get("slug") or "?"
                url = ex.get("url") or "?"
                created = (ex.get("created_at") or "")[:19]
                lines.append(f"- `{slug}` ({url}) — {created}")
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _parse_iso(value: str) -> str:
    """Force un ISO complet pour comparaison PostgREST."""
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        raise SystemExit(f"Date invalide : {value} (attendu YYYY-MM-DD ou ISO).")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Rapport mensuel des leçons Claude (table usine_lessons).",
    )
    parser.add_argument(
        "--since", default=None,
        help="Date de début (YYYY-MM-DD ou ISO). Défaut : 1er du mois courant.",
    )
    parser.add_argument(
        "--until", default=None,
        help="Date de fin exclusive (YYYY-MM-DD ou ISO). Défaut : maintenant.",
    )
    parser.add_argument(
        "--top", type=int, default=10,
        help="Nombre d'entrées à afficher par classement (défaut 10).",
    )
    parser.add_argument(
        "--out-dir", default=str(DEFAULT_OUT_DIR),
        help="Répertoire de sortie pour le rapport markdown.",
    )
    parser.add_argument(
        "--also-json", action="store_true",
        help="Écrit aussi un rapport JSON brut (pour CI).",
    )
    args = parser.parse_args(argv)

    now = datetime.now(timezone.utc)
    if args.since:
        since_iso = _parse_iso(args.since)
    else:
        first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # Si on est le 1er, on prend le mois précédent
        if now.day == 1:
            prev = first_of_month - timedelta(days=1)
            first_of_month = prev.replace(day=1)
        since_iso = first_of_month.isoformat()

    until_iso = _parse_iso(args.until) if args.until else now.isoformat()

    print(f"[lessons] Fetch usine_lessons entre {since_iso} et {until_iso}")
    rows = _fetch_lessons(since_iso, until_iso)
    print(f"[lessons] {len(rows)} ligne(s) récupérée(s).")

    agg = _aggregate(rows, args.top)
    md = _render(rows, agg, since_iso, until_iso)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = since_iso[:7]  # YYYY-MM
    out_path = out_dir / f"report_{stamp}.md"
    out_path.write_text(md, encoding="utf-8")
    print(f"[lessons] Rapport écrit : {out_path}")

    if args.also_json:
        json_path = out_dir / f"report_{stamp}.json"
        json_path.write_text(
            json.dumps(
                {
                    "since": since_iso, "until": until_iso,
                    "total": agg["total"],
                    "pending_template": agg["pending_template"],
                    "top_signatures": agg["top_signatures"],
                    "top_platforms": agg["top_platforms"],
                    "top_fields": agg["top_fields"],
                    "top_plat_field": [
                        {"platform": p, "field": f, "count": n}
                        for (p, f), n in agg["top_plat_field"]
                    ],
                    "phases": agg["phases"],
                },
                indent=2, ensure_ascii=False, default=str,
            ),
            encoding="utf-8",
        )
        print(f"[lessons] JSON écrit : {json_path}")

    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
