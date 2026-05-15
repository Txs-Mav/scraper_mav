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

try:
    from scraper_ai.config import (
        CLAUDE_AGENT_ENABLED,
        CLAUDE_AGENT_MAX_TOKENS_PER_RUN,
        CLAUDE_AGENT_MAX_TURNS,
    )
    from scraper_ai.claude_client import ClaudeClient, ClaudeUnavailableError
except ImportError:  # pragma: no cover
    from ..config import (  # type: ignore[no-redef]
        CLAUDE_AGENT_ENABLED,
        CLAUDE_AGENT_MAX_TOKENS_PER_RUN,
        CLAUDE_AGENT_MAX_TURNS,
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
        self._last_test_result: Optional[Dict[str, Any]] = None

        system_prompt = self._build_system_prompt(analysis, strategy, prior_attempt)
        user_prompt = self._build_user_prompt(analysis, strategy, prior_attempt)

        messages: List[Dict[str, Any]] = [
            {"role": "user", "content": user_prompt},
        ]

        self._log(f"Démarrage agent (max {CLAUDE_AGENT_MAX_TURNS} tours)...")
        self._trace_event("agent_start", {
            "site_url": analysis.site_url,
            "slug": prior_attempt.slug,
            "max_turns": CLAUDE_AGENT_MAX_TURNS,
            "max_tokens": CLAUDE_AGENT_MAX_TOKENS_PER_RUN,
        })

        for turn in range(1, CLAUDE_AGENT_MAX_TURNS + 1):
            if self._tokens_used >= CLAUDE_AGENT_MAX_TOKENS_PER_RUN:
                self._log(f"Budget tokens épuisé ({self._tokens_used}) — arrêt agent")
                self._trace_event("agent_exhausted", {
                    "tokens_used": self._tokens_used,
                    "turn": turn,
                })
                break

            try:
                response = self._client.call_with_tools(  # type: ignore[union-attr]
                    messages, system=system_prompt, tools=TOOL_DEFINITIONS,
                )
            except Exception as e:
                self._log(f"Tour {turn} : appel Claude échoué — {type(e).__name__}: {e}")
                self._trace_event("agent_error", {"turn": turn, "error": str(e)})
                return None

            self._tokens_used = (
                self._client.total_tokens_in + self._client.total_tokens_out  # type: ignore[union-attr]
            )

            stop_reason = getattr(response, "stop_reason", "")
            blocks = list(getattr(response, "content", []) or [])

            self._trace_event("assistant_message", {
                "turn": turn,
                "stop_reason": stop_reason,
                "tokens_total": self._tokens_used,
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

        # Décision finale : on accepte le code si le dernier run_scraper_test
        # a renvoyé >= 1 produit avec name + (prix OU sourceUrl).
        if self._last_test_result and self._last_test_result.get("ok"):
            new_path = DEDICATED_DIR / f"{prior_attempt.module_name}.py"
            new_code = new_path.read_text(encoding="utf-8") if new_path.exists() else ""
            self._trace_event("agent_success", {
                "tokens_used": self._tokens_used,
                "products_count": self._last_test_result.get("products_count", 0),
            })
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
            return {"error": f"outil inconnu: {name}"}, True
        except TypeError as e:
            return {"error": f"args invalides: {e}"}, True
        except Exception as e:
            return {"error": f"{type(e).__name__}: {str(e)[:300]}"}, True

    # ------------------------------------------------------------------
    # Implémentations des outils
    # ------------------------------------------------------------------

    def _tool_fetch_url(self, url: str, render_js: bool = False) -> Dict[str, Any]:
        if render_js:
            try:
                from .browser_agent import BrowserAgent
                with BrowserAgent() as agent:
                    result = agent.render(url)
                html = (result.html or "")[:FETCH_TRUNCATE_BYTES]
                return {
                    "status": result.status or 0,
                    "final_url": result.final_url or url,
                    "length": len(result.html or ""),
                    "html_truncated": html,
                    "rendered_via": "playwright",
                    "error": result.error or "",
                }
            except Exception as e:
                self._log(f"Playwright a échoué, fallback requests: {e}")

        try:
            resp = requests.get(url, timeout=20, allow_redirects=True, headers={
                "User-Agent": "Mozilla/5.0 (compatible; ClaudeAgent/1.0)",
            })
            html = resp.text[:FETCH_TRUNCATE_BYTES]
            return {
                "status": resp.status_code,
                "final_url": resp.url,
                "length": len(resp.text),
                "html_truncated": html,
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

    # ==================================================================
    # Construction des prompts
    # ==================================================================

    def _build_system_prompt(self, analysis: SiteAnalysis,
                             strategy: ScrapingStrategy,
                             prior: GeneratedScraper) -> str:
        return (
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
            "  c) extract_links + fetch_url pour identifier les pages listing ;\n"
            "  d) inspect_html sur les listings pour trouver les item selectors ;\n"
            "  e) fetch_url sur 1 page produit pour mapper les sélecteurs détail ;\n"
            "  f) write_scraper_code avec un fichier .py complet ;\n"
            "  g) run_scraper_test pour vérifier ; corriger si ko ; déclarer fini si ok.\n\n"
            f"BUDGET : {CLAUDE_AGENT_MAX_TURNS} tours max, {CLAUDE_AGENT_MAX_TOKENS_PER_RUN} "
            "tokens cumulés. Sois concis dans tes raisonnements."
        )

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
