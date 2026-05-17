"""
Scraper Usine -- Point d'entrée CLI.

Orchestre les 4 phases : Analyse → Stratégie → Génération → Validation.

Usage:
  python -m scraper_ai.scraper_usine.main <url>
  python -m scraper_ai.scraper_usine.main --batch urls.txt
  python -m scraper_ai.scraper_usine.main --dry-run <url>
  python -m scraper_ai.scraper_usine.main --resume <url>
  python -m scraper_ai.scraper_usine.main --check <slug>
  python -m scraper_ai.scraper_usine.main --check-all
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import List, Optional

from .analyzer import SiteAnalyzer, ANALYSIS_DIR
from .models import GeneratedScraper, SiteAnalysis, ValidationReport
from .planner import StrategyPlanner
from .generator import ScraperCodeGenerator
from .publisher import publish_pending_scraper
from .git_push import commit_and_push_scraper, GitPushResult
from .validator import ScraperValidator
from .workflow_generator import write_workflow_for_scraper
from .claude_supervisor import ClaudeSupervisor, SUPERVISION_DIR
from .claude_agent import ClaudeAgent


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        prog="scraper_usine",
        description="Générateur automatisé de scrapers dédiés.",
    )
    parser.add_argument("url", nargs="?", help="URL du site à analyser")
    parser.add_argument("--batch", metavar="FILE", help="Fichier avec une URL par ligne")
    parser.add_argument("--dry-run", action="store_true",
                        help="Analyse + stratégie sans générer le scraper")
    parser.add_argument("--resume", action="store_true",
                        help="Reprendre depuis Phase 2 (utilise l'analyse sauvegardée)")
    parser.add_argument("--no-claude", "--no-llm-fix", action="store_true",
                        dest="no_claude",
                        help="Désactiver toute la supervision Claude (juge + correcteur + agent)")
    parser.add_argument("--no-agent-fallback", action="store_true",
                        help="Désactiver UNIQUEMENT la Phase 4.5 (agent autonome). "
                             "La supervision Claude reste active.")
    parser.add_argument("--no-hybrid", action="store_true",
                        help="Forcer Opus full pour ce run (mode qualité max). "
                             "Désactive l'architecture diagnose/write hybride pour "
                             "ce subprocess uniquement. Utile pour relancer un site "
                             "où le hybride n'a pas suffi (cf. /admin/usine).")
    parser.add_argument("--force-playwright", action="store_true",
                        help="Forcer l'utilisation de Playwright")
    parser.add_argument("--check", metavar="SLUG",
                        help="Health check sur un scraper existant")
    parser.add_argument("--check-all", action="store_true",
                        help="Health check sur tous les scrapers")
    parser.add_argument("--audit", metavar="SLUG",
                        help="Affiche l'audit Claude (verdicts + trace agent) pour un slug")
    parser.add_argument("--profile", metavar="DOMAIN",
                        choices=["auto", "ecommerce", "real_estate", "jobs", "generic"],
                        help="Force le profil de domaine (sinon: auto-détection)")
    parser.add_argument("--golden-record", metavar="SLUG",
                        help="Enregistre un golden test depuis un run live")
    parser.add_argument("--golden-diff", metavar="SLUG",
                        help="Compare le golden au run actuel (détecte régressions)")
    parser.add_argument("--quiet", action="store_true", help="Mode silencieux")
    parser.add_argument("--no-publish", action="store_true",
                        help="Ne pas publier le scraper en pending dans shared_scrapers")
    parser.add_argument("--publish-threshold", type=int, default=95,
                        help="Score minimum pour publier en pending (défaut: 95)")

    args = parser.parse_args(argv)
    verbose = not args.quiet

    if args.audit:
        _print_audit(args.audit)
        return

    if args.check_all:
        _run_check_all(verbose)
        return

    if args.check:
        _run_check(args.check, verbose)
        return

    if args.golden_record:
        from .golden_tests import record_golden
        record_golden(args.golden_record)
        return

    if args.golden_diff:
        from .golden_tests import run_golden_diff
        result = run_golden_diff(args.golden_diff)
        if result.regressions:
            print(f"\n  RÉGRESSIONS ({len(result.regressions)}):")
            for r in result.regressions[:20]:
                print(f"    - {r}")
            sys.exit(1)
        print(f"\n  OK: {result.samples_matched}/{result.samples_total} samples conformes")
        return

    if args.batch:
        urls = _read_batch(args.batch)
    elif args.url:
        urls = [args.url]
    else:
        parser.print_help()
        sys.exit(1)

    for url in urls:
        _process_url(
            url,
            dry_run=args.dry_run,
            resume=args.resume,
            no_claude=args.no_claude,
            no_agent_fallback=args.no_agent_fallback,
            no_hybrid=args.no_hybrid,
            force_playwright=args.force_playwright,
            verbose=verbose,
            profile=args.profile,
            publish=not args.no_publish,
            publish_threshold=args.publish_threshold,
        )


# ---------------------------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------------------------

def _process_url(
    url: str,
    *,
    dry_run: bool = False,
    resume: bool = False,
    no_claude: bool = False,
    no_agent_fallback: bool = False,
    no_hybrid: bool = False,
    force_playwright: bool = False,
    verbose: bool = True,
    profile: Optional[str] = None,
    publish: bool = True,
    publish_threshold: int = 95,
) -> Optional[ValidationReport]:
    total_start = time.time()

    print(f"\n{'='*70}")
    print(f"  SCRAPER USINE : {url}")
    print(f"{'='*70}")
    print(f"  [{_ts()}] Démarrage pipeline\n")
    if no_hybrid:
        print(f"  [{_ts()}] Mode qualité max actif (--no-hybrid : Opus full pour ce run)")

    # Superviseur Claude unique pour tout le run (compteur de réécritures partagé).
    # Le flag force_full_claude (Phase 2.8) lui dit d'ignorer CLAUDE_HYBRID_ENABLED
    # pour CE run uniquement, sans toucher la config globale.
    supervisor = ClaudeSupervisor(
        enabled=not no_claude, verbose=verbose,
        force_full_claude=no_hybrid,
    )
    if not supervisor.enabled and not no_claude:
        print(f"  [{_ts()}] (Supervision Claude indisponible — pipeline en mode dégradé)")

    # --- Phase 1 : Analyse ---
    analysis: Optional[SiteAnalysis] = None

    if resume:
        print(f"  [{_ts()}] Tentative chargement analyse depuis cache...")
        analysis = _try_load_analysis(url, verbose)
        if analysis:
            print(f"  [{_ts()}] Phase 1 SKIP (analyse chargée depuis le cache)\n")

    if analysis is None:
        print(f"  [{_ts()}] Phase 1 : Analyse du site...")
        phase1_start = time.time()
        analyzer = SiteAnalyzer(
            use_playwright=True, verbose=verbose,
            force_profile_key=profile,
        )
        analysis = analyzer.analyze(url)
        print(f"  [{_ts()}] Phase 1 terminée en {time.time()-phase1_start:.1f}s")

        # Durcissement Phase 3 du plan : l'anti-bot n'arrête plus le pipeline.
        # Le planner basculera automatiquement en Playwright + stealth, et
        # l'agent Claude (Phase 4.5) peut explorer le site différemment.
        # Pour rétablir l'ancien comportement, exporter USINE_ABORT_ON_ANTIBOT=1.
        if analysis.anti_bot:
            if os.environ.get("USINE_ABORT_ON_ANTIBOT", "0") in ("1", "true", "yes"):
                print(f"\n  [{_ts()}] ABANDON : anti-bot détecté ({analysis.anti_bot})")
                print(f"  USINE_ABORT_ON_ANTIBOT=1 — arrêt explicite demandé.\n")
                return None
            print(
                f"  [{_ts()}] WARN anti-bot ({analysis.anti_bot}) — "
                f"on continue en mode Playwright + stealth. "
                f"Configurer SCRAPER_PROXY_URL pour activer un proxy résidentiel."
            )

        if analysis.needs_playwright and not analysis.listing_pages and not analysis.sitemap_urls and not analysis.detected_apis:
            playwright_ok = False
            try:
                import playwright
                playwright_ok = True
            except ImportError:
                pass
            if not playwright_ok:
                print(f"\n  [{_ts()}] PROBLEME : ce site est rendu côté client (JavaScript/SPA).")
                print(f"  L'inventaire n'est pas visible dans le HTML brut.")
                print(f"  Playwright est REQUIS pour ce type de site.")
                print(f"  Installez-le avec : pip install playwright && playwright install chromium")
                print(f"  Puis relancez la commande.\n")
                return None

    # Hook supervision Phase 1 (lecture seule).
    # Note : un verdict `fail` signale une analyse incohérente, mais on ne
    # coupe pas le pipeline — la Phase 4.5 (agent autonome) est précisément
    # conçue pour récupérer ces cas en explorant le site directement.
    if supervisor.enabled:
        v1 = supervisor.review_analysis(analysis)
        print(f"  [{_ts()}] Claude review Phase 1 : {v1.status} — {v1.reasoning[:120]}")

    # --- Phase 2 : Stratégie ---
    print(f"\n  [{_ts()}] Phase 2 : Planification de la stratégie...")
    phase2_start = time.time()
    planner = StrategyPlanner(verbose=verbose)
    strategy = planner.plan(analysis)
    print(f"  [{_ts()}] Phase 2 terminée en {time.time()-phase2_start:.1f}s")

    if force_playwright:
        from .models import RenderingMethod
        strategy.rendering = RenderingMethod.PLAYWRIGHT

    if dry_run:
        _print_dry_run(analysis, strategy)
        return None

    # Idem Phase 2 : un fail Claude est un signal fort pour la Phase 4.5
    # (l'agent autonome reconstruira from scratch). On loggue mais on continue.
    if supervisor.enabled:
        v2 = supervisor.review_strategy(analysis, strategy)
        print(f"  [{_ts()}] Claude review Phase 2 : {v2.status} — {v2.reasoning[:120]}")

    # --- Phase 3 : Génération ---
    print(f"\n  [{_ts()}] Phase 3 : Génération du scraper...")
    phase3_start = time.time()
    generator = ScraperCodeGenerator(verbose=verbose)
    generated = generator.generate(analysis, strategy)
    print(f"  [{_ts()}] Phase 3 terminée en {time.time()-phase3_start:.1f}s")
    print(f"    Fichier: {generated.file_path}")
    print(f"    Classe: {generated.class_name}")

    # Bind le supervisor au slug pour que les audits aient une destination.
    if supervisor.enabled:
        supervisor.set_slug(generated.slug)

        # Hook Phase 3 : review + rewrite éventuel du code généré.
        # Optimisation coût : on ne lance la review que sur les plateformes
        # GENERIC (non reconnues). Sur Shopify / WooCommerce / eDealer / Magento
        # / Prestashop etc., les templates Jinja2 sont éprouvés et la Phase 4
        # (validation par exécution réelle) est le filet réel — la review
        # Phase 3 ne ferait que coûter ~35K tokens d'input sans valeur ajoutée.
        # Réactiver via USINE_FORCE_PHASE3_REVIEW=1 pour debug.
        from .models import PlatformType
        force_review = os.environ.get("USINE_FORCE_PHASE3_REVIEW", "0") in ("1", "true", "yes")
        platform_is_known = analysis.platform.platform_type != PlatformType.GENERIC
        if platform_is_known and not force_review:
            print(
                f"  [{_ts()}] Claude review Phase 3 : SKIP "
                f"(plateforme connue: {analysis.platform.platform_type.value}, "
                f"templates Jinja2 fiables - la Phase 4 valide en exécution)"
            )
        else:
            v3, rewritten = supervisor.review_and_fix_code(generated, analysis)
            print(f"  [{_ts()}] Claude review Phase 3 : {v3.status} — {v3.reasoning[:120]}")
            if rewritten:
                print(f"  [{_ts()}] Code Phase 3 réécrit par Claude ({len(rewritten)} chars)")

    # --- Phase 4 : Validation ---
    print(f"\n  [{_ts()}] Phase 4 : Validation...")
    phase4_start = time.time()
    # On passe le supervisor au validator pour partager le compteur de réécritures.
    validator = ScraperValidator(verbose=verbose, supervisor=supervisor if supervisor.enabled else None)
    report = validator.validate(generated, analysis, strategy)
    print(f"  [{_ts()}] Phase 4 terminée en {time.time()-phase4_start:.1f}s")

    # --- Auto-correction Claude (Phase 4) ---
    if report.score < 80 and not no_claude:
        print(f"\n  [{_ts()}] Score {report.score}/100 < 80 — auto-correction Claude...")
        for attempt in range(1, 3):
            print(f"  [{_ts()}] Auto-correction #{attempt}...")
            corrected_code = validator.auto_correct(report, generated, analysis)
            if corrected_code:
                print(f"  [{_ts()}] Correction reçue, re-validation...")
                report = validator.validate(generated, analysis, strategy)
                if report.score >= 80:
                    print(f"  [{_ts()}] Score amélioré: {report.score}/100")
                    break
            else:
                print(f"  [{_ts()}] Pas de correction disponible")
                break

    # --- Correction ciblée des champs faibles (même si score global >= 80) ---
    if not no_claude and report.score >= 80:
        weak = validator.weak_fields(report, threshold=0.9)
        if weak:
            print(f"\n  [{_ts()}] Score global OK ({report.score}) mais champs faibles: {weak}")
            corrected_code = validator.auto_correct(
                report, generated, analysis, target_fields=weak,
            )
            if corrected_code:
                print(f"  [{_ts()}] Correction ciblée reçue, re-validation...")
                report = validator.validate(generated, analysis, strategy)
                print(f"  [{_ts()}] Score après correction ciblée: {report.score}/100")

    # --- Phase 4.5 : AI Agent Claude (fallback from-scratch) ---
    # Déclenché quand le code templates + corrections n'a pas atteint le seuil.
    # L'agent reconstruit le scraper avec tool use Anthropic (fetch HTML,
    # inspect DOM, write code, run scraper) — il sort du cadre Jinja2.
    if (report.score < 80 and not no_claude and not no_agent_fallback
            and supervisor.enabled):
        print(f"\n  [{_ts()}] Phase 4.5 : Score {report.score}/100 < 80 — bascule sur AI Agent Claude...")
        agent = ClaudeAgent(verbose=verbose)
        if not agent.enabled:
            print(f"  [{_ts()}] Agent Claude indisponible (clé manquante ou anthropic non installé)")
        else:
            agent_start = time.time()
            new_generated = agent.build_scraper_from_scratch(
                analysis, strategy, prior_attempt=generated,
            )
            print(f"  [{_ts()}] Agent terminé en {time.time()-agent_start:.1f}s")
            if new_generated:
                generated = new_generated
                print(f"  [{_ts()}] Re-validation du scraper reconstruit par l'agent...")
                report = validator.validate(generated, analysis, strategy)
                print(f"  [{_ts()}] Score après agent : {report.score}/100")
            else:
                print(f"  [{_ts()}] Agent n'a pas produit de scraper validé — on garde l'ancien code")

    # --- Verdict final go/no-go (avant publication) ---
    final_verdict_status = "ok"
    if supervisor.enabled and publish:
        v_final = supervisor.final_go_no_go(generated, analysis, strategy, report)
        final_verdict_status = v_final.status
        print(f"\n  [{_ts()}] Claude verdict final : {v_final.status} — {v_final.reasoning[:160]}")
        if v_final.status == "fail":
            print(f"  [{_ts()}] Phases 5-7 SKIP : Claude rejette la publication "
                  f"(audit dans scraper_cache/supervision/{generated.slug}_audit.json)")
            publish = False  # n'empêche pas le résumé final, juste pas de push

    # --- Phase 5 : Publication en pending dans shared_scrapers ---
    published = False
    if publish:
        print(f"\n  [{_ts()}] Phase 5 : Publication en pending dans shared_scrapers...")
        publish_result = publish_pending_scraper(
            analysis=analysis,
            strategy=strategy,
            generated=generated,
            report=report,
            threshold=publish_threshold,
            verbose=verbose,
        )
        published = publish_result is not None

    # --- Phase 6 : Génération du workflow GitHub Action dédié ---
    # On crée un workflow YAML par scraper qui le scrape toutes les heures via
    # `scripts/scrape_single_site.py`. Couche de redondance vis-à-vis du cron
    # orchestrateur principal (Vercel → Railway), avec skip auto si cache frais.
    workflow_relpath: Optional[str] = None
    if publish and published:
        print(f"\n  [{_ts()}] Phase 6 : Génération du workflow GitHub Action...")
        repo_root = Path(generated.file_path).resolve().parent.parent.parent
        site_name = analysis.site_name or generated.slug.replace("-", " ").title()
        try:
            wf_result = write_workflow_for_scraper(
                repo_root=repo_root,
                site_slug=generated.slug,
                site_name=site_name,
                verbose=verbose,
            )
            workflow_relpath = wf_result.relative_path
        except Exception as e:
            print(f"  [{_ts()}] ⚠️ Échec génération workflow: {type(e).__name__}: {e}")

    # --- Phase 7 : Auto-push du code Python + workflow sur Git ---
    # Critique pour Railway : sans ça le fichier .py vit sur disque éphémère et
    # disparaît au prochain redéploiement. Skip si publication a échoué (score
    # trop bas) — pas la peine de polluer le Git avec un scraper inactivé.
    push_result: Optional[GitPushResult] = None
    if publish and published:
        print(f"\n  [{_ts()}] Phase 7 : Push du code + workflow sur Git...")
        push_result = commit_and_push_scraper(
            generated=generated,
            score=report.score,
            message_extra=(
                f"Score {report.score}/100 ({report.grade}) — "
                f"{report.products_tested} produits testés.\n"
                f"Stratégie : {generated.strategy_summary}.\n"
                f"Plateforme : {analysis.platform.name}."
            ),
            verbose=verbose,
        )
    elif publish and not published:
        print(f"\n  [{_ts()}] Phases 6-7 SKIP : score insuffisant pour générer + push.")

    elapsed = time.time() - total_start

    # --- Résumé ---
    print(f"\n{'='*70}")
    print(f"  RÉSULTAT: {analysis.site_name}")
    print(f"{'='*70}")
    print(f"  Score      : {report.score}/100 ({report.grade})")
    print(f"  Produits   : {report.products_tested}")
    print(f"  Stratégie  : {generated.strategy_summary}")
    print(f"  Fichier    : {generated.file_path}")
    print(f"  Temps total: {elapsed:.1f}s")
    if report.warnings:
        print(f"  Warnings   :")
        for w in report.warnings:
            print(f"    - {w}")
    if final_verdict_status == "fail":
        print(f"  Statut     : REJETÉ par Claude (verdict final fail) — review manuelle requise")
    elif publish and report.score >= publish_threshold:
        print(f"  Statut     : PENDING (à valider sur /admin/scrapers)")
    elif publish:
        print(f"  Statut     : score < seuil ({publish_threshold}) — non publié")
    if supervisor.enabled:
        # Phase 2.8 : logger mode_used dans le summary + audit
        mode_used = "full_claude" if no_hybrid else (
            "hybrid" if os.environ.get("CLAUDE_HYBRID_ENABLED", "0") == "1" else "full_claude"
        )
        print(f"  Mode       : {mode_used}")
        print(f"  Audit      : scraper_cache/supervision/{generated.slug}_audit.json")
        # Persister le mode_used dans l'audit JSON pour les requêtes du dashboard
        try:
            audit_path = SUPERVISION_DIR / f"{generated.slug}_audit.json"
            if audit_path.exists():
                ad = json.loads(audit_path.read_text(encoding="utf-8"))
                ad["mode_used"] = mode_used
                audit_path.write_text(
                    json.dumps(ad, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
        except Exception:
            pass  # best-effort
    if workflow_relpath:
        print(f"  Workflow   : {workflow_relpath}")
    if push_result and push_result.pushed:
        short_sha = (push_result.commit_sha or "")[:8]
        print(f"  Git        : commit {short_sha} pushé sur {push_result.repo}@{push_result.branch}")
        print(f"               → Railway redéploiera dans ~2 min, scraper actif au prochain cron")
    elif push_result and push_result.skipped_reason == "env_missing":
        print(f"  Git        : push manuel requis (GITHUB_PAT/GITHUB_REPO non configurés)")
    elif push_result and push_result.skipped_reason == "no_changes_to_commit":
        print(f"  Git        : aucun changement (fichiers déjà à jour)")
    elif push_result and push_result.error:
        print(f"  Git        : ÉCHEC — {push_result.error[:100]}")
    print(f"{'='*70}\n")

    return report


def _ts() -> str:
    """Timestamp court pour les logs."""
    return time.strftime("%H:%M:%S")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

def _run_check(slug: str, verbose: bool) -> None:
    print(f"\n  Health check: {slug}")
    validator = ScraperValidator(verbose=verbose)
    report = validator.health_check(slug)
    print(f"  Score: {report.score}/100 ({report.grade})")
    if report.warnings:
        for w in report.warnings:
            print(f"    - {w}")
    if report.errors:
        for e in report.errors:
            print(f"    ERROR: {e}")


def _run_check_all(verbose: bool) -> None:
    try:
        from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry
        all_scrapers = DedicatedScraperRegistry.list_all()
    except Exception as e:
        print(f"  Erreur chargement registry: {e}")
        return

    print(f"\n  Health check sur {len(all_scrapers)} scrapers...\n")
    validator = ScraperValidator(verbose=False)

    for info in all_scrapers:
        slug = info["slug"]
        report = validator.health_check(slug)
        status = "OK" if report.score >= 80 else "WARN" if report.score >= 60 else "FAIL"
        degradation = ""
        for w in report.warnings:
            if "Dégradation" in w:
                degradation = f" {w}"
        print(f"  [{status:4s}] {slug:25s} {report.score:3d}/100{degradation}")


# ---------------------------------------------------------------------------
# Audit Claude (CLI: --audit <slug>)
# ---------------------------------------------------------------------------

def _print_audit(slug: str) -> None:
    """Affiche l'audit Claude (verdicts par phase + extrait trace agent).

    Cible : ``scraper_cache/supervision/{slug}_audit.json`` et
    ``{slug}_agent_trace.jsonl`` (s'ils existent).
    """
    audit_path = SUPERVISION_DIR / f"{slug}_audit.json"
    trace_path = SUPERVISION_DIR / f"{slug}_agent_trace.jsonl"

    if not audit_path.exists() and not trace_path.exists():
        print(f"  Aucun audit trouvé pour '{slug}' dans {SUPERVISION_DIR}")
        return

    print(f"\n{'='*70}")
    print(f"  AUDIT CLAUDE : {slug}")
    print(f"{'='*70}")

    if audit_path.exists():
        try:
            payload = json.loads(audit_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  Erreur lecture audit: {e}")
            payload = {"events": []}

        events = payload.get("events", [])
        print(f"\n  --- VERDICTS PAR PHASE ({len(events)} évènement(s)) ---")
        for ev in events:
            phase = ev.get("phase", "?")
            status = ev.get("status", "?")
            ts = ev.get("timestamp", "")[:19]
            rewrite = "↻" if ev.get("rewrite_applied") else " "
            reasoning = (ev.get("reasoning", "") or "")[:200]
            print(f"  [{ts}] {rewrite} {phase:25s} {status:8s} {reasoning}")
            for sug in (ev.get("suggestions") or [])[:3]:
                print(f"        suggestion: {sug[:160]}")

    if trace_path.exists():
        print(f"\n  --- TRACE AGENT (dernières lignes de {trace_path.name}) ---")
        try:
            lines = trace_path.read_text(encoding="utf-8").strip().splitlines()
            for line in lines[-30:]:
                try:
                    ev = json.loads(line)
                    ts = (ev.get("ts", "") or "")[:19]
                    typ = ev.get("type", "?")
                    if typ == "tool_result":
                        preview = ev.get("preview", "")[:160]
                        print(f"  [{ts}] tool_result {ev.get('tool_name', '?'):20s} {preview}")
                    elif typ == "assistant_message":
                        blocks = ev.get("blocks", [])
                        previews = ", ".join(
                            f"{b.get('type', '?')}:{(b.get('preview') or '')[:60]}"
                            for b in blocks[:3]
                        )
                        print(f"  [{ts}] assistant   {previews}")
                    else:
                        print(f"  [{ts}] {typ:18s} {json.dumps({k: v for k, v in ev.items() if k not in ('ts','type')}, default=str)[:160]}")
                except Exception:
                    print(f"  (ligne illisible: {line[:120]})")
        except Exception as e:
            print(f"  Erreur lecture trace: {e}")

    print(f"\n{'='*70}\n")


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def _try_load_analysis(url: str, verbose: bool) -> Optional[SiteAnalysis]:
    """Tente de charger une analyse sauvegardée pour cette URL."""
    import re
    from urllib.parse import urlparse
    domain = urlparse(url).netloc.replace("www.", "")
    slug = re.sub(r"\.(com|ca|net|org|fr|qc\.ca)$", "", domain)
    slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")

    path = ANALYSIS_DIR / f"{slug}_analysis.json"
    if path.exists():
        try:
            return SiteAnalysis.load(path)
        except Exception as e:
            if verbose:
                print(f"    Erreur chargement analyse: {e}")
    return None


def _read_batch(filepath: str) -> List[str]:
    path = Path(filepath)
    if not path.exists():
        print(f"  Fichier batch introuvable: {filepath}")
        sys.exit(1)
    urls = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            urls.append(line)
    return urls


def _print_dry_run(analysis: SiteAnalysis, strategy) -> None:
    print(f"\n  --- DRY RUN (pas de génération) ---")
    print(f"  Site        : {analysis.site_name} ({analysis.domain})")
    print(f"  Plateforme  : {analysis.platform.name}")
    print(f"  Listings    : {len(analysis.listing_pages)}")
    print(f"  Sitemap URLs: {len(analysis.sitemap_urls)}")
    print(f"  APIs        : {len(analysis.detected_apis)}")
    print(f"  JSON-LD     : {'oui' if analysis.json_ld_available else 'non'} ({analysis.json_ld_type})")
    print(f"  Playwright  : {'oui' if analysis.needs_playwright else 'non'}")
    print(f"  Anti-bot    : {analysis.anti_bot or 'aucun'}")
    print(f"  Prix        : {analysis.price_display_mode.value}")
    print(f"  Encodage    : {'mojibake' if analysis.needs_mojibake_fix else 'ok'}")
    print(f"  Warm-up     : {'oui' if analysis.warm_up_required else 'non'}")
    print(f"\n  STRATÉGIE:")
    print(f"  Discovery   : {strategy.discovery_method.value}")
    print(f"  Pagination  : {strategy.pagination_method.value}")
    print(f"  Extraction  : {strategy.extraction_method.value}")
    print(f"  Rendering   : {strategy.rendering.value}")
    print(f"  Classe base : {strategy.base_class}")
    print(f"  Override    : {'oui' if strategy.needs_scrape_override else 'non'}")
    print(f"  Pages détail: {'oui' if strategy.needs_detail_pages else 'non'}")
    print()


if __name__ == "__main__":
    main()
