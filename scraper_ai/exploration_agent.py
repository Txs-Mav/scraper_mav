"""
Agent d'exploration qui utilise Gemini pour découvrir URLs et extraire infos produits
Étape 1 du nouveau flux : Exploration + Extraction Gemini
"""
import re
import time
from typing import Dict, List, Optional, Any, Tuple
from urllib.parse import urlparse
from bs4 import BeautifulSoup

try:
    from .gemini_client import GeminiClient
    from .ai_tools import AITools
    from .config import EXTRACTION_SCHEMA
except ImportError:
    from gemini_client import GeminiClient
    from ai_tools import AITools
    from config import EXTRACTION_SCHEMA


class ExplorationAgent:
    """Agent qui explore un site et extrait les infos produits via Gemini"""

    def __init__(self):
        self.gemini_client = GeminiClient()
        self.ai_tools = None

    def explore_and_extract(self, url: str, initial_html: Optional[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        """Explore le site et extrait les infos produits via Gemini

        Args:
            url: URL de base du site
            initial_html: HTML initial de la page d'accueil (optionnel)
            inventory_only: Si True, exclut les pages catalogue/showroom

        Returns:
            Dictionnaire avec:
            - product_urls: Liste de toutes les URLs de produits
            - html_samples: Dictionnaire {url: html} pour échantillons
            - extracted_products: Liste des produits extraits par Gemini
            - detected_selectors: Dictionnaire des sélecteurs CSS détectés
            - site_structure: Informations sur la structure du site
        """
        print(f"\n{'='*60}")
        print(f"🔍 ÉTAPE 1: EXPLORATION ET EXTRACTION GEMINI")
        print(f"{'='*60}")
        print(f"🌐 Site: {url}\n")

        # Initialiser les outils AI
        self.ai_tools = AITools(url)

        # 1. DÉCOUVRIR TOUTES LES URLs DE PRODUITS
        print(f"📍 Découverte des URLs de produits...")
        product_urls = self._discover_product_urls(
            url, initial_html, inventory_only=inventory_only)
        print(f"   ✅ {len(product_urls)} URLs de produits découvertes\n")

        # 2. RÉCUPÉRER LE HTML DE CHAQUE URL PRODUIT
        print(f"📥 Récupération du HTML des pages de produits...")
        html_samples = self._fetch_product_html(product_urls)
        print(f"   ✅ {len(html_samples)} pages HTML récupérées\n")

        # 3. UTILISER GEMINI POUR EXTRAIRE LES INFOS PRODUITS
        print(f"🤖 Extraction des infos produits via Gemini...")
        extracted_products, detected_selectors = self._extract_with_gemini(
            html_samples, url)
        print(f"   ✅ {len(extracted_products)} produits extraits\n")

        # 4. DÉTECTER LES SÉLECTEURS CSS AUTOMATIQUEMENT
        print(f"🎯 Détection automatique des sélecteurs CSS...")
        detected_selectors = self._detect_selectors(
            html_samples, extracted_products, detected_selectors)
        print(f"   ✅ {len(detected_selectors)} sélecteurs détectés\n")

        # 5. ANALYSER LA STRUCTURE DU SITE
        site_structure = self._analyze_site_structure(
            url, html_samples, product_urls)

        return {
            'product_urls': product_urls,
            'html_samples': html_samples,
            'extracted_products': extracted_products,
            'detected_selectors': detected_selectors,
            'site_structure': site_structure
        }

    def _discover_product_urls(self, url: str, initial_html: Optional[str] = None, inventory_only: bool = False) -> List[str]:
        """Découvre toutes les URLs de produits (sitemap, pagination, navigation)"""
        self._inventory_only = inventory_only
        tools = self.ai_tools

        # Récupérer HTML initial si non fourni
        # Utilise max_retries=3 pour résister aux erreurs DNS/réseau transitoires
        # Utilise skip_visited_check=True pour le fallback Selenium (sinon l'URL
        # est déjà marquée comme visitée après le premier essai)
        if not initial_html:
            initial_html = tools.get(url, use_selenium=False, max_retries=3)
            if not initial_html or len(initial_html) < 1000:
                initial_html = tools.get(url, use_selenium=True, max_retries=2,
                                         skip_visited_check=True)

        all_product_urls = []

        # 1. Essayer le sitemap (priorité absolue)
        print(f"      🗺️ Recherche du sitemap...")
        sitemap_urls = tools.get_sitemap_urls(url)
        if sitemap_urls:
            print(
                f"         ✅ {len(sitemap_urls)} URLs trouvées dans le sitemap")
            # Limite de sécurité (augmentée pour inventaires complets)
            all_product_urls.extend(sitemap_urls[:2000])
        else:
            print(f"         ⚠️ Aucun sitemap trouvé")

        # 2. Détecter la pagination
        print(f"      📑 Détection de la pagination...")
        pagination = tools.detect_pagination(initial_html, url)
        if pagination:
            print(
                f"         ✅ Pagination détectée: {pagination.get('pattern', 'N/A')}")
            # Parcourir les pages de pagination
            page = 1
            consecutive_empty = 0
            max_pages = 200
            max_urls = 2000

            use_selenium_for_pages = False
            short_html_streak = 0

            while page <= max_pages and len(all_product_urls) < max_urls:
                try:
                    page_url = tools.build_pagination_url(
                        url, pagination, page)
                    page_html = tools.get(page_url,
                                          use_selenium=use_selenium_for_pages)
                    if not page_html or len(page_html) < 1000:
                        if not use_selenium_for_pages:
                            short_html_streak += 1
                            if short_html_streak >= 3:
                                print(f"         🔄 HTML trop court 3x → switch Selenium")
                                use_selenium_for_pages = True
                                short_html_streak = 0
                                continue
                        consecutive_empty += 1
                        if consecutive_empty >= 3:
                            break
                        page += 1
                        continue
                    else:
                        short_html_streak = 0

                    page_product_urls = tools.discover_product_urls(
                        page_html, page_url)
                    if page_product_urls:
                        all_product_urls.extend(page_product_urls)
                        consecutive_empty = 0
                    else:
                        consecutive_empty += 1
                        if consecutive_empty >= 3:
                            break

                    page += 1
                    time.sleep(0.3)
                except Exception as e:
                    print(f"         ⚠️ Erreur page {page}: {e}")
                    consecutive_empty += 1
                    if consecutive_empty >= 3:
                        break
                    page += 1
        else:
            print(f"         ⚠️ Aucune pagination détectée")
            # Vérifier si le site utilise infinite scroll / lazy loading
            if initial_html and tools.detect_infinite_scroll(initial_html):
                print(f"         🔄 Infinite scroll détecté → chargement avec Selenium...")
                scroll_html = tools.scroll_and_collect(url)
                if scroll_html and len(scroll_html) > len(initial_html or ''):
                    scroll_urls = tools.discover_product_urls(scroll_html, url)
                    if scroll_urls:
                        all_product_urls.extend(scroll_urls)
                        print(f"         ✅ +{len(scroll_urls)} URLs via infinite scroll")

        # Estimer le nombre de VRAIS produits (pas le total brut du sitemap)
        # Le sitemap peut contenir des pages blog/service/contact → gonfle le total
        _product_markers = [
            '/inventaire/', '/inventory/', '/product', '/produit',
            '/moto', '/vehicle', '/vehicule', 'a-vendre', 'for-sale',
            '/catalogue/', '/catalog/', '/occasion/', '/used/', '/pre-owned/',
            '/motos/', '/motorcycles/', '/scooter', '/quad',
        ]
        product_url_estimate = sum(
            1 for u in all_product_urls
            if any(m in u.lower() for m in _product_markers)
        )
        print(f"      📊 Estimation: ~{product_url_estimate} URLs produit sur {len(all_product_urls)} URLs brutes")

        # 3. Découvrir depuis les liens de la page d'accueil
        if product_url_estimate < 200:
            print(f"      🔗 Découverte depuis les liens...")
            discovered_urls = tools.discover_product_urls(initial_html, url)
            all_product_urls.extend(discovered_urls)

        # 4. Explorer les pages de listage (ex: /usage/motocyclette/inventaire/)
        #    pour découvrir les fiches produit (ex: .../triumph-scrambler-2022-a-vendre-ins00023/)
        #    IMPORTANT: Toujours explorer pour s'assurer d'avoir TOUS les produits
        if product_url_estimate < 200:
            candidate_listing_urls = self._get_listing_page_candidates(
                all_product_urls, url
            )
            if not candidate_listing_urls:
                candidate_listing_urls = self._get_listing_page_candidates(
                    tools.discover_product_urls(initial_html, url), url
                )
            if candidate_listing_urls:
                print(
                    f"      📂 Exploration des pages listage ({len(candidate_listing_urls)} pages)...")
                for listing_url in candidate_listing_urls[:8]:
                    try:
                        listing_html = tools.get(
                            listing_url, use_selenium=False)
                        if listing_html and len(listing_html) > 2000:
                            extra = tools.discover_product_urls(
                                listing_html, listing_url)
                            all_product_urls.extend(extra)

                            # Suivre la pagination sur cette page de listage
                            listing_pagination = tools.detect_pagination(listing_html, listing_url)
                            if listing_pagination:
                                print(f"         📑 Pagination détectée sur {listing_url[:60]}...")
                                lp_page = 2
                                lp_consecutive_empty = 0
                                while lp_page <= 50 and len(all_product_urls) < 2000:
                                    try:
                                        lp_url = tools.build_pagination_url(
                                            listing_url, listing_pagination, lp_page)
                                        lp_html = tools.get(lp_url, use_selenium=False)
                                        if not lp_html or len(lp_html) < 1000:
                                            lp_consecutive_empty += 1
                                            if lp_consecutive_empty >= 3:
                                                break
                                            lp_page += 1
                                            continue
                                        lp_extra = tools.discover_product_urls(lp_html, lp_url)
                                        if lp_extra:
                                            all_product_urls.extend(lp_extra)
                                            lp_consecutive_empty = 0
                                            print(f"         📄 Page {lp_page}: +{len(lp_extra)} URLs")
                                        else:
                                            lp_consecutive_empty += 1
                                            if lp_consecutive_empty >= 3:
                                                break
                                        lp_page += 1
                                        time.sleep(0.3)
                                    except Exception:
                                        lp_consecutive_empty += 1
                                        if lp_consecutive_empty >= 3:
                                            break
                                        lp_page += 1

                            if len(all_product_urls) >= 2000:
                                break
                    except Exception as e:
                        print(
                            f"      ⚠️ Erreur page listage {listing_url[:60]}...: {e}")

        # Dédupliquer
        normalized_urls_dict = {}
        for url_item in all_product_urls:
            normalized = tools.normalize_url_for_dedup(url_item)
            if normalized not in normalized_urls_dict or len(url_item) < len(normalized_urls_dict[normalized]):
                normalized_urls_dict[normalized] = url_item

        # Dédupliquer par modèle+année (ignorer les couleurs)
        # IMPORTANT: Les URLs avec un code de stock unique (unité physique)
        # ne doivent PAS être fusionnées — chaque code = un véhicule distinct
        stock_code_pattern = re.compile(
            r'(?:ins|inv|mj)\d{3,}'
            r'|[/-][tu]\d{4,}'
            r'|a-vendre-[a-z]\d{3,}'
            r'|ms[-_]p?\d+[-_]\d+'
            r'|ms[-_]w[-_]?get[-_]?\d+'
            r'|stock[-_]?\d{3,}'
            r'|sku[-_]?\d+'
        )
        model_year_urls_dict = {}
        for url_item in normalized_urls_dict.values():
            url_lower = url_item.lower()
            stock_match = stock_code_pattern.search(url_lower)
            if stock_match:
                # URL avec code de stock unique → garder tel quel
                model_year_urls_dict[url_item] = url_item
            else:
                # URL sans code de stock → dédup par modèle+année
                model_year_key = tools.normalize_url_by_model_year(url_item)
                if model_year_key not in model_year_urls_dict:
                    model_year_urls_dict[model_year_key] = url_item

        unique_urls = list(model_year_urls_dict.values())
        print(f"      ✅ {len(unique_urls)} URLs uniques après déduplication")

        # Déduplication bilingue (FR/EN) : si le site a des versions FR et EN
        # du même produit, ne garder qu'une seule version pour éviter le double-scraping
        unique_urls = self._deduplicate_bilingual_urls(unique_urls)

        # ------------------------------------------------------------
        # Filtrage adaptatif (PRODUCTION):
        # Si inventory_only=True ET le site a des URLs d'inventaire → exclure catalogue
        # Si inventory_only=False → mode inclusif (inventaire + catalogue + occasion)
        # ------------------------------------------------------------
        inventory_likely = [
            u for u in unique_urls if self._looks_like_inventory_url(u)]

        # Activer le mode strict si le site a un nombre significatif
        # d'URLs d'inventaire ET un pattern structurel clair.
        # Seuil bas (50 URLs OU 15%) car même 200 URLs inventaire sur 1400
        # indiquent clairement une séparation catalogue/inventaire.
        INVENTORY_MIN_COUNT = 30
        INVENTORY_MIN_RATIO = 0.10
        total = len(unique_urls) or 1
        inv_ratio = len(inventory_likely) / total
        has_enough_inventory = (
            len(inventory_likely) >= INVENTORY_MIN_COUNT
            or (len(inventory_likely) >= 10 and inv_ratio >= INVENTORY_MIN_RATIO)
        )
        inventory_only_mode = getattr(
            self, '_inventory_only', False) and has_enough_inventory

        # Détecter les patterns d'inventaire spécifiques au site
        if inventory_only_mode:
            self._site_inventory_path_markers = self._detect_site_inventory_patterns(
                inventory_likely)
            if self._site_inventory_path_markers:
                print(
                    f"      🔑 Patterns d'inventaire du site détectés: {self._site_inventory_path_markers}")
        else:
            self._site_inventory_path_markers = set()

        if getattr(self, '_inventory_only', False) and not has_enough_inventory:
            print(
                f"      ⚠️ Mode inventaire demandé mais pas assez d'URLs inventaire: {len(inventory_likely)}/{total}"
                f" ({inv_ratio:.0%}) → fallback mode inclusif"
            )
        elif inventory_only_mode:
            print(
                f"      🎯 Mode INVENTAIRE STRICT: {len(inventory_likely)}/{total}"
                f" ({inv_ratio:.0%}) → exclusion des pages catalogue/showroom"
            )
        else:
            print(
                f"      🧭 Mode INCLUSIF: inventaire + catalogue + occasion"
                f" (inventaire-likely: {len(inventory_likely)}/{len(unique_urls)})"
            )

        # Filtrer les URLs invalides (pages non-produits)
        filtered_urls = []
        excluded_count = 0
        for url in unique_urls:
            if self._is_valid_product_url(url, inventory_only=inventory_only_mode):
                filtered_urls.append(url)
            else:
                excluded_count += 1
                if excluded_count <= 5:  # Afficher seulement les 5 premières exclusions
                    print(f"      🚫 URL exclue (non-produit): {url[:80]}...")

        if excluded_count > 5:
            print(f"      🚫 ... et {excluded_count - 5} autres URLs exclues")

        print(
            f"      ✅ {len(filtered_urls)} URLs de produits valides après filtrage")

        # Vérification: comparer avec le total affiché sur le site
        if initial_html:
            announced_total = self._extract_announced_total(initial_html)
            if announced_total and announced_total > len(filtered_urls) * 2:
                print(
                    f"      ⚠️ Le site annonce ~{announced_total} produits mais"
                    f" seulement {len(filtered_urls)} URLs trouvées"
                    f" → tentative de re-crawl avec Selenium"
                )
                scroll_html = tools.scroll_and_collect(url)
                if scroll_html:
                    extra = tools.discover_product_urls(scroll_html, url)
                    new_urls = [u for u in extra if u not in set(filtered_urls)]
                    if new_urls:
                        filtered_urls.extend(new_urls)
                        print(f"      ✅ +{len(new_urls)} URLs supplémentaires via Selenium")

        return filtered_urls

    def _extract_announced_total(self, html: str) -> int | None:
        """Cherche un indicateur du nombre total de produits affiché sur le site.

        Ex: "152 résultats", "Showing 1-20 of 152", "152 véhicules trouvés"
        """
        import re
        if not html:
            return None

        patterns = [
            r'(\d+)\s*(?:r[ée]sultats?|results?|produits?|items?|v[ée]hicules?|articles?)',
            r'(?:showing|affichage)\s+\d+\s*[-–]\s*\d+\s+(?:of|de|sur)\s+(\d+)',
            r'(?:total|found|trouv[ée]s?)\s*[:\s]*(\d+)',
            r'(\d+)\s*(?:found|trouv[ée]s?)',
        ]
        html_lower = html.lower()
        for pattern in patterns:
            match = re.search(pattern, html_lower)
            if match:
                total = int(match.group(1))
                if 10 < total < 50000:
                    return total
        return None

    def _looks_like_inventory_url(self, url: str) -> bool:
        """Heuristique: URL "inventaire-likely" (pour activer le mode strict).

        Objectif: détecter si le site expose des fiches d'inventaire réelles (IDs, stock, a-vendre, etc.).
        """
        import re

        url_lower = (url or "").lower()
        if not url_lower:
            return False

        # Patterns d'identifiants de produit (très fiables)
        product_id_patterns = [
            r'ins\d{3,}',      # ins00023, ins12345 (Morin Sports)
            r'inv\d{3,}',      # inv02011 (autres concessionnaires)
            r'[/-][tu]\d{4,}',  # /t96538/, /u00380/ (RPM, certains sites)
            r'vin[-_]?([a-hj-npr-z0-9]{8,})',  # VIN explicite
            r'\b[a-hj-npr-z0-9]{17}\b',        # VIN 17 caractères
            r'stock[-_ ]?\d{3,}',              # stock 12345
            r'sku[-_]?\d+',                    # sku123, sku-456
            r'ref[-_]?\d+',                    # ref123, ref_456
            r'p\d{4,}',                        # p12345 (ID produit)
            r'mj\d{2,}',                       # MVM ancien format: mj220, mj2207
            r'ms[-_]p?\d+[-_]\d+',             # Mathias: ms-p25-0001a
            r'a-vendre-[a-z]\d{3,}',           # MVM/PowerGo: a-vendre-k00228, a-vendre-c00597, etc.
        ]
        has_product_id = any(re.search(pattern, url_lower)
                             for pattern in product_id_patterns)
        if has_product_id:
            return True

        # Indicateur de catalogue (manufacturer feed) → PAS inventaire
        catalog_url_markers = ['w-get']
        if any(m in url_lower for m in catalog_url_markers):
            return False

        # Indicateurs de vente / inventaire dans l'URL (inclut occasion = inventaire usagé)
        inventory_markers = [
            'inventaire', 'inventory', 'for-sale', 'a-vendre', 'stock', 'en-stock',
            'disponible', 'in-stock', 'instock',
            'occasion', 'usage', 'used', 'pre-owned', 'usag',
            'd-occasion', 'vehicules-occasion',
        ]
        has_inventory_marker = any(m in url_lower for m in inventory_markers)

        # Dernier segment "détail" (contient souvent année/id)
        last_segment = url_lower.rstrip('/').split('/')[-1]
        looks_like_detail = any(ch.isdigit()
                                for ch in last_segment) and len(last_segment) > 10

        return has_inventory_marker and looks_like_detail

    def _is_valid_product_url(self, url: str, inventory_only: bool = False) -> bool:
        """Valide qu'une URL est bien une page de produit (adaptatif inventaire vs catalogue).

        - Si inventory_only=True: on exclut les URLs "catalogue-like" sauf si elles ont des signaux inventaire forts.
        - Si inventory_only=False: on accepte aussi les URLs "catalogue-like" quand le site n'expose pas d'inventaire clair.

        Args:
            url: URL à valider

        Returns:
            True si l'URL est une page de produit d'inventaire valide, False sinon
        """
        url_lower = url.lower()

        # NOTE: On ne hard-exclut pas "catalogue" car certains sites utilisent des chemins ambigus.
        # On s'en sert comme signal "catalogue-like" (exclu seulement si inventory_only=True).

        # Segments de chemin à exclure (pages non-produits)
        exclude_segments = [
            '/catalogue', '/catalog',
            '/service', '/service-', '/services', '/sav',
            '/article', '/articles', '/blog/', '/blogs/', '/blogue/',
            '/conseil', '/conseils', '/guide', '/guides',
            '/formation', '/formations', '/evenement', '/evenements',
            '/promotion', '/promotions', '/promo', '/promos',
            '/contact', '/about', '/a-propos', '/nous-joindre',
            '/politique', '/privacy', '/cgv', '/mentions-legales',
            '/cart', '/panier', '/checkout', '/paiement',
            '/login', '/connexion', '/register', '/inscription',
            '/account', '/compte', '/search', '/recherche',
            '/faq', '/aide', '/help', '/assistance',
            '/entretien', '/reparation', '/reparations', '/maintenance',
            '/tutoriel', '/tutoriels', '/news', '/actualite', '/actualites',
            '/event', '/events', '/ouverture', '/invitation',
            '/offre', '/offres', '/wishlist', '/favoris',
            '/team/', '/equipe/',
            '/sell-your-', '/vendez-votre-',
            '/carriere', '/careers', '/emploi',
            '/promotions/local-',
        ]

        # Vérifier si l'URL contient un segment d'exclusion
        for exclude_segment in exclude_segments:
            if exclude_segment in url_lower:
                # Exception : si c'est une promotion mais que l'URL contient aussi des mots-clés de produit
                if 'promo' in exclude_segment or 'promotion' in exclude_segment:
                    # Vérifier si c'est une page produit avec promotion (contient moto, vehicule, etc.)
                    product_indicators = [
                        'moto', 'vehicule', 'inventaire', 'vendre', 'a-vendre']
                    if any(indicator in url_lower for indicator in product_indicators):
                        continue  # C'est une page produit avec promotion, garder
                return False

        # INDIQUEURS STRICTS pour pages de DÉTAIL PRODUIT (pas listing)
        # Format type Morin Sports: /usage/motocyclette/inventaire/triumph-scrambler-2022-a-vendre-ins00023/
        # Ces patterns indiquent une VRAIE fiche produit, pas une page de listing
        import re

        # Patterns d'identifiants de produit (très fiables)
        product_id_patterns = [
            r'ins\d{3,}',      # ins00023, ins12345 (Morin Sports)
            r'inv\d{3,}',      # inv02011 (autres concessionnaires)
            r'[/-][tu]\d{4,}',  # /t96538/, /u00380/ (RPM, certains sites)
            r'p\d{4,}',        # p12345 (ID produit)
            r'sku[-_]?\d+',    # sku123, sku-456
            r'ref[-_]?\d+',    # ref123, ref_456
            r'mj\d{2,}',      # MVM ancien format: mj220, mj2207
            r'ms[-_]p?\d+[-_]\d+',  # Mathias occasion: ms-p25-0001a
            r'ms[-_]w[-_]?get[-_]?\d+',  # Mathias neuf: ms-w-get-171465
            r'a-vendre-[a-z]\d{3,}',  # MVM/PowerGo: a-vendre-k00228, etc.
        ]

        # Vérifier si l'URL contient un ID produit (très fiable pour détail)
        has_product_id = any(re.search(pattern, url_lower)
                             for pattern in product_id_patterns)

        # Patterns qui indiquent une page de détail (avec nom de produit dans l'URL)
        # Ex: /triumph-scrambler-2022-a-vendre-ins00023/
        detail_indicators = [
            'a-vendre', 'for-sale', 'a-vendre-', '-a-vendre',
            'fiche-', 'detail-', 'details-',
        ]
        has_detail_indicator = any(
            ind in url_lower for ind in detail_indicators)

        # Patterns qui indiquent une page de LISTING (à éviter pour extraction directe)
        # Ces URLs sont OK pour découvrir plus de produits mais pas pour extraction
        listing_only_patterns = [
            r'/inventaire/?$',           # Se termine par /inventaire/ ou /inventaire
            r'/inventory/?$',
            r'/neuf/?$',
            r'/usage/?$',
            r'/used/?$',
            r'/new/?$',
            r'\?page=',                  # Pagination
            r'\?make=',                  # Filtres
            r'\?category=',
        ]
        is_listing_page = any(re.search(pattern, url_lower)
                              for pattern in listing_only_patterns)

        # Si c'est une page de listing sans ID produit, c'est pas une page de détail
        if is_listing_page and not has_product_id:
            return False

        # INDIQUEURS pour pages d'INVENTAIRE (mais pas suffisant seuls)
        # Inclut les marqueurs d'occasion car les véhicules usagés sont aussi de l'inventaire
        inventory_indicators = [
            'inventaire', 'inventory', 'vendre',
            'stock', 'en-stock', 'disponible',
            'occasion', 'usage', 'used', 'pre-owned', 'usag',
        ]
        has_inventory_indicator = any(
            indicator in url_lower for indicator in inventory_indicators)

        # Signal "catalogue-like" (adaptatif)
        catalogue_keywords = ['catalogue', 'catalog',
                              'showroom', 'modele', 'model', 'gamme', 'range']
        has_catalogue_keyword = any(
            kw in url_lower for kw in catalogue_keywords)
        # pattern courant, pas universel
        showroom_pattern = r'/neuf/[^/]+/[^/]+/[^/]+/?$'
        looks_like_showroom = bool(re.search(showroom_pattern, url_lower))
        is_catalogue_like = (
            (has_catalogue_keyword or looks_like_showroom)
            and not has_product_id
            and not has_detail_indicator
            and not has_inventory_indicator
        )

        # Si le site a suffisamment d'inventaire détectable, on devient strict (inventaire seulement)
        if inventory_only and is_catalogue_like:
            return False

        # Filtrage adaptatif par patterns de site: si le site utilise des marqueurs
        # d'inventaire détectables (ex: /inventaire/), exclure les URLs qui n'ont
        # aucun de ces marqueurs ET aucun code de stock
        if inventory_only and not has_product_id and not has_detail_indicator:
            site_markers = getattr(self, '_site_inventory_path_markers', set())
            if site_markers:
                url_path = urlparse(url).path.lower()
                has_site_marker = any(marker in url_path for marker in site_markers)
                if not has_site_marker and not has_inventory_indicator:
                    return False

        # Mots-clés qui indiquent une page de produit (fallback)
        # Inclut modèles connus (ex: widescape = CFMoto) pour améliorer la découverte
        product_indicators = [
            'moto', 'motorcycle', 'motocyclette', 'vehicule', 'vehicle',
            'quad', 'atv', 'vtt', 'motoneige', 'snowmobile',
            'cote-a-cote', 'side-by-side', 'sxs', 'utv',
            'motocross', 'sportive', 'cruiser', 'touring', 'double-usage',
            'enduro', 'supermoto', 'hors-route', 'routiere', 'scooter',
            'motomarine', 'watercraft', 'pwc', 'ponton', 'pontoon',
            'cforce', 'widescape', 'outlander', 'mxz', 'spark',
            'produit', 'product', 'detail', 'details', 'fiche',
            'inventaire', 'inventory', 'neuf', 'usage',
        ]

        has_product_indicator = has_inventory_indicator or any(
            indicator in url_lower for indicator in product_indicators)

        # Vérifier le format de l'URL - les pages de DÉTAIL ont:
        # - Un identifiant unique (ex: ins00023, t96538)
        # - Un nom de modèle dans le dernier segment
        # - Plus de segments que les pages listing
        url_parts = url.strip('/').split('/')
        last_segment = url_parts[-1] if url_parts else ''

        # Critère strict: le dernier segment doit contenir des infos produit
        # (pas juste "inventaire" ou un filtre)
        has_product_in_last_segment = (
            # Contient des chiffres (année, ID, etc.)
            any(char.isdigit() for char in last_segment) and
            # Pas juste un numéro de page
            not re.match(r'^(page|p)?\d+$', last_segment) and
            # A une certaine longueur (nom de modèle)
            len(last_segment) > 10
        )

        # LOGIQUE FINALE:
        # - Si ID produit trouvé → TOUJOURS accepter (très fiable)
        # - Si indicateur de détail → accepter si a aussi indicateur produit
        # - Mode inventaire strict: exiger un product_id ou detail_indicator
        #   (pas juste un indicateur produit — trop permissif pour les pages catalogue)
        # - Mode inclusif: accepter si produit dans le dernier segment ET indicateur produit
        if has_product_id:
            return True
        if has_detail_indicator and has_product_indicator:
            return True

        if inventory_only:
            return False

        if has_product_in_last_segment and has_product_indicator:
            return True

        return False

    def _detect_site_inventory_patterns(self, inventory_urls: List[str]) -> set:
        """Détecte les marqueurs de chemin d'inventaire communs pour ce site spécifique.

        Analyse les URLs identifiées comme inventaire pour trouver les segments de chemin
        récurrents (ex: 'inventaire', 'occasion', 'usage'). Ces patterns servent ensuite
        à exclure les URLs qui ne correspondent à aucun pattern d'inventaire du site.
        """
        from collections import Counter

        inventory_keywords = {
            'inventaire', 'inventory', 'occasion', 'usage', 'used',
            'pre-owned', 'pre-possede', 'vehicules-occasion',
        }

        markers = Counter()
        for url in inventory_urls:
            parsed = urlparse(url)
            path = (parsed.path or '').lower()
            segments = [s for s in path.split('/') if s]
            for seg in segments:
                if seg in inventory_keywords:
                    markers[seg] += 1
                elif any(kw in seg for kw in inventory_keywords):
                    markers[seg] += 1

        if not markers:
            return set()

        threshold = max(len(inventory_urls) * 0.3, 2)
        return {marker for marker, count in markers.items() if count >= threshold}

    def _deduplicate_bilingual_urls(self, urls: List[str]) -> List[str]:
        """Fusionne les doublons bilingues FR/EN d'un même produit.

        Détecte les sites bilingues (ex: /fr/neuf/... et /en/new/...) et
        ne garde qu'une version par produit (préfère FR).
        """
        if not urls or len(urls) < 20:
            return urls

        # FR→EN translations (one direction only to avoid cancellation)
        fr_to_en = [
            ('/fr/', '/en/'),
            ('/neuf/', '/new/'),
            ('/usage/', '/used/'),
            ('/motocyclette/', '/motorcycle/'),
            ('/vtt/', '/atv/'),
            ('/cote-a-cote/', '/side-by-side/'),
            ('/ponton/', '/pontoon/'),
            ('/motoneige/', '/snowmobile/'),
            ('/inventaire/', '/inventory/'),
            ('/3-roues/', '/3-wheel-motorcycle/'),
            ('/moteur-hors-bord/', '/outboard-motor/'),
        ]

        fr_count = sum(1 for u in urls if '/fr/' in u.lower())
        en_count = sum(1 for u in urls if '/en/' in u.lower())

        if fr_count < 10 or en_count < 10:
            return urls

        bilingual_ratio = min(fr_count, en_count) / max(fr_count, en_count)
        if bilingual_ratio < 0.4:
            return urls

        print(f"      🌐 Site bilingue détecté: {fr_count} FR + {en_count} EN")

        url_set = set(u.lower() for u in urls)
        url_map = {u.lower(): u for u in urls}
        kept = set()
        result = []

        for u in urls:
            u_lower = u.lower()
            if u_lower in kept:
                continue

            is_fr = '/fr/' in u_lower
            is_en = '/en/' in u_lower

            alt = u_lower
            if is_fr:
                for fr_seg, en_seg in fr_to_en:
                    alt = alt.replace(fr_seg, en_seg)
            elif is_en:
                for fr_seg, en_seg in fr_to_en:
                    alt = alt.replace(en_seg, fr_seg)

            if alt != u_lower and alt in url_set:
                kept.add(u_lower)
                kept.add(alt)
                if is_fr:
                    result.append(u)
                else:
                    result.append(url_map.get(alt, u))
            else:
                kept.add(u_lower)
                result.append(u)

        removed = len(urls) - len(result)
        if removed > 0:
            print(f"      ✅ {removed} doublons bilingues retirés → {len(result)} URLs")
        return result

    def _get_listing_page_candidates(
        self, discovered_urls: List[str], base_url: str
    ) -> List[str]:
        """Retourne les URLs qui ressemblent à des pages de listage (catégories)
        à explorer pour découvrir plus de fiches produit.
        Ex: /fr/usage/motocyclette/inventaire/ ou /fr/neuf/motoneige/
        """
        from urllib.parse import urlparse
        listing_segments = {
            'inventaire', 'motocyclette', 'motoneige', 'vtt', 'motomarine',
            'neuf', 'usage', 'inventaire-neuf', 'inventaire-usage',
            'motos', 'moto', 'motorcycles', 'motorcycle', 'motocyclettes',
            'scooters', 'scooter', 'quads', 'quad',
            'side-by-side', 'cote-a-cote', 'sxs',
            'vehicles', 'vehicules', 'catalogue', 'catalog',
            'inventory', 'new-inventory', 'used-inventory',
            'pre-owned', 'occasion', 'used',
            'en-stock', 'in-stock', 'disponible',
        }
        listing_path_markers = {
            'inventaire', 'usage', 'neuf', 'inventory',
            'motos', 'moto', 'motorcycles', 'motorcycle',
            'motocyclette', 'motocyclettes',
            'scooter', 'scooters', 'quad', 'quads',
            'side-by-side', 'cote-a-cote', 'sxs',
            'vehicles', 'vehicules', 'catalogue', 'catalog',
            'pre-owned', 'occasion', 'used',
        }
        candidates = []
        seen = set()
        for u in discovered_urls:
            u = (u or '').strip()
            if not u or u in seen:
                continue
            parsed = urlparse(u)
            path = (parsed.path or '').strip('/').lower()
            if not path:
                continue
            parts = path.split('/')
            last = (parts[-1] or '').lower()
            is_short_last = len(last) < 25 and not any(
                c.isdigit() for c in last)
            ends_with_listing = last in listing_segments
            has_listing_marker = any(m in path for m in listing_path_markers)
            if has_listing_marker and (is_short_last or ends_with_listing):
                seen.add(u)
                candidates.append(u)
        return candidates

    def _fetch_product_html(self, product_urls: List[str]) -> Dict[str, str]:
        """Récupère le HTML de chaque URL produit

        IMPORTANT: Cette fonction ne récupère que 20 échantillons de pages HTML, pas toutes les URLs.
        C'est intentionnel et optimal car:
        - Évite trop de requêtes HTTP (rate limiting, temps d'exécution)
        - Réduit la taille des données envoyées à Gemini pour l'analyse
        - 20 échantillons suffisent pour détecter les patterns HTML et générer un scraper efficace
        - Le scraper généré scrapera ensuite TOUTES les URLs découvertes (pas seulement 20)

        Exemple: Si 469 URLs sont découvertes, on récupère 20 échantillons pour l'analyse,
        puis le scraper généré scrapera les 469 URLs complètes.
        """
        html_samples = {}
        max_samples = 20  # Échantillonnage: 20 pages suffisent pour détecter les patterns

        print(
            f"      📊 Échantillonnage: récupération de {max_samples} pages sur {len(product_urls)} URLs découvertes")
        print(
            f"      ℹ️  Le scraper généré scrapera ensuite toutes les {len(product_urls)} URLs")

        for i, product_url in enumerate(product_urls[:max_samples]):
            try:
                print(
                    f"      Récupération {i+1}/{min(len(product_urls), max_samples)}: {product_url[:80]}...")
                html = self.ai_tools.get(product_url, use_selenium=False)
                if not html or len(html) < 1000:
                    html = self.ai_tools.browser_get(product_url)

                if html:
                    # Limiter la taille
                    html_samples[product_url] = html[:50000]
                    print(f"         ✅ {len(html)} caractères")
                else:
                    print(f"         ⚠️ HTML vide ou trop court")

                time.sleep(0.2)  # Rate limiting
            except Exception as e:
                print(f"         ❌ Erreur: {e}")

        return html_samples

    def _extract_with_gemini(self, html_samples: Dict[str, str], base_url: str) -> Tuple[List[Dict], Dict[str, str]]:
        """Utilise Gemini pour extraire les infos produits depuis le HTML"""
        all_products = []
        detected_selectors = {}

        # Préparer le HTML pour Gemini (limiter la taille)
        html_for_prompt = ""
        for url, html in list(html_samples.items())[:10]:  # Limiter à 10 pages
            html_clean = self.ai_tools.prepare_html_for_prompt(
                html[:20000])  # Limiter à 20k chars
            html_for_prompt += f"\n\n{'─'*60}\nURL: {url}\n{'─'*60}\n{html_clean}\n"

        if not html_for_prompt:
            return [], {}

        prompt = f"""Tu es un expert en extraction de données. Extrais TOUS les véhicules motorisés depuis ces pages HTML.

HTML DES PAGES DE PRODUITS:
{html_for_prompt}

IMPORTANT - RÈGLES STRICTES D'EXTRACTION:
1. Extrais UNIQUEMENT les VÉHICULES INDIVIDUELS avec marque et modèle spécifiques
2. Ignore COMPLÈTEMENT:
   - Les pages de services (service-apres-vente, entretien, réparation, maintenance)
   - Les articles de blog, conseils, guides, tutoriels
   - Les pages d'information générale, FAQ, contact
   - Les pages de formations, événements, promotions générales
   - Les catégories, les liens de navigation, les pages d'information
3. PRIX OBLIGATOIRE: N'extrais QUE les produits qui ont un prix valide (prix > 0)
   - Si une page ne contient pas de prix ou prix=0, ignore-la complètement
   - Ne retourne PAS de produits sans prix valide

Pour chaque véhicule valide, extrais:
- name, category, marque, modele, prix (OBLIGATOIRE > 0), disponibilite, image, annee
- sourceUrl: URL de la page où le produit a été trouvé
- sourceSite: {base_url}
- sourceCategorie: "inventaire", "catalogue", ou "vehicules_occasion"

DÉTECTION DES SÉLECTEURS CSS (OBLIGATOIRE):
Analyse le HTML de chaque page et identifie les sélecteurs CSS EXACTS utilisés pour chaque champ.
Pour chaque page HTML fournie, examine la structure et trouve:
- name: Le sélecteur CSS exact pour le nom du produit (généralement dans <h1> dans le contenu principal, pas dans header/nav/footer)
- prix/price: Le sélecteur CSS exact pour le prix (peut être .price, .prix, span.number, [data-price], etc.)
- image: Le sélecteur CSS exact pour l'image principale du produit (pas les logos/banners)

IMPORTANT: Analyse vraiment le HTML fourni et identifie les sélecteurs CSS RÉELS utilisés sur ce site spécifique.
Ne devine pas - analyse le code HTML pour trouver les classes, IDs, et attributs utilisés.

Retourne un dictionnaire "detected_selectors" avec les sélecteurs CSS EXACTS trouvés.
Exemple: {{"name": "h1", "prix": "span.number", "price": "span.number", "image": ".product-gallery img"}}
"""

        try:
            result = self.gemini_client.call(
                prompt=prompt,
                schema=EXTRACTION_SCHEMA,
                show_prompt=False
            )

            # Gérer le cas où Gemini retourne une liste directement au lieu d'un dict
            if isinstance(result, list):
                # Gemini a retourné directement la liste de produits
                all_products.extend(result)
            elif isinstance(result, dict):
                products = result.get('products', [])
                all_products.extend(products)

                # Essayer d'extraire les sélecteurs depuis la réponse
                if 'detected_selectors' in result:
                    detected_selectors.update(result['detected_selectors'])
            else:
                print(
                    f"         ⚠️ Réponse Gemini inattendue (type: {type(result).__name__})")

        except Exception as e:
            print(f"         ⚠️ Erreur lors de l'extraction Gemini: {e}")

        return all_products, detected_selectors

    def _detect_selectors(self, html_samples: Dict[str, str],
                          extracted_products: List[Dict],
                          existing_selectors: Dict[str, str]) -> Dict[str, str]:
        """Fallback: Détecte automatiquement les sélecteurs CSS si Gemini ne les a pas fournis"""
        selectors = existing_selectors.copy()

        # Si Gemini a déjà fourni tous les sélecteurs essentiels, on n'a pas besoin de fallback
        essential_keys = ['name', 'prix', 'image']
        if all(key in selectors for key in essential_keys):
            print(
                f"   ℹ️  Sélecteurs déjà fournis par Gemini, pas de fallback nécessaire")
            return selectors

        print(f"   ⚠️  Sélecteurs manquants, utilisation du fallback de détection...")

        if not html_samples:
            return selectors

        # Fonction helper pour vérifier si un élément est dans header/nav/footer
        def is_in_header_nav_footer(elem):
            """Vérifie si un élément est dans le header, nav ou footer"""
            if not elem:
                return False
            parent = elem.parent
            depth = 0
            max_depth = 10  # Limiter la profondeur de recherche

            while parent and depth < max_depth:
                parent_tag = parent.name.lower() if parent.name else ''
                parent_classes = ' '.join(parent.get('class', [])).lower()

                # Vérifier les tags HTML
                if parent_tag in ['header', 'nav', 'footer']:
                    return True

                # Vérifier les classes CSS
                exclude_keywords = ['header', 'nav', 'navbar', 'navigation',
                                    'menu', 'footer', 'logo', 'site-name', 'brand']
                if any(keyword in parent_classes for keyword in exclude_keywords):
                    return True

                parent = parent.parent
                depth += 1

            return False

        # Analyser TOUS les échantillons HTML pour détecter les patterns manquants (20 au lieu de 5)
        for url, html in list(html_samples.items()):
            soup = BeautifulSoup(html, 'html.parser')

            # Chercher le nom seulement si manquant
            if 'name' not in selectors:
                # Prioriser les sélecteurs dans le contenu principal (pas header/nav/footer)
                name_selectors = [
                    'article h1', '.main h1', '.content h1', '.product h1',
                    '.product-title h1', '.product-info h1', '.product-detail h1',
                    'h1',  # Fallback générique
                    'h2', '.title', '.product-title', '.product-name',
                    '[class*="title"]', '[class*="name"]', '[itemprop="name"]'
                ]
                for selector in name_selectors:
                    elem = soup.select_one(selector)
                    if elem:
                        # Vérifier que ce n'est pas dans header/nav/footer
                        if not is_in_header_nav_footer(elem):
                            selectors['name'] = selector
                            print(f"   ✅ Sélecteur 'name' détecté: {selector}")
                            break

            # Chercher le prix seulement si manquant
            if 'price' not in selectors and 'prix' not in selectors:
                # Ajouter span.number et .number pour le prix (priorité haute)
                price_selectors = [
                    'span.number', '.number',  # Pour les prix comme <span class="number">16 595</span>
                    '.price', '.prix',
                    '[class*="price"]', '[class*="prix"]',
                    '[class*="number"]',  # Variante avec number
                    '[data-price]', '[data-amount]',
                    '.product-price', '.product-price .amount',
                    '[itemprop="price"]'
                ]
                for selector in price_selectors:
                    if soup.select_one(selector):
                        selectors['prix'] = selector
                        selectors['price'] = selector
                        print(f"   ✅ Sélecteur 'prix' détecté: {selector}")
                        break

            # Chercher l'image seulement si manquante
            if 'image' not in selectors:
                image_selectors = [
                    'img.product-image', '.product-image img',
                    '.product-gallery img', '.woocommerce-product-gallery img',
                    '[class*="product"] img', 'img[src*="product"]',
                    '[itemprop="image"]', 'figure img', '.product img'
                ]
                for selector in image_selectors:
                    if soup.select_one(selector):
                        selectors['image'] = selector
                        print(f"   ✅ Sélecteur 'image' détecté: {selector}")
                        break

            # Si tous les sélecteurs essentiels sont trouvés, on peut arrêter
            if all(key in selectors for key in essential_keys):
                break

        # GARANTIR qu'un sélecteur "name" est toujours présent (même si aucun n'a été trouvé)
        if 'name' not in selectors:
            # Utiliser un sélecteur par défaut qui sera filtré par is_in_header_nav_footer dans le template
            selectors['name'] = 'h1'
            print(f"   ⚠️  Sélecteur 'name' non trouvé, utilisation du fallback: h1")

        # GARANTIR qu'un sélecteur "prix"/"price" est toujours présent
        if 'prix' not in selectors and 'price' not in selectors:
            selectors['prix'] = '.price'
            selectors['price'] = '.price'
            print(f"   ⚠️  Sélecteur 'prix' non trouvé, utilisation du fallback: .price")

        # GARANTIR qu'un sélecteur "image" est toujours présent
        if 'image' not in selectors:
            selectors['image'] = 'img'
            print(f"   ⚠️  Sélecteur 'image' non trouvé, utilisation du fallback: img")

        return selectors

    def _analyze_site_structure(self, url: str, html_samples: Dict[str, str],
                                product_urls: List[str]) -> Dict[str, Any]:
        """Analyse la structure du site pour faciliter la génération du scraper"""
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')

        structure = {
            'domain': domain,
            'base_url': url,
            'total_product_urls': len(product_urls),
            'html_samples_count': len(html_samples),
            'structure_type': 'unknown'
        }

        # Détecter le type de structure
        if html_samples:
            first_html = list(html_samples.values())[0]
            soup = BeautifulSoup(first_html, 'html.parser')

            # Vérifier si c'est une page de listing ou de détail
            if soup.select('.product, .item, [class*="product"]'):
                structure['structure_type'] = 'listing_page'
            elif soup.select('h1, .product-title, .product-name'):
                structure['structure_type'] = 'detail_page'
            else:
                structure['structure_type'] = 'mixed'

        return structure
