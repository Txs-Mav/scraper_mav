"""Schema strict pour le diagnostic Opus -> Sonnet (Phase 2 du plan optim couts).

Architecture diagnose-then-write :
  1. Opus reçoit le code échoué + HTML live + rapport de validation.
  2. Opus retourne un :class:`Diagnosis` JSON strict avec :
     - root_cause : 1-3 phrases explicatives
     - targeted_fixes : List[TargetedFix] avec evidence OBLIGATOIRE
       (extrait HTML/DOM >= 50 chars), suggested_approach, et confidence par fix
  3. Sonnet 4.5 reçoit le code + uniquement les fixes haute confiance et
     écrit les patches.

Le `evidence` obligatoire est le garde-fou anti-Risque 2 : Sonnet ne peut
plus inventer un sélecteur sur un diagnostic vague.

Filtrage avant Sonnet : seules les fixes avec ``confidence >= 0.7`` ET
``evidence`` valide passent. Si toutes filtrées -> escalade Opus full rewrite.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional


# Seuils d'acceptation d'une TargetedFix
MIN_EVIDENCE_LEN = 50
MIN_CONFIDENCE = 0.7

DiagnosisVerdict = Literal["no_fix_needed", "needs_fix", "needs_rewrite"]


@dataclass
class TargetedFix:
    """Description d'UNE correction à appliquer, avec preuve concrète.

    Attributes:
        method: nom de la méthode à corriger (ex: ``"extract_price"``).
        issue: catégorie du problème (ex: ``"selector_mismatch"``,
            ``"wrong_source"``, ``"missing_fallback"``).
        evidence: extrait HTML/DOM (50-300 chars) qui PROUVE le diagnostic.
            OBLIGATOIRE - sans evidence, Sonnet inventerait. Filtré si vide.
        suggested_approach: phrase actionnable pour Sonnet (ex: ``"utiliser
            [data-price-amount] au lieu de .price"``).
        confidence: 0-1, propre à cette fix. < 0.7 -> fix filtrée.
    """
    method: str
    issue: str
    evidence: str
    suggested_approach: str
    confidence: float

    def is_valid(self) -> bool:
        """Vrai si la fix peut être passée à Sonnet (evidence + confiance OK)."""
        return (
            bool(self.method)
            and bool(self.evidence)
            and len(self.evidence) >= MIN_EVIDENCE_LEN
            and self.confidence >= MIN_CONFIDENCE
        )

    def reject_reason(self) -> Optional[str]:
        """Renvoie la raison du rejet pour log audit, None si valide."""
        if not self.method:
            return "method vide"
        if not self.evidence:
            return "evidence vide"
        if len(self.evidence) < MIN_EVIDENCE_LEN:
            return f"evidence trop courte ({len(self.evidence)} < {MIN_EVIDENCE_LEN})"
        if self.confidence < MIN_CONFIDENCE:
            return f"confidence basse ({self.confidence:.2f} < {MIN_CONFIDENCE:.2f})"
        return None


@dataclass
class Diagnosis:
    """Sortie structurée d'Opus en mode diagnose-then-write.

    Attributes:
        verdict:
            - ``no_fix_needed`` : code OK, pas d'écriture nécessaire (skip Sonnet).
            - ``needs_fix`` : corrections ciblées via patches.
            - ``needs_rewrite`` : refactor complet nécessaire (full file).
        root_cause: 1-3 phrases expliquant la racine du problème.
        targeted_fixes: liste de TargetedFix. Vide si verdict=no_fix_needed.
        raw_response: payload Opus original (pour debug/audit).
    """
    verdict: DiagnosisVerdict
    root_cause: str
    targeted_fixes: List[TargetedFix] = field(default_factory=list)
    raw_response: Optional[Dict[str, Any]] = None

    def valid_fixes(self) -> List[TargetedFix]:
        """Renvoie uniquement les fixes qui passent le filtre confidence/evidence."""
        return [f for f in self.targeted_fixes if f.is_valid()]

    def all_fixes_rejected(self) -> bool:
        """Vrai si verdict=needs_fix ET aucune fix ne passe le filtre.

        Cas qui doit déclencher escalade Opus full rewrite (Sonnet n'a rien
        de fiable à appliquer).
        """
        return (
            self.verdict == "needs_fix"
            and len(self.targeted_fixes) > 0
            and len(self.valid_fixes()) == 0
        )

    def rejection_log(self) -> List[str]:
        """Liste lisible des fixes rejetées (pour audit)."""
        out: List[str] = []
        for fx in self.targeted_fixes:
            reason = fx.reject_reason()
            if reason:
                out.append(f"{fx.method}/{fx.issue}: {reason}")
        return out

    def as_sonnet_payload(self) -> Dict[str, Any]:
        """Sérialise pour passage à Sonnet (ne contient que les fixes valides)."""
        return {
            "root_cause": self.root_cause,
            "targeted_fixes": [
                {
                    "method": fx.method,
                    "issue": fx.issue,
                    "evidence": fx.evidence,
                    "suggested_approach": fx.suggested_approach,
                    "confidence": fx.confidence,
                }
                for fx in self.valid_fixes()
            ],
        }


# ---------------------------------------------------------------------------
# Parsing depuis JSON renvoyé par Opus
# ---------------------------------------------------------------------------

class DiagnosisParseError(ValueError):
    """Levée si Opus retourne un payload non conforme au schema."""


def parse_diagnosis(data: Any) -> Diagnosis:
    """Parse un payload Opus en :class:`Diagnosis`.

    Tolère les structures partielles : verdict invalide -> 'needs_rewrite'
    par défaut (cas où Opus a quand même donné de l'info, on prend la
    voie sûre de la réécriture complète).

    Raises:
        DiagnosisParseError: si la structure n'est même pas un dict ou si
            verdict + root_cause manquent tous les deux.
    """
    if not isinstance(data, dict):
        raise DiagnosisParseError(
            f"Diagnosis attendu dict, recu {type(data).__name__}"
        )

    verdict = data.get("verdict")
    if verdict not in ("no_fix_needed", "needs_fix", "needs_rewrite"):
        # Tolérance : on bascule en needs_rewrite (voie sûre)
        verdict = "needs_rewrite"

    root_cause = str(data.get("root_cause") or "").strip()
    if not root_cause and verdict != "no_fix_needed":
        raise DiagnosisParseError("root_cause manquant pour verdict != no_fix_needed")

    fixes: List[TargetedFix] = []
    raw_fixes = data.get("targeted_fixes") or []
    if isinstance(raw_fixes, list):
        for raw in raw_fixes:
            if not isinstance(raw, dict):
                continue
            try:
                fix = TargetedFix(
                    method=str(raw.get("method") or "").strip(),
                    issue=str(raw.get("issue") or "").strip(),
                    evidence=str(raw.get("evidence") or "").strip(),
                    suggested_approach=str(raw.get("suggested_approach") or "").strip(),
                    confidence=float(raw.get("confidence") or 0.0),
                )
                fixes.append(fix)
            except (TypeError, ValueError):
                continue

    return Diagnosis(
        verdict=verdict,  # type: ignore[arg-type]
        root_cause=root_cause,
        targeted_fixes=fixes,
        raw_response=data,
    )


# ---------------------------------------------------------------------------
# Prompt fragment (réutilisé par claude_supervisor)
# ---------------------------------------------------------------------------

DIAGNOSIS_OUTPUT_SPEC = (
    "Tu reponds en JSON strict suivant ce schema (aucun markdown, aucun preambule) :\n"
    "{\n"
    '  "verdict": "no_fix_needed" | "needs_fix" | "needs_rewrite",\n'
    '  "root_cause": "1-3 phrases expliquant la racine",\n'
    '  "targeted_fixes": [\n'
    "    {\n"
    '      "method": "nom_methode_python",\n'
    '      "issue": "selector_mismatch|wrong_source|missing_fallback|...",\n'
    '      "evidence": "extrait HTML/DOM concret 50-300 chars qui PROUVE le diagnostic",\n'
    '      "suggested_approach": "phrase actionnable pour le rewriter",\n'
    '      "confidence": 0.0-1.0\n'
    "    }\n"
    "  ]\n"
    "}\n"
    "REGLES STRICTES :\n"
    "- evidence DOIT etre un extrait CONCRET du HTML fourni (>= 50 caracteres). "
    "Pas d'interpretation libre, c'est ta preuve.\n"
    "- confidence par fix individuelle (pas une confidence globale).\n"
    "- Si tu n'as pas de preuve concrete pour une fix : ne la propose PAS.\n"
    "- verdict=no_fix_needed : targeted_fixes=[] et le code n'a pas besoin de modification.\n"
    "- verdict=needs_fix : 1-5 fixes ciblees, le code reste structurellement bon.\n"
    "- verdict=needs_rewrite : refactor complet necessaire, targeted_fixes peut etre vide."
)


__all__ = [
    "Diagnosis",
    "TargetedFix",
    "DiagnosisVerdict",
    "DiagnosisParseError",
    "parse_diagnosis",
    "MIN_EVIDENCE_LEN",
    "MIN_CONFIDENCE",
    "DIAGNOSIS_OUTPUT_SPEC",
]
