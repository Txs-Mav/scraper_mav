"""
Phase 1 : SiteAnalyzer -- Analyse profonde d'un site de concessionnaire.

Sous-étapes :
  1.1 Détection de plateforme
  1.2 Cartographie structure
  1.3 Test rendu JavaScript
  1.4 Interception API internes (délégué à api_interceptor)
  1.5 Mapping sélecteurs CSS
  1.6 Détection anti-bot
  1.7 Encodage et langue
  1.8 Persistance de l'analyse
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .browser_agent import BrowserAgent, CapturedResponse
from .models import (
    DetectedAPI, ListingPage, PriceDisplayMode,
    SelectorEntry, SelectorMap, SiteAnalysis,
)
from .platforms import (
    detect_platform, detect_iframe_inventory, probe_sitemap,
)
from .domain_profiles import (
    DomainProfile, DomainType, AUTO_PROFILE,
    detect_domain_profile, get_profile,
)
from .listing_detector import best_listing, measure_completeness
from .stealth import stealth_headers, random_user_agent
from .template_clusters import cluster_detail_templates
from .url_filters import (
    classify_listing as _classify_listing_helper,
    classify_state, fix_mojibake, is_product_url_for_site, normalize_url,
)

ANALYSIS_DIR = Path(__file__).resolve().parent.parent.parent / "scraper_cache" / "analysis"

# Conservé pour rétrocompatibilité — équivaut à AUTO_PROFILE.nav_keywords.
# Les nouveaux flux utilisent self.profile.nav_keywords (DomainProfile).
NAV_KEYWORDS = [
    # Inventaire general
    "inventaire", "inventory", "en-stock", "en stock", "in stock", "in-stock",
    "neufs", "neuf", "new", "occasions", "occasion", "used",
    "usagé", "usages", "pre-owned", "preowned", "certified",
    "catalogue", "catalog",
    # Vehicules generiques
    "véhicules", "vehicules", "vehicles",
    # Motos / powersports
    "motos", "moto", "motocyclettes", "motorcycle",
    "vtt", "quad", "atv",
    "motoneiges", "motoneige", "snowmobile",
    "side-by-side", "côte-à-côte", "utilitaires", "utility",
    # Automobiles
    "cars", "car", "auto", "autos", "automobile", "automobiles",
    "trucks", "truck", "camion", "camions", "pickup",
    "suv", "suvs", "vus",
    "sedan", "berline", "berlines",
    "coupe", "coupé",
    "convertible", "cabriolet", "décapotable",
    "minivan", "fourgonnette", "van", "fourgon",
    "crossover", "hatchback",
    "hybrid", "hybride", "electric", "électrique", "phev", "ev",
    "luxury", "sport",
    # Pages inventaire specifiques
    "search", "recherche", "browse", "parcourir", "showroom",
]

CALL_FOR_PRICE_PATTERNS = re.compile(
    r"prix\s+sur\s+demande|appelez|call\s+for\s+price|contactez|nous\s+contacter"
    r"|price\s+on\s+request|request\s+a\s+quote",
    re.IGNORECASE,
)

MOJIBAKE_PATTERNS = [
    ("Ã©", "é"), ("Ã¨", "è"), ("Ãª", "ê"), ("Ã ", "à"),
    ("Ã®", "î"), ("Ã´", "ô"), ("Ã¹", "ù"), ("Ã§", "ç"),
    ("Ã‰", "É"), ("Ã€", "À"), ("â€™", "'"), ("â€", "—"),
]


class SiteAnalyzer:
    """Analyse un site (concessionnaire, ecommerce, immo, jobs, générique) et
    produit un SiteAnalysis."""

    def __init__(self, *, use_playwright: bool = True, verbose: bool = True,
                 domain_profile: Optional[DomainProfile] = None,
                 force_profile_key: Optional[str] = None):
        """
        Args:
            use_playwright : autorise l'usage de Playwright (interception API + fallback Phase 1)
            verbose : logs détaillés
            domain_profile : profil métier imposé (auto, ecommerce, real_estate, jobs)
            force_profile_key : alternative string ('auto'|'ecommerce'|...) pour CLI
        """
        self.verbose = verbose
        self.use_playwright = use_playwright

        # Profil de domaine : explicite > forcé > auto (par défaut, rétrocompat)
        if domain_profile is not None:
            self.profile = domain_profile
        elif force_profile_key:
            self.profile = get_profile(force_profile_key)
        else:
            self.profile = AUTO_PROFILE  # défaut rétrocompat — détection auto en Phase 1

        self._auto_detect_profile = (domain_profile is None and not force_profile_key)

        self.session = requests.Session()
        self.session.headers.update(stealth_headers())

        # BrowserAgent partagé : lancé à la 1ère utilisation, réutilisé par
        # 1.3bis et 1.5 pour éviter de relancer Chromium deux fois.
        self._browser_agent: Optional[BrowserAgent] = None
        # Cache du rendu de la home (HTML + réponses JSON capturées). Permet
        # à 1.5 de récupérer directement les APIs vues lors du rendu 1.3bis.
        self._home_render_cache: Dict[str, Dict[str, Any]] = {}

    def _get_browser_agent(self) -> Optional[BrowserAgent]:
        """Lance (lazy) le BrowserAgent partagé. Retourne None si Playwright
        indisponible — les callers doivent gérer ce cas."""
        if not self.use_playwright:
            return None
        if self._browser_agent is None:
            try:
                self._browser_agent = BrowserAgent(log_fn=self._log).start()
            except Exception as e:
                self._log(f"    BrowserAgent indisponible: {type(e).__name__}: {e}")
                self._browser_agent = None
        return self._browser_agent

    def _close_browser_agent(self) -> None:
        if self._browser_agent is not None:
            try:
                self._browser_agent.close()
            except Exception:
                pass
            self._browser_agent = None

    # ------------------------------------------------------------------
    # Point d'entrée principal
    # ------------------------------------------------------------------

    def analyze(self, url: str) -> SiteAnalysis:
        self._log(f"Analyse de {url}")
        start = time.time()

        analysis = SiteAnalysis(
            site_url=url,
            domain=urlparse(url).netloc.replace("www.", ""),
        )

        self._log("    Fetch page d'accueil...")
        t0 = time.time()
        homepage_html, homepage_headers, response_times = self._fetch_homepage(url)
        self._log(f"    Fetch terminé en {time.time()-t0:.1f}s ({len(homepage_html or '')} chars)")
        if homepage_html is None:
            self._log("ERREUR: Impossible de charger la page d'accueil")
            # Slug + nom du site même en sortie anticipée : sinon les phases
            # suivantes (générateur, validator, audit) écrivent toutes dans
            # `_strategy.json` / `.py` (slug vide) et écrasent les autres
            # subprocess en parallèle. Voir bench 2026-05-16.
            analysis.slug = self._generate_slug(analysis)
            if not analysis.site_name:
                analysis.site_name = analysis.domain or url
            return analysis

        self._log("    Parsing HTML...")
        t0 = time.time()
        soup = BeautifulSoup(homepage_html, "lxml")
        self._log(f"    Parsing terminé en {time.time()-t0:.1f}s")
        analysis.avg_response_time_ms = sum(response_times) / len(response_times) if response_times else 0

        final_url = getattr(self, '_final_url', url)
        if final_url != url:
            analysis.site_url = final_url
            analysis.domain = urlparse(final_url).netloc.replace("www.", "")
            self._log(f"    Domaine mis à jour après redirect: {analysis.domain}")

        # 1.1 Détection plateforme
        self._log("1.1 Détection plateforme...")
        t0 = time.time()
        analysis.platform = detect_platform(homepage_html, homepage_headers, url)
        self._log(f"    -> {analysis.platform.name} ({time.time()-t0:.1f}s)")

        # 1.1bis Détection automatique du profil de domaine (si non imposé)
        if self._auto_detect_profile:
            self._log("1.1bis Détection profil de domaine...")
            preview_jsonld = self._scan_jsonld_types(soup)
            detected = detect_domain_profile(homepage_html, analysis.site_url, preview_jsonld)
            if detected.domain_type != self.profile.domain_type:
                self._log(f"    -> profil détecté: {detected.name} (était: {self.profile.name})")
                self.profile = detected
            else:
                self._log(f"    -> profil confirmé: {self.profile.name}")
        analysis.domain_profile_key = self.profile.domain_type.value

        # 1.2 Anti-bot EARLY (avant de bombarder le site de requêtes)
        self._log("1.2 Détection anti-bot + timing...")
        t0 = time.time()
        self._detect_anti_bot(analysis, url)
        self._log(f"    -> anti_bot={analysis.anti_bot}, "
                  f"avg_response={analysis.avg_response_time_ms:.0f}ms ({time.time()-t0:.1f}s)")
        if analysis.anti_bot:
            self._log("ABANDON: anti-bot détecté, arrêt de l'analyse")
            analysis.slug = self._generate_slug(analysis)
            return analysis

        # 1.3 Cartographie structure
        self._log("1.3 Cartographie structure...")
        t0 = time.time()
        self._map_structure(analysis, soup, analysis.site_url)
        self._log(f"    -> {len(analysis.listing_pages)} listings, "
                  f"{len(analysis.sitemap_urls)} sitemap URLs ({time.time()-t0:.1f}s)")

        # 1.3bis Si requests n'a rien trouvé (0 listing actif), tenter le rendu Playwright
        if self.use_playwright and not any(lp.estimated_products > 0 for lp in analysis.listing_pages):
            self._log("1.3bis Aucun listing exploitable en HTML brut → fallback Playwright...")
            t_render = time.time()
            # On capture les réponses JSON dès ce rendu : si 1.5 visite la
            # même URL, il n'aura pas à recharger la page.
            rendered_html = self._render_with_playwright(
                analysis.site_url, capture_for_intercept=True,
            )
            self._log(f"    Rendu Playwright terminé en {time.time()-t_render:.1f}s "
                      f"({len(rendered_html or '')} chars)")
            if rendered_html:
                analysis.playwright_used_in_phase1 = True
                rendered_soup = BeautifulSoup(rendered_html, "lxml")
                # Re-cartographie la nav avec le DOM hydraté
                t0 = time.time()
                self._map_structure(analysis, rendered_soup, analysis.site_url)
                self._log(f"    -> après rendu: {len(analysis.listing_pages)} listings "
                          f"({time.time()-t0:.1f}s)")
                # Retente la détection statistique sur la home rendue si toujours vide
                if not any(lp.estimated_products > 0 for lp in analysis.listing_pages):
                    cand = best_listing(rendered_html,
                                        item_hints=self.profile.listing_item_hints,
                                        base_url=analysis.site_url, min_items=4)
                    if cand:
                        analysis.statistical_listing_selector = cand.selector
                        analysis.statistical_listing_count = len(cand.items)
                        self._log(f"    -> listings via statistique sur home rendue: "
                                  f"'{cand.selector}' ({len(cand.items)} items)")
                        analysis.listing_pages.append(ListingPage(
                            url=analysis.site_url,
                            etat="neuf",
                            source_categorie="inventaire",
                            estimated_products=len(cand.items),
                            listing_data_completeness=measure_completeness(rendered_html, cand.selector),
                        ))

        # 1.4 Test rendu JS (iframes, scroll infini, load more)
        self._log("1.4 Test rendu JavaScript...")
        t0 = time.time()
        self._test_js_rendering(analysis, soup, url)
        self._log(f"    -> playwright={analysis.needs_playwright}, iframe={analysis.has_iframe_inventory}, "
                  f"scroll={analysis.has_infinite_scroll}, loadmore={analysis.has_load_more_button} ({time.time()-t0:.1f}s)")

        # 1.5 Interception API internes
        if self.use_playwright:
            self._log("1.5 Interception API internes (Playwright)...")
            t0 = time.time()
            self._intercept_apis(analysis)
            self._log(f"    -> {len(analysis.detected_apis)} API(s) trouvée(s) ({time.time()-t0:.1f}s)")
        else:
            self._log("1.5 Interception API SKIP (playwright désactivé)")

        # 1.6 Mapping sélecteurs CSS
        self._log("1.6 Mapping sélecteurs CSS...")
        t0 = time.time()
        self._map_selectors(analysis)
        self._log(f"    -> listing_item='{analysis.selectors.listing_item.selector}', "
                  f"detail_name='{analysis.selectors.detail_name.selector}', "
                  f"json_ld={analysis.json_ld_available} ({time.time()-t0:.1f}s)")

        # 1.7 Encodage et langue
        self._log("1.7 Encodage et langue...")
        t0 = time.time()
        self._detect_encoding_language(analysis, homepage_html, soup, url)
        self._log(f"    -> mojibake={analysis.needs_mojibake_fix}, "
                  f"langues={list(analysis.language_versions.keys())} ({time.time()-t0:.1f}s)")

        # 1.8 Warm-up
        self._log("1.8 Test warm-up...")
        t0 = time.time()
        self._detect_warm_up(analysis, url)
        self._log(f"    -> warm_up={analysis.warm_up_required} ({time.time()-t0:.1f}s)")

        # 1.8bis Détection de variantes de templates de fiche détail (P2.2)
        self._log("1.8bis Clustering des templates de fiche détail...")
        t0 = time.time()
        try:
            self._detect_detail_template_clusters(analysis)
        except Exception as e:
            self._log(f"    Clustering templates échoué: {type(e).__name__}: {e}")
        self._log(f"    -> {len(analysis.detail_template_clusters)} cluster(s) "
                  f"({time.time()-t0:.1f}s)")

        # Slug + nom du site
        analysis.slug = self._generate_slug(analysis)
        if not analysis.site_name:
            title = soup.find("title")
            analysis.site_name = title.get_text(strip=True) if title else analysis.domain

        # Applique le fix mojibake sur le nom de site quand le HTML source est
        # en latin1-vu-comme-utf8 (typique des CMS PowerGO/PrestaShop mal
        # configurés). Sans ça, le titre "Excel Moto | Your Dealership in
        # Montréal" devient "MontrÃ©al" dans tous les rapports + dashboard.
        if analysis.site_name and analysis.needs_mojibake_fix:
            analysis.site_name = fix_mojibake(analysis.site_name)

        analysis.analysis_timestamp = datetime.now(timezone.utc).isoformat()

        elapsed = time.time() - start
        self._log(f"Analyse terminée en {elapsed:.1f}s — {len(analysis.listing_pages)} listings, "
                  f"{len(analysis.sitemap_urls)} URLs sitemap, {len(analysis.detected_apis)} APIs, "
                  f"prix={analysis.price_display_mode.value}")

        # 1.9 Persistance
        self._save(analysis)

        # Libère Chromium dès la fin de l'analyse — on n'en a plus besoin
        # pour les phases suivantes (stratégie, génération).
        self._close_browser_agent()
        return analysis

    # ------------------------------------------------------------------
    # 1.1 - (délégué à platforms.detect_platform via analyze)
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 1.2 Cartographie structure
    # ------------------------------------------------------------------

    def _map_structure(self, analysis: SiteAnalysis, soup: BeautifulSoup, base_url: str) -> None:
        self._log("    Découverte liens navigation...")
        nav_links = self._discover_nav_links(soup, base_url)
        self._log(f"    {len(nav_links)} liens trouvés dans la nav")

        # Utilise le DomainProfile actif (auto, ecommerce, immo, jobs…)
        nav_keywords = [kw.lower() for kw in self.profile.nav_keywords]
        excluded = [p.lower() for p in self.profile.excluded_paths]
        # Compile les nav_patterns (regex) du profil — None si vide.
        nav_patterns_compiled: List[re.Pattern] = []
        for pat in getattr(self.profile, "nav_patterns", []) or []:
            try:
                nav_patterns_compiled.append(re.compile(pat, re.IGNORECASE))
            except re.error as e:
                self._log(f"    nav_pattern invalide ignoré '{pat}': {e}")

        domain = analysis.domain
        listing_candidates = []
        for link_url, link_text in nav_links:
            text_lower = link_text.lower()
            path_lower = urlparse(link_url).path.lower()

            if self._is_excluded_path(path_lower, excluded):
                continue

            # Si l'URL ressemble déjà à une fiche produit, ce n'est PAS un
            # listing — on évite ainsi de bouffer des liens "Voir détail" qui
            # passeraient le filtre keyword-substring.
            if is_product_url_for_site(
                link_url, domain=domain,
                profile=self.profile, platform=analysis.platform,
            ):
                continue

            matched = self._matches_nav_keyword(
                text_lower, path_lower, nav_keywords, nav_patterns_compiled,
            )
            if matched:
                listing_candidates.append((link_url, link_text))

        seen_urls = set()
        unique_candidates = []
        for link_url, link_text in listing_candidates:
            if link_url not in seen_urls:
                seen_urls.add(link_url)
                unique_candidates.append((link_url, link_text))

        self._log(f"    {len(unique_candidates)} candidats listing après filtrage")

        max_candidates = min(len(unique_candidates), 25)
        consecutive_zeros = 0
        # Quand la plateforme est connue (PowerGO, PrestaShop, Shopify…), on
        # tolère plus de zéros consécutifs avant de conclure "site SPA". Les
        # plateformes inconnues gardent un seuil plus bas pour ne pas spammer.
        platform_known = analysis.platform.platform_type.value not in ("generic",)
        max_consecutive_zeros = 15 if platform_known else 10

        for i, (link_url, link_text) in enumerate(unique_candidates[:max_candidates]):
            self._log(f"    Analyse listing {i+1}/{max_candidates}: {link_url[:80]}...")
            etat, cat = self._classify_listing(link_text, link_url)

            self._log(f"      Estimation produits...")
            t0 = time.time()
            count = self._estimate_product_count(link_url)
            self._log(f"      -> {count} produits ({time.time()-t0:.1f}s)")

            if count == 0:
                consecutive_zeros += 1
                self._log(f"      SKIP: 0 produits (consecutive_zeros={consecutive_zeros})")
                if consecutive_zeros >= max_consecutive_zeros:
                    self._log(f"    EARLY STOP: {max_consecutive_zeros} pages consécutives sans produits — "
                              f"site probablement rendu côté client (SPA)")
                    analysis.needs_playwright = True
                    break
                continue

            consecutive_zeros = 0
            self._log(f"      Mesure complétude listing...")
            t0 = time.time()
            completeness = self._measure_listing_completeness(link_url)
            self._log(f"      -> complétude={completeness:.0%} ({time.time()-t0:.1f}s)")

            analysis.listing_pages.append(ListingPage(
                url=link_url,
                etat=etat,
                source_categorie=cat,
                estimated_products=count,
                listing_data_completeness=completeness,
            ))

        analysis.listing_pages.sort(key=lambda lp: lp.estimated_products, reverse=True)

        self._log("    Probe sitemap...")
        t0 = time.time()
        sitemap_urls, sitemap_xml_url = probe_sitemap(self.session, base_url, analysis.platform)
        analysis.sitemap_urls = sitemap_urls
        analysis.sitemap_xml_url = sitemap_xml_url
        self._log(f"    Sitemap : {len(sitemap_urls)} URLs produit, xml={sitemap_xml_url[:60] if sitemap_xml_url else 'none'} ({time.time()-t0:.1f}s)")

    def _is_excluded_path(self, path: str, excludes: Optional[List[str]] = None) -> bool:
        """Vérifie si un chemin est exclu (combine l'exclusion fournie et le profil)."""
        if excludes is None:
            excludes = [p.lower() for p in self.profile.excluded_paths]
        path_lower = path.lower()
        for ex in excludes:
            if ex in path_lower:
                return True

        if path_lower.rstrip("/") in ("", "/", "/fr", "/en", "/eng", "/fra"):
            return True

        return False

    @staticmethod
    def _matches_nav_keyword(
        text: str,
        path: str,
        keywords: List[str],
        patterns: Optional[List[re.Pattern]] = None,
    ) -> bool:
        """Match un mot-clé sur le texte du lien (libre) ou comme segment du path
        (entre / et /). Évite les faux positifs type 'neuf' ⊂ 'inventaire-neufs-2024'.

        Si ``patterns`` est fourni (DomainProfile.nav_patterns compilées), chaque
        regex est aussi testée sur le texte ET le path — pour rattraper les
        variantes accentuées et pluriels que le substring matching rate.
        """
        if not keywords and not patterns:
            return False
        # Texte du lien : substring suffit (le lien dit ce qu'il est).
        for kw in keywords or []:
            if kw and kw in text:
                return True
        # Path : on exige un segment complet pour éviter 'neuf' ⊂ '/...-neuf-2024-id123'.
        segments = [s for s in path.split("/") if s]
        for seg in segments:
            if seg in (keywords or []):
                return True
        # Regex (DomainProfile.nav_patterns) — testées sur path en priorité, puis texte.
        for rx in patterns or []:
            if rx.search(path) or rx.search(text):
                return True
        return False

    def _discover_nav_links(self, soup: BeautifulSoup, base_url: str) -> List[Tuple[str, str]]:
        """Découvre les liens de navigation en élargissant aux patterns modernes
        (ARIA, mega-menu, footer-sitemap, drawer mobile).

        Stratégie en 2 passes :
          1. Passe BS4 sur le HTML statique (rapide, couvre la majorité des sites).
          2. Si la page est SPA (analysis.needs_playwright) ou que la passe 1 a
             ramené trop peu de liens (<5), passe Playwright avec traversée
             Shadow DOM pour récupérer les Web Components fermés.
        """
        domain = urlparse(base_url).netloc
        links: List[Tuple[str, str]] = []
        seen = set()

        nav_selectors = (
            "nav a, header a, footer a, aside a, "
            ".menu a, .navbar a, #menu a, "
            ".main-menu a, .primary-menu a, .mega-menu a, "
            ".navigation a, .site-nav a, .top-nav a, "
            "[role='navigation'] a, [role='menu'] a, [role='menubar'] a, "
            "[aria-label*='menu' i] a, [aria-label*='navigation' i] a, "
            "[class*='menu'] a, [class*='nav'] a, [id*='menu'] a"
        )

        for a in soup.select(nav_selectors):
            href = a.get("href", "")
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            full = urljoin(base_url, href)
            full = normalize_url(full, strip_tracking=True)
            if not full:
                continue
            if urlparse(full).netloc.replace("www.", "") != domain.replace("www.", ""):
                continue
            if full not in seen:
                seen.add(full)
                links.append((full, a.get_text(strip=True)))

        # Passe Playwright + Shadow DOM si la passe statique est pauvre ou si
        # le site est marqué SPA. Coût borné à un seul rendu.
        shadow_links = self._discover_shadow_dom_links(base_url, domain, seen)
        if shadow_links:
            self._log(f"    +{len(shadow_links)} liens via Shadow DOM walker")
            for full, text in shadow_links:
                if full not in seen:
                    seen.add(full)
                    links.append((full, text))

        return links

    def _discover_shadow_dom_links(
        self, base_url: str, domain: str, already_seen: set,
    ) -> List[Tuple[str, str]]:
        """Récupère les liens cachés dans les Shadow DOM via Playwright.
        Renvoie [] si Playwright indisponible ou si la passe statique est déjà
        riche (≥5 liens) et que le site n'est pas SPA."""
        if not self.use_playwright:
            return []
        # Skip si on a déjà une nav riche et que le site n'a pas l'air SPA.
        # On n'a pas encore needs_playwright ici (1.4 vient après 1.3) donc on
        # se base sur le nombre de liens déjà ramassés.
        if len(already_seen) >= 5:
            return []
        agent = self._get_browser_agent()
        if agent is None:
            return []
        try:
            raw = agent.extract_all_links_with_shadow(base_url)
        except Exception as e:
            self._log(f"    Shadow DOM walker échoué: {type(e).__name__}: {e}")
            return []
        out: List[Tuple[str, str]] = []
        out_seen: set = set()
        for item in raw:
            href = item.get("href", "")
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            full = urljoin(base_url, href)
            full = normalize_url(full, strip_tracking=True)
            if not full:
                continue
            if urlparse(full).netloc.replace("www.", "") != domain.replace("www.", ""):
                continue
            if full in already_seen or full in out_seen:
                continue
            out_seen.add(full)
            out.append((full, item.get("text", "")))
        return out

    def _classify_listing(self, text: str, url: str) -> Tuple[str, str]:
        """Classifie un listing en (etat, source_categorie).

        Délègue à url_filters.classify_listing (source de vérité unique partagée
        avec le code généré). Les 4 combinaisons valides sont:
          - ('neuf',          'inventaire')
          - ('neuf',          'catalogue')
          - ('occasion',      'vehicules_occasion')
          - ('demonstrateur', 'vehicules_occasion')
        """
        return _classify_listing_helper(text, url)

    def _estimate_product_count(self, url: str) -> int:
        try:
            resp = self.session.get(url, timeout=15)
            if resp.status_code != 200:
                return 0
            soup = BeautifulSoup(resp.text, "lxml")
            total_el = soup.select_one(
                ".total-products, .result-count, .woocommerce-result-count, "
                ".products-count, [data-total], .search-result-count"
            )
            if total_el:
                m = re.search(r"(\d+)", total_el.get_text())
                if m:
                    return int(m.group(1))

            # 1) Heuristique : sélecteurs communs + hints du DomainProfile
            hint_selectors = ", ".join(self.profile.listing_item_hints)
            base_selectors = (
                "article, .product, .product-miniature, .product-card, "
                ".vehicle-card, .inventory-item, .pg-vehicle-card, .item"
            )
            full_sel = f"{hint_selectors}, {base_selectors}" if hint_selectors else base_selectors
            try:
                items = soup.select(full_sel)
            except Exception:
                items = soup.select(base_selectors)
            if items and len(items) >= 4:
                return len(items)

            # 2) Fallback statistique : détecte les groupes d'items répétés
            cand = best_listing(
                resp.text,
                item_hints=self.profile.listing_item_hints,
                base_url=url,
                min_items=4,
            )
            if cand:
                return len(cand.items)

            return len(items) if items else 0
        except Exception:
            return 0

    def _measure_listing_completeness(self, url: str) -> float:
        """Mesure combien de champs clés sont disponibles sur la page listing."""
        try:
            resp = self.session.get(url, timeout=15)
            if resp.status_code != 200:
                return 0.0
            soup = BeautifulSoup(resp.text, "lxml")
            items = soup.select(
                "article, .product, .product-miniature, .product-card, "
                ".vehicle-card, .inventory-item, .pg-vehicle-card"
            )
            if not items:
                return 0.0

            sample = items[:5]
            fields_found = {"name": 0, "price": 0, "image": 0, "link": 0, "brand": 0}
            for item in sample:
                if item.find("a"):
                    fields_found["link"] += 1
                if item.find("img"):
                    fields_found["image"] += 1
                text = item.get_text(separator=" ", strip=True)
                if re.search(r"\d[\d\s,.]*\$|\$[\d\s,.]+", text):
                    fields_found["price"] += 1
                if len(text) > 10:
                    fields_found["name"] += 1

            total = len(sample)
            if total == 0:
                return 0.0
            scores = [v / total for v in fields_found.values()]
            return sum(scores) / len(scores)
        except Exception:
            return 0.0

    # ------------------------------------------------------------------
    # 1.3 Test rendu JavaScript
    # ------------------------------------------------------------------

    def _test_js_rendering(self, analysis: SiteAnalysis, soup: BeautifulSoup, url: str) -> None:
        iframe_src = detect_iframe_inventory(soup)
        if iframe_src:
            analysis.has_iframe_inventory = True
            analysis.iframe_src = iframe_src
            self._log(f"    Iframe inventaire détecté : {iframe_src}")

        html_str = str(soup)
        html_lower = html_str.lower()

        # --- (1) Telemetry : signatures textuelles, pour diagnostic uniquement ---
        # Plus utilisées comme décision SPA depuis P1.1 — la décision est désormais
        # comportementale (cf. plus bas). On garde la liste pour les logs/health checks.
        spa_signals_detected: List[str] = []
        if "__NEXT_DATA__" in html_str or "_next/static" in html_lower:
            spa_signals_detected.append("Next.js")
        if "ng-app" in html_lower or "ng-controller" in html_lower or "angular" in html_lower:
            spa_signals_detected.append("Angular")
        if "__react" in html_lower or "react-root" in html_lower or "data-reactroot" in html_lower:
            spa_signals_detected.append("React")
        if "__vue" in html_lower or "data-v-" in html_lower:
            spa_signals_detected.append("Vue.js")
        if "d2cmedia" in html_lower or "edealer" in html_lower:
            spa_signals_detected.append("D2C/eDealer")
        if "dealer.com" in html_lower and "ddc-" in html_lower:
            spa_signals_detected.append("Dealer.com")

        visible_text = soup.get_text(separator=" ", strip=True)
        html_size = len(html_str)
        text_ratio = len(visible_text) / max(html_size, 1)
        if html_size > 200000 and text_ratio < 0.05:
            spa_signals_detected.append(f"HTML-lourd-{html_size//1000}k-text-{text_ratio:.0%}")

        scripts = soup.find_all("script", src=True)
        bundle_scripts = [s["src"] for s in scripts if any(
            w in s["src"].lower() for w in ["bundle", "chunk", "main.", "app."]
        )]
        if len(bundle_scripts) >= 3:
            spa_signals_detected.append(f"bundles-{len(bundle_scripts)}")

        analysis.spa_signals_detected = spa_signals_detected
        if spa_signals_detected:
            self._log(f"    Signatures SPA (telemetry uniquement): {', '.join(spa_signals_detected)}")

        # --- (2) Décision comportementale : static_count vs rendered_count ---
        static_count = self._count_static_items(html_str, url)
        analysis.spa_static_item_count = static_count
        self._log(f"    Items statiques (HTML brut) détectés: {static_count}")

        # Trigger rendu Playwright si :
        #  - aucun item détecté en HTML brut, OU
        #  - HTML très "vide" (text_ratio < 5% sur HTML > 200k) — symptôme classique de SPA hydraté.
        should_probe_render = (
            static_count == 0
            or (html_size > 200_000 and text_ratio < 0.05)
        )

        if should_probe_render and self.use_playwright:
            rendered_count = self._count_rendered_items(url)
            if rendered_count is not None:
                analysis.spa_rendered_item_count = rendered_count
                self._log(f"    Items après rendu Playwright: {rendered_count} "
                          f"(static={static_count})")
                # Décision : on bascule en Playwright si le rendu débloque réellement
                # des items (ratio 2x ou apparition à partir de zéro).
                if (rendered_count >= 2 * max(static_count, 1)
                        or (static_count == 0 and rendered_count >= 4)):
                    analysis.needs_playwright = True
                    self._log(f"    -> SPA confirmé comportementalement "
                              f"(static={static_count} → rendered={rendered_count})")
            else:
                # BrowserAgent indisponible → garde-fou : on retombe sur l'heuristique
                # textuelle historique pour ne pas régresser sur les sites où on ne peut
                # pas mesurer dynamiquement.
                if len(spa_signals_detected) >= 2:
                    analysis.needs_playwright = True
                    self._log(f"    -> Playwright indisponible, fallback signatures: "
                              f"{', '.join(spa_signals_detected[:3])}")
        elif not should_probe_render:
            # HTML brut produit déjà des items ; pas besoin de Playwright pour la
            # cartographie, indépendamment des frameworks détectés.
            self._log(f"    -> rendu Playwright non nécessaire ({static_count} items en HTML brut)")

        infinite_scroll_signals = [
            "infinite-scroll", "infinitescroll", "infinite_scroll",
            "data-infinite", "waypoint", "scroll-trigger",
            "loadOnScroll", "scroll-load", "lazy-load-trigger",
        ]
        for signal in infinite_scroll_signals:
            if signal in html_lower:
                analysis.has_infinite_scroll = True
                self._log(f"    Scroll infini détecté via signal: {signal}")
                break

        if not analysis.has_infinite_scroll:
            for script in soup.find_all("script"):
                if script.string:
                    s = script.string.lower()
                    if ("scroll" in s and ("load" in s or "fetch" in s or "page" in s)
                            and any(w in s for w in ["product", "item", "vehicle", "inventory"])):
                        analysis.has_infinite_scroll = True
                        self._log("    Scroll infini détecté via script JS (scroll+load+product)")
                        break

        load_more_patterns = [
            "charger plus", "load more", "afficher plus",
            "show more", "charger la suite", "voir plus",
        ]
        for btn in soup.find_all(["button", "a"]):
            btn_text = btn.get_text(strip=True).lower()
            if len(btn_text) > 50:
                continue
            for pat in load_more_patterns:
                if pat == btn_text or (pat in btn_text and len(btn_text) < 30):
                    css_sel = self._element_to_selector(btn)
                    analysis.has_load_more_button = True
                    analysis.load_more_selector = css_sel
                    self._log(f"    Bouton 'Load More' trouvé : {css_sel} (texte: '{btn_text}')")
                    break
            if analysis.has_load_more_button:
                break

    def _element_to_selector(self, el) -> str:
        """Construit un sélecteur CSS basique à partir d'un élément BS4."""
        tag = el.name
        if el.get("id"):
            return f"#{el['id']}"
        classes = el.get("class", [])
        if classes:
            return f"{tag}.{'.'.join(classes)}"
        return tag

    def _count_static_items(self, html: str, url: str) -> int:
        """Compte les items détectables en HTML brut via le détecteur statistique.
        Retourne 0 si rien n'est trouvé. Utilisé par la décision SPA comportementale."""
        try:
            cand = best_listing(
                html,
                item_hints=self.profile.listing_item_hints,
                base_url=url,
                min_items=2,
            )
            return len(cand.items) if cand else 0
        except Exception:
            return 0

    def _count_rendered_items(self, url: str) -> Optional[int]:
        """Rend la page via Playwright et compte les items détectés statistiquement.
        Retourne None si Playwright indisponible (signal pour le caller de retomber
        sur le fallback signatures)."""
        agent = self._get_browser_agent()
        if agent is None:
            return None
        try:
            # On capture aussi les réponses JSON : si 1.5 visite la même URL,
            # il les rejouera sans recharger la page.
            result = agent.render(url, capture_responses=True)
        except Exception as e:
            self._log(f"    BrowserAgent.render échoué: {type(e).__name__}: {e}")
            return None
        if not result.success or not result.html:
            return None
        # Mémorise le rendu pour 1.5 (api_interceptor)
        self._home_render_cache[url] = {
            "html": result.html,
            "captured_responses": result.captured_responses,
            "final_url": result.final_url,
        }
        return self._count_static_items(result.html, url)

    # ------------------------------------------------------------------
    # 1.4 Interception API (délégué à api_interceptor)
    # ------------------------------------------------------------------

    def _intercept_apis(self, analysis: SiteAnalysis) -> None:
        try:
            from .api_interceptor import intercept_apis
            listing_urls = [lp.url for lp in analysis.listing_pages[:3]]
            if not listing_urls:
                listing_urls = self._guess_inventory_urls(analysis)
            self._log(f"    URLs à intercepter: {listing_urls}")
            self._log(f"    scroll={analysis.has_infinite_scroll or analysis.has_load_more_button}, "
                      f"load_more='{analysis.load_more_selector}'")
            apis = intercept_apis(
                listing_urls,
                scroll=analysis.has_infinite_scroll or analysis.has_load_more_button,
                load_more_selector=analysis.load_more_selector,
                cookie_consent=analysis.cookie_consent,
                agent=self._get_browser_agent(),
                cached_captures=self._captures_for_urls(listing_urls),
            )
            analysis.detected_apis = apis
            if apis:
                self._log(f"    {len(apis)} API(s) interne(s) détectée(s)")
                for api in apis:
                    self._log(f"      - {api.method} {api.url[:80]} (confiance: {api.confidence:.0%}, "
                              f"direct={api.accessible_sans_browser})")
            else:
                self._log("    Aucune API interne détectée")
        except ImportError:
            self._log("    Playwright non installé — interception API ignorée")
        except Exception as e:
            self._log(f"    Interception API échouée : {type(e).__name__}: {e}")

    def _captures_for_urls(
        self, urls: List[str],
    ) -> Dict[str, List[CapturedResponse]]:
        """Renvoie les réponses JSON déjà capturées pour des URLs données
        (mises en cache par 1.3bis). Si une URL n'est pas dans le cache, elle
        sera re-rendue par api_interceptor.
        """
        out: Dict[str, List[CapturedResponse]] = {}
        for u in urls:
            entry = self._home_render_cache.get(u)
            if entry and entry.get("captured_responses"):
                out[u] = entry["captured_responses"]
        return out

    # ------------------------------------------------------------------
    # 1.5 Mapping sélecteurs CSS
    # ------------------------------------------------------------------

    def _map_selectors(self, analysis: SiteAnalysis) -> None:
        if not analysis.listing_pages:
            self._log("    Aucune page listing — skip sélecteurs")
            return

        pages_with_products = [lp for lp in analysis.listing_pages if lp.estimated_products > 0]
        if not pages_with_products:
            self._log("    Aucune page listing avec produits — skip sélecteurs")
            return

        for i, lp in enumerate(pages_with_products[:3]):
            cat = lp.source_categorie or "default"
            self._log(f"    Détection sélecteurs listing [{cat}]: {lp.url[:60]} ({lp.estimated_products} produits)...")
            t0 = time.time()
            sm = self._detect_listing_selectors(lp.url)
            if sm:
                analysis.selectors_by_category[cat] = sm
                if not analysis.selectors.listing_item.selector:
                    analysis.selectors = sm
                self._log(f"      -> item='{sm.listing_item.selector}' ({time.time()-t0:.1f}s)")
            else:
                self._log(f"      -> aucun sélecteur trouvé ({time.time()-t0:.1f}s)")

        self._log("    Recherche URLs détail pour échantillon...")
        t0 = time.time()
        sample_urls = self._get_sample_detail_urls(analysis)
        self._log(f"    {len(sample_urls)} URLs détail trouvées ({time.time()-t0:.1f}s)")

        for i, detail_url in enumerate(sample_urls[:5]):
            self._log(f"    Détection sélecteurs détail {i+1}/{min(5,len(sample_urls))}: {detail_url[:70]}...")
            t0 = time.time()
            self._detect_detail_selectors(detail_url, analysis)
            self._log(f"      -> ({time.time()-t0:.1f}s)")

        self._log("    Détection JSON-LD...")
        t0 = time.time()
        self._detect_json_ld(sample_urls[:3], analysis)
        self._log(f"    -> json_ld={analysis.json_ld_available} type={analysis.json_ld_type} ({time.time()-t0:.1f}s)")

        self._log("    Détection mode prix...")
        t0 = time.time()
        self._detect_price_display_mode(analysis)
        self._log(f"    -> {analysis.price_display_mode.value} ({time.time()-t0:.1f}s)")

    def _detect_detail_template_clusters(self, analysis: SiteAnalysis) -> None:
        """Échantillonne 10-20 URLs détail et clusterise par signature DOM.
        Stocke le résultat dans analysis.detail_template_clusters. Si un seul
        cluster sort, le générateur garde son chemin nominal (rétrocompat)."""
        urls: List[str] = []
        # Source 1 : sitemap (déjà filtré sur les URLs produit)
        if analysis.sitemap_urls:
            urls.extend(analysis.sitemap_urls[:20])
        # Source 2 : crawl des listings si on n'a pas assez d'URLs
        if len(urls) < 10:
            crawled = self._get_sample_detail_urls(analysis)
            for u in crawled:
                if u not in urls:
                    urls.append(u)
                    if len(urls) >= 20:
                        break
        if len(urls) < 4:
            self._log(f"    Pas assez d'URLs détail ({len(urls)}) — skip clustering")
            return

        def _fetch(u: str) -> Optional[str]:
            try:
                resp = self.session.get(u, timeout=15)
                if resp.status_code != 200:
                    return None
                return resp.text
            except Exception:
                return None

        clusters = cluster_detail_templates(
            urls,
            fetch_html=_fetch,
            log_fn=self._log,
        )
        analysis.detail_template_clusters = clusters

    def _get_sample_detail_urls(self, analysis: SiteAnalysis) -> List[str]:
        """Récupère quelques URLs de pages détail pour tester les sélecteurs."""
        if analysis.sitemap_urls:
            return analysis.sitemap_urls[:5]

        listing_pages_with_products = [lp for lp in analysis.listing_pages if lp.estimated_products > 0]

        for lp in listing_pages_with_products[:3]:
            try:
                resp = self.session.get(lp.url, timeout=15)
                if resp.status_code != 200:
                    continue
                soup = BeautifulSoup(resp.text, "lxml")
                domain = urlparse(lp.url).netloc

                item_sel = analysis.selectors.listing_item.selector
                if item_sel:
                    items = soup.select(item_sel)
                    urls = []
                    for item in items[:10]:
                        link = item.find("a", href=True)
                        if link:
                            href = urljoin(lp.url, link["href"])
                            if urlparse(href).netloc.replace("www.", "") == domain.replace("www.", ""):
                                if href != lp.url and href not in urls:
                                    urls.append(href)
                    if urls:
                        self._log(f"    {len(urls)} URLs détail extraites depuis items listing")
                        return urls[:5]

                urls = []
                for a in soup.find_all("a", href=True):
                    href = urljoin(lp.url, a["href"])
                    href = normalize_url(href, strip_tracking=True)
                    if not href or href == lp.url:
                        continue
                    if urlparse(href).netloc.replace("www.", "") != domain.replace("www.", ""):
                        continue
                    if is_product_url_for_site(
                        href, domain=domain,
                        profile=self.profile, platform=analysis.platform,
                    ):
                        urls.append(href)
                if urls:
                    return list(dict.fromkeys(urls))[:5]
            except Exception:
                continue
        return []

    def _detect_listing_selectors(self, listing_url: str) -> Optional[SelectorMap]:
        """Détecte les sélecteurs d'un listing.

        Ordre (P2.1) :
          1. Détecteur statistique d'abord (indépendant du naming, plus robuste).
          2. Si un candidat statistique sort, on tente les candidats fixes
             (DomainProfile hints + e-commerce communs). Si l'un d'eux capture
             le même ensemble d'items à >80%, on prend le sélecteur fixe (plus
             stable et lisible) tout en gardant l'info statistique.
          3. Si le détecteur statistique ne sort rien : fallback historique
             (essai sériel des candidats fixes).
        """
        try:
            resp = self.session.get(listing_url, timeout=15)
            if resp.status_code != 200:
                return None
            soup = BeautifulSoup(resp.text, "lxml")

            profile_candidates = [(s, "a") for s in self.profile.listing_item_hints]
            base_candidates = [
                ("article.product-miniature", "h3 a, .product-title a"),
                ("li.product", "a.woocommerce-LoopProduct-link, h2 a"),
                (".product-card", "a, h3 a"),
                (".product-tile", "a"),
                (".vehicle-card", "a"),
                (".pg-vehicle-card", "a"),
                (".inventory-item", "a"),
                (".item", "a"),
            ]
            candidates = profile_candidates + base_candidates

            # 1) Statistique en premier
            cand = best_listing(
                resp.text,
                item_hints=self.profile.listing_item_hints,
                base_url=listing_url,
                min_items=4,
            )

            if cand:
                stat_sel = cand.selector
                stat_signatures = {self._item_signature(it) for it in cand.items}
                self._log(f"      Statistical detector: '{stat_sel}' "
                          f"(score={cand.score:.2f}, {len(cand.items)} items)")

                # 2) Validation : un candidat fixe capture-t-il (presque) le même set ?
                best_fixed: Optional[Tuple[str, str, List, float]] = None
                for item_sel, link_sel in candidates:
                    try:
                        items = soup.select(item_sel)
                    except Exception:
                        continue
                    if len(items) < 4:
                        continue
                    fixed_signatures = {self._item_signature(it) for it in items}
                    overlap_n = len(stat_signatures & fixed_signatures)
                    overlap_ratio = overlap_n / max(
                        len(stat_signatures), len(fixed_signatures), 1,
                    )
                    if overlap_ratio >= 0.80 and (
                        best_fixed is None or overlap_ratio > best_fixed[3]
                    ):
                        best_fixed = (item_sel, link_sel, items, overlap_ratio)

                if best_fixed is not None:
                    self._log(f"      Candidat fixe valide '{best_fixed[0]}' "
                              f"(overlap={best_fixed[3]:.0%}) — utilisé comme sélecteur final")
                    sm = self._build_listing_selector_map(
                        best_fixed[2], best_fixed[0], best_fixed[1],
                    )
                else:
                    sm = self._build_listing_selector_map(cand.items, stat_sel, "a")
                return sm

            # 3) Fallback : pas de candidat statistique → essai sériel des fixes (legacy)
            for item_sel, link_sel in candidates:
                try:
                    items = soup.select(item_sel)
                except Exception:
                    continue
                if len(items) >= 4:
                    return self._build_listing_selector_map(items, item_sel, link_sel)

        except Exception:
            pass
        return None

    @staticmethod
    def _item_signature(tag) -> str:
        """Signature stable d'un élément pour comparer deux sélections d'items.

        Combine tag + classes triées + premier href ancré. Ne dépend pas de
        l'identité Python des objets Tag (utile car best_listing re-parse le HTML).
        """
        try:
            classes = sorted(c for c in (tag.get("class") or []) if c)
            href = ""
            link = tag.find("a", href=True) if hasattr(tag, "find") else None
            if link:
                raw_href = link.get("href", "") or ""
                href = raw_href.split("?")[0].split("#")[0].rstrip("/")
            return f"{tag.name}|{','.join(classes[:3])}|{href}"
        except Exception:
            return f"{getattr(tag, 'name', '?')}|?"

    def _build_listing_selector_map(self, items: List, item_sel: str, link_sel: str) -> SelectorMap:
        """Construit un SelectorMap à partir d'un sample d'items détectés.

        La reliability de chaque sélecteur est calculée comme le pourcentage
        d'items où la valeur est réellement extractible (P2.3) — pas un
        hardcode 1.0. Le seuil ≥ 4 items est conservé côté appelant pour
        décider si on retient le candidat globalement.
        """
        sm = SelectorMap()
        n = max(len(items), 1)
        # listing_item : reliability sature à 10 items pour ne pas surestimer
        # la stabilité d'un sélecteur basé sur 4 items seulement.
        sm.listing_item = SelectorEntry(
            selector=item_sel, reliability=min(1.0, len(items) / 10.0),
        )

        # listing_link : on compte combien d'items contiennent un <a> avec href
        # non vide (le sélecteur composé est `{item_sel} {link_sel}` au final).
        link_hits = 0
        for it in items:
            try:
                a = it.find("a", href=True) if hasattr(it, "find") else None
            except Exception:
                a = None
            if a and (a.get("href") or "").strip() not in ("", "#"):
                link_hits += 1
        sm.listing_link = SelectorEntry(
            selector=f"{item_sel} {link_sel}", reliability=link_hits / n,
        )

        # listing_price : présence d'un signal $/€ dans le texte de l'item.
        price_re = re.compile(r"\d[\d\s,.]*\$|\$[\d\s,.]+|€\s?[\d,.]+")
        price_hits = 0
        for it in items:
            try:
                text = it.get_text(separator=" ", strip=True) if hasattr(it, "get_text") else ""
            except Exception:
                text = ""
            if price_re.search(text):
                price_hits += 1
        if price_hits > 0:
            sm.listing_price = SelectorEntry(
                selector=f"{item_sel} .price, {item_sel} .prix, {item_sel} [itemprop='price']",
                reliability=price_hits / n,
            )

        # listing_image : on choisit l'attribut le plus fréquent (src vs data-src etc.).
        img_attr_counts: Dict[str, int] = {}
        img_hits = 0
        for it in items:
            try:
                img = it.find("img") if hasattr(it, "find") else None
            except Exception:
                img = None
            if not img:
                continue
            img_hits += 1
            chosen_attr = "src"
            for data_attr in ("data-src", "data-lazy-src", "data-original"):
                if img.get(data_attr):
                    chosen_attr = data_attr
                    break
            img_attr_counts[chosen_attr] = img_attr_counts.get(chosen_attr, 0) + 1
        if img_hits > 0:
            attr = max(img_attr_counts.items(), key=lambda x: x[1])[0]
            sm.listing_image = SelectorEntry(
                selector=f"{item_sel} img", attribute=attr,
                reliability=img_hits / n,
            )
            sm.image_attr = attr
        return sm

    def _scan_jsonld_types(self, soup: BeautifulSoup) -> List[str]:
        """Lit rapidement les @type JSON-LD présents dans la page (pour détection profil)."""
        types: List[str] = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
                items = data if isinstance(data, list) else [data]
                for it in items:
                    t = it.get("@type", "") if isinstance(it, dict) else ""
                    if isinstance(t, list):
                        types.extend(str(x) for x in t)
                    elif t:
                        types.append(str(t))
            except (json.JSONDecodeError, TypeError, AttributeError):
                continue
        return types

    def _detect_detail_selectors(self, detail_url: str, analysis: SiteAnalysis) -> None:
        try:
            resp = self.session.get(detail_url, timeout=15)
            if resp.status_code != 200:
                return
            soup = BeautifulSoup(resp.text, "lxml")

            h1 = soup.find("h1")
            if h1:
                sel = self._element_to_selector(h1) or "h1"
                if not analysis.selectors.detail_name.selector:
                    analysis.selectors.detail_name = SelectorEntry(
                        selector=sel, reliability=1.0,
                        sample_values=[h1.get_text(strip=True)[:100]],
                    )

            price_candidates = soup.select(
                ".price, .prix, .product-price, .pg-vehicle-price, "
                "[itemprop='price'], .woocommerce-Price-amount"
            )
            if price_candidates:
                sel = self._element_to_selector(price_candidates[0])
                if not analysis.selectors.detail_price.selector:
                    analysis.selectors.detail_price = SelectorEntry(
                        selector=sel, reliability=1.0,
                        sample_values=[price_candidates[0].get_text(strip=True)[:50]],
                    )

            img = soup.select_one(
                ".product-cover img, .main-image img, .pg-vehicle-image, "
                ".gallery img, [itemprop='image'], .product-image img"
            )
            if img:
                attr = "src"
                for da in ["data-src", "data-lazy-src"]:
                    if img.get(da):
                        attr = da
                        break
                if not analysis.selectors.detail_image.selector:
                    analysis.selectors.detail_image = SelectorEntry(
                        selector=self._element_to_selector(img) or "img",
                        attribute=attr, reliability=1.0,
                    )
                    analysis.selectors.image_attr = attr

            # Détection des champs spécifiques au DomainProfile (extra_fields)
            for field_spec in self.profile.fields:
                # On saute les champs déjà mappés sur les attributs auto-spécifiques
                if field_spec.name in ("name", "prix", "marque", "modele", "annee",
                                       "kilometrage", "vin", "couleur", "image",
                                       "description"):
                    continue
                if field_spec.name in analysis.selectors.extra_fields:
                    continue
                for hint in field_spec.css_hints:
                    try:
                        el = soup.select_one(hint)
                    except Exception:
                        continue
                    if el and el.get_text(strip=True):
                        analysis.selectors.extra_fields[field_spec.name] = SelectorEntry(
                            selector=hint, reliability=0.7,
                            sample_values=[el.get_text(strip=True)[:80]],
                        )
                        break

        except Exception:
            pass

    def _detect_json_ld(self, detail_urls: List[str], analysis: SiteAnalysis) -> None:
        # Types pertinents pour le profil + types généraux toujours acceptés
        relevant_types = set(self.profile.jsonld_types) | {
            "Product", "Vehicle", "Car", "MotorizedBicycle",
            "JobPosting", "RealEstateListing", "Residence",
        }
        for url in detail_urls:
            try:
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    continue
                soup = BeautifulSoup(resp.text, "lxml")
                for script in soup.find_all("script", type="application/ld+json"):
                    try:
                        data = json.loads(script.string or "")
                        items = data if isinstance(data, list) else [data]
                        for item in items:
                            if not isinstance(item, dict):
                                continue
                            t = item.get("@type", "")
                            if isinstance(t, list):
                                t = t[0] if t else ""
                            if t in relevant_types:
                                analysis.json_ld_available = True
                                analysis.json_ld_type = t
                                self._log(f"    JSON-LD @type={t} trouvé")
                                return
                            if isinstance(item.get("offers"), dict):
                                analysis.json_ld_available = True
                                analysis.json_ld_type = t or "WithOffers"
                                return
                    except (json.JSONDecodeError, TypeError):
                        continue
            except Exception:
                continue

    def _detect_price_display_mode(self, analysis: SiteAnalysis) -> None:
        total, visible, call = 0, 0, 0
        pages_with_products = [lp for lp in analysis.listing_pages if lp.estimated_products > 0]
        for lp in pages_with_products[:2]:
            try:
                resp = self.session.get(lp.url, timeout=15)
                if resp.status_code != 200:
                    continue
                soup = BeautifulSoup(resp.text, "lxml")
                items = soup.select(
                    analysis.selectors.listing_item.selector or
                    "article, .product, .product-miniature, .product-card, .vehicle-card, .item"
                )
                for item in items[:20]:
                    total += 1
                    text = item.get_text(separator=" ", strip=True)
                    if re.search(r"\d[\d\s,.]*\$|\$[\d\s,.]+", text):
                        visible += 1
                    elif CALL_FOR_PRICE_PATTERNS.search(text):
                        call += 1
            except Exception:
                continue

        self._log(f"      prix check: {total} items, {visible} avec prix visible, {call} sur demande")
        if total == 0:
            analysis.price_display_mode = PriceDisplayMode.NONE
        elif visible / total >= 0.8:
            analysis.price_display_mode = PriceDisplayMode.VISIBLE
        elif call / total >= 0.5:
            analysis.price_display_mode = PriceDisplayMode.CALL_FOR_PRICE
        elif visible > 0:
            analysis.price_display_mode = PriceDisplayMode.MIXED
        else:
            analysis.price_display_mode = PriceDisplayMode.NONE

    # ------------------------------------------------------------------
    # 1.6 Anti-bot, timing, warm-up
    # ------------------------------------------------------------------

    def _detect_anti_bot(self, analysis: SiteAnalysis, url: str) -> None:
        try:
            self._log("    Check headers anti-bot...")
            resp = self.session.get(url, timeout=15)
            headers_lower = {k.lower(): v for k, v in resp.headers.items()}

            if "cf-ray" in headers_lower:
                if resp.status_code == 403 or "challenge" in resp.text.lower()[:2000]:
                    analysis.anti_bot = "cloudflare"
                    self._log("    Anti-bot Cloudflare détecté")
                    return
                self._log("    cf-ray présent mais pas de challenge (Cloudflare passif)")
            if "x-datadome" in headers_lower:
                analysis.anti_bot = "datadome"
                self._log("    Anti-bot Datadome détecté")
                return

            self._log("    Test timing (5 requêtes)...")
            times = []
            for i in range(5):
                t0 = time.time()
                r = self.session.get(url, timeout=20)
                ms = (time.time() - t0) * 1000
                times.append(ms)
                self._log(f"      Requête {i+1}/5: {r.status_code} en {ms:.0f}ms")
                if r.status_code in (403, 429):
                    analysis.anti_bot = "rate_limit"
                    self._log("    Rate limiting détecté")
                    return

            analysis.avg_response_time_ms = sum(times) / len(times)
            self._log(f"    Temps moyen: {analysis.avg_response_time_ms:.0f}ms")
        except Exception as e:
            self._log(f"    Erreur anti-bot check: {type(e).__name__}: {e}")

    def _detect_warm_up(self, analysis: SiteAnalysis, url: str) -> None:
        """Vérifie si le site nécessite un warm-up (visite homepage d'abord)."""
        if not analysis.listing_pages:
            return
        test_url = analysis.listing_pages[0].url
        try:
            fresh_session = requests.Session()
            fresh_session.headers.update(self.session.headers)
            r1 = fresh_session.get(test_url, timeout=15, allow_redirects=True)
            final1 = r1.url

            fresh_session2 = requests.Session()
            fresh_session2.headers.update(self.session.headers)
            fresh_session2.get(url, timeout=15)
            r2 = fresh_session2.get(test_url, timeout=15, allow_redirects=True)
            final2 = r2.url

            if final1 != final2 or abs(len(r1.text) - len(r2.text)) > 1000:
                analysis.warm_up_required = True
                self._log("    Warm-up session nécessaire")
        except Exception:
            pass

    # ------------------------------------------------------------------
    # 1.7 Encodage et langue
    # ------------------------------------------------------------------

    def _detect_encoding_language(self, analysis: SiteAnalysis, html: str,
                                  soup: BeautifulSoup, url: str) -> None:
        for pattern, _ in MOJIBAKE_PATTERNS:
            if pattern in html:
                analysis.needs_mojibake_fix = True
                self._log("    Mojibake détecté dans le HTML")
                break

        html_tag = soup.find("html")
        lang = html_tag.get("lang", "") if html_tag else ""
        if lang:
            analysis.language_versions[lang[:2]] = url

        for link in soup.find_all("link", rel="alternate"):
            hl = link.get("hreflang", "")
            href = link.get("href", "")
            if hl and href:
                analysis.language_versions[hl[:2]] = urljoin(url, href)

        fr_links = soup.find_all("a", href=True)
        for a in fr_links:
            href = a.get("href", "")
            if "/fr/" in href or "/fr" == href.rstrip("/")[-3:]:
                analysis.language_versions["fr"] = urljoin(url, href)
                break

        if "#/" in url or "#!/" in url:
            analysis.needs_playwright = True
            self._log("    URLs hash-based détectées, Playwright requis")

        parsed = urlparse(url)
        if any(part.startswith("#") for part in parsed.path.split("/")):
            analysis.needs_playwright = True

    # ------------------------------------------------------------------
    # 1.8 Persistance
    # ------------------------------------------------------------------

    def _save(self, analysis: SiteAnalysis) -> None:
        path = ANALYSIS_DIR / f"{analysis.slug}_analysis.json"
        try:
            analysis.save(path)
            self._log(f"    Analyse sauvegardée : {path}")
        except Exception as e:
            self._log(f"    Erreur sauvegarde : {e}")

    # ------------------------------------------------------------------
    # Utilitaires
    # ------------------------------------------------------------------

    def _render_with_playwright(
        self, url: str, *, capture_for_intercept: bool = False,
    ) -> Optional[str]:
        """Rend une page via le BrowserAgent partagé (stealth + DCL-first).
        Si capture_for_intercept=True, mémorise les réponses JSON pour que
        l'étape 1.5 puisse les rejouer sans recharger la page.
        Retourne None si Playwright indisponible ou erreur."""
        agent = self._get_browser_agent()
        if agent is None:
            return None

        try:
            result = agent.render(
                url,
                capture_responses=capture_for_intercept,
            )
        except Exception as e:
            self._log(f"    Erreur BrowserAgent: {type(e).__name__}: {e}")
            return None

        if not result.success:
            if result.error:
                self._log(f"    Erreur Playwright goto: {result.error}")
            return None

        if capture_for_intercept:
            self._home_render_cache[url] = {
                "html": result.html,
                "captured_responses": result.captured_responses,
                "final_url": result.final_url,
            }

        return result.html

    def _fetch_homepage(self, url: str) -> Tuple[Optional[str], dict, List[float]]:
        times: List[float] = []
        try:
            t0 = time.time()
            resp = self.session.get(url, timeout=20, allow_redirects=True)
            elapsed_ms = (time.time() - t0) * 1000
            times.append(elapsed_ms)

            self._final_url = resp.url
            if resp.url != url:
                self._log(f"    Redirect: {url} -> {resp.url}")

            self._log(f"    HTTP {resp.status_code} en {elapsed_ms:.0f}ms, "
                      f"{len(resp.text)} chars, final_url={resp.url[:80]}")
            if resp.status_code != 200:
                self._log(f"    ERREUR: status {resp.status_code}")
                return None, {}, times

            has_cookie_banner = "cookie" in resp.text.lower()[:5000]
            if has_cookie_banner:
                self._log("    Bannière cookie détectée dans le HTML")

            return resp.text, dict(resp.headers), times
        except Exception as e:
            self._log(f"    ERREUR fetch homepage: {type(e).__name__}: {e}")
            return None, {}, times

    def _guess_inventory_urls(self, analysis: SiteAnalysis) -> List[str]:
        """Devine des URLs d'inventaire pour les sites SPA sans listing detecte."""
        base = analysis.site_url.rstrip("/")
        parsed = urlparse(base)
        base_origin = f"{parsed.scheme}://{parsed.netloc}"

        candidates = [
            f"{base_origin}/new/inventory.html",
            f"{base_origin}/used/search.html",
            f"{base_origin}/new/search.html",
            f"{base_origin}/en/new/inventory/",
            f"{base_origin}/en/used/inventory/",
            f"{base_origin}/fr/neuf/inventaire/",
            f"{base_origin}/fr/usage/inventaire/",
            f"{base_origin}/inventory/",
            f"{base_origin}/inventaire/",
            f"{base_origin}/en/inventory/",
            f"{base_origin}/fr/inventaire-neuf/",
            base,
        ]

        valid = []
        for url in candidates:
            try:
                resp = self.session.head(url, timeout=8, allow_redirects=True)
                if resp.status_code == 200:
                    valid.append(url)
                    if len(valid) >= 3:
                        break
            except Exception:
                continue

        if not valid:
            valid = [base]

        self._log(f"    URLs inventaire devinées: {valid}")
        return valid

    def _generate_slug(self, analysis: SiteAnalysis) -> str:
        # Fallback en cascade : domain (peuplé depuis urlparse de l'URL initiale)
        # → netloc parsé depuis site_url → site_url brute. Évite "unknown-site"
        # qui collisionne entre tous les runs ratés en parallèle.
        domain = analysis.domain
        if not domain and analysis.site_url:
            domain = urlparse(analysis.site_url).netloc.replace("www.", "")
        if not domain and analysis.site_url:
            domain = analysis.site_url
        slug = re.sub(r"\.(com|ca|net|org|fr|qc\.ca)$", "", domain or "")
        slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")
        return slug or "unknown-site"

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [SiteAnalyzer] {msg}")
