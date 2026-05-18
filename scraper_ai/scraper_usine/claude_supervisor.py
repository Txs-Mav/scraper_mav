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
from .html_cleanup import clean_html_for_llm
from .lessons import record_lesson, extract_field_hints

try:
    from scraper_ai.config import (
        CLAUDE_CRITICAL_PLATFORMS,
        CLAUDE_HYBRID_ENABLED,
        CLAUDE_MAX_REWRITES,
        CLAUDE_MODEL_DIAGNOSIS,
        CLAUDE_MODEL_REWRITE,
        CLAUDE_SUPERVISOR_ENABLED,
    )
    from scraper_ai.claude_client import ClaudeClient, ClaudeUnavailableError
except ImportError:  # pragma: no cover
    from ..config import (  # type: ignore[no-redef]
        CLAUDE_CRITICAL_PLATFORMS,
        CLAUDE_HYBRID_ENABLED,
        CLAUDE_MAX_REWRITES,
        CLAUDE_MODEL_DIAGNOSIS,
        CLAUDE_MODEL_REWRITE,
        CLAUDE_SUPERVISOR_ENABLED,
    )
    from ..claude_client import (  # type: ignore[no-redef]
        ClaudeClient, ClaudeUnavailableError,
    )


SUPERVISION_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "scraper_cache" / "supervision"
)

# Cache disque des samples HTML déjà fetchés pour éviter de recharger 2-3 fois
# la même page (Phase 3 review + Phase 4 auto-correct + agent rebuild).
HTML_SAMPLE_CACHE_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "scraper_cache" / "html_samples"
)
HTML_SAMPLE_CACHE_TTL_SEC = 3600  # 1 heure

# Limite max d'un échantillon HTML envoyé à Claude. Au-delà, on tronque
# pour ne pas exploser le contexte (Claude Sonnet 4.5 = 200K tokens, mais
# on reste large pour laisser de la place au reste du prompt + tool history).
HTML_SAMPLE_MAX_BYTES = 80_000

# Limite max du code envoyé à Claude pour rewrite. Au-delà, on tronque et
# on fournit la structure (signatures + méthodes pertinentes).
CODE_SAMPLE_MAX_BYTES = 40_000


VerdictStatus = Literal["ok", "warning", "fail"]


def _normalize_python_bool_literals(code: str) -> str:
    """Convertit ``true``/``false`` JS-style en ``True``/``False`` Python.

    Bug récurrent observé sur les réécritures Claude (cf. bench 2026-05-16,
    9/10 sites) : le modèle produit ``USE_PLAYWRIGHT_FOR_DISCOVERY = true``
    avec une minuscule. ``ast.parse`` accepte (``true`` est un identifiant
    Python valide) mais l'import lève ``NameError`` et casse tout le scraper.

    On utilise ``tokenize`` pour ne remplacer que les vrais ``NAME`` tokens —
    pas les occurrences à l'intérieur de chaînes ou de commentaires (ex.
    ``"value": true`` dans un payload JSON-as-string n'est PAS modifié).

    Le remplacement se fait par positions ligne/colonne pour préserver le
    formatage du code (``tokenize.untokenize`` peut réintroduire des espaces).
    """
    import io
    import tokenize

    try:
        tokens = list(tokenize.tokenize(
            io.BytesIO(code.encode("utf-8")).readline
        ))
    except (tokenize.TokenizeError, SyntaxError, IndentationError):
        return code

    bad = [
        t for t in tokens
        if t.type == tokenize.NAME and t.string in ("true", "false")
    ]
    if not bad:
        return code

    lines = code.splitlines(keepends=True)
    # Sens inverse : éviter de décaler les colonnes des tokens suivants.
    for tok in reversed(bad):
        line_idx = tok.start[0] - 1
        col_start = tok.start[1]
        col_end = tok.end[1]
        if 0 <= line_idx < len(lines):
            line = lines[line_idx]
            replacement = "True" if tok.string == "true" else "False"
            lines[line_idx] = line[:col_start] + replacement + line[col_end:]

    return "".join(lines)


@dataclass
class Verdict:
    """Résultat d'un appel de supervision Claude.

    ``rewritten_code`` n'est rempli que par les méthodes de réécriture
    (Phase 3 et Phase 4). Sur les phases lecture seule, il reste ``None``.

    Champs cost-tracking (Phase 1.1) :
      - ``model`` : nom du modèle utilisé (ex: "claude-opus-4-7")
      - ``cache_read_tokens`` / ``cache_creation_tokens`` : compteurs
        prompt-caching Anthropic (utilisés pour calculer le coût USD)
      - ``cost_usd`` : coût total de l'appel, calculé via
        :func:`scraper_ai.scraper_usine.cost_tracking.compute_cost_usd`
    """
    status: VerdictStatus = "ok"
    reasoning: str = ""
    rewritten_code: Optional[str] = None
    tokens_in: int = 0
    tokens_out: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    model: Optional[str] = None
    cost_usd: float = 0.0
    suggestions: List[str] = field(default_factory=list)


class ClaudeSupervisor:
    """Orchestre review + réécriture par Claude sur les phases 1-5."""

    def __init__(self, *, slug: Optional[str] = None,
                 enabled: bool = True, verbose: bool = True,
                 force_full_claude: bool = False):
        self.verbose = verbose
        self.slug = slug
        self._rewrite_count = 0
        self._client: Optional[ClaudeClient] = None
        self._disabled_reason: Optional[str] = None
        self.audit_path: Optional[Path] = None
        # Phase 2.8 : flag --no-hybrid (toggle admin "Mode qualité max").
        # Si True, ignore CLAUDE_HYBRID_ENABLED et force le mode monolithique
        # Opus pour CE run uniquement (sans toucher la config globale prod).
        self.force_full_claude = force_full_claude

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

        before_code = generated.code
        verdict = self._json_call(prompt, system=_SYSTEM_REWRITER, max_tokens=20000)
        applied = self._maybe_apply_rewrite(generated, verdict)
        self._save_audit("phase3_codegen", verdict, rewrite_applied=applied)
        if applied:
            try:
                record_lesson(
                    slug=generated.slug,
                    url=analysis.site_url,
                    platform=analysis.platform.name,
                    phase="supervisor_initial",
                    field_fixed=(extract_field_hints(verdict.reasoning) or [None])[0],
                    weak_fields=extract_field_hints(verdict.reasoning),
                    before_code=before_code,
                    after_code=generated.code,
                    claude_rationale=verdict.reasoning,
                    tokens_used=(verdict.tokens_in + verdict.tokens_out) or None,
                    iterations=1,
                    verbose=self.verbose,
                )
            except Exception as e:
                self._log(f"capture lesson Phase 3 KO : {e}")
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
        force_full_claude: bool = False,
    ) -> Optional[str]:
        """Réécrit le scraper après une validation insatisfaisante.

        Dispatch entre 2 modes selon ``CLAUDE_HYBRID_ENABLED`` (et override
        ``force_full_claude`` du flag admin Phase 2.8) :

        - **Mode actuel (hybride OFF)** : 1 appel monolithique Opus
          (rewrite complet ou patches selon la réponse). Comportement
          historique préservé.
        - **Mode hybride (ON)** : 2 appels chaînés
            1. Opus diagnostique → ``Diagnosis`` JSON strict avec evidence.
            2. Sonnet 4.5 écrit les patches (5x moins cher pour la verbosité).

        Garde-fous d'escalade automatiques (mode hybride) :
          - Plateforme dans ``CLAUDE_CRITICAL_PLATFORMS`` → Opus écrit
          - Toutes les fixes Opus rejetées (low confidence/evidence) → Opus écrit
          - Verdict ``no_fix_needed`` → on ne touche rien (économie 100 %)
          - Smoke test 6-étapes échoue après écriture Sonnet → rollback + Opus

        Retourne le code corrigé (déjà écrit sur disque) ou ``None``.
        """
        if not self.enabled:
            return None
        if self.remaining_rewrites <= 0:
            self._log("Budget de réécritures épuisé — pas de correction.")
            return None

        if html_sample is None:
            html_sample = self._fetch_html_sample_for_report(report)

        # Décision mode hybride vs monolithique
        platform_critical = (analysis.platform.name in CLAUDE_CRITICAL_PLATFORMS)
        # ``force_full_claude`` arg = override par appel ; self.force_full_claude
        # = override pour tout le run (vient du flag --no-hybrid de main.py).
        force_full_run = force_full_claude or self.force_full_claude
        use_hybrid = (
            CLAUDE_HYBRID_ENABLED
            and not force_full_run
            and not platform_critical
        )

        if use_hybrid:
            return self._correct_hybrid(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )
        return self._correct_monolithic(
            generated, analysis, report,
            target_fields=target_fields, html_sample=html_sample,
        )

    def _correct_monolithic(
        self,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        report: ValidationReport,
        *,
        target_fields: Optional[List[str]] = None,
        html_sample: Optional[str] = None,
    ) -> Optional[str]:
        """Correction historique : 1 appel Opus monolithique (rewrite complet).

        Préservé pour le mode hybride OFF et pour les sites de la liste
        blanche ``CLAUDE_CRITICAL_PLATFORMS``.
        """
        prompt = self._build_correction_prompt(
            report, generated, analysis, target_fields=target_fields,
            html_sample=html_sample,
        )

        before_code = generated.code
        try:
            verdict = self._json_call(prompt, system=_SYSTEM_REWRITER, max_tokens=20000)
        except Exception as e:
            self._log(f"correct_scraper monolithic a échoué : {type(e).__name__}: {e}")
            return None

        applied = self._maybe_apply_rewrite(generated, verdict)
        self._save_audit("phase4_autocorrect", verdict, rewrite_applied=applied)
        if applied:
            self._capture_lesson_safely(
                generated=generated, analysis=analysis, report=report,
                phase="auto_correct", target_fields=target_fields,
                before_code=before_code, verdict=verdict,
            )
        return generated.code if applied else None

    def _correct_hybrid(
        self,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        report: ValidationReport,
        *,
        target_fields: Optional[List[str]] = None,
        html_sample: Optional[str] = None,
    ) -> Optional[str]:
        """Architecture diagnose-then-write (Phase 2 du plan optim coûts).

        Étape 1 : Opus produit un :class:`Diagnosis` JSON strict.
        Étape 2 : Sonnet 4.5 écrit les patches OU un fichier complet selon
                  le verdict d'Opus.

        Avec garde-fous Phase 2.5 : escalade Opus si fixes rejetées,
        confidence basse, ou smoke test échoue après Sonnet.
        """
        from .diagnosis import (
            DiagnosisParseError,
            parse_diagnosis,
            DIAGNOSIS_OUTPUT_SPEC,
        )
        from .code_validator import apply_patches, validate_and_write_atomic

        before_code = generated.code

        # ----- Étape 1 : Opus diagnose -----
        diagnose_prompt = self._build_diagnosis_prompt(
            report, generated, analysis,
            target_fields=target_fields, html_sample=html_sample,
        ) + "\n\n" + DIAGNOSIS_OUTPUT_SPEC

        try:
            diag_verdict = self._json_call(
                diagnose_prompt,
                system=_SYSTEM_DIAGNOSER,
                max_tokens=2000,  # diagnostic court : ~400-800 tokens output
                model=CLAUDE_MODEL_DIAGNOSIS,
            )
        except Exception as e:
            self._log(f"hybrid diagnose KO : {type(e).__name__}: {e}")
            return self._correct_monolithic(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )

        # Le _json_call a deja parse en dict, on extrait raw payload
        raw_data = diag_verdict.suggestions  # placeholder, on reparse depuis raw
        # En realite on stocke le dict d'origine dans verdict.reasoning si
        # notre _verdict_from_json n'a pas reconnu le schema. Cas : Opus
        # repond avec le schema Diagnosis qui n'a PAS la cle 'status', donc
        # _verdict_from_json verra {} et tombera en warning. On re-decode :
        try:
            # Reparse le payload JSON depuis verdict.reasoning si le client
            # nous a renvoye le json brut. Sinon, on essaie depuis raw.
            # Le plus propre : refaire l'appel via .call() pour avoir le dict.
            # Mais on peut aussi exploiter raw_response si on a stocke le
            # dict initial. Pour rester simple : on appelle Opus une 2eme
            # fois proprement et on log que c'est un degenerated case.
            # Variante pragmatique : on accepte que diag_verdict.reasoning
            # contient le JSON parsable (cas typique : status=warning,
            # reasoning="..."). On retombe en monolithic si vraiment mal parse.
            data: Any = self._extract_diagnosis_payload(diag_verdict)
            diagnosis = parse_diagnosis(data)
        except (DiagnosisParseError, ValueError) as e:
            self._log(f"hybrid : Diagnosis non parsable ({e}), escalade monolithic")
            self._save_audit_hybrid_event(
                "phase4_diagnose", diag_verdict,
                escalation="parse_error",
            )
            return self._correct_monolithic(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )

        # Garde-fou : verdict no_fix_needed -> on ne touche rien
        if diagnosis.verdict == "no_fix_needed":
            self._log("hybrid : Opus dit 'no_fix_needed', skip écriture (économie 100%)")
            self._save_audit_hybrid_event(
                "phase4_diagnose", diag_verdict,
                diagnosis=diagnosis, decision="no_fix_needed",
            )
            return None  # rien à appliquer, pas d'erreur

        # Garde-fou : toutes les fixes rejetées -> escalade Opus
        if diagnosis.all_fixes_rejected():
            self._log(
                f"hybrid : toutes les fixes rejetées "
                f"({len(diagnosis.targeted_fixes)} -> 0 valides), escalade Opus"
            )
            self._save_audit_hybrid_event(
                "phase4_diagnose", diag_verdict,
                diagnosis=diagnosis, escalation="all_fixes_rejected",
            )
            return self._correct_monolithic(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )

        # Audit du diagnostic
        self._save_audit_hybrid_event(
            "phase4_diagnose", diag_verdict, diagnosis=diagnosis,
        )

        # ----- Étape 2 : Sonnet écrit -----
        write_prompt = self._build_write_prompt(
            report, generated, analysis, diagnosis,
            html_sample=html_sample,
        )

        try:
            write_verdict = self._json_call(
                write_prompt,
                system=_SYSTEM_REWRITER,
                max_tokens=20000,
                model=CLAUDE_MODEL_REWRITE,
            )
        except Exception as e:
            self._log(f"hybrid write Sonnet KO : {type(e).__name__}: {e}")
            return self._correct_monolithic(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )

        # Récupère soit patches[] soit full_rewrite depuis la réponse
        write_payload = self._extract_write_payload(write_verdict)
        if not write_payload:
            self._log("hybrid : payload write Sonnet vide/illisible, escalade Opus")
            self._save_audit_hybrid_event(
                "phase4_write", write_verdict,
                escalation="empty_write_payload",
            )
            return self._correct_monolithic(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )

        new_code = self._compute_new_code_from_write_payload(
            base_code=before_code, payload=write_payload,
        )
        if new_code is None:
            # Patches ont échoué ou trop nombreux → escalade
            self._save_audit_hybrid_event(
                "phase4_write", write_verdict,
                escalation="patch_apply_failed",
            )
            return self._correct_monolithic(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )

        # ----- Smoke test 6 étapes (Phase 2.4) -----
        if not generated.file_path:
            self._log("hybrid : pas de file_path, escalade monolithic")
            return self._correct_monolithic(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )

        target_path = Path(generated.file_path)
        module_dotted = (
            f"scraper_ai.dedicated_scrapers.{generated.module_name}"
        )
        validation = validate_and_write_atomic(
            new_code,
            target_path=target_path,
            class_name=generated.class_name,
            module_dotted_path=module_dotted,
        )

        if not validation.ok:
            self._log(
                f"hybrid : smoke test échoué à {validation.failed_at} "
                f"({validation.error}), rollback + escalade Opus"
            )
            self._save_audit_hybrid_event(
                "phase4_write", write_verdict,
                escalation=f"smoke_test_failed:{validation.failed_at}",
                error=validation.error,
            )
            return self._correct_monolithic(
                generated, analysis, report,
                target_fields=target_fields, html_sample=html_sample,
            )

        # Tout OK
        generated.code = new_code
        self._rewrite_count += 1
        self._log(
            f"hybrid : Sonnet a écrit {len(new_code)} chars, smoke test OK "
            f"(rewrites {self._rewrite_count}/{CLAUDE_MAX_REWRITES})"
        )
        self._save_audit_hybrid_event(
            "phase4_write", write_verdict,
            decision="written",
            steps_passed=validation.steps_passed,
        )

        # Capture leçon (avec model utilisé pour traçabilité)
        self._capture_lesson_safely(
            generated=generated, analysis=analysis, report=report,
            phase="auto_correct_hybrid", target_fields=target_fields,
            before_code=before_code, verdict=write_verdict,
        )
        return generated.code

    # --- Helpers diagnose-then-write (Phase 2.3) ---------------------

    @staticmethod
    def _extract_diagnosis_payload(verdict: Verdict) -> Any:
        """Récupère le payload Diagnosis depuis un Verdict.

        Notre _verdict_from_json ne reconnait pas Diagnosis (clés différentes),
        donc le dict initial peut être perdu. On essaie plusieurs fallbacks.
        """
        if isinstance(verdict.suggestions, list) and verdict.suggestions:
            # Cas où le client a stocké le dict raw dans suggestions
            first = verdict.suggestions[0]
            if isinstance(first, dict):
                return first
        # On essaie de re-parser le reasoning comme JSON si c'est du texte JSON
        if verdict.reasoning:
            try:
                return json.loads(verdict.reasoning)
            except (ValueError, json.JSONDecodeError):
                pass
        # Sinon, on retourne un dict minimal qui forcera un parse_diagnosis échec
        # propre (et donc fallback monolithic).
        return {"verdict": verdict.status, "reasoning": verdict.reasoning}

    @staticmethod
    def _extract_write_payload(verdict: Verdict) -> Optional[Dict[str, Any]]:
        """Récupère ``{patches: [...], full_rewrite: str|None}`` depuis Verdict."""
        # Sonnet répond en JSON {patches, full_rewrite, reasoning}. Notre
        # _verdict_from_json a peut-être vu rewritten_code ; sinon parse manuel.
        if verdict.rewritten_code:
            return {"patches": [], "full_rewrite": verdict.rewritten_code}
        if verdict.reasoning:
            try:
                data = json.loads(verdict.reasoning)
                if isinstance(data, dict):
                    return data
            except (ValueError, json.JSONDecodeError):
                pass
        return None

    @staticmethod
    def _compute_new_code_from_write_payload(
        *, base_code: str, payload: Dict[str, Any],
    ) -> Optional[str]:
        """Applique patches ou full_rewrite. Retourne None si échec."""
        from .code_validator import apply_patches

        full = payload.get("full_rewrite")
        if isinstance(full, str) and full.strip() and "class " in full:
            return full

        patches = payload.get("patches") or []
        if not patches:
            return None

        result = apply_patches(base_code, patches, max_patches=5)
        if result.applied_count == 0 or result.failed_count > 0:
            return None
        return result.new_code

    def _save_audit_hybrid_event(
        self,
        phase: str,
        verdict: Verdict,
        *,
        diagnosis: Optional[Any] = None,
        decision: Optional[str] = None,
        escalation: Optional[str] = None,
        error: Optional[str] = None,
        steps_passed: Optional[List[str]] = None,
    ) -> None:
        """Variante de _save_audit qui ajoute les champs hybrid-spécifiques.

        Permet de tracer dans l'audit JSON quelle phase hybride a tourné,
        avec quel modèle, quel diagnostic, et pourquoi (le cas échéant) on
        a escaladé vers Opus monolithic.
        """
        if not self.audit_path:
            return
        try:
            payload = json.loads(self.audit_path.read_text(encoding="utf-8"))
        except Exception:
            payload = {"slug": self.slug, "events": []}

        event = {
            "phase": phase,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": verdict.status,
            "reasoning": verdict.reasoning[:500],
            "tokens_in": verdict.tokens_in,
            "tokens_out": verdict.tokens_out,
            "cache_read_tokens": verdict.cache_read_tokens,
            "cache_creation_tokens": verdict.cache_creation_tokens,
            "model": verdict.model,
            "cost_usd": verdict.cost_usd,
            "mode": "hybrid",
        }
        if diagnosis is not None:
            event["diagnosis"] = {
                "verdict": diagnosis.verdict,
                "root_cause": diagnosis.root_cause[:300],
                "fixes_total": len(diagnosis.targeted_fixes),
                "fixes_valid": len(diagnosis.valid_fixes()),
                "rejection_log": diagnosis.rejection_log()[:5],
            }
        if decision is not None:
            event["decision"] = decision
        if escalation is not None:
            event["escalation_reason"] = escalation
        if error is not None:
            event["error"] = error[:500]
        if steps_passed is not None:
            event["smoke_test_steps_passed"] = steps_passed

        payload.setdefault("events", []).append(event)
        total_cost = sum(
            (e.get("cost_usd") or 0.0) for e in payload.get("events", [])
        )
        payload["total_cost_usd"] = round(total_cost, 6)

        self.audit_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def _capture_lesson_safely(
        self,
        *,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        report: ValidationReport,
        phase: str,
        target_fields: Optional[List[str]],
        before_code: str,
        verdict: Verdict,
    ) -> None:
        """Wrapper sûr autour de record_lesson (best-effort, ne casse jamais le run)."""
        try:
            hint_fields = list(target_fields or []) or extract_field_hints(verdict.reasoning)
            primary = (target_fields[0] if target_fields else
                       (hint_fields[0] if hint_fields else None))
            record_lesson(
                slug=generated.slug,
                url=analysis.site_url,
                platform=analysis.platform.name,
                phase=phase,
                field_fixed=primary,
                weak_fields=hint_fields,
                before_code=before_code,
                after_code=generated.code,
                claude_rationale=verdict.reasoning,
                tokens_used=(verdict.tokens_in + verdict.tokens_out) or None,
                iterations=1,
                extra_signature=f"score:{report.score}",
                verbose=self.verbose,
            )
        except Exception as e:
            self._log(f"capture lesson {phase} KO : {e}")

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

        # Sanity-check des littéraux booléens JS-style. Les réécritures Claude
        # produisent récurremment `= true` / `= false` (minuscules) au lieu de
        # `True` / `False` Python, ce qui ne casse pas ast.parse mais provoque
        # un NameError à l'import du module. Sans ce fix, chaque rewrite
        # déclenche une nouvelle review Claude pour corriger un bug de Claude.
        normalized = _normalize_python_bool_literals(new_code)
        if normalized != new_code:
            self._log("rewrite : `true`/`false` JS-style normalisés en `True`/`False`")
            new_code = normalized
            verdict.rewritten_code = new_code

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
                   max_tokens: Optional[int] = None,
                   model: Optional[str] = None) -> Verdict:
        """Wrap un appel Claude qui doit renvoyer du JSON Verdict-like.

        Tolère les réponses non-JSON en renvoyant un Verdict warning.

        Capture aussi les delta de tokens (input/output/cache) pour le calcul
        de coût Phase 1.1 — on lit les compteurs cumulatifs du client avant
        et après l'appel.

        Args:
            model: si fourni, utilise ce modèle pour cet appel uniquement
                (utilisé par diagnose_then_write pour switcher Opus -> Sonnet).
        """
        if self._client is None:
            return Verdict(status="ok", reasoning="Supervisor désactivé")

        from .cost_tracking import compute_cost_usd

        # Snapshot des compteurs cumulatifs AVANT l'appel
        in_before = self._client.total_tokens_in
        out_before = self._client.total_tokens_out
        cr_before = self._client.total_cache_read_tokens
        cc_before = self._client.total_cache_creation_tokens

        try:
            data = self._client.call(
                prompt, system=system,
                response_mime_type="application/json",
                max_tokens=max_tokens,
                model=model,
            )
        except Exception as e:
            self._log(f"appel Claude échoué : {type(e).__name__}: {e}")
            return Verdict(
                status="warning",
                reasoning=f"Claude API erreur: {e}",
                model=(model or self._client.model),
            )

        # Delta = tokens consommés par cet appel précisément
        delta_in = self._client.total_tokens_in - in_before
        delta_out = self._client.total_tokens_out - out_before
        delta_cr = self._client.total_cache_read_tokens - cr_before
        delta_cc = self._client.total_cache_creation_tokens - cc_before

        verdict = self._verdict_from_json(data)
        # Note : total_tokens_in du client INCLUT déjà cache_read+cache_creation,
        # donc tokens_in "non-caché" = delta_in - delta_cr - delta_cc
        verdict.tokens_in = max(0, delta_in - delta_cr - delta_cc)
        verdict.tokens_out = delta_out
        verdict.cache_read_tokens = delta_cr
        verdict.cache_creation_tokens = delta_cc
        verdict.model = model or self._client.model
        verdict.cost_usd = compute_cost_usd(
            verdict.model,
            input_tokens=verdict.tokens_in,
            output_tokens=verdict.tokens_out,
            cache_read_tokens=verdict.cache_read_tokens,
            cache_creation_tokens=verdict.cache_creation_tokens,
        )
        return verdict

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
            "cache_read_tokens": verdict.cache_read_tokens,
            "cache_creation_tokens": verdict.cache_creation_tokens,
            "model": verdict.model,
            "cost_usd": verdict.cost_usd,
        })

        # Total cumulatif (utile pour /admin/usine et alertes budget)
        total_cost = sum(
            (e.get("cost_usd") or 0.0) for e in payload.get("events", [])
        )
        payload["total_cost_usd"] = round(total_cost, 6)

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
            # 1) Tentative cache disque (TTL 1h) - évite refetch + repassage
            #    par html_cleanup pour les Phase 3 + Phase 4 + agent rebuild
            #    qui touchent souvent le même sample HTML.
            cached = _load_cached_html(url)
            if cached is not None:
                return self._truncate_for_prompt(cached, HTML_SAMPLE_MAX_BYTES)

            # 2) Fetch + nettoyage + cache disque pour les futurs appels
            try:
                resp = requests.get(url, timeout=15, allow_redirects=True)
                if resp.status_code == 200:
                    # Pré-traitement HTML AVANT troncature : on retire le bruit
                    # (scripts JS, styles, svg, data-attrs non sémantiques) en
                    # préservant JSON-LD / og-meta / microdata via la whitelist
                    # de html_cleanup.clean_html_for_llm. Gain typique -30 à
                    # -40% d'octets sans aucune perte d'info utile pour Claude.
                    cleaned = clean_html_for_llm(resp.text, aggressive=True)
                    _save_cached_html(url, cleaned)
                    return self._truncate_for_prompt(
                        cleaned, HTML_SAMPLE_MAX_BYTES,
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

    def _build_diagnosis_prompt(
        self,
        report: ValidationReport,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        *,
        target_fields: Optional[List[str]] = None,
        html_sample: Optional[str] = None,
    ) -> str:
        """Prompt Phase 4 hybride - étape DIAGNOSE (Opus).

        Demande à Opus d'analyser le code échoué + HTML live et de produire
        un :class:`Diagnosis` JSON structuré avec evidence concrète et
        confidence par fix. Output court (~400-800 tokens).
        """
        issues = "\n".join(f"- {w}" for w in (report.warnings + report.errors)) or "(aucun)"
        coverage = "\n".join(
            f"  - {fd.field_name}: {fd.coverage:.0%} ({fd.present_count}/{fd.total_count})"
            for fd in report.field_details
        )
        sample = json.dumps(report.sample_products[:2], indent=2,
                            ensure_ascii=False, default=str)
        focus = ""
        if target_fields:
            focus = f"\nFOCUS sur ces champs sous-couverts : {', '.join(target_fields)}.\n"

        code_block = self._truncate_for_prompt(generated.code, CODE_SAMPLE_MAX_BYTES)
        html_block = (
            self._truncate_for_prompt(html_sample, HTML_SAMPLE_MAX_BYTES)
            if html_sample else "(aucun HTML live disponible)"
        )

        return (
            f"DIAGNOSTIC : le scraper de {analysis.site_url} a obtenu "
            f"{report.score}/100 ({report.grade}).\n\n"
            f"PROBLEMES :\n{issues}\n\n"
            f"COUVERTURE PAR CHAMP :\n{coverage}\n\n"
            f"ECHANTILLON DE PRODUITS EXTRAITS :\n{sample}\n\n"
            f"HTML LIVE D'UNE PAGE PRODUIT :\n```html\n{html_block}\n```\n\n"
            f"CODE ACTUEL DU SCRAPER :\n```python\n{code_block}\n```\n"
            f"{focus}\n"
            "Ton role : DIAGNOSTIQUER (pas reecrire). Identifie la racine "
            "du probleme et propose des fixes ciblees AVEC PREUVE CONCRETE "
            "(extrait HTML/DOM) et confidence par fix. Si le code semble bon "
            "et que le probleme est ailleurs (cache, anti-bot, sample biaise), "
            "verdict='no_fix_needed'. Si tu juges qu'un refactor complet est "
            "necessaire, verdict='needs_rewrite' (le rewriter prendra le "
            "relais avec le fichier complet)."
        )

    def _build_write_prompt(
        self,
        report: ValidationReport,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        diagnosis: Any,
        *,
        html_sample: Optional[str] = None,
    ) -> str:
        """Prompt Phase 4 hybride - étape WRITE (Sonnet).

        Sonnet reçoit le code + le diagnostic Opus filtré (uniquement fixes
        valides) et produit soit des patches ciblés, soit un fichier complet
        si verdict=needs_rewrite.
        """
        sonnet_payload = diagnosis.as_sonnet_payload()
        diag_block = json.dumps(sonnet_payload, indent=2, ensure_ascii=False)
        code_block = self._truncate_for_prompt(generated.code, CODE_SAMPLE_MAX_BYTES)
        html_block = (
            self._truncate_for_prompt(html_sample, HTML_SAMPLE_MAX_BYTES)
            if html_sample else "(aucun HTML live disponible)"
        )

        if diagnosis.verdict == "needs_rewrite":
            output_spec = (
                "Reponds en JSON strict (aucun markdown, aucun preambule) :\n"
                "{\n"
                '  "patches": [],\n'
                '  "full_rewrite": "<contenu .py complet>",\n'
                '  "reasoning": "1-2 phrases sur ce que tu as fait"\n'
                "}\n"
                "REGLES STRICTES si full_rewrite :\n"
                "- Conserve la classe, son heritage DedicatedScraper, et les attributs SITE_*;\n"
                "- N'ajoute pas de docstring de plus de 5 lignes;\n"
                "- Le fichier doit etre directement importable depuis "
                "scraper_ai.dedicated_scrapers."
            )
        else:
            output_spec = (
                "Reponds en JSON strict (aucun markdown, aucun preambule) :\n"
                "{\n"
                '  "patches": [{"find": "<extrait code exact>", "replace": "<remplacement>"}, ...],\n'
                '  "full_rewrite": null,\n'
                '  "reasoning": "1-2 phrases sur les patches"\n'
                "}\n"
                "REGLES STRICTES :\n"
                "- find DOIT etre une chaine UNIQUE dans le code (pas ambigue).\n"
                "- 1 a 5 patches max. Si tu as besoin de plus, utilise full_rewrite.\n"
                "- Tes patches doivent etre justifies par les fixes du diagnostic.\n"
                "- N'ajoute pas de patches qui ne sont PAS dans targeted_fixes."
            )

        return (
            f"WRITE : applique le diagnostic Opus pour corriger le scraper "
            f"de {analysis.site_url}.\n\n"
            f"DIAGNOSTIC OPUS (filtre, fixes haute confiance uniquement) :\n"
            f"```json\n{diag_block}\n```\n\n"
            f"CODE ACTUEL :\n```python\n{code_block}\n```\n\n"
            f"HTML LIVE (reference) :\n```html\n{html_block}\n```\n\n"
            f"{output_spec}"
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

# Phase 2.3 : system prompt pour l'etape DIAGNOSE (Opus en mode hybride).
# Plus court que _SYSTEM_AUDITOR pour minimiser les tokens repetes a chaque
# diagnostic. Force le format JSON strict avec evidence concrete.
_SYSTEM_DIAGNOSER = (
    "Tu es un expert senior en web scraping Python. Tu DIAGNOSTIQUES (tu "
    "n'ecris pas de code) un scraper qui ne passe pas la validation. Tu "
    "produis un JSON strict avec verdict, root_cause, et targeted_fixes "
    "ayant chacune une evidence concrete (extrait HTML >=50 chars) et une "
    "confidence par fix. Sans evidence concrete, tu ne proposes PAS la fix. "
    "Sans markdown, sans preambule, sans triple backticks."
)


# ---------------------------------------------------------------------------
# Cache disque des samples HTML (TTL 1h, par domaine + hash URL)
# ---------------------------------------------------------------------------

def _html_cache_path(url: str) -> Path:
    """Renvoie le chemin disque du sample HTML pour une URL donnée.

    Format : ``scraper_cache/html_samples/{domain}_{sha8(url)}.html``. On
    inclut le domaine pour garder le cache lisible, et un hash court de
    l'URL complète pour ne pas se tromper entre 2 pages produit du même
    domaine.
    """
    from urllib.parse import urlparse
    domain = (urlparse(url).netloc or "unknown").replace(":", "_")
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
    return HTML_SAMPLE_CACHE_DIR / f"{domain}_{digest}.html"


def _load_cached_html(url: str) -> Optional[str]:
    """Récupère le HTML en cache si présent ET pas expiré, sinon None."""
    path = _html_cache_path(url)
    if not path.exists():
        return None
    try:
        age_sec = time.time() - path.stat().st_mtime
        if age_sec > HTML_SAMPLE_CACHE_TTL_SEC:
            return None
        return path.read_text(encoding="utf-8")
    except Exception:
        return None


def _save_cached_html(url: str, cleaned_html: str) -> None:
    """Persiste le HTML déjà nettoyé. Best-effort (silencieux si KO)."""
    if not cleaned_html:
        return
    try:
        HTML_SAMPLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _html_cache_path(url).write_text(cleaned_html, encoding="utf-8")
    except Exception:
        pass


__all__ = [
    "ClaudeSupervisor",
    "Verdict",
    "VerdictStatus",
    "SUPERVISION_DIR",
]
