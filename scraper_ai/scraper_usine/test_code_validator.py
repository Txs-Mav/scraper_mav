"""Tests pour code_validator.apply_patches (Phase 2.4 du plan)."""
from __future__ import annotations

from scraper_ai.scraper_usine.code_validator import apply_patches


SAMPLE_CODE = '''class Demo:
    def extract_price(self, soup):
        return soup.select_one(".price")

    def extract_name(self, soup):
        return soup.select_one(".name")
'''


def test_single_patch_applies():
    res = apply_patches(
        SAMPLE_CODE,
        [{"find": '.select_one(".price")', "replace": '.select_one("[data-price]")'}],
    )
    assert res.applied_count == 1
    assert res.failed_count == 0
    assert "[data-price]" in res.new_code
    assert ".price" not in res.new_code


def test_patch_find_absent_fails():
    res = apply_patches(
        SAMPLE_CODE,
        [{"find": "absent_string_xyz", "replace": "X"}],
    )
    assert res.applied_count == 0
    assert res.failed_count == 1
    assert "absent" in res.errors[0]


def test_patch_find_ambiguous_fails():
    res = apply_patches(
        SAMPLE_CODE,
        [{"find": "soup.select_one", "replace": "soup.select_one"}],
    )
    # 2 occurrences du même find -> ambigu, refuse
    assert res.applied_count == 0
    assert res.failed_count == 1
    assert "ambigu" in res.errors[0]


def test_too_many_patches_refuses():
    patches = [{"find": f"f{i}", "replace": "X"} for i in range(7)]
    res = apply_patches(SAMPLE_CODE, patches, max_patches=5)
    assert res.applied_count == 0
    assert "trop de patches" in res.errors[0]
    # Code inchange
    assert res.new_code == SAMPLE_CODE


def test_overlap_detection():
    """Si 2 patches ont des find qui s'incluent, on refuse tout."""
    res = apply_patches(
        SAMPLE_CODE,
        [
            {"find": ".select_one(\".price\")", "replace": "X"},
            {"find": ".select_one", "replace": "Y"},  # contenu dans le premier
        ],
    )
    assert res.overlap_detected
    assert res.applied_count == 0
    assert res.new_code == SAMPLE_CODE  # rollback


def test_multiple_independent_patches():
    res = apply_patches(
        SAMPLE_CODE,
        [
            {"find": '.select_one(".price")', "replace": '.select_one("[data-price]")'},
            {"find": '.select_one(".name")', "replace": '.select_one("h1")'},
        ],
    )
    assert res.applied_count == 2
    assert res.failed_count == 0
    assert "[data-price]" in res.new_code
    assert "h1" in res.new_code


def test_invalid_patch_dict():
    res = apply_patches(SAMPLE_CODE, [{"find": "x"}])  # replace manquant
    assert res.applied_count == 0
    assert res.failed_count == 1


def test_non_dict_patch():
    res = apply_patches(SAMPLE_CODE, ["not a dict"])  # type: ignore[list-item]
    assert res.applied_count == 0
    assert res.failed_count == 1


def test_empty_find_rejected():
    res = apply_patches(SAMPLE_CODE, [{"find": "", "replace": "X"}])
    assert res.applied_count == 0
    assert res.failed_count == 1
