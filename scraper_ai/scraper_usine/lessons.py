"""Capture legere des corrections Claude (Phase 5.2 du plan optim couts).

Avant : ce module faisait 232 lignes avec signature normalisee, alias de
champs, diff unified, troncatures dramatiques (12K + 12K + 16K = 40K chars
par lecon stockee dans Supabase via POST synchrone 15s timeout).

Maintenant : append-only JSONL local, payload minimal (slug, url, phase,
rationale court, timestamp, tokens, cost). Le dashboard /admin/usine
continue de lire la table Supabase ``usine_lessons`` historique pour les
anciennes lecons ; les nouvelles vont dans ``scraper_cache/lessons.jsonl``.

API publique conservee :
  - :func:`record_lesson` (signature inchangee, simplement le contenu ecrit change)
  - :func:`extract_field_hints` (helper pur, utile)

Drops :
  - signature normalisee (jamais utilisee dans les prompts)
  - diff unified de 16K chars (jamais utilise dans les prompts)
  - before_code/after_code complets (jamais utilises dans les prompts)
  - POST Supabase synchrone qui rallongeait chaque run de 1-15s par lecon
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional


# Chemin local du journal append-only. Ne grossit pas avec before/after_code,
# uniquement metadata + rationale court.
LESSONS_JSONL_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "scraper_cache" / "lessons.jsonl"
)

# Plafond rationale (avant : 2000 chars, maintenant : 500 chars suffisent
# largement pour un audit retrospectif).
MAX_RATIONALE_LEN = 500


# ---------------------------------------------------------------------------
# Extraction de hints de champs (helper pur, garde sa valeur)
# ---------------------------------------------------------------------------

_KNOWN_FIELDS = (
    "price", "prix", "name", "title", "image", "images",
    "year", "annee", "mileage", "kilometrage",
    "marque", "make", "modele", "model",
    "url", "sourceUrl", "color", "couleur",
    "description", "stock", "availability", "transmission",
)


def _normalize_field_token(tok: str) -> str:
    """Renvoie un champ canonique (en `price`/`name`/...) ou la string brute."""
    t = tok.strip().lower().strip(".:,\"'`")
    aliases = {
        "prix": "price", "annee": "year", "kilometrage": "mileage",
        "modele": "model", "couleur": "color", "marque": "make",
        "title": "name", "images": "image", "sourceurl": "url",
    }
    return aliases.get(t, t)


def extract_field_hints(text: str) -> List[str]:
    """Cherche des mentions de champs dans un reasoning Claude.

    Retourne une liste de champs canoniques par ordre d'apparition (sans
    doublons). Garde sa valeur car utilise pour deviner field_fixed.
    """
    if not text:
        return []
    found: List[str] = []
    lower = text.lower()
    for f in _KNOWN_FIELDS:
        if re.search(rf"\b{re.escape(f.lower())}\b", lower) and _normalize_field_token(f) not in found:
            found.append(_normalize_field_token(f))
    return found


def _truncate(text: Optional[str], max_len: int) -> str:
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "...[tronque]"


# ---------------------------------------------------------------------------
# Append local JSONL (best-effort, ne casse jamais le run)
# ---------------------------------------------------------------------------

def record_lesson(
    *,
    slug: Optional[str],
    url: Optional[str],
    platform: Optional[str],
    phase: str,
    field_fixed: Optional[str] = None,
    weak_fields: Optional[Iterable[str]] = None,
    before_code: Optional[str] = None,  # noqa: ARG001 - signature compat
    after_code: Optional[str] = None,   # noqa: ARG001 - signature compat
    claude_rationale: Optional[str] = None,
    tokens_used: Optional[int] = None,
    iterations: Optional[int] = None,
    extra_signature: Optional[str] = None,
    verbose: bool = False,
) -> bool:
    """Append une lecon dans ``scraper_cache/lessons.jsonl`` (append-only).

    Args before_code/after_code conserves dans la signature pour ne pas casser
    les callers existants, mais leur contenu n'est PLUS persiste (il etait
    inutilise et coutait 24KB par lecon en stockage Supabase).

    Le diff complet, la signature normalisee, et l'insertion Supabase ont ete
    retires (plan Phase 5.2). Si le dashboard a besoin de relire les lecons
    historiques, il peut continuer a interroger la table Supabase
    ``usine_lessons`` (en lecture seule, plus jamais d'ecriture).

    Returns:
        True si append OK, False sinon (best-effort, jamais d'exception).
    """
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "slug": slug,
        "url": url,
        "platform": platform,
        "phase": phase,
        "field_fixed": (
            _normalize_field_token(field_fixed) if field_fixed else None
        ),
        "weak_fields": [
            _normalize_field_token(f) for f in (weak_fields or [])
        ] or None,
        "claude_rationale": _truncate(claude_rationale, MAX_RATIONALE_LEN),
        "tokens_used": tokens_used,
        "iterations": iterations,
        "extra_signature": extra_signature,
    }

    try:
        LESSONS_JSONL_PATH.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(payload, ensure_ascii=False, default=str)
        with LESSONS_JSONL_PATH.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        return True
    except Exception as e:
        if verbose:
            print(
                f"  [lessons] append local KO: {type(e).__name__}: {e}",
                file=sys.stderr,
            )
        return False


__all__ = [
    "record_lesson",
    "extract_field_hints",
    "LESSONS_JSONL_PATH",
]
