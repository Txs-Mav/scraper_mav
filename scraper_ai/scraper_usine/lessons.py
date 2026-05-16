"""Capture des corrections Claude pour la table `usine_lessons`.

Phase 2 du plan usine-bench-cron-lessons : à chaque fois que Claude
(supervisor ou agent) corrige un scraper généré, on enregistre :

  - error_signature  : symptôme normalisé (ex `missing_field:price|platform:shopify`)
  - field_fixed      : champ ciblé si identifiable (price/name/year/images/...)
  - before_code      : extrait du code avant correction (tronqué)
  - after_code       : extrait du code après correction (tronqué)
  - diff             : unified diff entre les deux (tronqué)
  - claude_rationale : extrait du reasoning Claude
  - phase            : supervisor_initial | auto_correct | agent_fallback | agent_tool_fix

Ces enregistrements sont agrégés par ``scripts/usine_lessons_report.py``
pour proposer des améliorations de templates/recettes.

Comportement en cas d'absence de Supabase : on logue uniquement sur stderr
(pas de levée d'exception — la capture est best-effort, elle ne doit jamais
faire planter le pipeline).
"""
from __future__ import annotations

import difflib
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Iterable, List, Optional

import requests

# Taille max conservée pour before/after/diff (limite ligne Postgres et coût stockage).
MAX_CODE_LEN = 12_000
MAX_DIFF_LEN = 16_000
MAX_RATIONALE_LEN = 2_000


# ---------------------------------------------------------------------------
# Normalisation du signature
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
    doublons).
    """
    if not text:
        return []
    found: List[str] = []
    lower = text.lower()
    for f in _KNOWN_FIELDS:
        if re.search(rf"\b{re.escape(f.lower())}\b", lower) and _normalize_field_token(f) not in found:
            found.append(_normalize_field_token(f))
    return found


def build_error_signature(
    *,
    phase: str,
    platform: Optional[str],
    field_fixed: Optional[str],
    weak_fields: Optional[Iterable[str]] = None,
    extra: Optional[str] = None,
) -> str:
    """Construit un signature normalisé pour grouper les patterns.

    Forme : ``<phase>|platform:<platform>|field:<f1,f2>|extra:<truncated>``.
    """
    parts = [f"phase:{phase}"]
    if platform:
        parts.append(f"platform:{platform.lower()}")
    fields: List[str] = []
    if field_fixed:
        fields.append(_normalize_field_token(field_fixed))
    if weak_fields:
        for f in weak_fields:
            n = _normalize_field_token(f)
            if n and n not in fields:
                fields.append(n)
    if fields:
        parts.append(f"field:{','.join(fields)}")
    if extra:
        parts.append(f"extra:{extra[:60]}")
    return "|".join(parts)


# ---------------------------------------------------------------------------
# Diff helpers
# ---------------------------------------------------------------------------

def make_unified_diff(before: str, after: str) -> str:
    if not before and not after:
        return ""
    a = (before or "").splitlines(keepends=True)
    b = (after or "").splitlines(keepends=True)
    diff = "".join(difflib.unified_diff(
        a, b, fromfile="before", tofile="after", n=2,
    ))
    if len(diff) > MAX_DIFF_LEN:
        diff = diff[:MAX_DIFF_LEN] + "\n... [diff tronqué]"
    return diff


def _truncate(text: Optional[str], max_len: int) -> str:
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "\n... [tronqué]"


# ---------------------------------------------------------------------------
# Insertion Supabase (best-effort)
# ---------------------------------------------------------------------------

def _supabase_creds() -> Optional[tuple[str, str]]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    return url, key


def record_lesson(
    *,
    slug: Optional[str],
    url: Optional[str],
    platform: Optional[str],
    phase: str,
    field_fixed: Optional[str] = None,
    weak_fields: Optional[Iterable[str]] = None,
    before_code: Optional[str] = None,
    after_code: Optional[str] = None,
    claude_rationale: Optional[str] = None,
    tokens_used: Optional[int] = None,
    iterations: Optional[int] = None,
    extra_signature: Optional[str] = None,
    verbose: bool = False,
) -> bool:
    """Insère une ligne dans `usine_lessons`. Retourne True si insertion ok.

    Best-effort : toute erreur (réseau, schéma manquant, RLS) loguée en
    stderr sans lever — la pipeline ne doit jamais planter pour ça.
    """
    creds = _supabase_creds()
    if not creds:
        if verbose:
            print("  [lessons] Supabase non configuré — leçon ignorée",
                  file=sys.stderr)
        return False

    diff = make_unified_diff(before_code or "", after_code or "")
    sig = build_error_signature(
        phase=phase,
        platform=platform,
        field_fixed=field_fixed,
        weak_fields=weak_fields,
        extra=extra_signature,
    )
    payload = {
        "slug": slug,
        "url": url,
        "platform": platform,
        "phase": phase,
        "error_signature": sig,
        "field_fixed": (_normalize_field_token(field_fixed) if field_fixed else None),
        "before_code": _truncate(before_code, MAX_CODE_LEN),
        "after_code": _truncate(after_code, MAX_CODE_LEN),
        "diff": diff,
        "claude_rationale": _truncate(claude_rationale, MAX_RATIONALE_LEN),
        "tokens_used": tokens_used,
        "iterations": iterations,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    supa_url, key = creds
    try:
        resp = requests.post(
            f"{supa_url}/rest/v1/usine_lessons",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            data=json.dumps(payload),
            timeout=15,
        )
        if resp.status_code not in (200, 201, 204):
            if verbose:
                print(
                    f"  [lessons] Supabase {resp.status_code}: {resp.text[:200]}",
                    file=sys.stderr,
                )
            return False
        return True
    except Exception as e:
        if verbose:
            print(f"  [lessons] erreur réseau : {type(e).__name__}: {e}",
                  file=sys.stderr)
        return False


__all__ = [
    "record_lesson",
    "build_error_signature",
    "extract_field_hints",
    "make_unified_diff",
]
