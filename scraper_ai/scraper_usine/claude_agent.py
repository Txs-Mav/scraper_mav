"""Agent autonome Claude (Phase 4.5 du pipeline scraper_usine).

Quand le scraper généré par templates Jinja2 + corrections itératives ne passe
pas le seuil de validation, on bascule sur cet agent qui :

  1. Reçoit une mission (URL du site, profil de domaine, code échoué).
  2. Dispose de 6 outils (HTTP fetch, DOM inspect, link extract, read/write
     du fichier scraper, run du scraper en sous-processus).
  3. Itère via le **tool use** d'Anthropic
     (https://docs.anthropic.com/en/docs/build-with-claude/tool-use) jusqu'à
     produire un fichier ``dedicated_scrapers/{slug}.py`` qui passe son propre
     ``run_scraper_test`` avec ≥ 1 produit conforme.

Garde-fous (config.py) :
  - ``CLAUDE_AGENT_MAX_TURNS`` : nombre max de tours assistant<->tool_result.
  - ``CLAUDE_AGENT_MAX_TOKENS_PER_RUN`` : plafond cumul in+out (cost cap).

Trace complète persistée dans
``scraper_cache/supervision/{slug}_agent_trace.jsonl`` (un événement par
ligne, pour replay).
"""
from __future__ import annotations

import ast
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .models import GeneratedScraper, ScrapingStrategy, SiteAnalysis
from .domain_profiles import get_profile
from .generator import DEDICATED_DIR, GENERATED_REGISTRY_PATH
from .html_cleanup import clean_html_for_llm
from .lessons import record_lesson

try:
    from scraper_ai.config import (
        CLAUDE_AGENT_ENABLED,
        CLAUDE_AGENT_MAX_TOKENS_PER_RUN,
        CLAUDE_AGENT_MAX_TURNS,
        CLAUDE_HYBRID_ENABLED,
        CLAUDE_MODEL_DIAGNOSIS,
        CLAUDE_MODEL_REWRITE,
    )
    from scraper_ai.claude_client import ClaudeClient, ClaudeUnavailableError
except ImportError:  # pragma: no cover
    from ..config import (  # type: ignore[no-redef]
        CLAUDE_AGENT_ENABLED,
        CLAUDE_AGENT_MAX_TOKENS_PER_RUN,
        CLAUDE_AGENT_MAX_TURNS,
        CLAUDE_HYBRID_ENABLED,
        CLAUDE_MODEL_DIAGNOSIS,
        CLAUDE_MODEL_REWRITE,
    )
    from ..claude_client import (  # type: ignore[no-redef]
        ClaudeClient, ClaudeUnavailableError,
    )


SUPERVISION_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "scraper_cache" / "supervision"
)

# Limite par fetch (octets). Les pages produits sont souvent > 200 KB ; on
# tronque à 25 KB avant de redonner à Claude. À 25 KB ≈ 8K tokens, on peut
# faire 6-8 fetch sans saturer le contexte (Opus 4.7 = 200K input).
FETCH_TRUNCATE_BYTES = 25_000

# Timeout dur d'un run_scraper_test (secondes). Plus court que le timeout du
# validator principal car l'agent doit pouvoir itérer rapidement.
AGENT_TEST_TIMEOUT = 90

# Plafond strict d'URLs scrapées par run_scraper_test, indépendamment de
# ce que renvoie discover_product_urls. Évite qu'un site avec 1733 produits
# fasse timeout systématiquement durant le test (l'agent veut juste vérifier
# que ses sélecteurs fonctionnent, pas faire un crawl complet).
TEST_MAX_URLS_PER_CATEGORY = 5


# ---------------------------------------------------------------------------
# Définition des outils (JSON Schema au format Anthropic)
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "name": "fetch_url",
        "description": (
            "Récupère le contenu HTML d'une URL. Utilise requests par défaut "
            "(rapide). Si render_js=True, utilise un BrowserAgent Playwright "
            "(lent, 10-15s, mais nécessaire pour les SPA Next.js/React). "
            "Le HTML est tronqué à ~60KB pour éviter de saturer le contexte."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL absolue à fetcher"},
                "render_js": {
                    "type": "boolean", "default": False,
                    "description": "True pour utiliser Playwright (sites SPA)",
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "inspect_html",
        "description": (
            "Cherche tous les éléments matchant un sélecteur CSS dans un HTML. "
            "Renvoie les N premiers matches avec tag, attributs, text (tronqué). "
            "Utile pour vérifier qu'un sélecteur est valide AVANT de l'écrire "
            "dans le code."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "html": {"type": "string", "description": "HTML à inspecter"},
                "css_selector": {"type": "string"},
                "max_matches": {"type": "integer", "default": 10},
            },
            "required": ["html", "css_selector"],
        },
    },
    {
        "name": "extract_links",
        "description": (
            "Extrait toutes les URLs absolues (<a href>) d'un HTML. Filtre "
            "optionnel par regex sur l'URL. Retourne au max 100 URLs uniques."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "html": {"type": "string"},
                "base_url": {"type": "string"},
                "pattern_regex": {
                    "type": "string", "default": "",
                    "description": "Regex Python à matcher contre l'URL absolue (vide = toutes)",
                },
            },
            "required": ["html", "base_url"],
        },
    },
    {
        "name": "read_existing_scraper",
        "description": (
            "Lit le code Python actuel du scraper `{slug}.py` dans "
            "dedicated_scrapers/. Utile pour repartir du code échoué comme "
            "contexte sans le redemander en paramètre."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"slug": {"type": "string"}},
            "required": ["slug"],
        },
    },
    {
        "name": "write_scraper_code",
        "description": (
            "Écrit le code Python complet d'un scraper dans "
            "dedicated_scrapers/{module}.py. Valide la syntaxe via ast.parse "
            "AVANT d'écrire — si le code est invalide, retourne {ok:false, errors:[...]} "
            "sans rien modifier sur disque. Met aussi à jour _generated_registry.py."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "slug": {"type": "string"},
                "class_name": {"type": "string"},
                "module_name": {"type": "string"},
                "code": {
                    "type": "string",
                    "description": "Code Python COMPLET du fichier .py",
                },
            },
            "required": ["slug", "class_name", "module_name", "code"],
        },
    },
    {
        "name": "run_scraper_test",
        "description": (
            "Exécute le scraper en sous-processus isolé (timeout dur 90s) sur "
            "1-3 catégories. Retourne {products: [...], errors: [...], "
            "field_coverage: {champ: 0..1}}. À utiliser pour valider que le "
            "code écrit fonctionne réellement avant de déclarer 'done'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "slug": {"type": "string"},
                "module_name": {"type": "string"},
                "class_name": {"type": "string"},
                "categories": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": ["all"],
                },
                "sample_limit": {"type": "integer", "default": 3},
            },
            "required": ["slug", "module_name", "class_name"],
        },
    },
    {
        "name": "query_sitemap",
        "description": (
            "Cherche un sitemap.xml utilisable pour ce site et retourne un "
            "échantillon d'URLs détectées (jusqu'à 50). Évite de réinventer "
            "la découverte d'URLs quand un sitemap existe. Retourne "
            "{ok, sitemap_url, product_urls: [...], total_estimated}."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "base_url": {
                    "type": "string",
                    "description": "URL racine du site (ex: https://www.exemple.ca)",
                },
            },
            "required": ["base_url"],
        },
    },
    {
        "name": "try_known_platforms",
        "description": (
            "Vérifie si le HTML correspond à une plateforme connue (Shopify, "
            "WooCommerce, Magento, eDealer, PowerGO, etc.). Si oui, retourne "
            "les sélecteurs et la classe de base à hériter. Évite à l'agent "
            "de réinventer un scraper pour une plateforme déjà couverte."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "html": {"type": "string", "description": "HTML d'une page du site"},
                "url": {"type": "string", "description": "URL d'origine du HTML"},
            },
            "required": ["html", "url"],
        },
    },
]


class ClaudeAgent:
    """Agent autonome qui reconstruit un scraper en explorant le site.

    À utiliser via :meth:`build_scraper_from_scratch`. Toutes les autres
    méthodes (les ``_tool_*``) sont les implémentations des outils exposés
    à Claude — elles ne devraient pas être appelées directement.
    """

    def __init__(self, *, slug: Optional[str] = None,
                 enabled: bool = True, verbose: bool = True):
        self.verbose = verbose
        self.slug = slug
        self._client: Optional[ClaudeClient] = None
        self._disabled_reason: Optional[str] = None
        self._trace_path: Optional[Path] = None

        if not enabled or not CLAUDE_AGENT_ENABLED:
            self._disabled_reason = (
                "Désactivé via flag --no-agent-fallback ou CLAUDE_AGENT_ENABLED=0"
            )
            self._log(self._disabled_reason)
            return

        try:
            self._client = ClaudeClient(verbose=False)
        except ClaudeUnavailableError as e:
            self._disabled_reason = str(e)
            self._log(f"Désactivé : {e}")

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def set_slug(self, slug: str) -> None:
        self.slug = slug
        SUPERVISION_DIR.mkdir(parents=True, exist_ok=True)
        self._trace_path = SUPERVISION_DIR / f"{slug}_agent_trace.jsonl"
        # Reset trace au début de chaque run agent
        self._trace_path.write_text("", encoding="utf-8")

    # ------------------------------------------------------------------
    # Point d'entrée principal
    # ------------------------------------------------------------------

    def build_scraper_from_scratch(
        self,
        analysis: SiteAnalysis,
        strategy: ScrapingStrategy,
        prior_attempt: Optional[GeneratedScraper] = None,
    ) -> Optional[GeneratedScraper]:
        """Lance la boucle agentique pour reconstruire un scraper.

        Retourne un nouveau :class:`GeneratedScraper` si l'agent a produit
        un fichier qui passe son propre ``run_scraper_test``, ``None`` sinon.

        Le slug/class_name/module_name sont REPRIS de ``prior_attempt`` si
        fourni, pour ne pas casser la chaîne de publication / push Git en
        aval (le fichier ``{slug}.py`` est juste écrasé).
        """
        if not self.enabled:
            self._log("Agent indisponible — skip Phase 4.5")
            return None

        if prior_attempt is None:
            self._log("prior_attempt requis pour identifier le slug cible")
            return None

        self.set_slug(prior_attempt.slug)
        self._tokens_used = 0
        self._cost_usd_cumulative = 0.0
        self._last_test_result: Optional[Dict[str, Any]] = None
        # Snapshot du code avant agent — sert à calculer le diff pour la
        # capture des leçons (Phase 2 du plan).
        prior_code_snapshot: str = prior_attempt.code or ""
        if not prior_code_snapshot and prior_attempt.file_path:
            try:
                prior_code_snapshot = Path(prior_attempt.file_path).read_text(encoding="utf-8")
            except Exception:
                prior_code_snapshot = ""

        # Phase 2.7 : architecture hybride pour l'agent.
        # - Mode actuel (CLAUDE_HYBRID_ENABLED=0) : Opus partout (comportement historique).
        # - Mode hybride : tour 1 = Opus produit un PlanDeMission JSON court,
        #   puis tours 2-N en Sonnet 4.5 avec le plan en system_prompt. Si Sonnet
        #   bloque après 8 tours, on injecte 1 tour Opus de recovery.
        mission_plan: Optional[Dict[str, Any]] = None
        if CLAUDE_HYBRID_ENABLED:
            mission_plan = self._build_mission_plan(analysis, strategy, prior_attempt)

        system_prompt = self._build_system_prompt(
            analysis, strategy, prior_attempt, mission_plan=mission_plan,
        )
        user_prompt = self._build_user_prompt(analysis, strategy, prior_attempt)

        messages: List[Dict[str, Any]] = [
            {"role": "user", "content": user_prompt},
        ]

        # Compteur de tours Sonnet sans run_scraper_test ok=True (déclencheur recovery)
        sonnet_unsuccessful_streak = 0
        SONNET_RECOVERY_THRESHOLD = 8

        self._log(
            f"Démarrage agent (max {CLAUDE_AGENT_MAX_TURNS} tours, "
            f"hybride={'ON' if CLAUDE_HYBRID_ENABLED else 'OFF'})..."
        )
        self._trace_event("agent_start", {
            "site_url": analysis.site_url,
            "slug": prior_attempt.slug,
            "max_turns": CLAUDE_AGENT_MAX_TURNS,
            "max_tokens": CLAUDE_AGENT_MAX_TOKENS_PER_RUN,
            "hybrid_enabled": CLAUDE_HYBRID_ENABLED,
            "mission_plan": mission_plan,
        })

        for turn in range(1, CLAUDE_AGENT_MAX_TURNS + 1):
            if self._tokens_used >= CLAUDE_AGENT_MAX_TOKENS_PER_RUN:
                self._log(f"Budget tokens épuisé ({self._tokens_used}) — arrêt agent")
                self._trace_event("agent_exhausted", {
                    "tokens_used": self._tokens_used,
                    "turn": turn,
                })
                break

            # Phase 2.7 : choix du modèle pour ce tour
            # - Mode actuel : Opus partout (CLAUDE_MODEL_DIAGNOSIS pour cohérence)
            # - Mode hybride : Sonnet par défaut, MAIS Opus de recovery si Sonnet
            #   a stagné > 8 tours sans run_scraper_test ok=True.
            if CLAUDE_HYBRID_ENABLED:
                if sonnet_unsuccessful_streak >= SONNET_RECOVERY_THRESHOLD:
                    turn_model = CLAUDE_MODEL_DIAGNOSIS  # Opus recovery
                    sonnet_unsuccessful_streak = 0  # reset après recovery
                    self._log(
                        f"Tour {turn} : RECOVERY Opus déclenché "
                        f"(Sonnet stagne depuis {SONNET_RECOVERY_THRESHOLD} tours)"
                    )
                else:
                    turn_model = CLAUDE_MODEL_REWRITE  # Sonnet
            else:
                turn_model = self._client.model  # type: ignore[union-attr]

            # Snapshot compteurs AVANT pour calculer le delta de ce tour
            in_before = self._client.total_tokens_in  # type: ignore[union-attr]
            out_before = self._client.total_tokens_out  # type: ignore[union-attr]
            cr_before = self._client.total_cache_read_tokens  # type: ignore[union-attr]
            cc_before = self._client.total_cache_creation_tokens  # type: ignore[union-attr]

            try:
                response = self._client.call_with_tools(  # type: ignore[union-attr]
                    messages, system=system_prompt, tools=TOOL_DEFINITIONS,
                    model=turn_model,
                )
            except Exception as e:
                self._log(f"Tour {turn} : appel Claude échoué — {type(e).__name__}: {e}")
                self._trace_event("agent_error", {"turn": turn, "error": str(e)})
                return None

            self._tokens_used = (
                self._client.total_tokens_in + self._client.total_tokens_out  # type: ignore[union-attr]
            )

            # Delta tokens de ce tour précis (utile pour cost tracking)
            from .cost_tracking import compute_cost_usd
            delta_in = self._client.total_tokens_in - in_before  # type: ignore[union-attr]
            delta_out = self._client.total_tokens_out - out_before  # type: ignore[union-attr]
            delta_cr = self._client.total_cache_read_tokens - cr_before  # type: ignore[union-attr]
            delta_cc = self._client.total_cache_creation_tokens - cc_before  # type: ignore[union-attr]
            non_cached_in = max(0, delta_in - delta_cr - delta_cc)
            turn_cost = compute_cost_usd(
                turn_model,
                input_tokens=non_cached_in,
                output_tokens=delta_out,
                cache_read_tokens=delta_cr,
                cache_creation_tokens=delta_cc,
            )
            self._cost_usd_cumulative = (
                getattr(self, "_cost_usd_cumulative", 0.0) + turn_cost
            )

            stop_reason = getattr(response, "stop_reason", "")
            blocks = list(getattr(response, "content", []) or [])

            self._trace_event("assistant_message", {
                "turn": turn,
                "stop_reason": stop_reason,
                "tokens_total": self._tokens_used,
                "tokens_in_delta": non_cached_in,
                "tokens_out_delta": delta_out,
                "cache_read_delta": delta_cr,
                "cache_creation_delta": delta_cc,
                "model": turn_model,
                "cost_usd_turn": round(turn_cost, 6),
                "cost_usd_cumulative": round(self._cost_usd_cumulative, 6),
                "sonnet_streak": sonnet_unsuccessful_streak,
                "blocks": [
                    {"type": getattr(b, "type", "?"),
                     "preview": self._block_preview(b)}
                    for b in blocks
                ],
            })

            messages.append({
                "role": "assistant",
                "content": [self._serialize_block(b) for b in blocks],
            })

            if stop_reason == "end_turn":
                self._log(f"Tour {turn} : agent a terminé (end_turn)")
                break

            if stop_reason != "tool_use":
                self._log(f"Tour {turn} : stop_reason inattendu '{stop_reason}', arrêt")
                break

            tool_results: List[Dict[str, Any]] = []
            for block in blocks:
                if getattr(block, "type", None) != "tool_use":
                    continue
                tool_name = getattr(block, "name", "")
                tool_input = getattr(block, "input", {}) or {}
                tool_id = getattr(block, "id", "")

                self._log(f"Tour {turn} : tool_use {tool_name}")
                result_payload, is_error = self._dispatch_tool(tool_name, tool_input)
                self._trace_event("tool_result", {
                    "turn": turn,
                    "tool_name": tool_name,
                    "is_error": is_error,
                    "preview": self._truncate_str(json.dumps(result_payload, default=str), 800),
                })
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps(result_payload, default=str)[:50000],
                    "is_error": is_error,
                })

            if not tool_results:
                self._log(f"Tour {turn} : aucun tool_use traitable, arrêt")
                break

            messages.append({"role": "user", "content": tool_results})

            # Incrémenter le streak Sonnet si ce tour était Sonnet ET qu'aucun
            # run_scraper_test n'a renvoyé ok=True. Reset si succès.
            if CLAUDE_HYBRID_ENABLED and turn_model == CLAUDE_MODEL_REWRITE:
                if self._last_test_result and self._last_test_result.get("ok"):
                    sonnet_unsuccessful_streak = 0
                else:
                    sonnet_unsuccessful_streak += 1

        # Décision finale : on accepte le code si le dernier run_scraper_test
        # a renvoyé >= 1 produit avec name + (prix OU sourceUrl).
        if self._last_test_result and self._last_test_result.get("ok"):
            new_path = DEDICATED_DIR / f"{prior_attempt.module_name}.py"
            new_code = new_path.read_text(encoding="utf-8") if new_path.exists() else ""
            self._trace_event("agent_success", {
                "tokens_used": self._tokens_used,
                "cost_usd_total": round(getattr(self, "_cost_usd_cumulative", 0.0), 6),
                "products_count": self._last_test_result.get("products_count", 0),
            })
            # Capture de la leçon : agent fallback complet. On déduit les
            # champs ciblés depuis le field_coverage du dernier test (champs
            # qui sont passés de 0 à >0).
            try:
                cov = (self._last_test_result.get("field_coverage") or {})
                weak = [k for k, v in cov.items() if v and v > 0]
                primary = weak[0] if weak else None
                record_lesson(
                    slug=prior_attempt.slug,
                    url=analysis.site_url,
                    platform=analysis.platform.name,
                    phase="agent_fallback",
                    field_fixed=primary,
                    weak_fields=weak,
                    before_code=prior_code_snapshot,
                    after_code=new_code,
                    claude_rationale=(
                        f"Agent autonome reconstruit ({turn} tours, "
                        f"{self._tokens_used} tokens). "
                        f"Produits validés : {self._last_test_result.get('products_count', 0)}."
                    ),
                    tokens_used=self._tokens_used,
                    iterations=turn,
                    extra_signature=f"tokens:{self._tokens_used}",
                    verbose=self.verbose,
                )
            except Exception as e:
                self._log(f"capture lesson Phase 4.5 KO : {e}")
            return GeneratedScraper(
                slug=prior_attempt.slug,
                class_name=prior_attempt.class_name,
                module_name=prior_attempt.module_name,
                file_path=str(new_path),
                code=new_code,
                strategy_summary="claude_agent_rebuild",
            )

        self._log("Agent n'a pas produit de scraper validé — fallback sur ancien code")
        self._trace_event("agent_failure", {
            "tokens_used": self._tokens_used,
            "cost_usd_total": round(getattr(self, "_cost_usd_cumulative", 0.0), 6),
            "last_test": self._last_test_result,
        })
        return None

    # ==================================================================
    # Dispatcher d'outils
    # ==================================================================

    def _dispatch_tool(self, name: str, args: Dict[str, Any]) -> Tuple[Any, bool]:
        try:
            if name == "fetch_url":
                return self._tool_fetch_url(**args), False
            if name == "inspect_html":
                return self._tool_inspect_html(**args), False
            if name == "extract_links":
                return self._tool_extract_links(**args), False
            if name == "read_existing_scraper":
                return self._tool_read_existing_scraper(**args), False
            if name == "write_scraper_code":
                return self._tool_write_scraper_code(**args), False
            if name == "run_scraper_test":
                result = self._tool_run_scraper_test(**args)
                self._last_test_result = result
                return result, False
            if name == "query_sitemap":
                return self._tool_query_sitemap(**args), False
            if name == "try_known_platforms":
                return self._tool_try_known_platforms(**args), False
            return {"error": f"outil inconnu: {name}"}, True
        except TypeError as e:
            return {"error": f"args invalides: {e}"}, True
        except Exception as e:
            return {"error": f"{type(e).__name__}: {str(e)[:300]}"}, True

    # ------------------------------------------------------------------
    # Implémentations des outils
    # ------------------------------------------------------------------

    def _tool_fetch_url(self, url: str, render_js: bool = False) -> Dict[str, Any]:
        # Note : on pré-traite le HTML avec clean_html_for_llm AVANT troncature.
        # JSON-LD, og-meta et microdata sont préservés (cf. html_cleanup.py),
        # mais on retire les ~30-40% de bruit (scripts JS, styles, svg, data-attrs
        # non sémantiques). Le `length` retourné est la longueur originale pour
        # que Claude sache combien d'info source existe.
        if render_js:
            try:
                from .browser_agent import BrowserAgent
                with BrowserAgent() as agent:
                    result = agent.render(url)
                raw_html = result.html or ""
                cleaned = clean_html_for_llm(raw_html, aggressive=True)
                return {
                    "status": result.status or 0,
                    "final_url": result.final_url or url,
                    "length": len(raw_html),
                    "html_truncated": cleaned[:FETCH_TRUNCATE_BYTES],
                    "rendered_via": "playwright",
                    "error": result.error or "",
                }
            except Exception as e:
                self._log(f"Playwright a échoué, fallback requests: {e}")

        try:
            resp = requests.get(url, timeout=20, allow_redirects=True, headers={
                "User-Agent": "Mozilla/5.0 (compatible; ClaudeAgent/1.0)",
            })
            cleaned = clean_html_for_llm(resp.text, aggressive=True)
            return {
                "status": resp.status_code,
                "final_url": resp.url,
                "length": len(resp.text),
                "html_truncated": cleaned[:FETCH_TRUNCATE_BYTES],
                "rendered_via": "requests",
            }
        except Exception as e:
            return {"status": 0, "error": f"{type(e).__name__}: {e}"}

    def _tool_inspect_html(self, html: str, css_selector: str,
                           max_matches: int = 10) -> Dict[str, Any]:
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            soup = BeautifulSoup(html, "html.parser")

        try:
            matches = soup.select(css_selector)
        except Exception as e:
            return {"error": f"sélecteur invalide: {e}", "matches": []}

        results = []
        for el in matches[:max_matches]:
            results.append({
                "tag": el.name,
                "attrs": {k: (v if isinstance(v, str) else " ".join(v))
                          for k, v in (el.attrs or {}).items()},
                "text": (el.get_text(" ", strip=True) or "")[:200],
            })
        return {
            "selector": css_selector,
            "total_matches": len(matches),
            "matches": results,
        }

    def _tool_extract_links(self, html: str, base_url: str,
                            pattern_regex: str = "") -> Dict[str, Any]:
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            soup = BeautifulSoup(html, "html.parser")

        compiled = None
        if pattern_regex:
            try:
                compiled = re.compile(pattern_regex)
            except re.error as e:
                return {"error": f"regex invalide: {e}", "links": []}

        seen: List[str] = []
        for a in soup.find_all("a", href=True):
            absolute = urljoin(base_url, a["href"])
            if compiled and not compiled.search(absolute):
                continue
            if absolute not in seen:
                seen.append(absolute)
            if len(seen) >= 100:
                break
        return {"links": seen, "count": len(seen)}

    def _tool_read_existing_scraper(self, slug: str) -> Dict[str, Any]:
        module = slug.replace("-", "_")
        path = DEDICATED_DIR / f"{module}.py"
        if not path.exists():
            return {"exists": False, "code": ""}
        code = path.read_text(encoding="utf-8")
        return {
            "exists": True,
            "code": code[:30000],
            "truncated": len(code) > 30000,
            "length": len(code),
        }

    def _tool_write_scraper_code(self, slug: str, class_name: str,
                                 module_name: str, code: str) -> Dict[str, Any]:
        if not code.strip():
            return {"ok": False, "errors": ["code vide"]}
        try:
            ast.parse(code)
        except SyntaxError as e:
            return {"ok": False, "errors": [f"SyntaxError: {e}"]}
        if "class " not in code:
            return {"ok": False, "errors": ["aucune classe détectée"]}

        path = DEDICATED_DIR / f"{module_name}.py"
        path.write_text(code, encoding="utf-8")
        self._update_generated_registry(slug, module_name, class_name)
        return {
            "ok": True,
            "path": str(path),
            "length": len(code),
        }

    def _tool_run_scraper_test(self, slug: str, module_name: str,
                               class_name: str,
                               categories: Optional[List[str]] = None,
                               sample_limit: int = 3) -> Dict[str, Any]:
        """Exécute le scraper en sous-processus isolé avec timeout dur.

        Utilise ``Queue`` (pas Pipe) pour éviter le deadlock quand le
        payload dépasse 64 KB.
        """
        import multiprocessing as mp

        cats = categories or ["all"]
        ctx = mp.get_context("spawn")
        result_queue: "mp.Queue" = ctx.Queue()
        # Plafond explicite : sample_limit URLs (défaut 3) ou TEST_MAX_URLS_PER_CATEGORY
        # selon le plus grand des deux. Évite de lancer 1733 fetch.
        max_urls = max(sample_limit, TEST_MAX_URLS_PER_CATEGORY)
        proc = ctx.Process(
            target=_run_scraper_subprocess,
            args=(module_name, class_name, cats, result_queue, max_urls),
            daemon=True,
        )
        proc.start()

        payload: Optional[Dict[str, Any]] = None
        try:
            payload = result_queue.get(timeout=AGENT_TEST_TIMEOUT)
        except Exception:
            pass

        proc.join(timeout=5)
        if proc.is_alive():
            proc.terminate()
            proc.join(timeout=3)
            if proc.is_alive():
                proc.kill()
            try:
                result_queue.close()
            except Exception:
                pass
            if payload is None:
                return {
                    "ok": False,
                    "products_count": 0,
                    "errors": [f"timeout > {AGENT_TEST_TIMEOUT}s"],
                    "products": [],
                    "field_coverage": {},
                }

        try:
            result_queue.close()
        except Exception:
            pass
        if payload is None:
            payload = {"products": [], "error": "no payload received"}

        products = (payload.get("products") or [])[:sample_limit]
        errors = [payload["error"]] if payload.get("error") else []

        # Conformité minimale : ≥1 produit avec name + (prix OU sourceUrl)
        ok = any(
            p.get("name") and (p.get("prix") or p.get("sourceUrl"))
            for p in products
        )

        coverage: Dict[str, float] = {}
        if products:
            for field_name in ("name", "prix", "sourceUrl", "image", "marque",
                               "modele", "annee", "kilometrage"):
                present = sum(1 for p in products if p.get(field_name))
                coverage[field_name] = round(present / len(products), 2)

        return {
            "ok": ok,
            "products_count": len(products),
            "products": [_sanitize_product(p) for p in products],
            "errors": errors,
            "field_coverage": coverage,
        }

    # ------------------------------------------------------------------
    # Outils ajoutés en Phase 3 (durcissement)
    # ------------------------------------------------------------------

    def _tool_query_sitemap(self, base_url: str) -> Dict[str, Any]:
        """Tente de localiser et lire un sitemap.xml pour le site donné.

        Délègue à ``platforms.probe_sitemap`` qui tente plusieurs chemins
        connus (``/sitemap.xml``, ``/sitemap_index.xml``, etc.) et filtre
        les URLs probables de pages produit. Retourne au plus 50 URLs pour
        ne pas saturer le contexte Claude.
        """
        try:
            from .platforms import probe_sitemap, detect_platform, PlatformRecipe
        except Exception as e:
            return {"ok": False, "error": f"import platforms KO: {e}"}

        try:
            session = requests.Session()
            session.headers.update({
                "User-Agent": "Mozilla/5.0 (compatible; ClaudeAgent/1.0)",
            })
            # On essaye d'abord avec une recette par défaut (générique)
            recipe = PlatformRecipe()
            urls, sitemap_url = probe_sitemap(session, base_url, recipe)
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:300]}"}

        urls = list(urls or [])[:50]
        return {
            "ok": bool(urls),
            "sitemap_url": sitemap_url or "",
            "product_urls": urls,
            "total_estimated": len(urls),
            "note": (
                "Échantillon limité à 50 URLs. S'il y a plus dans le sitemap, "
                "le scraper généré devra les lire à l'exécution réelle."
                if urls else
                "Aucun sitemap exploitable trouvé. Fallback sur listing + détail."
            ),
        }

    def _tool_try_known_platforms(self, html: str, url: str) -> Dict[str, Any]:
        """Vérifie si le HTML correspond à une plateforme reconnue.

        Si oui, retourne la classe à hériter, les sélecteurs par défaut et le
        chemin de sitemap probable — l'agent peut alors choisir d'écrire un
        scraper "thin" qui hérite plutôt qu'un from-scratch.
        """
        try:
            from .platforms import detect_platform
        except Exception as e:
            return {"matched": False, "error": f"import platforms KO: {e}"}

        try:
            recipe = detect_platform(html or "", {}, url)
        except Exception as e:
            return {"matched": False, "error": f"{type(e).__name__}: {str(e)[:300]}"}

        if not recipe or recipe.platform_type.value == "generic":
            return {
                "matched": False,
                "platform": "generic",
                "note": "Plateforme non reconnue, continue avec un from-scratch.",
            }

        return {
            "matched": True,
            "platform": recipe.platform_type.value,
            "platform_name": recipe.name,
            "inheritable_class": recipe.inheritable_scraper_class or None,
            "default_listing_selector": recipe.default_listing_selector or "",
            "default_item_selector": recipe.default_item_selector or "",
            "default_price_selector": recipe.default_price_selector or "",
            "default_sitemap_path": recipe.default_sitemap_path or "",
            "default_pagination_param": recipe.default_pagination_param or "",
            "note": (
                f"Plateforme reconnue : {recipe.name}. "
                + (
                    f"Préférer hériter de `{recipe.inheritable_scraper_class}` "
                    f"plutôt qu'un from-scratch."
                    if recipe.inheritable_scraper_class
                    else "Pas de classe d'héritage disponible — utiliser les sélecteurs proposés."
                )
            ),
        }

    # ==================================================================
    # Construction des prompts
    # ==================================================================

    def _build_system_prompt(self, analysis: SiteAnalysis,
                             strategy: ScrapingStrategy,
                             prior: GeneratedScraper,
                             *,
                             mission_plan: Optional[Dict[str, Any]] = None) -> str:
        base = (
            "Tu es un agent autonome chargé de construire un scraper Python qui "
            "extrait l'inventaire d'un site e-commerce ou concessionnaire.\n\n"
            "RÈGLES D'OR :\n"
            "1. Le scraper DOIT être une classe qui hérite de "
            "`scraper_ai.dedicated_scrapers.base.DedicatedScraper`.\n"
            "2. Il DOIT implémenter `discover_product_urls(self, categories) -> List[str]` "
            "et `extract_from_detail_page(self, url, html, soup) -> Optional[Dict]`.\n"
            "3. Les attributs SITE_NAME, SITE_SLUG, SITE_URL, SITE_DOMAIN sont "
            "OBLIGATOIRES.\n"
            "4. Tu N'INVENTES PAS de sélecteurs : utilise `fetch_url` puis "
            "`inspect_html` pour confirmer chaque sélecteur AVANT de l'écrire.\n"
            "5. Tu écris le code via `write_scraper_code` puis tu valides via "
            "`run_scraper_test`. Si `ok=false`, tu corriges et tu réessaies.\n"
            "6. Tu déclares ta mission terminée (réponse texte sans tool_use) "
            "UNIQUEMENT après un `run_scraper_test` qui retourne ok=true.\n\n"
            "MÉTHODOLOGIE RECOMMANDÉE :\n"
            "  a) read_existing_scraper(slug) pour voir ce qui a échoué ;\n"
            "  b) fetch_url(site_url) pour comprendre la structure home ;\n"
            "  c) try_known_platforms(html, url) : si MATCH, écris un scraper "
            "QUI HÉRITE de la classe proposée plutôt que from-scratch ;\n"
            "  d) query_sitemap(base_url) : si OK, utilise les URLs trouvées "
            "comme base de discover_product_urls ;\n"
            "  e) extract_links + fetch_url pour compléter ;\n"
            "  f) inspect_html sur les listings/pages détail pour mapper les sélecteurs ;\n"
            "  g) write_scraper_code avec un fichier .py complet ;\n"
            "  h) run_scraper_test pour vérifier ; corriger si ko ; déclarer fini si ok.\n\n"
            f"BUDGET : {CLAUDE_AGENT_MAX_TURNS} tours max, {CLAUDE_AGENT_MAX_TOKENS_PER_RUN} "
            "tokens cumulés. Sois concis dans tes raisonnements."
        )

        # Phase 2.7 : si on est en mode hybride, on injecte le PlanDeMission
        # produit par Opus en tour 0. Sonnet l'utilise comme guide d'exécution
        # mécanique au lieu de re-raisonner à chaque tour.
        if mission_plan:
            plan_block = json.dumps(mission_plan, indent=2, ensure_ascii=False)
            base += (
                "\n\nPLAN DE MISSION (produit par l'architecte Opus) :\n"
                f"```json\n{plan_block}\n```\n\n"
                "Suis ce plan d'execution. Si tu rencontres un blocage non prevu, "
                "tu peux t'en ecarter mais explique pourquoi en 1 phrase concise."
            )
        return base

    def _build_mission_plan(
        self,
        analysis: SiteAnalysis,
        strategy: ScrapingStrategy,
        prior: GeneratedScraper,
    ) -> Optional[Dict[str, Any]]:
        """Phase 2.7 : tour 0 d'Opus = PlanDeMission JSON court.

        Sortie typique (~500 tokens output) :
            {
                "strategy": "scraper_thin_inheriting_X" | "from_scratch",
                "discovery": "sitemap_then_filter" | "listing_pagination" | ...,
                "extraction_priority": ["json_ld", "css_selector", "regex_fallback"],
                "tools_sequence": ["query_sitemap", "fetch_url", ...]
            }

        Si l'appel échoue (timeout, JSON invalide), on retourne None et
        l'agent tourne sans plan (= comportement Sonnet pur).
        """
        if self._client is None:
            return None

        from .cost_tracking import compute_cost_usd

        profile = get_profile(analysis.domain_profile_key or "auto")
        target_fields = ", ".join(f.name for f in profile.fields)

        prompt = (
            f"PLAN DE MISSION pour reconstruire le scraper de "
            f"{analysis.site_url}.\n\n"
            f"Plateforme detectee : {analysis.platform.name}\n"
            f"Domain profile : {profile.name} (champs : {target_fields})\n"
            f"json_ld_available : {analysis.json_ld_available}\n"
            f"sitemap : {analysis.sitemap_xml_url or '(aucun)'}\n"
            f"discovery_method (planner) : {strategy.discovery_method.value}\n"
            f"extraction_method (planner) : {strategy.extraction_method.value}\n\n"
            "Ton role : produire un PLAN court (JSON strict) que l'agent "
            "executor suivra. Tu n'ecris PAS de code. Output JSON :\n"
            "{\n"
            '  "strategy": "scraper_thin_inheriting_<class>" | "from_scratch",\n'
            '  "discovery": "sitemap_then_filter" | "listing_pagination" | "api_endpoint",\n'
            '  "extraction_priority": ["json_ld", "css_selector", "microdata", "regex_fallback"],\n'
            '  "tools_sequence": ["read_existing_scraper", "fetch_url", "try_known_platforms", "query_sitemap", "inspect_html", "write_scraper_code", "run_scraper_test"],\n'
            '  "key_selectors_hints": ["[data-price-amount]", "h1.product-title", "..."],\n'
            '  "rationale": "1 phrase courte"\n'
            "}\n"
            "Sois concis : <500 tokens output. Aucun markdown."
        )

        # Snapshot compteurs avant
        in_before = self._client.total_tokens_in
        out_before = self._client.total_tokens_out
        cr_before = self._client.total_cache_read_tokens
        cc_before = self._client.total_cache_creation_tokens

        try:
            data = self._client.call(
                prompt,
                system="Tu es un architecte expert en web scraping. Tu produis "
                       "un plan JSON strict, jamais de code, jamais de markdown.",
                max_tokens=800,
                response_mime_type="application/json",
                model=CLAUDE_MODEL_DIAGNOSIS,
            )
        except Exception as e:
            self._log(f"Mission plan KO : {type(e).__name__}: {e}")
            self._trace_event("mission_plan_error", {"error": str(e)})
            return None

        delta_in = self._client.total_tokens_in - in_before
        delta_out = self._client.total_tokens_out - out_before
        delta_cr = self._client.total_cache_read_tokens - cr_before
        delta_cc = self._client.total_cache_creation_tokens - cc_before
        non_cached_in = max(0, delta_in - delta_cr - delta_cc)
        plan_cost = compute_cost_usd(
            CLAUDE_MODEL_DIAGNOSIS,
            input_tokens=non_cached_in,
            output_tokens=delta_out,
            cache_read_tokens=delta_cr,
            cache_creation_tokens=delta_cc,
        )
        self._cost_usd_cumulative = (
            getattr(self, "_cost_usd_cumulative", 0.0) + plan_cost
        )

        if not isinstance(data, dict):
            self._log("Mission plan : reponse non-dict, agent sans plan")
            return None

        self._trace_event("mission_plan", {
            "model": CLAUDE_MODEL_DIAGNOSIS,
            "tokens_in_delta": non_cached_in,
            "tokens_out_delta": delta_out,
            "cost_usd": round(plan_cost, 6),
            "plan": data,
        })
        return data

    def _build_user_prompt(self, analysis: SiteAnalysis,
                           strategy: ScrapingStrategy,
                           prior: GeneratedScraper) -> str:
        profile = get_profile(analysis.domain_profile_key or "auto")
        target_fields = ", ".join(f"{f.name}({f.parser})" for f in profile.fields)

        listing_hints = []
        for lp in analysis.listing_pages[:3]:
            listing_hints.append(f"  - {lp.url} (catégorie: {lp.source_categorie})")

        return (
            f"MISSION : reconstruire le scraper pour {analysis.site_name} "
            f"({analysis.site_url}).\n\n"
            f"Le scraper templatisé existant n'a pas atteint le seuil de validation "
            f"(score < 80). Il faut le réécrire entièrement.\n\n"
            f"--- CONTEXTE ---\n"
            f"slug      : {prior.slug}\n"
            f"module    : {prior.module_name}\n"
            f"classe    : {prior.class_name}\n"
            f"fichier   : dedicated_scrapers/{prior.module_name}.py\n"
            f"profil    : {profile.name} (champs cibles: {target_fields})\n"
            f"plateforme: {analysis.platform.name}\n"
            f"discovery : {strategy.discovery_method.value}\n"
            f"extraction: {strategy.extraction_method.value}\n"
            f"rendering : {strategy.rendering.value}\n"
            f"json_ld   : {analysis.json_ld_available} ({analysis.json_ld_type})\n"
            f"sitemap   : {analysis.sitemap_xml_url or '(aucun)'}\n"
            f"listings détectés:\n" +
            ("\n".join(listing_hints) if listing_hints else "  (aucun)") + "\n\n"
            f"Commence par lire le code existant pour comprendre ce qui a échoué, "
            f"puis explore le site et écris une nouvelle version.\n"
            f"Quand le `run_scraper_test` final est ok, réponds simplement 'Mission accomplie'."
        )

    # ==================================================================
    # Helpers
    # ==================================================================

    def _update_generated_registry(self, slug: str, module: str,
                                   class_name: str) -> None:
        """Idempotent : ajoute l'entrée registry si absente, sinon no-op."""
        header = (
            "# AUTO-GENERE par scraper_usine. Ne pas modifier.\n"
            "GENERATED_SCRAPERS = {}\nGENERATED_DOMAINS = {}\n\n"
        )
        entry = (
            f"try:\n"
            f"    from .{module} import {class_name}\n"
            f"    GENERATED_SCRAPERS['{slug}'] = {class_name}\n"
            f"except ImportError:\n"
            f"    pass\n\n"
        )

        if GENERATED_REGISTRY_PATH.exists():
            content = GENERATED_REGISTRY_PATH.read_text(encoding="utf-8")
            if f"from .{module} import" in content:
                return
            content += entry
        else:
            content = header + entry

        GENERATED_REGISTRY_PATH.write_text(content, encoding="utf-8")

    @staticmethod
    def _serialize_block(block: Any) -> Dict[str, Any]:
        """Convertit un block du SDK Anthropic en dict pour le re-poster."""
        block_type = getattr(block, "type", None)
        if block_type == "text":
            return {"type": "text", "text": getattr(block, "text", "") or ""}
        if block_type == "tool_use":
            return {
                "type": "tool_use",
                "id": getattr(block, "id", ""),
                "name": getattr(block, "name", ""),
                "input": getattr(block, "input", {}) or {},
            }
        # fallback générique : on conserve le dict si possible
        return {"type": block_type or "unknown"}

    @staticmethod
    def _block_preview(block: Any) -> str:
        block_type = getattr(block, "type", "")
        if block_type == "text":
            return ClaudeAgent._truncate_str(getattr(block, "text", "") or "", 200)
        if block_type == "tool_use":
            inp = getattr(block, "input", {}) or {}
            return f"{getattr(block, 'name', '')}({list(inp.keys())})"
        return block_type

    @staticmethod
    def _truncate_str(s: str, max_len: int) -> str:
        if not s:
            return ""
        return s if len(s) <= max_len else s[:max_len] + "...[tronqué]"

    def _trace_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        if not self._trace_path:
            return
        try:
            line = json.dumps({
                "ts": datetime.now(timezone.utc).isoformat(),
                "type": event_type,
                **payload,
            }, ensure_ascii=False, default=str)
            with self._trace_path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [ClaudeAgent] {msg}")


# ---------------------------------------------------------------------------
# Helpers exécutés dans un sous-processus séparé (multiprocessing spawn)
# ---------------------------------------------------------------------------

def _run_scraper_subprocess(module_name: str, class_name: str,
                             categories: List[str], queue,
                             max_urls: int = 5) -> None:
    """Réimplémentation locale de validator._run_scraper_subprocess.

    Patche ``discover_product_urls`` du scraper pour limiter strictement
    le nombre d'URLs scrapées (par défaut 5). Sinon un site avec 1733
    URLs sitemap fait systématiquement timeout pendant un simple test.

    Utilise Queue (pas Pipe) pour éviter le deadlock du buffer 64 KB.
    """
    import importlib as _imp
    payload: Dict[str, Any] = {"products": [], "error": ""}
    try:
        module_path = f"scraper_ai.dedicated_scrapers.{module_name}"
        mod = _imp.import_module(module_path)
        scraper_class = getattr(mod, class_name)
        scraper = scraper_class()

        scraper.MAX_WORKERS = 2
        if hasattr(scraper, "WORKERS"):
            scraper.WORKERS = 2
        scraper.HTTP_TIMEOUT = 20
        if hasattr(scraper, "DETAIL_TIMEOUT"):
            scraper.DETAIL_TIMEOUT = 20

        original_discover = scraper.discover_product_urls

        def limited_discover(categories=None):
            urls = original_discover(categories=categories)
            if isinstance(urls, list) and len(urls) > max_urls:
                return urls[:max_urls]
            return urls

        scraper.discover_product_urls = limited_discover

        result = scraper.scrape(categories=categories, inventory_only=False)
        # Tronqué pour rester sous la limite de sérialisation Queue
        # et pour limiter la quantité de tokens redonnée à Claude.
        products = result.get("products", [])
        payload["products"] = [_sanitize_product(p) for p in products]
    except Exception as e:
        import traceback
        payload["error"] = (
            f"{type(e).__name__}: {str(e)[:400]}\n"
            f"{traceback.format_exc()[-1200:]}"
        )
    try:
        queue.put(payload, timeout=10)
    except Exception:
        pass


def _sanitize_product(p: Dict[str, Any]) -> Dict[str, Any]:
    """Tronque les valeurs longues pour ne pas exploser le contexte Claude."""
    out: Dict[str, Any] = {}
    for k, v in p.items():
        if isinstance(v, str) and len(v) > 200:
            out[k] = v[:200] + "..."
        elif isinstance(v, list) and len(v) > 5:
            out[k] = v[:5]
        else:
            out[k] = v
    return out


__all__ = ["ClaudeAgent", "TOOL_DEFINITIONS"]
