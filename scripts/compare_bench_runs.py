#!/usr/bin/env python3
"""Compare deux runs de usine_bench (off vs on) avec criteres GO/NO-GO Phase 3.3.

Usage:
    python scripts/compare_bench_runs.py <off.json> <on.json>

Sortie:
    Tableau comparatif + verdict GO/NO-GO base sur les criteres Phase 3.3
    du plan optim couts Claude.

Exit code:
    0 si GO (tous criteres OK)
    1 si NO-GO (au moins 1 critere echoue)
    2 si erreur lecture fichiers

Criteres :
    - Score moyen ON >= score moyen OFF (a +- 2 points)
    - Aucun site ne passe de score >= 80 a score < 80
    - Couverture par champ : aucune regression > 5 pts sur name, prix, sourceUrl, image
    - Cout total ON < 50% du cout total OFF
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


SCORE_AVG_TOLERANCE_PTS = 2.0
SCORE_THRESHOLD_GOOD = 80.0
COVERAGE_MAX_REGRESSION_PCT = 5.0
COST_REDUCTION_TARGET_PCT = 50.0
CRITICAL_FIELDS = ("name", "prix", "sourceUrl", "image")


def _load(path: str) -> Dict[str, Any]:
    p = Path(path)
    if not p.exists():
        print(f"ERREUR : fichier introuvable : {path}", file=sys.stderr)
        sys.exit(2)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"ERREUR : lecture JSON {path} : {e}", file=sys.stderr)
        sys.exit(2)


def _site_index(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Index les results par URL pour comparaison ligne a ligne."""
    sites = payload.get("results") or []
    return {(s.get("url") or s.get("slug") or "?"): s for s in sites}


def _format_pct(v: float) -> str:
    sign = "+" if v >= 0 else ""
    return f"{sign}{v:.2f}"


def _check_avg_score(off: Dict[str, Any], on: Dict[str, Any]) -> tuple[bool, str]:
    avg_off = float((off.get("aggregate") or {}).get("average_score") or 0)
    avg_on = float((on.get("aggregate") or {}).get("average_score") or 0)
    delta = avg_on - avg_off
    ok = delta >= -SCORE_AVG_TOLERANCE_PTS
    return ok, (
        f"Score moyen : OFF={avg_off:.2f} -> ON={avg_on:.2f} "
        f"(delta {_format_pct(delta)} pts, tolerance -{SCORE_AVG_TOLERANCE_PTS:.0f})"
    )


def _check_no_site_drops_below_80(
    off_idx: Dict[str, Dict[str, Any]],
    on_idx: Dict[str, Dict[str, Any]],
) -> tuple[bool, str, List[str]]:
    regressions: List[str] = []
    for url, off_site in off_idx.items():
        on_site = on_idx.get(url)
        if on_site is None:
            continue
        off_score = float(off_site.get("score") or 0)
        on_score = float(on_site.get("score") or 0)
        if off_score >= SCORE_THRESHOLD_GOOD and on_score < SCORE_THRESHOLD_GOOD:
            regressions.append(
                f"{url} : {off_score:.0f} -> {on_score:.0f} (CHUTE sous 80)"
            )
    msg = "Aucun site ne tombe sous 80" if not regressions else f"{len(regressions)} site(s) tombent sous 80"
    return len(regressions) == 0, msg, regressions


def _check_coverage_per_field(
    off_idx: Dict[str, Dict[str, Any]],
    on_idx: Dict[str, Dict[str, Any]],
) -> tuple[bool, str, List[str]]:
    """Compare couverture par champ critique site par site.

    Note : usine_bench.py n'expose pas directement la couverture champs dans
    SiteResult (le score moyen suffit a la fenetre actuelle). On lit donc le
    rapport detaille de chaque site pour avoir field_details.
    """
    regressions: List[str] = []
    for url, off_site in off_idx.items():
        on_site = on_idx.get(url)
        if on_site is None:
            continue
        off_cov = _read_coverage(off_site.get("report_path"))
        on_cov = _read_coverage(on_site.get("report_path"))
        for field in CRITICAL_FIELDS:
            off_pct = off_cov.get(field, 0.0) * 100
            on_pct = on_cov.get(field, 0.0) * 100
            delta = on_pct - off_pct
            if delta < -COVERAGE_MAX_REGRESSION_PCT:
                regressions.append(
                    f"{url} {field} : {off_pct:.0f}% -> {on_pct:.0f}% "
                    f"(delta {_format_pct(delta)} pts)"
                )
    msg = (
        "Aucune regression > 5 pts sur champs critiques"
        if not regressions
        else f"{len(regressions)} regression(s) detectee(s)"
    )
    return len(regressions) == 0, msg, regressions


def _read_coverage(report_relpath: Optional[str]) -> Dict[str, float]:
    if not report_relpath:
        return {}
    project_root = Path(__file__).resolve().parent.parent
    p = project_root / report_relpath
    if not p.exists():
        return {}
    try:
        report = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
    cov: Dict[str, float] = {}
    for fd in report.get("field_details") or []:
        name = fd.get("field_name")
        if name:
            cov[name] = float(fd.get("coverage") or 0.0)
    return cov


def _check_cost_reduction(off: Dict[str, Any], on: Dict[str, Any]) -> tuple[bool, str]:
    cost_off = float((off.get("aggregate") or {}).get("total_cost_usd") or 0)
    cost_on = float((on.get("aggregate") or {}).get("total_cost_usd") or 0)
    if cost_off <= 0:
        return True, f"Cout OFF=0 (pas de mesure), ON=${cost_on:.4f} (skip critere)"
    reduction_pct = (1 - cost_on / cost_off) * 100
    ok = reduction_pct >= COST_REDUCTION_TARGET_PCT
    return ok, (
        f"Cout : OFF=${cost_off:.4f} -> ON=${cost_on:.4f} "
        f"(reduction {reduction_pct:.1f}%, cible >= {COST_REDUCTION_TARGET_PCT:.0f}%)"
    )


def main(argv: List[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2

    off_path, on_path = argv
    off = _load(off_path)
    on = _load(on_path)

    off_idx = _site_index(off)
    on_idx = _site_index(on)

    print(f"\n{'='*70}")
    print(f"  COMPARAISON BENCH A/B (Phase 3.3 plan optim couts)")
    print(f"{'='*70}")
    print(f"  OFF : {off_path}")
    print(f"  ON  : {on_path}\n")

    print("  --- Tableau site-par-site ---")
    print(f"  {'URL':40s}  {'OFF':>6s}  {'ON':>6s}  {'delta':>7s}")
    for url, off_site in off_idx.items():
        on_site = on_idx.get(url)
        off_score = off_site.get("score") or 0
        on_score = (on_site or {}).get("score") or 0
        delta = on_score - off_score
        marker = ""
        if off_score >= 80 and on_score < 80:
            marker = "  <-- CHUTE sous 80"
        print(
            f"  {url[:40]:40s}  {off_score:6.0f}  {on_score:6.0f}  "
            f"{_format_pct(delta):>7s}{marker}"
        )

    print("\n  --- Criteres GO/NO-GO ---")

    checks: List[tuple[bool, str]] = []

    ok, msg = _check_avg_score(off, on)
    checks.append((ok, msg))
    print(f"  [{('OK' if ok else 'KO'):2s}] {msg}")

    ok, msg, details = _check_no_site_drops_below_80(off_idx, on_idx)
    checks.append((ok, msg))
    print(f"  [{('OK' if ok else 'KO'):2s}] {msg}")
    for d in details:
        print(f"       {d}")

    ok, msg, details = _check_coverage_per_field(off_idx, on_idx)
    checks.append((ok, msg))
    print(f"  [{('OK' if ok else 'KO'):2s}] {msg}")
    for d in details[:10]:
        print(f"       {d}")

    ok, msg = _check_cost_reduction(off, on)
    checks.append((ok, msg))
    print(f"  [{('OK' if ok else 'KO'):2s}] {msg}")

    all_ok = all(ok for ok, _ in checks)
    print(f"\n{'='*70}")
    print(f"  VERDICT : {'GO (bascule autorisee)' if all_ok else 'NO-GO (rester en hybride OFF)'}")
    print(f"{'='*70}\n")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
