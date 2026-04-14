"""
Phase 4 : ScraperValidator -- Teste et valide un scraper généré.

Exécute le scraper sur un échantillon, calcule un score de qualité (0-100),
génère un rapport, et optionnellement corrige via Gemini.
"""
from __future__ import annotations

import importlib
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from .models import (
    FieldCoverage, GeneratedScraper, PriceDisplayMode,
    ScrapingStrategy, SiteAnalysis, ValidationReport,
)

REPORTS_DIR = Path(__file__).resolve().parent.parent.parent / "scraper_cache" / "reports"


class ScraperValidator:
    """Valide un scraper généré par exécution réelle et scoring contextuel."""

    def __init__(self, verbose: bool = True):
        self.verbose = verbose

    def validate(
        self,
        generated: GeneratedScraper,
        analysis: SiteAnalysis,
        strategy: ScrapingStrategy,
    ) -> ValidationReport:
        self._log(f"Validation de {generated.slug}...")
        report = ValidationReport(
            site_url=analysis.site_url,
            site_name=analysis.site_name,
            scraper_file=generated.file_path,
            strategy_used=generated.strategy_summary,
            platform_detected=analysis.platform.name,
            price_display_mode=analysis.price_display_mode.value,
        )

        products, errors, elapsed = self._run_scraper(generated)
        report.execution_time_seconds = elapsed
        report.errors = errors

        if not products and errors:
            report.score = 0
            report.grade = "F"
            report.warnings.append("Le scraper a échoué sans produire de résultats")
            self._save_report(report, generated.slug)
            return report

        report.products_tested = len(products)
        report.urls_attempted = len(products)

        soft_404 = self._count_soft_404(products)
        report.soft_404_detected = soft_404
        if soft_404 > 0:
            report.warnings.append(f"{soft_404} soft-404 détectés")

        report.sample_products = [_sanitize(p) for p in products[:5]]

        valid = [p for p in products if p.get("name")]
        effective_total = max(1, len(products) - soft_404)
        report.success_rate = len(valid) / effective_total if effective_total > 0 else 0.0

        score, field_details = self._score(
            products=valid,
            total_attempted=effective_total,
            price_absent_expected=strategy.price_absent_expected,
        )
        report.score = score
        report.grade = self._grade(score)
        report.field_details = field_details
        report.field_coverage = {fd.field_name: fd.coverage for fd in field_details}

        self._add_warnings(report, field_details, strategy)

        self._log(f"Score: {score}/100 ({report.grade}) — {len(valid)} produits valides")
        self._save_report(report, generated.slug)
        return report

    # ------------------------------------------------------------------
    # Exécution du scraper
    # ------------------------------------------------------------------

    def _run_scraper(self, generated: GeneratedScraper) -> tuple:
        products: List[Dict] = []
        errors: List[str] = []
        start = time.time()

        try:
            module_path = f"scraper_ai.dedicated_scrapers.{generated.module_name}"
            self._log(f"Import dynamique: {module_path}")
            mod = importlib.import_module(module_path)
            self._log(f"Module importé, recherche classe {generated.class_name}...")
            scraper_class = getattr(mod, generated.class_name)
            self._log(f"Classe trouvée, instanciation...")
            scraper = scraper_class()

            scraper.MAX_WORKERS = 3
            scraper.HTTP_TIMEOUT = 25

            self._log("Exécution scrape(categories=['inventaire']) (basse intensité, 3 workers)...")
            t0 = time.time()
            result = scraper.scrape(categories=["inventaire"], inventory_only=False)
            self._log(f"Scrape terminé en {time.time()-t0:.1f}s")
            products = result.get("products", [])
            self._log(f"{len(products)} produits extraits")

        except Exception as e:
            errors.append(f"{type(e).__name__}: {str(e)[:500]}")
            self._log(f"ERREUR scraper: {type(e).__name__}: {e}")
            import traceback
            self._log(f"Traceback:\n{traceback.format_exc()}")

        elapsed = time.time() - start
        self._log(f"Run complet en {elapsed:.1f}s — {len(products)} produits, {len(errors)} erreurs")
        return products, errors, round(elapsed, 2)

    # ------------------------------------------------------------------
    # Scoring (0-100)
    # ------------------------------------------------------------------

    def _score(self, products: List[Dict], total_attempted: int,
               price_absent_expected: bool) -> tuple:
        if not products:
            return 0, []

        details: List[FieldCoverage] = []
        total = len(products)
        score = 0.0

        # --- Taux de réussite (30 pts) ---
        success_ratio = total / max(1, total_attempted)
        score += success_ratio * 30

        # --- Champs obligatoires (25 pts) ---
        name_cov = self._coverage("name", products)
        details.append(name_cov)
        score += min(1.0, name_cov.coverage) * 8

        prix_cov = self._coverage("prix", products)
        details.append(prix_cov)
        if price_absent_expected:
            score += 7
        else:
            score += min(1.0, prix_cov.coverage / 0.9) * 7 if prix_cov.coverage > 0 else 0

        url_cov = self._coverage("sourceUrl", products)
        site_cov = self._coverage("sourceSite", products)
        details.extend([url_cov, site_cov])
        score += (min(1.0, url_cov.coverage) + min(1.0, site_cov.coverage)) / 2 * 5

        image_cov = self._coverage("image", products)
        details.append(image_cov)
        score += min(1.0, image_cov.coverage / 0.8) * 5 if image_cov.coverage > 0 else 0

        # --- Champs contextuels (20 pts) ---
        occasions = [p for p in products if p.get("etat") == "occasion"]
        if occasions:
            km_cov = self._coverage("kilometrage", occasions)
            km_cov.field_name = "kilometrage (occasions)"
            details.append(km_cov)
            score += min(1.0, km_cov.coverage / 0.6) * 5 if km_cov.coverage > 0 else 0
        else:
            score += 5

        for field_name, threshold, pts in [
            ("marque", 0.8, 5), ("modele", 0.8, 5), ("annee", 0.7, 5),
        ]:
            cov = self._coverage(field_name, products)
            details.append(cov)
            score += min(1.0, cov.coverage / threshold) * pts if cov.coverage > 0 else 0

        # --- Cohérence (15 pts) ---
        if not price_absent_expected:
            prices = [p["prix"] for p in products if isinstance(p.get("prix"), (int, float))]
            valid_prices = [pr for pr in prices if 500 <= pr <= 150000]
            if prices:
                score += (len(valid_prices) / len(prices)) * 5
            else:
                score += 5
        else:
            score += 5

        years = [p["annee"] for p in products if isinstance(p.get("annee"), (int, float))]
        valid_years = [y for y in years if 2000 <= y <= 2027]
        if years:
            score += (len(valid_years) / len(years)) * 5
        else:
            score += 5

        images = [p.get("image", "") for p in products if p.get("image")]
        if images:
            accessible = self._check_images(images[:5])
            score += (accessible / max(1, min(5, len(images)))) * 5
        else:
            score += 0

        # --- Santé technique (10 pts) ---
        score += 5

        mojibake = sum(1 for p in products for v in p.values()
                       if isinstance(v, str) and any(bad in v for bad in ("Ã©", "Ã¨", "Ã ")))
        if mojibake == 0:
            score += 3

        score += 2

        return min(100, round(score)), details

    def _coverage(self, field: str, products: List[Dict]) -> FieldCoverage:
        present = sum(1 for p in products if p.get(field) not in (None, "", 0))
        total = len(products)
        samples = [str(p[field])[:100] for p in products[:3] if p.get(field)]
        return FieldCoverage(
            field_name=field,
            present_count=present,
            total_count=total,
            coverage=present / total if total > 0 else 0.0,
            sample_values=samples,
        )

    def _check_images(self, urls: List[str]) -> int:
        accessible = 0
        for url in urls:
            try:
                resp = requests.head(url, timeout=5, allow_redirects=True)
                if resp.status_code == 200:
                    accessible += 1
            except Exception:
                pass
        return accessible

    def _count_soft_404(self, products: List[Dict]) -> int:
        count = 0
        for p in products:
            name = str(p.get("name", "")).lower()
            if any(w in name for w in ["404", "introuvable", "not found", "page non trouvée"]):
                count += 1
        return count

    def _grade(self, score: int) -> str:
        if score >= 95: return "A+"
        if score >= 90: return "A"
        if score >= 85: return "B+"
        if score >= 80: return "B"
        if score >= 70: return "C"
        if score >= 60: return "D"
        return "F"

    def _add_warnings(self, report: ValidationReport, details: List[FieldCoverage],
                      strategy: ScrapingStrategy) -> None:
        for fd in details:
            if fd.coverage < 0.5 and fd.field_name not in ("sourceUrl", "sourceSite"):
                report.warnings.append(f"{fd.field_name}: couverture {fd.coverage:.0%} (faible)")

        if report.execution_time_seconds > 120:
            report.warnings.append(f"Temps d'exécution élevé: {report.execution_time_seconds:.0f}s")

    # ------------------------------------------------------------------
    # Auto-correction via Gemini
    # ------------------------------------------------------------------

    def auto_correct(self, report: ValidationReport, generated: GeneratedScraper,
                     analysis: SiteAnalysis) -> Optional[str]:
        """Tente une correction via Gemini si le score est < 80. Retourne le code corrigé ou None."""
        if report.score >= 80:
            return None

        try:
            from scraper_ai.gemini_client import GeminiClient
            client = GeminiClient()
        except Exception:
            self._log("GeminiClient non disponible pour l'auto-correction")
            return None

        prompt = self._build_correction_prompt(report, generated, analysis)

        try:
            result = client.call(prompt, show_prompt=False, response_mime_type="text/plain")
            if isinstance(result, str) and "class " in result:
                return result
        except Exception as e:
            self._log(f"Gemini auto-correction échouée: {e}")

        return None

    def _build_correction_prompt(self, report: ValidationReport,
                                 generated: GeneratedScraper,
                                 analysis: SiteAnalysis) -> str:
        issues = "\n".join(f"- {w}" for w in report.warnings + report.errors)
        sample = json.dumps(report.sample_products[:2], indent=2, ensure_ascii=False, default=str)

        return (
            f"Tu es un expert en web scraping Python. Le scraper suivant pour "
            f"{analysis.site_url} a obtenu un score de {report.score}/100.\n\n"
            f"PROBLÈMES:\n{issues}\n\n"
            f"ÉCHANTILLON DE PRODUITS:\n{sample}\n\n"
            f"CODE DU SCRAPER:\n```python\n{generated.code[:8000]}\n```\n\n"
            f"Corrige le code pour résoudre les problèmes identifiés. "
            f"Retourne UNIQUEMENT le code Python corrigé, sans explication."
        )

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    def health_check(self, slug: str) -> ValidationReport:
        """Exécute une validation sur un scraper existant et compare au dernier rapport."""
        self._log(f"Health check: {slug}")

        try:
            from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry
            registry = DedicatedScraperRegistry()
            scraper = registry.get_by_slug(slug)
            if not scraper:
                report = ValidationReport(site_url="", site_name=slug)
                report.errors.append(f"Scraper '{slug}' introuvable dans le registry")
                return report
        except Exception as e:
            report = ValidationReport(site_url="", site_name=slug)
            report.errors.append(str(e))
            return report

        gen = GeneratedScraper(
            slug=slug,
            class_name=type(scraper).__name__,
            module_name=type(scraper).__module__.split(".")[-1],
        )

        dummy_analysis = SiteAnalysis(
            site_url=scraper.SITE_URL,
            site_name=scraper.SITE_NAME,
        )
        dummy_strategy = ScrapingStrategy()

        report = self.validate(gen, dummy_analysis, dummy_strategy)

        last_report = self._load_last_report(slug)
        if last_report:
            diff = report.score - last_report.get("score", 0)
            if diff < -10:
                report.warnings.append(
                    f"Dégradation: score {last_report['score']} -> {report.score} ({diff:+d})"
                )
                self._log(f"DÉGRADATION détectée: {diff:+d} points")
            else:
                self._log(f"Score stable: {report.score} (précédent: {last_report['score']})")

        return report

    def _load_last_report(self, slug: str) -> Optional[Dict]:
        path = REPORTS_DIR / f"{slug}_report.json"
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return None

    # ------------------------------------------------------------------
    # Persistance
    # ------------------------------------------------------------------

    def _save_report(self, report: ValidationReport, slug: str) -> None:
        path = REPORTS_DIR / f"{slug}_report.json"
        try:
            report.save(path)
            report.analysis_file = str(path)
            self._log(f"Rapport sauvegardé: {path}")
        except Exception as e:
            self._log(f"Erreur sauvegarde rapport: {e}")

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [Validator] {msg}")


def _sanitize(product: Dict) -> Dict:
    """Tronque les valeurs longues pour le rapport."""
    out = {}
    for k, v in product.items():
        if isinstance(v, str) and len(v) > 200:
            out[k] = v[:200] + "..."
        elif isinstance(v, list) and len(v) > 5:
            out[k] = v[:5]
        else:
            out[k] = v
    return out
