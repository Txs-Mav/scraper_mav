"""Tests hors-ligne du Count Oracle — réconciliation, parsing, couverture.

Ne touche pas le réseau : on teste la logique de décision (le cœur de la
barrière), pas les sondes HTTP.

    python -m pytest scraper_ai/scraper_usine/test_count_oracle.py
    python scraper_ai/scraper_usine/test_count_oracle.py   # runner minimal
"""
from count_oracle import (CountSignal, CountTarget, _reconcile, _parse_number)


def test_parse_number():
    assert _parse_number("1 240") == 1240
    assert _parse_number("1,240") == 1240
    assert _parse_number("1 240") == 1240   # espace insécable
    assert _parse_number("340 résultats") == 340
    assert _parse_number("aucun") is None


def test_reconcile_empty():
    t = _reconcile([])
    assert t.n is None and t.confidence == 0.0


def test_reconcile_single_source():
    t = _reconcile([CountSignal("sitemap", 500, 0.85)])
    assert t.n == 500
    assert not t.disagreement
    assert t.confidence == 0.7   # une seule source crédible


def test_reconcile_agreement():
    t = _reconcile([CountSignal("sitemap", 500, 0.85),
                    CountSignal("results_text", 510, 0.7)])
    assert t.n in (500, 505, 510)
    assert not t.disagreement
    assert t.confidence == 0.9   # ≥2 sources concordantes


def test_reconcile_disagreement_flagged():
    # sitemap 500 vs results_text 1200 → désaccord, à faire remonter
    t = _reconcile([CountSignal("sitemap", 500, 0.85),
                    CountSignal("results_text", 1200, 0.7)])
    assert t.disagreement is True
    assert t.confidence == 0.5


def test_low_confidence_signal_excluded_from_n():
    # la pagination bruitée (conf 0.4) ne doit PAS corrompre N
    t = _reconcile([CountSignal("sitemap", 480, 0.85),
                    CountSignal("pagination", 1131, 0.4)])
    assert t.n == 480
    assert not t.disagreement


def test_coverage_gate():
    t = CountTarget(n=1000, confidence=0.9)
    assert t.coverage(1000) == 1.0
    assert t.coverage(400) == 0.4          # scraper incomplet → barrière refuse
    assert CountTarget(n=None, confidence=0.0).coverage(400) is None


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok   {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {fn.__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} tests passés")
    raise SystemExit(1 if failed else 0)
