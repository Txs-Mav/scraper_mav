"""Tests pour le schema Diagnosis (Phase 2.2 du plan optim couts)."""
from __future__ import annotations

import pytest

from scraper_ai.scraper_usine.diagnosis import (
    Diagnosis,
    DiagnosisParseError,
    TargetedFix,
    parse_diagnosis,
)


def _good_evidence() -> str:
    return '<span class="price" data-price-amount="11999">$11,999.00</span>'


def test_targeted_fix_valid():
    fx = TargetedFix(
        method="extract_price",
        issue="selector_mismatch",
        evidence=_good_evidence(),
        suggested_approach="utiliser [data-price-amount]",
        confidence=0.9,
    )
    assert fx.is_valid()
    assert fx.reject_reason() is None


def test_targeted_fix_rejected_low_confidence():
    fx = TargetedFix(
        method="extract_price", issue="x", evidence=_good_evidence(),
        suggested_approach="...", confidence=0.5,
    )
    assert not fx.is_valid()
    assert "confidence" in (fx.reject_reason() or "")


def test_targeted_fix_rejected_short_evidence():
    fx = TargetedFix(
        method="extract_price", issue="x", evidence="short",
        suggested_approach="...", confidence=0.95,
    )
    assert not fx.is_valid()
    assert "evidence" in (fx.reject_reason() or "")


def test_parse_diagnosis_valid():
    data = {
        "verdict": "needs_fix",
        "root_cause": "Le selecteur .price ne match rien.",
        "targeted_fixes": [
            {
                "method": "extract_price",
                "issue": "selector_mismatch",
                "evidence": _good_evidence(),
                "suggested_approach": "utiliser [data-price-amount]",
                "confidence": 0.92,
            }
        ],
    }
    diag = parse_diagnosis(data)
    assert diag.verdict == "needs_fix"
    assert "selecteur" in diag.root_cause
    assert len(diag.targeted_fixes) == 1
    assert len(diag.valid_fixes()) == 1
    assert not diag.all_fixes_rejected()


def test_parse_diagnosis_unknown_verdict_fallback():
    """Verdict invalide => fallback en needs_rewrite (voie sure)."""
    data = {
        "verdict": "panic",
        "root_cause": "Erreur globale.",
    }
    diag = parse_diagnosis(data)
    assert diag.verdict == "needs_rewrite"


def test_parse_diagnosis_no_fix_needed_no_root_cause():
    """no_fix_needed peut avoir un root_cause vide."""
    data = {"verdict": "no_fix_needed", "root_cause": ""}
    diag = parse_diagnosis(data)
    assert diag.verdict == "no_fix_needed"
    assert diag.targeted_fixes == []


def test_parse_diagnosis_needs_fix_requires_root_cause():
    data = {"verdict": "needs_fix", "root_cause": "", "targeted_fixes": []}
    with pytest.raises(DiagnosisParseError):
        parse_diagnosis(data)


def test_parse_diagnosis_not_a_dict():
    with pytest.raises(DiagnosisParseError):
        parse_diagnosis("not a dict")
    with pytest.raises(DiagnosisParseError):
        parse_diagnosis([1, 2, 3])


def test_all_fixes_rejected_triggers_escalation():
    """Cas critique : Opus a propose des fixes mais aucune n'est fiable."""
    data = {
        "verdict": "needs_fix",
        "root_cause": "Quelque chose semble mal.",
        "targeted_fixes": [
            {
                "method": "extract_price",
                "issue": "x",
                "evidence": "short",  # < 50 chars
                "suggested_approach": "...",
                "confidence": 0.4,  # < 0.7
            }
        ],
    }
    diag = parse_diagnosis(data)
    assert diag.all_fixes_rejected()
    assert len(diag.valid_fixes()) == 0
    rejections = diag.rejection_log()
    assert len(rejections) == 1


def test_as_sonnet_payload_only_includes_valid_fixes():
    data = {
        "verdict": "needs_fix",
        "root_cause": "X",
        "targeted_fixes": [
            {
                "method": "good", "issue": "ok",
                "evidence": _good_evidence(),
                "suggested_approach": "...", "confidence": 0.9,
            },
            {
                "method": "bad", "issue": "ok",
                "evidence": "short",
                "suggested_approach": "...", "confidence": 0.9,
            },
        ],
    }
    diag = parse_diagnosis(data)
    payload = diag.as_sonnet_payload()
    assert len(payload["targeted_fixes"]) == 1
    assert payload["targeted_fixes"][0]["method"] == "good"


def test_parse_diagnosis_skips_malformed_fixes():
    data = {
        "verdict": "needs_fix",
        "root_cause": "X",
        "targeted_fixes": [
            "not a dict",
            {"method": "ok", "issue": "ok", "evidence": _good_evidence(),
             "suggested_approach": "...", "confidence": "not a number"},
            {"method": "good", "issue": "ok",
             "evidence": _good_evidence(),
             "suggested_approach": "...", "confidence": 0.9},
        ],
    }
    diag = parse_diagnosis(data)
    # 1 skip silent (string) + 1 ValueError sur confidence + 1 valide
    # selon le code, on tolere et on ne garde que les fix proprement parsees
    methods = [f.method for f in diag.targeted_fixes]
    assert "good" in methods
