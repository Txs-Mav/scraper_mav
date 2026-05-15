"""Client Anthropic (Claude) pour les appels API.

Pendant minimaliste de :mod:`scraper_ai.gemini_client` mais ciblé sur l'API
Messages d'Anthropic. Utilisé par :mod:`scraper_ai.scraper_usine` pour la
supervision (juge), la correction de code (rewrite) et l'agent autonome
(tool use).

Pourquoi un client séparé plutôt que multiplexer GeminiClient ?
  - Les SDK divergent (Vertex/genai vs anthropic).
  - Le tool use de Claude a son propre cycle de messages (assistant ->
    tool_use -> user/tool_result -> assistant) qu'il vaut mieux exposer
    explicitement à :class:`scraper_ai.scraper_usine.claude_agent.ClaudeAgent`.
  - On évite de coupler la dispo Anthropic à celle de Gemini (un peut
    tomber sans bloquer l'autre).
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

try:
    from .config import (
        ANTHROPIC_API_KEY,
        CLAUDE_MAX_OUTPUT_TOKENS,
        CLAUDE_MODEL,
    )
except ImportError:  # pragma: no cover — exécution hors package
    from config import (  # type: ignore[no-redef]
        ANTHROPIC_API_KEY,
        CLAUDE_MAX_OUTPUT_TOKENS,
        CLAUDE_MODEL,
    )


class ClaudeUnavailableError(RuntimeError):
    """Levée quand le SDK ou la clé Anthropic ne sont pas disponibles.

    Le superviseur l'attrape pour s'auto-désactiver proprement (le pipeline
    `scraper_usine` continue sans LLM, comme avant l'intégration Claude).
    """


class ClaudeClient:
    """Wrapper minimaliste autour du SDK ``anthropic``.

    Expose deux primitives :
      - :meth:`call` pour les générations texte/JSON simples (juge + rewrite).
      - :meth:`call_with_tools` pour le mode agentique (un seul tour ; la
        boucle agent reste dans :class:`ClaudeAgent` qui a besoin d'inspecter
        les tool_use blocks et d'envoyer les tool_results).
    """

    def __init__(self, model: Optional[str] = None,
                 api_key: Optional[str] = None,
                 verbose: bool = True):
        self.model = model or CLAUDE_MODEL
        self.verbose = verbose
        self._call_count = 0
        self.total_tokens_in = 0
        self.total_tokens_out = 0

        key = api_key or ANTHROPIC_API_KEY
        if not key:
            raise ClaudeUnavailableError(
                "ANTHROPIC_API_KEY manquante — Claude désactivé."
            )

        try:
            import anthropic  # noqa: F401
        except ImportError as e:
            raise ClaudeUnavailableError(
                "Le paquet `anthropic` n'est pas installé. "
                "Lance `pip install anthropic>=0.40.0` pour activer Claude."
            ) from e

        from anthropic import Anthropic
        self._client = Anthropic(api_key=key)

        if self.verbose:
            print(f"  [ClaudeClient] Initialisé (modèle: {self.model})")

    # ------------------------------------------------------------------
    # Génération simple (texte ou JSON)
    # ------------------------------------------------------------------

    def call(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        response_mime_type: str = "text/plain",
        temperature: Optional[float] = None,
        show_prompt: bool = False,
    ) -> Any:
        """Appelle Claude avec un prompt utilisateur.

        Si ``response_mime_type == "application/json"``, on tente un
        ``json.loads`` sur la réponse (les réponses de Claude peuvent contenir
        des blocs ```json ... ``` qu'on retire).

        ``temperature`` est ignorée pour les modèles qui ne la supportent
        plus (cf. Opus 4.7+). Pour rester explicite, on n'envoie le paramètre
        à l'API que si le caller le demande ET que le modèle le tolère.

        Returns:
            ``str`` si MIME type texte, ``dict``/``list`` si JSON.
        """
        if show_prompt:
            self._log_prompt(prompt, system)

        max_out = max_tokens or CLAUDE_MAX_OUTPUT_TOKENS
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_out,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        if temperature is not None and self._supports_temperature():
            kwargs["temperature"] = temperature

        response = self._client.messages.create(**kwargs)

        # Comptage tokens (utilisable par le superviseur pour les coûts).
        usage = getattr(response, "usage", None)
        if usage is not None:
            self.total_tokens_in += getattr(usage, "input_tokens", 0) or 0
            self.total_tokens_out += getattr(usage, "output_tokens", 0) or 0

        text = self._extract_text(response)
        self._call_count += 1

        if show_prompt:
            self._log_response(text)

        if response_mime_type == "application/json":
            return self._parse_json(text)
        return text

    # ------------------------------------------------------------------
    # Tool use (un seul tour — la boucle reste côté ClaudeAgent)
    # ------------------------------------------------------------------

    def call_with_tools(
        self,
        messages: List[Dict[str, Any]],
        *,
        system: Optional[str] = None,
        tools: List[Dict[str, Any]],
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> Any:
        """Envoie un tour d'agent avec outils disponibles.

        Args:
            messages: historique complet (user/assistant/tool_result blocks).
            system: prompt système.
            tools: liste de tool definitions au format Anthropic
                (``{"name", "description", "input_schema"}``).

        Returns:
            L'objet ``Message`` brut renvoyé par le SDK ; l'appelant inspecte
            ``message.content`` (liste de blocks ``text`` / ``tool_use``) et
            ``message.stop_reason`` (``"end_turn"`` / ``"tool_use"`` / ...).
        """
        max_out = max_tokens or CLAUDE_MAX_OUTPUT_TOKENS
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_out,
            "messages": messages,
            "tools": tools,
        }
        if system:
            kwargs["system"] = system
        if temperature is not None and self._supports_temperature():
            kwargs["temperature"] = temperature

        response = self._client.messages.create(**kwargs)
        usage = getattr(response, "usage", None)
        if usage is not None:
            self.total_tokens_in += getattr(usage, "input_tokens", 0) or 0
            self.total_tokens_out += getattr(usage, "output_tokens", 0) or 0
        self._call_count += 1
        return response

    # ------------------------------------------------------------------
    # Utilitaires
    # ------------------------------------------------------------------

    def _supports_temperature(self) -> bool:
        """Indique si le modèle accepte le paramètre ``temperature``.

        À partir de Claude Opus 4.7, Anthropic a déprécié ``temperature``
        (l'API renvoie 400 si on l'envoie). On exclut donc cette famille.
        Liste maintenue manuellement — étendre quand de nouveaux modèles
        rejoignent la dépréciation.
        """
        deprecated_prefixes = ("claude-opus-4-7",)
        return not any(self.model.startswith(p) for p in deprecated_prefixes)

    @staticmethod
    def _extract_text(response: Any) -> str:
        """Concatène le texte des blocks ``text`` du message."""
        parts: List[str] = []
        for block in getattr(response, "content", []) or []:
            block_type = getattr(block, "type", None)
            if block_type == "text":
                parts.append(getattr(block, "text", "") or "")
        return "".join(parts).strip()

    @staticmethod
    def _parse_json(text: str) -> Any:
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*\n?", "", text)
            text = re.sub(r"\n?```\s*$", "", text)
        return json.loads(text)

    def _log_prompt(self, prompt: str, system: Optional[str]) -> None:
        print(f"\n{'─'*60}")
        print(f"  [ClaudeClient] PROMPT ({self.model}):")
        if system:
            preview = system[:500] + ("..." if len(system) > 500 else "")
            print(f"  [system]: {preview}")
        body = prompt[:2000] + ("..." if len(prompt) > 2000 else "")
        print(body)
        print(f"{'─'*60}")

    def _log_response(self, text: str) -> None:
        print(f"\n{'─'*60}")
        print(f"  [ClaudeClient] RÉPONSE:")
        body = text[:3000] + ("..." if len(text) > 3000 else "")
        print(body)
        print(f"{'─'*60}\n")
