"""
Framework de tests golden pour les scrapers générés.

Un "golden" = ensemble d'URLs de référence + champs attendus pour un scraper donné.
Permet de détecter automatiquement les régressions entre deux runs (ex: le site
a changé son HTML → l'extraction se dégrade silencieusement).

Stockage :
  scraper_cache/golden/<slug>.json
  {
    "slug": "moto-ducharme",
    "created_at": "2026-04-25T...",
    "site_url": "https://...",
    "domain_profile": "auto",
    "samples": [
      {
        "url": "https://moto-ducharme.com/...",
        "expected": {"name": "Honda CBR600", "prix": 11999, "annee": 2023, ...},
        "ignore_fields": ["sourceUrl"]
      }, ...
    ]
  }

Usage :
  from scraper_ai.scraper_usine.golden_tests import (
      record_golden, run_golden_diff, GoldenDiffResult
  )

  # Enregistrer un golden depuis un run actuel
  record_golden("moto-ducharme", scraper_instance)

  # Vérifier qu'un scraper produit toujours les mêmes résultats
  result = run_golden_diff("moto-ducharme")
  if result.regressions:
      for r in result.regressions:
          print(r)
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

GOLDEN_DIR = Path(__file__).resolve().parent.parent.parent / "scraper_cache" / "golden"

# Champs métadonnées qu'on ne compare jamais (volatils par essence)
DEFAULT_IGNORED = {"sourceUrl", "groupedUrls", "quantity"}


@dataclass
class GoldenSample:
    url: str
    expected: Dict[str, Any] = field(default_factory=dict)
    ignore_fields: List[str] = field(default_factory=list)


@dataclass
class GoldenSet:
    slug: str
    site_url: str = ""
    domain_profile: str = "auto"
    created_at: str = ""
    samples: List[GoldenSample] = field(default_factory=list)

    def save(self) -> Path:
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        path = GOLDEN_DIR / f"{self.slug}.json"
        path.write_text(
            json.dumps(asdict(self), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return path

    @classmethod
    def load(cls, slug: str) -> Optional["GoldenSet"]:
        path = GOLDEN_DIR / f"{slug}.json"
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        gs = cls(slug=data.get("slug", slug),
                 site_url=data.get("site_url", ""),
                 domain_profile=data.get("domain_profile", "auto"),
                 created_at=data.get("created_at", ""))
        gs.samples = [
            GoldenSample(url=s["url"], expected=s.get("expected", {}),
                          ignore_fields=s.get("ignore_fields", []))
            for s in data.get("samples", [])
        ]
        return gs


@dataclass
class GoldenDiff:
    """Diff sur un sample golden donné."""
    url: str
    missing_fields: List[str] = field(default_factory=list)        # absents du run actuel
    changed_fields: List[Tuple[str, Any, Any]] = field(default_factory=list)  # (champ, old, new)
    extra_fields: List[str] = field(default_factory=list)          # nouveaux dans le run actuel


@dataclass
class GoldenDiffResult:
    """Résultat agrégé d'une comparaison golden vs run actuel."""
    slug: str
    samples_total: int = 0
    samples_matched: int = 0       # samples retrouvés dans le run actuel
    samples_missing: int = 0       # URLs golden absentes du run
    diffs: List[GoldenDiff] = field(default_factory=list)
    regressions: List[str] = field(default_factory=list)  # messages humains

    @property
    def pass_(self) -> bool:
        return not self.regressions

    def save(self) -> Path:
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        path = GOLDEN_DIR / f"{self.slug}_lastdiff.json"
        path.write_text(
            json.dumps({
                "slug": self.slug,
                "ran_at": datetime.now(timezone.utc).isoformat(),
                "samples_total": self.samples_total,
                "samples_matched": self.samples_matched,
                "samples_missing": self.samples_missing,
                "regressions": self.regressions,
                "diffs": [
                    {
                        "url": d.url,
                        "missing_fields": d.missing_fields,
                        "changed_fields": [(f, str(o)[:120], str(n)[:120])
                                            for f, o, n in d.changed_fields],
                        "extra_fields": d.extra_fields,
                    }
                    for d in self.diffs
                ],
            }, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return path


# ---------------------------------------------------------------------------
# Enregistrement
# ---------------------------------------------------------------------------

def record_golden(slug: str, *, max_samples: int = 5,
                  domain_profile: str = "auto",
                  ignore_fields: Optional[List[str]] = None) -> GoldenSet:
    """Enregistre un golden depuis un run live du scraper.
    Sélectionne max_samples produits diversifiés."""
    from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry
    scraper = DedicatedScraperRegistry.get_by_slug(slug)
    if not scraper:
        raise ValueError(f"Scraper introuvable: {slug}")

    print(f"[Golden] Enregistrement de {slug} (max {max_samples} samples)...")
    result = scraper.scrape()
    products = result.get("products", [])
    if not products:
        raise RuntimeError(f"Aucun produit retourné par {slug}, impossible d'enregistrer")

    # Échantillonnage : on prend les premiers + diversité (différentes années / catégories)
    selected = _diverse_sample(products, max_samples)

    gs = GoldenSet(
        slug=slug,
        site_url=getattr(scraper, "SITE_URL", ""),
        domain_profile=domain_profile,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    ignored = set(ignore_fields or []) | DEFAULT_IGNORED
    for p in selected:
        url = p.get("sourceUrl") or p.get("url") or ""
        if not url:
            continue
        expected = {k: v for k, v in p.items() if k not in ignored and v not in (None, "", 0)}
        gs.samples.append(GoldenSample(
            url=url, expected=expected, ignore_fields=list(ignored),
        ))

    gs.save()
    print(f"[Golden] Sauvegardé: {len(gs.samples)} samples → {GOLDEN_DIR / f'{slug}.json'}")
    return gs


def run_golden_diff(slug: str, tolerance_pct: float = 0.05) -> GoldenDiffResult:
    """Compare le golden enregistré au run actuel du scraper.
    Tolerance_pct : variation acceptée pour les valeurs numériques (5% par défaut)."""
    gs = GoldenSet.load(slug)
    if not gs:
        result = GoldenDiffResult(slug=slug)
        result.regressions.append(f"Pas de golden enregistré pour {slug}")
        return result

    from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry
    scraper = DedicatedScraperRegistry.get_by_slug(slug)
    if not scraper:
        result = GoldenDiffResult(slug=slug)
        result.regressions.append(f"Scraper introuvable: {slug}")
        return result

    print(f"[Golden] Diff de {slug} ({len(gs.samples)} samples attendus)...")
    run_result = scraper.scrape()
    products_by_url = {
        (p.get("sourceUrl") or p.get("url") or ""): p
        for p in run_result.get("products", [])
    }

    out = GoldenDiffResult(slug=slug, samples_total=len(gs.samples))

    for sample in gs.samples:
        actual = products_by_url.get(sample.url)
        if not actual:
            out.samples_missing += 1
            out.regressions.append(f"URL golden manquante du run actuel: {sample.url}")
            continue

        out.samples_matched += 1
        ignored = set(sample.ignore_fields) | DEFAULT_IGNORED
        diff = GoldenDiff(url=sample.url)

        for field_name, expected_val in sample.expected.items():
            if field_name in ignored:
                continue
            actual_val = actual.get(field_name)
            if actual_val in (None, "", 0):
                diff.missing_fields.append(field_name)
                out.regressions.append(
                    f"[{sample.url[:60]}] champ '{field_name}' devenu vide "
                    f"(attendu: {str(expected_val)[:60]})"
                )
                continue
            if not _values_equivalent(expected_val, actual_val, tolerance_pct):
                diff.changed_fields.append((field_name, expected_val, actual_val))
                out.regressions.append(
                    f"[{sample.url[:60]}] '{field_name}' changé : "
                    f"{str(expected_val)[:50]} → {str(actual_val)[:50]}"
                )

        if diff.missing_fields or diff.changed_fields:
            out.diffs.append(diff)

    out.save()
    if out.regressions:
        print(f"[Golden] {slug}: {len(out.regressions)} régression(s) détectée(s)")
    else:
        print(f"[Golden] {slug}: PASS ({out.samples_matched}/{out.samples_total})")
    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _diverse_sample(products: List[Dict], n: int) -> List[Dict]:
    """Sélectionne n produits couvrant un éventail de prix / années."""
    if len(products) <= n:
        return list(products)
    sorted_by_price = sorted(
        products,
        key=lambda p: (p.get("prix") or 0, p.get("annee") or 0),
    )
    step = max(1, len(sorted_by_price) // n)
    return [sorted_by_price[i] for i in range(0, len(sorted_by_price), step)][:n]


def _values_equivalent(a: Any, b: Any, tol: float) -> bool:
    """True si les valeurs sont considérées équivalentes (tolérance numérique)."""
    if type(a) != type(b):
        # Tenter casts numériques
        try:
            return _values_equivalent(float(a), float(b), tol)
        except (TypeError, ValueError):
            return str(a).strip().lower() == str(b).strip().lower()
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if a == b:
            return True
        if a == 0 or b == 0:
            return abs(a - b) < 1
        return abs(a - b) / max(abs(a), abs(b)) <= tol
    if isinstance(a, str):
        return a.strip().lower() == b.strip().lower()
    if isinstance(a, list):
        return sorted(map(str, a)) == sorted(map(str, b))
    return a == b
