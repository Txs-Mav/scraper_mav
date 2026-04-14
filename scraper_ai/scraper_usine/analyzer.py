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

from .models import (
    DetectedAPI, ListingPage, PriceDisplayMode,
    SelectorEntry, SelectorMap, SiteAnalysis,
)
from .platforms import (
    detect_platform, detect_iframe_inventory, probe_sitemap,
)

ANALYSIS_DIR = Path(__file__).resolve().parent.parent.parent / "scraper_cache" / "analysis"

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
    """Analyse un site de concessionnaire et produit un SiteAnalysis."""

    def __init__(self, *, use_playwright: bool = True, verbose: bool = True):
        self.verbose = verbose
        self.use_playwright = use_playwright
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "fr-CA,fr;q=0.9,en-US;q=0.7,en;q=0.5",
        })

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

        # Slug + nom du site
        analysis.slug = self._generate_slug(analysis)
        if not analysis.site_name:
            title = soup.find("title")
            analysis.site_name = title.get_text(strip=True) if title else analysis.domain

        analysis.analysis_timestamp = datetime.now(timezone.utc).isoformat()

        elapsed = time.time() - start
        self._log(f"Analyse terminée en {elapsed:.1f}s — {len(analysis.listing_pages)} listings, "
                  f"{len(analysis.sitemap_urls)} URLs sitemap, {len(analysis.detected_apis)} APIs, "
                  f"prix={analysis.price_display_mode.value}")

        # 1.9 Persistance
        self._save(analysis)
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

        domain = analysis.domain
        listing_candidates = []
        for link_url, link_text in nav_links:
            text_lower = link_text.lower()
            path_lower = urlparse(link_url).path.lower()

            if self._is_excluded_path(path_lower):
                continue

            matched = False
            for kw in NAV_KEYWORDS:
                if kw in text_lower or kw in path_lower:
                    matched = True
                    break
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
        max_consecutive_zeros = 8

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

    @staticmethod
    def _is_excluded_path(path: str) -> bool:
        excludes = [
            "/contact", "/nous-contacter", "/about", "/a-propos",
            "/content/", "/blog", "/nouvelles", "/news",
            "/emploi", "/carrieres", "/careers",
            "/politique", "/privacy", "/terms", "/conditions",
            "/evenement", "/event",
            "/heures", "/hours",
            "/login", "/compte", "/account", "/panier", "/cart",
            "/temoignages", "/testimonials", "/reviews",
            "/directions", "/map", "/carte",
            "/faq", "/aide", "/help",
            "/gallery", "/galerie", "/photos",
            "/media", "/presse", "/press",
        ]
        path_lower = path.lower()
        for ex in excludes:
            if ex in path_lower:
                return True

        if path_lower.rstrip("/") in ("", "/", "/fr", "/en", "/eng", "/fra"):
            return True

        return False

    def _discover_nav_links(self, soup: BeautifulSoup, base_url: str) -> List[Tuple[str, str]]:
        domain = urlparse(base_url).netloc
        links: List[Tuple[str, str]] = []
        seen = set()

        for a in soup.select("nav a, header a, .menu a, .navbar a, #menu a"):
            href = a.get("href", "")
            if not href or href.startswith("#") or href.startswith("javascript:"):
                continue
            full = urljoin(base_url, href)
            if urlparse(full).netloc.replace("www.", "") != domain.replace("www.", ""):
                continue
            if full not in seen:
                seen.add(full)
                links.append((full, a.get_text(strip=True)))

        return links

    def _classify_listing(self, text: str, url: str) -> Tuple[str, str]:
        combined = (text + " " + url).lower()
        if any(w in combined for w in [
            "occasion", "used", "usagé", "usages", "pre-owned", "preowned",
            "certified", "certifié", "/used/", "/usage/", "/occasion/",
        ]):
            return "occasion", "vehicules_occasion"
        if any(w in combined for w in [
            "neuf", "new", "inventaire", "inventory", "/new/", "/neuf/",
        ]):
            return "neuf", "inventaire"
        if "catalogue" in combined or "catalog" in combined:
            return "neuf", "catalogue"
        return "neuf", "inventaire"

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
            items = soup.select(
                "article, .product, .product-miniature, .product-card, "
                ".vehicle-card, .inventory-item, .pg-vehicle-card, .item"
            )
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

        spa_signals = 0
        spa_reasons = []

        if "__NEXT_DATA__" in html_str or "_next/static" in html_lower:
            spa_signals += 2
            spa_reasons.append("Next.js")

        if "ng-app" in html_lower or "ng-controller" in html_lower or 'angular' in html_lower:
            spa_signals += 2
            spa_reasons.append("Angular")

        if "__react" in html_lower or "react-root" in html_lower or "data-reactroot" in html_lower:
            spa_signals += 2
            spa_reasons.append("React")

        if "__vue" in html_lower or "data-v-" in html_lower:
            spa_signals += 2
            spa_reasons.append("Vue.js")

        if "d2cmedia" in html_lower or "edealer" in html_lower:
            spa_signals += 2
            spa_reasons.append("D2C/eDealer")

        if "dealer.com" in html_lower and "ddc-" in html_lower:
            spa_signals += 2
            spa_reasons.append("Dealer.com")

        visible_text = soup.get_text(separator=" ", strip=True)
        html_size = len(html_str)
        text_ratio = len(visible_text) / max(html_size, 1)
        if html_size > 200000 and text_ratio < 0.05:
            spa_signals += 1
            spa_reasons.append(f"HTML lourd ({html_size//1000}K) mais peu de texte ({text_ratio:.1%})")

        scripts = soup.find_all("script", src=True)
        bundle_scripts = [s["src"] for s in scripts if any(w in s["src"].lower() for w in ["bundle", "chunk", "main.", "app."])]
        if len(bundle_scripts) >= 3:
            spa_signals += 1
            spa_reasons.append(f"{len(bundle_scripts)} scripts bundle")

        if spa_signals >= 2:
            analysis.needs_playwright = True
            self._log(f"    SPA détecté: {', '.join(spa_reasons)}")

        load_more_patterns = [
            "charger plus", "load more", "afficher plus",
            "show more", "charger la suite",
        ]
        for btn in soup.find_all("button"):
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
                    if urlparse(href).netloc.replace("www.", "") != domain.replace("www.", ""):
                        continue
                    if href == lp.url:
                        continue
                    path = urlparse(href).path.lower()
                    if any(kw in path for kw in ["/neuf/", "/occasion/", "/usage/",
                                                   "/inventory/", "/inventaire/", "/product/",
                                                   "/vehicle/", "/vehicule/", "/detail/"]):
                        urls.append(href)
                    elif re.search(r'/\d+-[a-z]', path) and len(path) > 10:
                        urls.append(href)
                if urls:
                    return list(dict.fromkeys(urls))[:5]
            except Exception:
                continue
        return []

    def _detect_listing_selectors(self, listing_url: str) -> Optional[SelectorMap]:
        try:
            resp = self.session.get(listing_url, timeout=15)
            if resp.status_code != 200:
                return None
            soup = BeautifulSoup(resp.text, "lxml")

            candidates = [
                ("article.product-miniature", "h3 a, .product-title a"),
                ("li.product", "a.woocommerce-LoopProduct-link, h2 a"),
                (".product-card", "a, h3 a"),
                (".vehicle-card", "a"),
                (".pg-vehicle-card", "a"),
                (".inventory-item", "a"),
                (".item", "a"),
            ]
            for item_sel, link_sel in candidates:
                items = soup.select(item_sel)
                if len(items) >= 2:
                    sm = SelectorMap()
                    sm.listing_item = SelectorEntry(selector=item_sel, reliability=len(items) / max(len(items), 1))
                    sm.listing_link = SelectorEntry(selector=f"{item_sel} {link_sel}", reliability=1.0)

                    price_text = items[0].get_text()
                    if re.search(r"\d[\d\s,.]*\$|\$[\d\s,.]+", price_text):
                        sm.listing_price = SelectorEntry(selector=f"{item_sel} .price, {item_sel} .prix", reliability=0.5)

                    img = items[0].find("img")
                    if img:
                        attr = "src"
                        for data_attr in ["data-src", "data-lazy-src", "data-original"]:
                            if img.get(data_attr):
                                attr = data_attr
                                break
                        sm.listing_image = SelectorEntry(selector=f"{item_sel} img", attribute=attr, reliability=1.0)
                        sm.image_attr = attr

                    return sm
        except Exception:
            pass
        return None

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

        except Exception:
            pass

    def _detect_json_ld(self, detail_urls: List[str], analysis: SiteAnalysis) -> None:
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
                            t = item.get("@type", "")
                            if t in ("Product", "Vehicle", "Car", "MotorizedBicycle"):
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
        domain = analysis.domain
        slug = re.sub(r"\.(com|ca|net|org|fr|qc\.ca)$", "", domain)
        slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")
        return slug or "unknown-site"

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [SiteAnalyzer] {msg}")
