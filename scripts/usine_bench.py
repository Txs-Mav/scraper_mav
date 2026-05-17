#!/usr/bin/env python3
"""Banc de test pour scraper_usine — gate de décision avant Phase 1.

Lit scripts/usine_bench_sites.yaml, lance le pipeline complet
(`python -m scraper_ai.scraper_usine.main URL --no-publish`) sur chaque URL,
parse le rapport généré dans `scraper_cache/reports/<slug>_report.json`,
agrège les scores et produit un rapport markdown dans `scraper_cache/bench/`.

Sortie:
    exit 0 si le score moyen > publish_threshold (gate PASS)
    exit 1 sinon (gate FAIL — passer en Phase 3 du plan)

Usage:
    python scripts/usine_bench.py
    python scripts/usine_bench.py --sites scripts/usine_bench_sites.yaml --parallel 2
    python scripts/usine_bench.py --threshold 90 --skip-claude

Dépendances:
    - Python 3.11+
    - PyYAML installé (`pip install pyyaml`)
    - scraper_ai installé (cf. scraper_ai/requirements.txt)
    - Variables d'env pour Claude (CLAUDE_API_KEY) et Supabase (optionnel)
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

try:
    import yaml
except ImportError:
    print("ERREUR: PyYAML manquant. Installez avec `pip install pyyaml`.")
    sys.exit(2)


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
REPORTS_DIR = PROJECT_ROOT / "scraper_cache" / "reports"
BENCH_DIR = PROJECT_ROOT / "scraper_cache" / "bench"


@dataclass
class SiteResult:
    url: str
    note: str
    family: str
    slug: Optional[str] = None
    platform: Optional[str] = None
    score: Optional[float] = None
    grade: Optional[str] = None
    duration_sec: float = 0.0
    products: int = 0
    claude_supervisor_used: bool = False
    claude_agent_used: bool = False
    verdict: str = "fail"  # pass | warn | fail | timeout | error
    error: Optional[str] = None
    report_path: Optional[str] = None
    log_excerpt: str = ""
    # Cost tracking (Phase 1.1) - extrait du fichier audit Claude
    cost_usd: float = 0.0
    cost_breakdown: Dict[str, float] = field(default_factory=dict)
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0


def _slug_from_url(url: str) -> str:
    """Reproduit la logique de scraper_usine pour deviner le slug d'analyse."""
    domain = urlparse(url).netloc.replace("www.", "")
    base = re.sub(r"\.(com|ca|net|org|fr|qc\.ca)$", "", domain)
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")


def _parse_log_for_signals(log_text: str) -> Dict[str, Any]:
    """Détecte dans les logs si la supervision Claude ou l'agent ont tourné."""
    return {
        "claude_supervisor_used": "Claude review" in log_text
        or "Auto-correction Claude" in log_text
        or "supervisor.correct_scraper" in log_text,
        "claude_agent_used": "Phase 4.5" in log_text
        or "AI Agent Claude" in log_text
        or "build_scraper_from_scratch" in log_text,
    }


def _run_one(site: Dict[str, Any], threshold: int, timeout_sec: int,
             skip_claude: bool, verbose: bool) -> SiteResult:
    url = site["url"]
    note = site.get("note", "")
    family = site.get("_family", "?")
    result = SiteResult(url=url, note=note, family=family)

    args = [
        sys.executable, "-u", "-m", "scraper_ai.scraper_usine.main",
        url,
        "--no-publish",
        "--publish-threshold", str(threshold),
        "--quiet",
    ]
    if skip_claude:
        args.append("--no-claude")

    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")

    start = time.time()
    try:
        if verbose:
            print(f"[bench] -> {url}")
        proc = subprocess.run(
            args,
            cwd=str(PROJECT_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
    except subprocess.TimeoutExpired as e:
        result.duration_sec = time.time() - start
        result.verdict = "timeout"
        result.error = f"Timeout après {timeout_sec}s"
        result.log_excerpt = (e.stdout or "")[-2000:] if e.stdout else ""
        return result
    except Exception as e:  # pragma: no cover
        result.duration_sec = time.time() - start
        result.verdict = "error"
        result.error = f"{type(e).__name__}: {e}"
        return result

    result.duration_sec = time.time() - start
    stdout = proc.stdout or ""
    stderr = proc.stderr or ""
    full_log = stdout + ("\n[stderr]\n" + stderr if stderr.strip() else "")
    result.log_excerpt = full_log[-4000:]

    signals = _parse_log_for_signals(full_log)
    result.claude_supervisor_used = signals["claude_supervisor_used"]
    result.claude_agent_used = signals["claude_agent_used"]

    slug = _slug_from_url(url)
    result.slug = slug

    # Le report JSON est écrit par ScraperValidator dans REPORTS_DIR/{slug}_report.json
    report_path = REPORTS_DIR / f"{slug}_report.json"
    if not report_path.exists():
        result.verdict = "error" if proc.returncode != 0 else "fail"
        result.error = (
            f"Rapport introuvable: {report_path.name}"
            + (f" (exit={proc.returncode})" if proc.returncode != 0 else "")
        )
        return result

    result.report_path = str(report_path.relative_to(PROJECT_ROOT))
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as e:
        result.verdict = "error"
        result.error = f"Lecture report KO: {e}"
        return result

    result.score = float(payload.get("score") or 0)
    result.grade = payload.get("grade") or "?"
    result.platform = payload.get("platform_detected") or "?"
    result.products = int(payload.get("products_tested") or 0)

    if result.score >= threshold:
        result.verdict = "pass"
    elif result.score >= max(60, threshold - 20):
        result.verdict = "warn"
    else:
        result.verdict = "fail"

    # Extraire le coût Claude depuis l'audit (Phase 1.1)
    audit_path = PROJECT_ROOT / "scraper_cache" / "supervision" / f"{slug}_audit.json"
    if audit_path.exists():
        try:
            audit = json.loads(audit_path.read_text(encoding="utf-8"))
            result.cost_usd = round(float(audit.get("total_cost_usd") or 0.0), 6)
            # Coût par phase pour debug + comparaison A/B
            breakdown: Dict[str, float] = {}
            cache_read = 0
            cache_creation = 0
            for ev in audit.get("events", []):
                phase = ev.get("phase") or "unknown"
                breakdown[phase] = breakdown.get(phase, 0.0) + float(ev.get("cost_usd") or 0.0)
                cache_read += int(ev.get("cache_read_tokens") or 0)
                cache_creation += int(ev.get("cache_creation_tokens") or 0)
            result.cost_breakdown = {k: round(v, 6) for k, v in breakdown.items()}
            result.cache_read_tokens = cache_read
            result.cache_creation_tokens = cache_creation
        except Exception:
            pass  # best-effort, l'absence de cost ne doit pas casser le bench

    return result


def _aggregate(results: List[SiteResult], threshold: int) -> Dict[str, Any]:
    scored = [r for r in results if r.score is not None]
    avg = sum(r.score for r in scored) / len(scored) if scored else 0.0
    total_cost = sum(r.cost_usd for r in results)
    return {
        "total": len(results),
        "scored": len(scored),
        "pass": sum(1 for r in results if r.verdict == "pass"),
        "warn": sum(1 for r in results if r.verdict == "warn"),
        "fail": sum(1 for r in results if r.verdict == "fail"),
        "timeout": sum(1 for r in results if r.verdict == "timeout"),
        "error": sum(1 for r in results if r.verdict == "error"),
        "average_score": round(avg, 2),
        "gate_pass": avg > threshold,
        "claude_supervisor_uses": sum(1 for r in results if r.claude_supervisor_used),
        "claude_agent_uses": sum(1 for r in results if r.claude_agent_used),
        "total_duration_sec": round(sum(r.duration_sec for r in results), 1),
        "total_cost_usd": round(total_cost, 6),
        "average_cost_usd_per_site": round(total_cost / max(1, len(results)), 6),
    }


def _render_markdown(results: List[SiteResult], summary: Dict[str, Any],
                     threshold: int) -> str:
    lines: List[str] = []
    verdict = "PASS" if summary["gate_pass"] else "FAIL"
    lines.append(f"# Bench scraper_usine — {verdict}")
    lines.append("")
    lines.append(f"_Généré le {datetime.now(timezone.utc).isoformat()}_")
    lines.append("")
    lines.append("## Résumé")
    lines.append("")
    lines.append(f"- Sites testés : **{summary['total']}**")
    lines.append(f"- Score moyen : **{summary['average_score']}/100** (seuil > {threshold})")
    lines.append(f"- Gate : **{verdict}**")
    lines.append(
        f"- Verdicts : pass={summary['pass']} warn={summary['warn']} "
        f"fail={summary['fail']} timeout={summary['timeout']} error={summary['error']}"
    )
    lines.append(
        f"- Claude supervisor : utilisé sur {summary['claude_supervisor_uses']}/{summary['total']} sites"
    )
    lines.append(
        f"- Claude agent fallback : utilisé sur {summary['claude_agent_uses']}/{summary['total']} sites"
    )
    lines.append(f"- Durée totale : {summary['total_duration_sec']}s")
    lines.append("")

    if summary["gate_pass"]:
        lines.append(
            "**Décision : PASS** — déclencher la Phase 1 du plan "
            "(migration SQL `usine_*` + GitHub Action cron 2h)."
        )
    else:
        lines.append(
            "**Décision : FAIL** — passer en Phase 3 (durcissement) avant "
            "de relancer le bench. Voir colonnes 'Claude agent' / 'Verdict' "
            "pour identifier les sites en cause."
        )
    lines.append("")

    lines.append("## Détail par site")
    lines.append("")
    lines.append(
        "| Site | Famille | Plateforme | Score | Produits | Sup | Agent | "
        "Durée | Verdict | Note |"
    )
    lines.append(
        "|------|---------|------------|-------|----------|-----|-------|"
        "-------|---------|------|"
    )
    for r in results:
        score_str = f"{r.score:.0f}" if r.score is not None else "—"
        sup = "✓" if r.claude_supervisor_used else "·"
        agt = "✓" if r.claude_agent_used else "·"
        lines.append(
            f"| {r.url} | {r.family} | {r.platform or '—'} | "
            f"{score_str} ({r.grade or '—'}) | {r.products} | {sup} | {agt} | "
            f"{r.duration_sec:.0f}s | {r.verdict.upper()} | {r.note} |"
        )
    lines.append("")

    fails = [r for r in results if r.verdict in ("fail", "error", "timeout")]
    if fails:
        lines.append("## Diagnostics (sites en échec)")
        lines.append("")
        for r in fails:
            lines.append(f"### {r.url}")
            lines.append("")
            if r.error:
                lines.append(f"**Erreur** : {r.error}")
                lines.append("")
            if r.log_excerpt.strip():
                lines.append("Extrait de log (4000 derniers chars) :")
                lines.append("")
                lines.append("```")
                lines.append(r.log_excerpt.strip())
                lines.append("```")
                lines.append("")
            if r.report_path:
                lines.append(f"Rapport complet : `{r.report_path}`")
                lines.append("")

    return "\n".join(lines)


def _load_sites(yaml_path: Path) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not yaml_path.exists():
        raise SystemExit(f"YAML introuvable: {yaml_path}")
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    options = data.get("options") or {}
    sites: List[Dict[str, Any]] = []
    for family in ("moto_qc", "auto_qc"):
        for entry in (data.get(family) or []):
            if not isinstance(entry, dict) or not entry.get("url"):
                continue
            entry = {**entry, "_family": family}
            sites.append(entry)
    return sites, options


def _check_registry_collisions(sites: List[Dict[str, Any]]) -> List[str]:
    """Avertit si une URL du bench correspond à un scraper déjà enregistré."""
    try:
        from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry
    except Exception:
        return []
    warnings: List[str] = []
    for site in sites:
        try:
            if DedicatedScraperRegistry.has_dedicated_scraper(site["url"]):
                warnings.append(site["url"])
        except Exception:
            continue
    return warnings


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Banc de test scraper_usine (gate de décision avant Phase 1).",
    )
    parser.add_argument(
        "--sites", default=str(SCRIPT_DIR / "usine_bench_sites.yaml"),
        help="Chemin du fichier YAML de sites.",
    )
    parser.add_argument(
        "--threshold", type=int, default=None,
        help="Score moyen requis pour passer la gate (défaut: YAML.options.publish_threshold ou 94).",
    )
    parser.add_argument(
        "--parallel", type=int, default=None,
        help="Nombre de runs simultanés (défaut: YAML.options.parallel ou 2).",
    )
    parser.add_argument(
        "--timeout", type=int, default=None,
        help="Timeout par site en secondes (défaut: YAML.options.timeout_per_site_sec ou 1800).",
    )
    parser.add_argument(
        "--skip-claude", action="store_true",
        help="Passe --no-claude au pipeline (utile pour bench ‘base templates only’).",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="Ne pas afficher la progression run-par-run.",
    )
    parser.add_argument(
        "--out-dir", default=str(BENCH_DIR),
        help="Répertoire des rapports markdown (défaut: scraper_cache/bench/).",
    )
    args = parser.parse_args(argv)

    sites, options = _load_sites(Path(args.sites))
    if not sites:
        print("Aucun site dans le YAML. Rien à faire.")
        return 1

    threshold = args.threshold or options.get("publish_threshold") or 94
    parallel = max(1, args.parallel or options.get("parallel") or 2)
    timeout_sec = args.timeout or options.get("timeout_per_site_sec") or 1800
    skip_claude = args.skip_claude

    collisions = _check_registry_collisions(sites)
    if collisions:
        print("AVERTISSEMENT: ces URLs sont DÉJÀ couvertes par le registry :")
        for u in collisions:
            print(f"  - {u}")
        print("  Le bench n'est plus un vrai cold-start. Continuer ? (Ctrl+C pour annuler)")
        time.sleep(3)

    print(
        f"[bench] {len(sites)} site(s), parallel={parallel}, "
        f"threshold={threshold}, timeout={timeout_sec}s, skip_claude={skip_claude}"
    )
    BENCH_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    results: List[SiteResult] = []
    with cf.ThreadPoolExecutor(max_workers=parallel) as pool:
        future_to_site = {
            pool.submit(_run_one, site, threshold, timeout_sec,
                        skip_claude, not args.quiet): site
            for site in sites
        }
        for fut in cf.as_completed(future_to_site):
            site = future_to_site[fut]
            try:
                res = fut.result()
            except Exception as e:  # pragma: no cover
                res = SiteResult(
                    url=site["url"], note=site.get("note", ""),
                    family=site.get("_family", "?"),
                    verdict="error", error=f"{type(e).__name__}: {e}",
                )
            results.append(res)
            verdict_str = res.verdict.upper().ljust(7)
            score_str = f"{res.score:.0f}" if res.score is not None else " ? "
            print(f"  [{verdict_str}] score={score_str} {res.url}")

    # Tri pour rapport lisible: famille puis URL
    results.sort(key=lambda r: (r.family, r.url))

    summary = _aggregate(results, threshold)
    md = _render_markdown(results, summary, threshold)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"report_{ts}.md"
    out_path.write_text(md, encoding="utf-8")

    json_path = out_dir / f"report_{ts}.json"
    json_path.write_text(
        json.dumps(
            {
                "summary": summary,
                "threshold": threshold,
                "results": [
                    {
                        "url": r.url, "family": r.family, "note": r.note,
                        "slug": r.slug, "platform": r.platform,
                        "score": r.score, "grade": r.grade,
                        "products": r.products,
                        "duration_sec": r.duration_sec,
                        "claude_supervisor_used": r.claude_supervisor_used,
                        "claude_agent_used": r.claude_agent_used,
                        "verdict": r.verdict, "error": r.error,
                        "report_path": r.report_path,
                    }
                    for r in results
                ],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print()
    print(f"Rapport markdown : {out_path.relative_to(PROJECT_ROOT)}")
    print(f"Rapport JSON     : {json_path.relative_to(PROJECT_ROOT)}")
    print(
        f"Score moyen      : {summary['average_score']}/100 "
        f"(seuil > {threshold} → "
        f"{'PASS' if summary['gate_pass'] else 'FAIL'})"
    )
    return 0 if summary["gate_pass"] else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
