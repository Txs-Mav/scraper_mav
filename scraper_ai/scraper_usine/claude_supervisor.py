"""Superviseur Claude pour le pipeline scraper_usine (phases 1 → 5).

Claude joue trois rôles imbriqués :
  1. **Juge** (lecture seule) : il observe les sorties des phases 1, 2 et 5
     et émet un :class:`Verdict` (``ok`` / ``warning`` / ``fail``).
  2. **Correcteur actif** : aux phases 3 (post-génération) et 4 (post-validation),
     il peut renvoyer un fichier Python complet réécrit qui écrase celui
     sur disque après validation ``ast.parse``.
  3. **Fallback** : si après 2 itérations de :meth:`correct_scraper` le score
     reste insuffisant, l'orchestrateur (``main.py``) bascule sur
     :class:`scraper_ai.scraper_usine.claude_agent.ClaudeAgent` qui lui
     reconstruit le scraper from scratch.

Toutes les interventions sont tracées dans
``scraper_cache/supervision/{slug}_audit.json`` avec hash sha1 du code
avant/après pour faciliter le débogage et la revue manuelle.
"""
from __future__ import annotations

import ast
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import requests

from .models import (
    GeneratedScraper, ScrapingStrategy, SiteAnalysis,
    ValidationReport, _to_serializable,
)
from .domain_profiles import get_profile

try:
    from scraper_ai.config import (
        CLAUDE_MAX_REWRITES,
        CLAUDE_SUPERVISOR_ENABLED,
    )
    from scraper_ai.claude_client import ClaudeClient, ClaudeUnavailableError
except ImportError:  # pragma: no cover
    from ..config import (  # type: ignore[no-redef]
        CLAUDE_MAX_REWRITES,
        CLAUDE_SUPERVISOR_ENABLED,
    )
    from ..claude_client import (  # type: ignore[no-redef]
        ClaudeClient, ClaudeUnavailableError,
    )


SUPERVISION_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "scraper_cache" / "supervision"
)

# Limite max d'un échantillon HTML envoyé à Claude. Au-delà, on tronque
# pour ne pas exploser le contexte (Claude Sonnet 4.5 = 200K tokens, mais
# on reste large pour laisser de la place au reste du prompt + tool history).
HTML_SAMPLE_MAX_BYTES = 80_000

# Limite max du code envoyé à Claude pour rewrite. Au-delà, on tronque et
# on fournit la structure (signatures + méthodes pertinentes).
CODE_SAMPLE_MAX_BYTES = 40_000


VerdictStatus = Literal["ok", "warning", "fail"]


@dataclass
class Verdict:
    """Résultat d'un appel de supervision Claude.

    ``rewritten_code`` n'est rempli que par les méthodes de réécriture
    (Phase 3 et Phase 4). Sur les phases lecture seule, il reste ``None``.
    """
    status: VerdictStatus = "ok"
    reasoning: str = ""
    rewritten_code: Optional[str] = None
    tokens_in: int = 0
    tokens_out: int = 0
    suggestions: List[str] = field(default_factory=list)


class ClaudeSupervisor:
    """Orchestre review + réécriture par Claude sur les phases 1-5."""

    def __init__(self, *, slug: Optional[str] = None,
                 enabled: bool = True, verbose: bool = True):
        self.verbose = verbose
        self.slug = slug
        self._rewrite_count = 0
        self._client: Optional[ClaudeClient] = None
        self._disabled_reason: Optional[str] = None
        self.audit_path: Optional[Path] = None

        if not enabled or not CLAUDE_SUPERVISOR_ENABLED:
            self._disabled_reason = (
                "Désactivé via flag --no-claude ou CLAUDE_SUPERVISOR_ENABLED=0"
            )
            self._log(self._disabled_reason)
            return

        try:
            self._client = ClaudeClient(verbose=verbose)
        except ClaudeUnavailableError as e:
            self._disabled_reason = str(e)
            self._log(f"Désactivé : {e}")

    # ------------------------------------------------------------------
    # Propriétés / état
    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def set_slug(self, slug: str) -> None:
        """Bind le slug du run courant (initialise le fichier d'audit)."""
        self.slug = slug
        SUPERVISION_DIR.mkdir(parents=True, exist_ok=True)
        self.audit_path = SUPERVISION_DIR / f"{slug}_audit.json"
        if not self.audit_path.exists():
            self.audit_path.write_text(
                json.dumps({"slug": slug, "events": []}, indent=2,
                           ensure_ascii=False),
                encoding="utf-8",
            )

    @property
    def remaining_rewrites(self) -> int:
        return max(0, CLAUDE_MAX_REWRITES - self._rewrite_count)

    # ------------------------------------------------------------------
    # Phase 1 : review de l'analyse (lecture seule)
    # ------------------------------------------------------------------

    def review_analysis(self, analysis: SiteAnalysis) -> Verdict:
        if not self.enabled:
            return Verdict(status="ok", reasoning="Supervisor désactivé")

        summary = self._summarize_analysis(analysis)
        prompt = (
            "Tu es un auditeur expert en web scraping. Voici le résumé "
            "de la Phase 1 (analyse de site) du pipeline scraper_usine. "
            "Évalue la cohérence des signaux détectés et signale toute "
            "incohérence évidente qui pourrait empêcher la génération "
            "d'un scraper fonctionnel.\n\n"
            f"{summary}\n\n"
            "Réponds en JSON strict : "
            '{"status": "ok"|"warning"|"fail", "reasoning": "...", '
            '"suggestions": ["..."]}\n'
            "- status=fail UNIQUEMENT si l'analyse est inutilisable "
            "(ex: anti-bot dur + aucun listing + aucun sitemap + aucune API).\n"
            "- status=warning si incohérences mineures (ex: signaux SPA "
            "mais needs_playwright=False, JSON-LD absent sur un site moderne).\n"
            "- status=ok sinon."
        )
        verdict = self._json_call(prompt, system=_SYSTEM_AUDITOR)
        self._save_audit("phase1_analysis", verdict, rewrite_applied=False)
        return verdict

    # ------------------------------------------------------------------
    # Phase 2 : review de la stratégie (lecture seule)
    # ------------------------------------------------------------------

    def review_strategy(self, analysis: SiteAnalysis,
                        strategy: ScrapingStrategy) -> Verdict:
        if not self.enabled:
            return Verdict(status="ok", reasoning="Supervisor désactivé")

        summary = self._summarize_strategy(analysis, strategy)
        prompt = (
            "Tu es un auditeur expert en web scraping. Voici la stratégie "
            "Phase 2 sélectionnée par le planner. Vérifie qu'elle est "
            "cohérente avec les signaux détectés en Phase 1.\n\n"
            f"{summary}\n\n"
            "Cas typiques d'incohérence :\n"
            "- discovery_method=API mais aucune detected_apis;\n"
            "- discovery_method=SITEMAP mais aucun sitemap_url;\n"
            "- extraction_method=JSON_LD mais json_ld_available=False;\n"
            "- rendering=REQUESTS mais needs_playwright=True.\n\n"
            "Réponds en JSON strict : "
            '{"status": "ok"|"warning"|"fail", "reasoning": "...", '
            '"suggestions": ["..."]}'
        )
        verdict = self._json_call(prompt, system=_SYSTEM_AUDITOR)
        self._save_audit("phase2_strategy", verdict, rewrite_applied=False)
        return verdict

    # ------------------------------------------------------------------
    # Phase 3 : review du code généré + rewrite éventuel
    # ------------------------------------------------------------------

    def review_and_fix_code(
        self,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        html_sample: Optional[str] = None,
    ) -> Tuple[Verdict, Optional[str]]:
        """Audit du code juste après la Phase 3.

        Si Claude juge le code mauvais ou incomplet, il renvoie un fichier
        Python COMPLET réécrit. On le valide via ``ast.parse`` puis on
        l'écrit sur disque avant la Phase 4. Retourne ``(Verdict, code_appliqué_ou_None)``.
        """
        if not self.enabled:
            return Verdict(status="ok", reasoning="Supervisor désactivé"), None

        if self.remaining_rewrites <= 0:
            return Verdict(
                status="warning",
                reasoning=f"Budget de réécritures épuisé ({CLAUDE_MAX_REWRITES})",
            ), None

        if html_sample is None:
            html_sample = self._fetch_html_sample_for_analysis(analysis)

        profile = get_profile(analysis.domain_profile_key or "auto")
        target_fields = ", ".join(f.name for f in profile.fields)

        code_block = self._truncate_for_prompt(generated.code, CODE_SAMPLE_MAX_BYTES)
        html_block = self._truncate_for_prompt(html_sample or "", HTML_SAMPLE_MAX_BYTES)

        prompt = (
            f"Tu es un expert Python en web scraping. Voici un scraper "
            f"généré par templates Jinja2 pour {analysis.site_url}.\n\n"
            f"PROFIL DOMAINE: {profile.name} (champs cibles: {target_fields})\n"
            f"PLATEFORME: {analysis.platform.name}\n\n"
            f"CODE GÉNÉRÉ:\n```python\n{code_block}\n```\n\n"
            f"HTML LIVE D'UNE PAGE PRODUIT (échantillon):\n"
            f"```html\n{html_block}\n```\n\n"
            "Vérifie que :\n"
            "1. Les sélecteurs CSS du code correspondent à des éléments "
            "présents dans le HTML;\n"
            "2. Les méthodes obligatoires (discover_product_urls, "
            "extract_from_detail_page) ont une logique non-vide;\n"
            "3. Pas d'anti-pattern Python évident (regex mal échappée, "
            "exception silencieuse, boucle infinie).\n\n"
            "Si le code est OK, réponds en JSON strict :\n"
            '{"status": "ok", "reasoning": "...", "rewritten_code": null}\n\n'
            "Si le code doit être réécrit (sélecteurs faux, méthode vide, "
            "bug évident), réponds avec le fichier Python COMPLET réécrit :\n"
            '{"status": "warning", "reasoning": "...", '
            '"rewritten_code": "<contenu .py complet>"}\n\n'
            "RÈGLES STRICTES si tu réécris :\n"
            "- Conserve la classe, son héritage, et les attributs SITE_*;\n"
            "- N'ajoute pas de docstring de plus de 5 lignes;\n"
            "- Le fichier doit être directement importable depuis "
            "`scraper_ai.dedicated_scrapers`."
        )

        verdict = self._json_call(prompt, system=_SYSTEM_REWRITER, max_tokens=20000)
        applied = self._maybe_apply_rewrite(generated, verdict)
        self._save_audit("phase3_codegen", verdict, rewrite_applied=applied)
        return verdict, generated.code if applied else None

    # ------------------------------------------------------------------
    # Phase 4 : auto-correction (remplace l'ancien Gemini)
    # ------------------------------------------------------------------

    def correct_scraper(
        self,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        report: ValidationReport,
        *,
        target_fields: Optional[List[str]] = None,
        html_sample: Optional[str] = None,
    ) -> Optional[str]:
        """Réécrit le scraper après une validation insatisfaisante.

        Drop-in replacement de ``ScraperValidator.auto_correct`` côté Gemini.
        Retourne le code corrigé (déjà écrit sur disque) ou ``None`` si
        Claude refuse / échoue / budget épuisé.
        """
        if not self.enabled:
            return None
        if self.remaining_rewrites <= 0:
            self._log("Budget de réécritures épuisé — pas de correction.")
            return None

        if html_sample is None:
            html_sample = self._fetch_html_sample_for_report(report)

        prompt = self._build_correction_prompt(
            report, generated, analysis, target_fields=target_fields,
            html_sample=html_sample,
        )

        try:
            verdict = self._json_call(prompt, system=_SYSTEM_REWRITER, max_tokens=20000)
        except Exception as e:
            self._log(f"correct_scraper a échoué : {type(e).__name__}: {e}")
            return None

        applied = self._maybe_apply_rewrite(generated, verdict)
        self._save_audit("phase4_autocorrect", verdict, rewrite_applied=applied)
        return generated.code if applied else None

    # ------------------------------------------------------------------
    # Verdict final go/no-go (avant Phase 5)
    # ------------------------------------------------------------------

    def final_go_no_go(
        self,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        strategy: ScrapingStrategy,
        report: ValidationReport,
    ) -> Verdict:
        if not self.enabled:
            return Verdict(status="ok", reasoning="Supervisor désactivé")

        sample = json.dumps(report.sample_products[:2], indent=2,
                            ensure_ascii=False, default=str)
        coverage = ", ".join(
            f"{fd.field_name}={fd.coverage:.0%}"
            for fd in report.field_details
        )
        prompt = (
            f"Décision finale go/no-go pour publier le scraper de "
            f"{analysis.site_name} ({analysis.site_url}).\n\n"
            f"SCORE: {report.score}/100 ({report.grade})\n"
            f"PRODUITS TESTÉS: {report.products_tested}\n"
            f"COUVERTURE: {coverage}\n"
            f"WARNINGS: {report.warnings or '(aucun)'}\n"
            f"ÉCHANTILLON:\n{sample}\n\n"
            "Critères go (status=ok) :\n"
            "- score >= 80 ET au moins un produit avec name + (prix OU sourceUrl) valide;\n"
            "- aucune erreur fatale, pas de soft-404 majoritaire.\n\n"
            "Sinon status=fail. Réponds en JSON strict :\n"
            '{"status": "ok"|"warning"|"fail", "reasoning": "...", '
            '"suggestions": ["..."]}'
        )
        verdict = self._json_call(prompt, system=_SYSTEM_AUDITOR)
        self._save_audit("phase5_final_go_no_go", verdict, rewrite_applied=False)
        return verdict

    # ==================================================================
    # Helpers internes
    # ==================================================================

    def _maybe_apply_rewrite(self, generated: GeneratedScraper,
                             verdict: Verdict) -> bool:
        """Valide + écrit sur disque le code réécrit. Met à jour
        ``generated.code`` et incrémente le compteur de réécritures."""
        new_code = verdict.rewritten_code
        if not new_code or not new_code.strip():
            return False
        if "class " not in new_code:
            self._log("rewrite ignoré : pas de classe détectée")
            return False

        try:
            ast.parse(new_code)
        except SyntaxError as e:
            self._log(f"rewrite ignoré : SyntaxError {e}")
            verdict.status = "warning"
            verdict.reasoning += f" [rewrite REJETÉ : SyntaxError {e}]"
            return False

        if not generated.file_path:
            self._log("rewrite ignoré : pas de file_path sur GeneratedScraper")
            return False

        path = Path(generated.file_path)
        path.write_text(new_code, encoding="utf-8")
        generated.code = new_code
        self._rewrite_count += 1
        self._log(
            f"Code réécrit appliqué ({self._rewrite_count}/"
            f"{CLAUDE_MAX_REWRITES}) → {path.name}"
        )
        return True

    def _json_call(self, prompt: str, *, system: Optional[str] = None,
                   max_tokens: Optional[int] = None) -> Verdict:
        """Wrap un appel Claude qui doit renvoyer du JSON Verdict-like.

        Tolère les réponses non-JSON en renvoyant un Verdict warning.
        """
        if self._client is None:
            return Verdict(status="ok", reasoning="Supervisor désactivé")

        try:
            data = self._client.call(
                prompt, system=system,
                response_mime_type="application/json",
                max_tokens=max_tokens,
            )
        except Exception as e:
            self._log(f"appel Claude échoué : {type(e).__name__}: {e}")
            return Verdict(
                status="warning",
                reasoning=f"Claude API erreur: {e}",
            )

        return self._verdict_from_json(data)

    @staticmethod
    def _verdict_from_json(data: Any) -> Verdict:
        if not isinstance(data, dict):
            return Verdict(status="warning",
                           reasoning=f"Réponse non-dict: {type(data).__name__}")
        status = data.get("status", "warning")
        if status not in ("ok", "warning", "fail"):
            status = "warning"
        return Verdict(
            status=status,
            reasoning=str(data.get("reasoning", ""))[:2000],
            rewritten_code=data.get("rewritten_code"),
            suggestions=list(data.get("suggestions", []) or []),
        )

    # --- Audit JSON --------------------------------------------------

    def _save_audit(self, phase: str, verdict: Verdict,
                    rewrite_applied: bool) -> None:
        if not self.audit_path:
            return
        try:
            payload = json.loads(self.audit_path.read_text(encoding="utf-8"))
        except Exception:
            payload = {"slug": self.slug, "events": []}

        payload.setdefault("events", []).append({
            "phase": phase,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": verdict.status,
            "reasoning": verdict.reasoning,
            "suggestions": verdict.suggestions,
            "rewrite_applied": rewrite_applied,
            "tokens_in": verdict.tokens_in,
            "tokens_out": verdict.tokens_out,
        })
        self.audit_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    # --- Récupération HTML live --------------------------------------

    def _fetch_html_sample_for_report(self, report: ValidationReport) -> Optional[str]:
        """Récupère un HTML produit live à partir du sample du rapport.

        On essaye le premier produit qui a un sourceUrl. Si aucun, fallback
        sur l'URL du site. Tolère les échecs (Claude peut s'en passer).
        """
        candidates: List[str] = []
        for p in report.sample_products[:3]:
            url = p.get("sourceUrl") or p.get("url")
            if url:
                candidates.append(url)
        if not candidates and report.site_url:
            candidates.append(report.site_url)
        return self._fetch_first_ok(candidates)

    def _fetch_html_sample_for_analysis(self, analysis: SiteAnalysis) -> Optional[str]:
        """Cherche une URL produit probable depuis l'analyse Phase 1."""
        candidates: List[str] = []
        for lp in analysis.listing_pages[:1]:
            if lp.url:
                candidates.append(lp.url)
        if analysis.sitemap_urls:
            candidates.append(analysis.sitemap_urls[0])
        if analysis.site_url:
            candidates.append(analysis.site_url)
        return self._fetch_first_ok(candidates)

    def _fetch_first_ok(self, urls: List[str]) -> Optional[str]:
        for url in urls:
            try:
                resp = requests.get(url, timeout=15, allow_redirects=True)
                if resp.status_code == 200:
                    return self._truncate_for_prompt(
                        resp.text, HTML_SAMPLE_MAX_BYTES,
                    )
            except Exception:
                continue
        return None

    # --- Construction de prompts -------------------------------------

    @staticmethod
    def _summarize_analysis(analysis: SiteAnalysis) -> str:
        return (
            f"site_url: {analysis.site_url}\n"
            f"site_name: {analysis.site_name}\n"
            f"domain: {analysis.domain}\n"
            f"platform: {analysis.platform.name} ({analysis.platform.platform_type.value})\n"
            f"domain_profile: {analysis.domain_profile_key}\n"
            f"listing_pages: {len(analysis.listing_pages)}\n"
            f"sitemap_urls: {len(analysis.sitemap_urls)}\n"
            f"detected_apis: {len(analysis.detected_apis)}\n"
            f"json_ld_available: {analysis.json_ld_available} ({analysis.json_ld_type})\n"
            f"needs_playwright: {analysis.needs_playwright}\n"
            f"anti_bot: {analysis.anti_bot or 'aucun'}\n"
            f"price_display_mode: {analysis.price_display_mode.value}\n"
            f"spa_signals: {analysis.spa_signals_detected}"
        )

    @staticmethod
    def _summarize_strategy(analysis: SiteAnalysis,
                            strategy: ScrapingStrategy) -> str:
        return (
            f"--- ANALYSE ---\n"
            f"{ClaudeSupervisor._summarize_analysis(analysis)}\n\n"
            f"--- STRATÉGIE ---\n"
            f"discovery_method: {strategy.discovery_method.value}\n"
            f"pagination_method: {strategy.pagination_method.value}\n"
            f"extraction_method: {strategy.extraction_method.value}\n"
            f"rendering: {strategy.rendering.value}\n"
            f"base_class: {strategy.base_class}\n"
            f"needs_scrape_override: {strategy.needs_scrape_override}\n"
            f"needs_detail_pages: {strategy.needs_detail_pages}\n"
            f"price_absent_expected: {strategy.price_absent_expected}\n"
            f"warm_up: {strategy.warm_up}"
        )

    def _build_correction_prompt(
        self,
        report: ValidationReport,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        *,
        target_fields: Optional[List[str]] = None,
        html_sample: Optional[str] = None,
    ) -> str:
        issues = "\n".join(f"- {w}" for w in (report.warnings + report.errors)) or "(aucun)"
        sample = json.dumps(report.sample_products[:2], indent=2,
                            ensure_ascii=False, default=str)
        coverage = "\n".join(
            f"  - {fd.field_name}: {fd.coverage:.0%} ({fd.present_count}/{fd.total_count})"
            for fd in report.field_details
        )
        focus = ""
        if target_fields:
            focus = (
                f"\nCIBLE LA CORRECTION sur ces champs uniquement : "
                f"{', '.join(target_fields)}.\n"
                "Ne touche pas aux autres méthodes."
            )

        code_block = self._truncate_for_prompt(generated.code, CODE_SAMPLE_MAX_BYTES)
        html_block = (
            self._truncate_for_prompt(html_sample, HTML_SAMPLE_MAX_BYTES)
            if html_sample else "(aucun HTML live disponible)"
        )

        return (
            f"Le scraper pour {analysis.site_url} a obtenu un score de "
            f"{report.score}/100 ({report.grade}).\n\n"
            f"PROBLÈMES:\n{issues}\n\n"
            f"COUVERTURE PAR CHAMP:\n{coverage}\n\n"
            f"ÉCHANTILLON DE PRODUITS EXTRAITS:\n{sample}\n\n"
            f"HTML LIVE D'UNE PAGE PRODUIT:\n```html\n{html_block}\n```\n\n"
            f"CODE ACTUEL DU SCRAPER:\n```python\n{code_block}\n```\n"
            f"{focus}\n\n"
            "Réécris le fichier Python COMPLET pour corriger les champs "
            "sous-couverts. Réponds en JSON strict :\n"
            '{"status": "warning", "reasoning": "...", "rewritten_code": '
            '"<fichier .py complet>"}\n\n'
            "RÈGLES :\n"
            "1. Conserve la signature de la classe, l'héritage et les attributs SITE_*;\n"
            "2. Conserve les imports existants (sauf ajout nécessaire);\n"
            "3. Si extraction CSS échoue, ajoute fallback JSON-LD ou regex sur le HTML;\n"
            "4. Préserve les méthodes qui fonctionnent (couverture > 90%);\n"
            "5. Pas de markdown, pas d'explication hors JSON."
        )

    @staticmethod
    def _truncate_for_prompt(text: Optional[str], max_bytes: int) -> str:
        if not text:
            return ""
        encoded = text.encode("utf-8")
        if len(encoded) <= max_bytes:
            return text
        truncated = encoded[:max_bytes].decode("utf-8", errors="ignore")
        return truncated + "\n... [tronqué pour limite de contexte]"

    @staticmethod
    def _sha1(text: str) -> str:
        return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [ClaudeSupervisor] {msg}")


# ---------------------------------------------------------------------------
# Prompts système (réutilisés par tous les appels — sépare le rôle des
# instructions ad hoc, permet à Claude de garder un comportement cohérent).
# ---------------------------------------------------------------------------

_SYSTEM_AUDITOR = (
    "Tu es un auditeur senior en web scraping. Tu réponds TOUJOURS en JSON "
    "strict respectant le schéma demandé, sans markdown, sans préambule. "
    "Tu es factuel : si tu n'as pas assez d'information, tu utilises status='warning' "
    "plutôt que d'inventer."
)

_SYSTEM_REWRITER = (
    "Tu es un développeur Python senior, expert en web scraping et en classes "
    "héritant de DedicatedScraper (BeautifulSoup + requests). Tu réponds "
    "TOUJOURS en JSON strict (clés: status, reasoning, rewritten_code, "
    "suggestions). Le code retourné doit être un fichier .py complet, "
    "directement importable, sans markdown, sans triple backticks."
)


__all__ = [
    "ClaudeSupervisor",
    "Verdict",
    "VerdictStatus",
    "SUPERVISION_DIR",
]
