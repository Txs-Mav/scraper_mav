"""Calcul de coût USD pour les appels Claude.

Centralise la table de prix Anthropic (USD par million de tokens) pour que
tous les modules (`claude_supervisor`, `claude_agent`, dashboard admin)
parlent du même chiffre.

Tarifs publics Anthropic (mai 2026, à mettre à jour si Anthropic change) :
  - claude-opus-4-7    : 15 $/M input, 75 $/M output
  - claude-sonnet-4-5  : 3 $/M input,  15 $/M output
  - claude-haiku-3-5   : 0.80 $/M input, 4 $/M output

Tarifs prompt caching :
  - cache_read_input_tokens     = 0.10 × tarif input (90 % off)
  - cache_creation_input_tokens = 1.25 × tarif input (surcoût d'écriture)

Ces ratios sont identiques pour tous les modèles Anthropic (cf. doc Anthropic
prompt caching).
"""
from __future__ import annotations

from typing import Dict, Optional

# Prix en USD par million de tokens. Clé = prefix de model name, value = (in, out).
# Le matching utilise startswith() pour tolérer les suffixes de version.
_MODEL_PRICES_USD_PER_M: Dict[str, tuple[float, float]] = {
    "claude-opus-4-7":   (15.0, 75.0),
    "claude-opus-4":     (15.0, 75.0),
    "claude-sonnet-4-5": (3.0,  15.0),
    "claude-sonnet-4":   (3.0,  15.0),
    "claude-sonnet-3-7": (3.0,  15.0),
    "claude-sonnet-3-5": (3.0,  15.0),
    "claude-haiku-3-5":  (0.80, 4.0),
    "claude-haiku":      (0.80, 4.0),
    # Fallback générique pour les noms historiques
    "claude-3-opus":     (15.0, 75.0),
    "claude-3-5-sonnet": (3.0,  15.0),
    "claude-3-5-haiku":  (0.80, 4.0),
}

# Multiplicateurs prompt caching (0.10× pour read, 1.25× pour creation).
_CACHE_READ_RATIO = 0.10
_CACHE_CREATION_RATIO = 1.25


def get_model_prices(model: str) -> Optional[tuple[float, float]]:
    """Retourne ``(input_usd_per_M, output_usd_per_M)`` pour un modèle, ou None.

    Match par préfixe pour tolérer les suffixes de version. Renvoie None si
    le modèle n'est pas connu (le caller décide s'il logue 0$ ou warn).
    """
    if not model:
        return None
    for prefix, prices in _MODEL_PRICES_USD_PER_M.items():
        if model.startswith(prefix):
            return prices
    return None


def compute_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    """Calcule le coût USD d'un appel Claude.

    Args:
        model: nom du modèle (ex: "claude-opus-4-7", "claude-sonnet-4-5").
        input_tokens: tokens input non-cachés (facturés au tarif normal).
        output_tokens: tokens output générés.
        cache_read_tokens: tokens lus depuis le cache (facturés à 0.10× input).
        cache_creation_tokens: tokens écrits dans le cache (facturés à 1.25× input).

    Returns:
        Coût en USD (float). Renvoie 0.0 si modèle inconnu.

    Notes:
        Les compteurs ``input_tokens`` retournés par Anthropic dans ``usage``
        n'incluent PAS les ``cache_read_input_tokens`` ni ``cache_creation_input_tokens``.
        Il faut donc les passer séparément (et non additionner avant de passer
        à cette fonction). Voir https://docs.anthropic.com/.../prompt-caching
    """
    prices = get_model_prices(model)
    if prices is None:
        return 0.0
    in_per_m, out_per_m = prices

    cost_input = (input_tokens / 1_000_000) * in_per_m
    cost_output = (output_tokens / 1_000_000) * out_per_m
    cost_cache_read = (cache_read_tokens / 1_000_000) * in_per_m * _CACHE_READ_RATIO
    cost_cache_creation = (
        cache_creation_tokens / 1_000_000
    ) * in_per_m * _CACHE_CREATION_RATIO

    return round(
        cost_input + cost_output + cost_cache_read + cost_cache_creation,
        6,
    )


def format_cost(cost_usd: float) -> str:
    """Formatte un coût pour affichage (ex: ``$0.0124``)."""
    if cost_usd < 0.001:
        return f"${cost_usd*1000:.2f}m"  # millicents
    return f"${cost_usd:.4f}"


__all__ = ["compute_cost_usd", "get_model_prices", "format_cost"]
