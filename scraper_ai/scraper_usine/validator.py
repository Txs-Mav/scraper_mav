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

from datetime import datetime, timezone

from .models import (
    FieldCoverage, GeneratedScraper, PriceDisplayMode,
    ScrapingStrategy, SiteAnalysis, ValidationReport, _from_dict,
)
from .domain_profiles import DomainProfile, get_profile, AUTO_PROFILE

REPORTS_DIR = Path(__file__).resolve().parent.parent.parent / "scraper_cache" / "reports"
STRATEGIES_DIR = Path(__file__).resolve().parent.parent.parent / "scraper_cache" / "strategies"

# Limite par défaut d'exécution d'un scraper validé (en secondes).
# Au-delà, le sous-processus est tué pour éviter de bloquer la pipeline.
DEFAULT_RUN_TIMEOUT_SECONDS = 180

# Taille max d'un code à envoyer en une fois à Gemini pour auto-correction.
# Au-delà, on découpe en chunks et on demande des corrections ciblées.
MAX_CODE_INLINE_BYTES = 30_000


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

        # Profil de domaine pour scoring adaptatif (auto, ecommerce, immo, jobs)
        profile = get_profile(analysis.domain_profile_key or "auto")
        categories = profile.default_categories or ["all"]

        products, errors, elapsed = self._run_scraper(generated, categories=categories)
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

        score, field_details = self._score_by_profile(
            products=valid,
            total_attempted=effective_total,
            profile=profile,
            price_absent_expected=strategy.price_absent_expected,
        )
        report.score = score
        report.grade = self._grade(score)
        report.field_details = field_details
        report.field_coverage = {fd.field_name: fd.coverage for fd in field_details}

        self._add_warnings(report, field_details, strategy)

        self._log(f"Score: {score}/100 ({report.grade}) — {len(valid)} produits valides "
                  f"[profil: {profile.name}]")
        self._save_report(report, generated.slug)
        return report

    # ------------------------------------------------------------------
    # Exécution du scraper
    # ------------------------------------------------------------------

    def _run_scraper(self, generated: GeneratedScraper,
                     categories: Optional[List[str]] = None,
                     timeout: int = DEFAULT_RUN_TIMEOUT_SECONDS) -> tuple:
        """Exécute le scraper généré dans un sous-processus avec timeout dur.
        Évite qu'un scraper qui boucle bloque la pipeline."""
        import multiprocessing as mp

        products: List[Dict] = []
        errors: List[str] = []
        start = time.time()
        cats = categories or ["inventaire"]

        # Multiprocessing avec timeout dur (signal.SIGTERM si dépassement)
        ctx = mp.get_context("spawn")  # spawn = pas de fork, plus sûr
        parent_conn, child_conn = ctx.Pipe(duplex=False)
        proc = ctx.Process(
            target=_run_scraper_subprocess,
            args=(generated.module_name, generated.class_name, cats, child_conn),
            daemon=True,
        )
        try:
            self._log(f"Lancement sous-processus (timeout {timeout}s, categories={cats})...")
            proc.start()
            proc.join(timeout=timeout)

            if proc.is_alive():
                self._log(f"TIMEOUT après {timeout}s → kill sous-processus")
                proc.terminate()
                proc.join(timeout=5)
                if proc.is_alive():
                    proc.kill()
                    proc.join(timeout=3)
                errors.append(f"Timeout: scraper > {timeout}s")
            else:
                if parent_conn.poll(timeout=2):
                    payload = parent_conn.recv()
                    if isinstance(payload, dict):
                        products = payload.get("products", [])
                        if payload.get("error"):
                            errors.append(payload["error"])
                else:
                    errors.append("Sous-processus terminé sans résultat (probable crash)")

        except Exception as e:
            errors.append(f"{type(e).__name__}: {str(e)[:500]}")
            self._log(f"ERREUR runner: {type(e).__name__}: {e}")
        finally:
            try:
                parent_conn.close()
            except Exception:
                pass

        elapsed = time.time() - start
        self._log(f"Run complet en {elapsed:.1f}s — {len(products)} produits, {len(errors)} erreurs")
        return products, errors, round(elapsed, 2)

    # ------------------------------------------------------------------
    # Scoring (0-100)
    # ------------------------------------------------------------------

    def _score_by_profile(self, products: List[Dict], total_attempted: int,
                          profile: DomainProfile,
                          price_absent_expected: bool) -> tuple:
        """Scoring adaptatif au DomainProfile :
          - 30 pts : taux de réussite
          - 50 pts : couverture des champs (pondérée par FieldSpec.weight)
          - 10 pts : cohérence des valeurs (prix dans range, années valides…)
          - 10 pts : santé technique (mojibake, images accessibles)
        """
        if not products:
            return 0, []

        details: List[FieldCoverage] = []
        total = len(products)
        score = 0.0

        # --- Taux de réussite (30 pts) ---
        success_ratio = total / max(1, total_attempted)
        score += min(1.0, success_ratio) * 30

        # --- Couverture des champs (50 pts répartis par poids du profil) ---
        total_weight = profile.total_weight() or 1
        coverage_pts = 50.0

        for field_spec in profile.fields:
            cov = self._coverage(field_spec.name, products)
            details.append(cov)
            field_max = coverage_pts * (field_spec.weight / total_weight)

            if field_spec.name == "prix" and price_absent_expected:
                score += field_max  # bonus si absence attendue
                continue

            if cov.coverage > 0:
                ratio = min(1.0, cov.coverage / max(0.01, field_spec.coverage_threshold))
                score += field_max * ratio

        # --- Cohérence (10 pts) ---
        coherence = 0.0
        if not price_absent_expected:
            prices = [p["prix"] for p in products if isinstance(p.get("prix"), (int, float))]
            valid_prices = [pr for pr in prices
                            if profile.ranges.price_min <= pr <= profile.ranges.price_max]
            if prices:
                coherence += (len(valid_prices) / len(prices)) * 5
            else:
                coherence += 5
        else:
            coherence += 5

        years = [p["annee"] for p in products if isinstance(p.get("annee"), (int, float))]
        valid_years = [y for y in years
                       if profile.ranges.year_min <= y <= profile.ranges.year_max]
        if years:
            coherence += (len(valid_years) / len(years)) * 5
        else:
            coherence += 5

        score += coherence

        # --- Santé technique (10 pts) ---
        tech = 5.0  # base
        mojibake = sum(1 for p in products for v in p.values()
                       if isinstance(v, str) and any(bad in v for bad in ("Ã©", "Ã¨", "Ã ")))
        if mojibake == 0:
            tech += 3
        images = [p.get("image", "") for p in products if p.get("image")]
        if images:
            accessible = self._check_images(images[:5])
            tech += (accessible / max(1, min(5, len(images)))) * 2
        else:
            tech += 0
        score += tech

        return min(100, round(score)), details

    # Conservé pour rétrocompat (ancien scoring auto-only, dépréc.)
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

    @staticmethod
    def weak_fields(report: ValidationReport, threshold: float = 0.9) -> List[str]:
        """Retourne les champs avec couverture < threshold (par défaut 90%)."""
        skip = {"sourceUrl", "sourceSite"}
        return [
            fd.field_name for fd in report.field_details
            if fd.coverage < threshold and fd.field_name not in skip
        ]

    # ------------------------------------------------------------------
    # Auto-correction via Gemini
    # ------------------------------------------------------------------

    def auto_correct(self, report: ValidationReport, generated: GeneratedScraper,
                     analysis: SiteAnalysis,
                     *, target_fields: Optional[List[str]] = None) -> Optional[str]:
        """Tente une correction via Gemini.

        Modes:
          - Score < 80          → auto-correct global (comportement initial).
          - target_fields fourni → correction ciblée sur ces champs uniquement
            (utilisable même si le score global est bon mais qu'un champ
            critique est sous le seuil).
        """
        if not target_fields and report.score >= 80:
            return None

        try:
            from scraper_ai.gemini_client import GeminiClient
            client = GeminiClient()
        except Exception:
            self._log("GeminiClient non disponible pour l'auto-correction")
            return None

        if target_fields:
            prompt = self._build_field_targeted_prompt(
                report, generated, analysis, target_fields,
            )
        else:
            prompt = self._build_correction_prompt(report, generated, analysis)

        try:
            result = client.call(prompt, show_prompt=False, response_mime_type="text/plain")
            if isinstance(result, str) and "class " in result:
                return result
        except Exception as e:
            self._log(f"Gemini auto-correction échouée: {e}")

        return None

    def _build_field_targeted_prompt(self, report: ValidationReport,
                                     generated: GeneratedScraper,
                                     analysis: SiteAnalysis,
                                     target_fields: List[str]) -> str:
        """Prompt focalisé : on demande à Gemini de corriger UNIQUEMENT les
        méthodes liées aux champs faibles, pas de tout réécrire."""
        coverage_lines = []
        for fd in report.field_details:
            if fd.field_name in target_fields:
                samples = ", ".join(fd.sample_values[:2]) if fd.sample_values else "(aucun)"
                coverage_lines.append(
                    f"- {fd.field_name}: {fd.coverage:.0%} couverture ({fd.present_count}/{fd.total_count}). "
                    f"Échantillons: {samples}"
                )

        sample = json.dumps(report.sample_products[:2], indent=2,
                            ensure_ascii=False, default=str)
        code_block = self._summarize_large_code(generated.code, report)

        return (
            f"Tu es un expert en web scraping Python. Pour {analysis.site_url}, "
            f"le scraper a un score global de {report.score}/100, MAIS certains "
            f"champs sont sous-couverts:\n\n"
            f"{chr(10).join(coverage_lines)}\n\n"
            f"ÉCHANTILLON DE PRODUITS:\n{sample}\n\n"
            f"CODE PERTINENT (méthodes liées aux champs faibles):\n"
            f"```python\n{code_block}\n```\n\n"
            f"OBJECTIF: ajouter UNIQUEMENT des fallbacks ciblés pour les champs listés. "
            f"Ne touche pas aux autres méthodes. Conserve la signature de la classe "
            f"et les attributs SITE_*.\n\n"
            f"Retourne UNIQUEMENT le code Python complet du fichier corrigé, "
            f"sans markdown, sans explication."
        )

    def _build_correction_prompt(self, report: ValidationReport,
                                 generated: GeneratedScraper,
                                 analysis: SiteAnalysis) -> str:
        """Construit un prompt d'auto-correction. Si le code est trop volumineux,
        on inclut un sommaire structurel + uniquement les méthodes concernées par
        les warnings de couverture."""
        issues = "\n".join(f"- {w}" for w in report.warnings + report.errors)
        sample = json.dumps(report.sample_products[:2], indent=2,
                            ensure_ascii=False, default=str)

        code_bytes = len(generated.code.encode("utf-8"))
        if code_bytes <= MAX_CODE_INLINE_BYTES:
            code_block = generated.code
            mode = "code complet"
        else:
            # Code trop gros : extraire structure + méthodes pertinentes
            code_block = self._summarize_large_code(generated.code, report)
            mode = f"sommaire (code original = {code_bytes} bytes, > {MAX_CODE_INLINE_BYTES})"

        profile_hint = ""
        if analysis.domain_profile_key:
            profile_hint = f"\nDOMAINE: {analysis.domain_profile_key}"

        return (
            f"Tu es un expert en web scraping Python. Le scraper pour "
            f"{analysis.site_url} a obtenu un score de {report.score}/100.{profile_hint}\n"
            f"\nPROBLÈMES IDENTIFIÉS:\n{issues}\n"
            f"\nÉCHANTILLON DES PRODUITS EXTRAITS (ce qui fonctionne déjà):\n"
            f"{sample}\n"
            f"\nCODE DU SCRAPER ({mode}):\n```python\n{code_block}\n```\n"
            f"\nRÈGLES STRICTES:\n"
            f"  1. Conserver IDENTIQUES la signature de la classe, les attributs SITE_*, "
            f"     l'héritage et les imports (sauf ajout nécessaire).\n"
            f"  2. Ne pas ajouter de docstring de >5 lignes.\n"
            f"  3. Cibler en priorité les champs avec couverture < 50%.\n"
            f"  4. Si extraction CSS échoue, ajouter fallback JSON-LD ou regex sur le HTML.\n"
            f"  5. Préserver les méthodes qui fonctionnent (ne pas les réécrire si non listées).\n"
            f"\nRetourne UNIQUEMENT le code Python complet du fichier corrigé, "
            f"sans markdown, sans explication."
        )

    def _summarize_large_code(self, code: str, report: ValidationReport) -> str:
        """Pour les scrapers > 30 KB, on garde la structure (classe, signatures) +
        les méthodes liées aux champs en faible couverture."""
        # Champs problématiques (couverture < 60%)
        weak_fields = {fd.field_name for fd in report.field_details
                       if fd.coverage < 0.6 and fd.field_name not in ("sourceUrl", "sourceSite")}

        # Mots-clés à chercher dans les méthodes pour les inclure intégralement
        keywords = {
            "name": ["extract_from_detail", "_extract_css", "_extract_json_ld"],
            "prix": ["_parse_price", "_extract_css", "_map_api_product"],
            "image": ["image_attr", "detail_image", "_extract_css"],
            "marque": ["_extract_css", "_extract_json_ld"],
            "modele": ["_extract_css", "_extract_json_ld"],
            "annee": ["clean_year", "_extract_json_ld"],
            "kilometrage": ["clean_mileage", "_extract_json_ld"],
        }
        wanted_methods = set()
        for f in weak_fields:
            wanted_methods.update(keywords.get(f, []))
        wanted_methods.update(["extract_from_detail_page", "_map_api_product",
                               "_extract_from_listing_item", "discover_product_urls"])

        lines = code.split("\n")
        out: List[str] = []
        in_method = False
        keep_method = False
        method_buffer: List[str] = []

        for line in lines:
            stripped = line.strip()
            # Toujours garder header de classe + attributs SITE_*
            if stripped.startswith(("class ", "SITE_", "MAX_", "WORKERS", "HTTP_",
                                    "API_", "LISTING_PAGES", "PRODUCTS_PER_PAGE",
                                    "SITEMAP_URL")):
                out.append(line)
                continue

            if line.lstrip().startswith("def "):
                # Flush méthode précédente si on la garde
                if in_method and keep_method:
                    out.extend(method_buffer)
                # Nouvelle méthode
                method_buffer = [line]
                in_method = True
                method_name = line.lstrip()[4:].split("(")[0]
                keep_method = any(kw in method_name for kw in wanted_methods)
                continue

            if in_method:
                method_buffer.append(line)
            else:
                out.append(line)

        if in_method and keep_method:
            out.extend(method_buffer)

        # Limite stricte à 25 KB après filtrage
        result = "\n".join(out)
        if len(result.encode("utf-8")) > 25_000:
            result = result.encode("utf-8")[:25_000].decode("utf-8", errors="ignore")
            result += "\n# ... [truncated for prompt size]\n"
        return result

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    def health_check(self, slug: str) -> ValidationReport:
        """Exécute une validation sur un scraper existant et compare au dernier rapport.

        Recharge ScrapingStrategy persistée pour préserver `price_absent_expected`,
        `domain_profile_key`, etc. — sinon un site en 'prix sur demande' serait
        pénalisé à chaque check."""
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

        analysis, strategy = self._load_persisted_context(slug, scraper)
        report = self.validate(gen, analysis, strategy)

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

    def _load_persisted_context(self, slug: str, scraper) -> tuple:
        """Charge SiteAnalysis + ScrapingStrategy persistées par le générateur.
        Tombe sur des dummies cohérents si aucun fichier n'est disponible."""
        path = STRATEGIES_DIR / f"{slug}_strategy.json"
        if not path.exists():
            self._log(
                f"Aucune stratégie persistée pour '{slug}' — scoring avec contexte par "
                f"défaut (peut sur-pénaliser les sites 'prix sur demande')."
            )
            return self._dummy_context(scraper)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            self._log(f"Erreur lecture stratégie persistée: {e}")
            return self._dummy_context(scraper)

        analysis = SiteAnalysis(
            site_url=payload.get("site_url", scraper.SITE_URL),
            site_name=payload.get("site_name", scraper.SITE_NAME),
            domain_profile_key=payload.get("domain_profile_key", "auto"),
        )
        try:
            analysis.price_display_mode = PriceDisplayMode(
                payload.get("price_display_mode", "visible")
            )
        except (ValueError, KeyError):
            pass

        strategy_data = payload.get("strategy", {}) or {}
        try:
            strategy = _from_dict(ScrapingStrategy, strategy_data)
        except Exception as e:
            self._log(f"Erreur reconstruction strategy: {e}")
            strategy = ScrapingStrategy()
        return analysis, strategy

    @staticmethod
    def _dummy_context(scraper) -> tuple:
        analysis = SiteAnalysis(
            site_url=getattr(scraper, "SITE_URL", ""),
            site_name=getattr(scraper, "SITE_NAME", ""),
        )
        return analysis, ScrapingStrategy()

    def _load_last_report(self, slug: str) -> Optional[Dict]:
        """Retourne le rapport précédent (pour mesurer la régression).

        Préfère le rapport daté le plus récent (avant aujourd'hui) au lieu de
        l'alias 'latest' qui pointe sur le rapport courant — sinon on
        comparerait toujours le rapport à lui-même."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            dated = sorted(
                REPORTS_DIR.glob(f"{slug}_report_*.json"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        except Exception:
            dated = []

        for p in dated:
            if p.name == f"{slug}_report.json":
                continue
            if today in p.name:
                continue
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue

        # Fallback (rétrocompat): alias 'latest' s'il n'y a aucun snapshot daté.
        latest = REPORTS_DIR / f"{slug}_report.json"
        if latest.exists():
            try:
                return json.loads(latest.read_text(encoding="utf-8"))
            except Exception:
                pass
        return None

    # ------------------------------------------------------------------
    # Persistance
    # ------------------------------------------------------------------

    def _save_report(self, report: ValidationReport, slug: str) -> None:
        """Sauvegarde le rapport avec versionnement quotidien.

        Produit deux fichiers:
          - {slug}_report_{YYYY-MM-DD}.json (snapshot du jour)
          - {slug}_report.json (alias 'latest' pour rétrocompat)

        _load_last_report() ignorera le 'latest' au profit du 2e plus récent
        (vraie comparaison de régression).
        """
        try:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            dated_path = REPORTS_DIR / f"{slug}_report_{today}.json"
            latest_path = REPORTS_DIR / f"{slug}_report.json"
            report.save(dated_path)
            report.save(latest_path)
            report.analysis_file = str(latest_path)
            self._log(f"Rapport sauvegardé: {dated_path.name} (+ alias latest)")
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


def _run_scraper_subprocess(module_name: str, class_name: str,
                             categories: List[str], conn) -> None:
    """Exécuté dans un sous-processus séparé pour isoler le scraper.
    Communique avec le parent via une Connection Pipe."""
    import importlib as _imp
    payload: Dict[str, object] = {"products": [], "error": ""}
    try:
        module_path = f"scraper_ai.dedicated_scrapers.{module_name}"
        mod = _imp.import_module(module_path)
        scraper_class = getattr(mod, class_name)
        scraper = scraper_class()

        scraper.MAX_WORKERS = 3
        if hasattr(scraper, "WORKERS"):
            scraper.WORKERS = 3
        scraper.HTTP_TIMEOUT = 25
        # Certains scrapers (PowerGO/Motoplex et descendants) utilisent un
        # DETAIL_TIMEOUT distinct pour les pages détail — on le réduit aussi
        # pour rester cohérent avec HTTP_TIMEOUT en mode validation.
        if hasattr(scraper, "DETAIL_TIMEOUT"):
            scraper.DETAIL_TIMEOUT = 25

        result = scraper.scrape(categories=categories, inventory_only=False)
        payload["products"] = result.get("products", [])
    except Exception as e:
        import traceback
        payload["error"] = f"{type(e).__name__}: {str(e)[:500]}\n{traceback.format_exc()[-1500:]}"
    try:
        conn.send(payload)
        conn.close()
    except Exception:
        pass
