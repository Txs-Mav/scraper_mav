"""
Module de scraping intelligent avec cache Supabase
Orchestre le workflow complet: cache → exploration → détection → extraction
"""
import json
import time
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from urllib.parse import urlparse, urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from bs4 import BeautifulSoup


try:
    from .supabase_storage import SupabaseStorage, get_storage
    from .selector_detector import SelectorDetector
    from .exploration_agent import ExplorationAgent
    from .scraper_generator import ScraperGenerator
    from .config import CACHE_DIR, PROMPT_VERSION
    from .dedicated_scrapers.registry import DedicatedScraperRegistry
except ImportError:
    from supabase_storage import SupabaseStorage, get_storage
    from selector_detector import SelectorDetector
    from exploration_agent import ExplorationAgent
    from scraper_generator import ScraperGenerator
    from config import CACHE_DIR, PROMPT_VERSION
    try:
        from dedicated_scrapers.registry import DedicatedScraperRegistry
    except ImportError:
        DedicatedScraperRegistry = None


class IntelligentScraper:
    """Scraper intelligent avec gestion de cache et sélecteurs dynamiques"""

    def __init__(self, user_id: str):
        """
        Initialise le scraper intelligent.

        Args:
            user_id: ID de l'utilisateur connecté (OBLIGATOIRE)

        Raises:
            ValueError: Si user_id n'est pas fourni
        """
        if not user_id:
            raise ValueError(
                "❌ Authentification requise: vous devez être connecté pour utiliser le scraper.")

        self.user_id = user_id
        self.storage = SupabaseStorage(user_id)
        self.selector_detector = SelectorDetector()
        self.exploration_agent = ExplorationAgent()
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        })
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=30,
            pool_maxsize=30,
            max_retries=requests.adapters.Retry(total=2, backoff_factor=0.3,
                                                status_forcelist=[500, 502, 503, 504])
        )
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)

    def scrape(
        self,
        url: str,
        force_refresh: bool = False,
        categories: List[str] = None,
        inventory_only: bool = False
    ) -> Dict[str, Any]:
        """Scrape un site avec le workflow intelligent

        Args:
            url: URL du site à scraper
            force_refresh: Forcer la régénération même si cache valide
            categories: Catégories à scraper (inventaire, occasion, catalogue)
            inventory_only: Si True, exclut les pages catalogue/showroom

        Returns:
            Dict avec products, metadata, scraper_info
        """
        self._inventory_only = inventory_only
        start_time = time.time()

        # Normaliser l'URL
        url = self._normalize_url(url)

        # =====================================================
        # PRÉ-CHECK: SCRAPER DÉDIÉ (bypass complet du workflow AI)
        # =====================================================
        if DedicatedScraperRegistry and DedicatedScraperRegistry.has_dedicated_scraper(url):
            print(f"\n{'='*70}")
            print(f"🔧 SCRAPER DÉDIÉ DÉTECTÉ")
            print(f"{'='*70}")
            dedicated = DedicatedScraperRegistry.get_by_url(url)
            if dedicated:
                result = dedicated.scrape(
                    categories=categories,
                    inventory_only=inventory_only
                )
                return result

        print(f"\n{'='*70}")
        print(f"🚀 SCRAPER INTELLIGENT v{PROMPT_VERSION}")
        print(f"{'='*70}")
        print(f"🌐 Site: {url}")
        print(f"👤 User ID: {self.user_id or 'Non connecté (local)'}")
        print(f"🔄 Force refresh: {force_refresh}")
        print(f"📦 Inventaire seulement: {'Oui' if inventory_only else 'Non'}")

        # Catégories par défaut: TOUTES les catégories pour extraction complète
        # L'état (neuf/usagé/catalogue) est détecté automatiquement par produit
        if categories is None:
            categories = ['inventaire', 'occasion', 'catalogue']

        # =====================================================
        # PRÉ-CHECK: CONNECTIVITÉ DU SITE
        # =====================================================
        if not self._check_site_connectivity(url):
            print(f"\n{'='*60}")
            print(f"❌ SITE INACCESSIBLE: {url}")
            print(f"{'='*60}")
            print(f"   Le site ne répond pas après plusieurs tentatives.")
            print(f"   Vérifiez l'URL et votre connexion réseau.")
            return self._create_empty_result(url, start_time, "site_unreachable")

        # =====================================================
        # ÉTAPE 1: VÉRIFICATION DU CACHE
        # =====================================================
        print(f"\n{'='*50}")
        print(f"📦 ÉTAPE 1: VÉRIFICATION DU CACHE")
        print(f"{'='*50}")

        cached_scraper = None
        cache_status = "miss"

        if not force_refresh and self.storage:
            is_valid, cached_scraper = self.storage.is_cache_valid(url)

            if is_valid and cached_scraper:
                cache_status = "hit"
                print(f"✅ CACHE VALIDE trouvé!")
                print(f"   Expire: {cached_scraper.get('expires_at', 'N/A')}")
                print(
                    f"   Sélecteurs: {len(cached_scraper.get('selectors', {}))} détectés")
                print(
                    f"   URLs produits: {len(cached_scraper.get('product_urls', []))} en cache")
            elif cached_scraper:
                cache_status = "expired"
                print(f"⚠️  CACHE EXPIRÉ - Mise à jour des URLs nécessaire")
            else:
                print(f"❌ Aucun cache trouvé")
        else:
            print(
                f"⏭️  Cache ignoré (force_refresh={force_refresh}, storage={bool(self.storage)})")

        # =====================================================
        # ÉTAPE 2: EXPLORATION (si nécessaire)
        # =====================================================
        selectors = {}
        product_urls = []

        if cache_status == "hit":
            # Utiliser les données du cache
            selectors = cached_scraper.get('selectors', {})
            product_urls = cached_scraper.get('product_urls', [])

            # Optionnel: rafraîchir les URLs si le cache est proche de l'expiration
            # (commenté pour l'instant, à activer si nécessaire)
            # product_urls = self._refresh_product_urls(url, selectors, categories)

        elif cache_status == "expired" and cached_scraper:
            # Cache expiré: réutiliser les sélecteurs, mais rafraîchir les URLs
            print(f"\n{'='*50}")
            print(f"🔄 ÉTAPE 2: RAFRAÎCHISSEMENT DES URLs")
            print(f"{'='*50}")

            selectors = cached_scraper.get('selectors', {})
            print(f"   Réutilisation des sélecteurs existants")

            # Découvrir les nouvelles URLs
            product_urls = self._discover_product_urls(url, categories)

            # Mettre à jour le cache avec les nouvelles URLs
            if self.storage and product_urls:
                self.storage.update_scraper_urls(url, product_urls)
                self.storage.refresh_cache_expiry(url)
                print(f"   ✅ Cache mis à jour avec {len(product_urls)} URLs")

        else:
            # Pas de cache: exploration complète
            print(f"\n{'='*50}")
            print(f"🔍 ÉTAPE 2: EXPLORATION COMPLÈTE")
            print(f"{'='*50}")

            # 2.1 Découvrir les URLs de produits
            product_urls = self._discover_product_urls(url, categories)

            if not product_urls:
                print(f"❌ Aucune URL de produit trouvée!")
                return self._create_empty_result(url, start_time, "no_urls_found")

            # 2.2 Récupérer des échantillons HTML
            html_samples = self._fetch_html_samples(product_urls[:5])

            if not html_samples:
                print(f"❌ Impossible de récupérer le HTML!")
                return self._create_empty_result(url, start_time, "html_fetch_failed")

            # 2.3 Détecter les sélecteurs CSS
            print(f"\n🎯 Détection des sélecteurs CSS...")
            detection_result = self.selector_detector.detect_selectors(
                html_samples=html_samples,
                base_url=url
            )

            selectors = detection_result.get('selectors', {})

            # 2.4 Sauvegarder dans le cache
            if self.storage and selectors:
                scraper_code = self._generate_scraper_code(
                    url, selectors, product_urls)
                self.storage.save_scraper(
                    site_url=url,
                    scraper_code=scraper_code,
                    selectors=selectors,
                    product_urls=product_urls,
                    metadata={
                        'site_name': self._extract_site_name(url),
                        'detection_result': detection_result,
                        'prompt_version': PROMPT_VERSION,
                        'categories': categories,
                        'inventory_only': getattr(self, '_inventory_only', False)
                    }
                )

        # =====================================================
        # ÉTAPE 3: EXTRACTION DES PRODUITS
        # =====================================================
        print(f"\n{'='*50}")
        print(f"📥 ÉTAPE 3: EXTRACTION DES PRODUITS")
        print(f"{'='*50}")
        print(f"   URLs à traiter: {len(product_urls)}")

        products = self._extract_products(product_urls, selectors, url)

        # =====================================================
        # AUTO-HEAL: Si le taux de succès est trop bas (< 15%),
        # les URLs sont probablement périmées (véhicules vendus qui redirigent).
        # Rafraîchir les URLs depuis la page listing (pas le sitemap).
        # Les sélecteurs CSS restent valides — aucun appel AI.
        # S'applique sur cache hit ET cache miss (première exécution).
        # =====================================================
        success_rate = (len(products) / len(product_urls)
                        * 100) if product_urls else 0
        elapsed_so_far = time.time() - start_time
        can_auto_heal = elapsed_so_far < 120

        if product_urls and len(product_urls) >= 20 and success_rate < 15 and can_auto_heal:
            print(
                f"\n⚠️  Taux d'extraction très bas: {len(products)}/{len(product_urls)} ({success_rate:.0f}%)")
            print(
                f"   🔄 Rafraîchissement des URLs depuis le listing (sélecteurs conservés, 0 appel AI)...")
            refreshed_urls = self._refresh_urls_from_listing(url, categories)
            if refreshed_urls and len(refreshed_urls) > len(products):
                print(
                    f"   ✅ {len(refreshed_urls)} URLs actuelles trouvées → ré-extraction")
                product_urls = refreshed_urls
                products = self._extract_products(product_urls, selectors, url)
                if self.storage:
                    self.storage.update_scraper_urls(url, product_urls)
                    self.storage.refresh_cache_expiry(url)
                    print(
                        f"   ✅ Cache mis à jour ({len(product_urls)} URLs, sélecteurs inchangés)")
            else:
                refreshed_urls = self._refresh_urls_only(url, categories)
                if refreshed_urls and len(refreshed_urls) > len(products) * 2:
                    print(
                        f"   ✅ {len(refreshed_urls)} URLs (sitemap) → ré-extraction")
                    product_urls = refreshed_urls
                    products = self._extract_products(
                        product_urls, selectors, url)
                    if self.storage:
                        self.storage.update_scraper_urls(url, product_urls)
                        self.storage.refresh_cache_expiry(url)
                        print(
                            f"   ✅ Cache mis à jour ({len(product_urls)} URLs, sélecteurs inchangés)")
        elif product_urls and len(product_urls) >= 20 and success_rate < 15:
            print(
                f"\n⚠️  Taux d'extraction bas ({success_rate:.0f}%) mais auto-heal ignoré "
                f"(déjà {elapsed_so_far:.0f}s écoulées)")

        # Post-filtrage inventaire: exclure les produits catalogue si demandé
        # Exception : si le site est entièrement catalogue (pas d'inventaire),
        # on garde TOUS les produits (sites comme Morin Sports, Moto 4 Saisons, etc.)
        if getattr(self, '_inventory_only', False) and products:
            pre_filter_count = len(products)
            filtered = self._filter_inventory_only_products(products)

            # Si le filtre supprime >80% des produits, c'est un site catalogue-only
            # → garder tous les produits au lieu de tout supprimer
            if len(filtered) < pre_filter_count * 0.2 and pre_filter_count >= 3:
                print(
                    f"\n🏪 Site catalogue détecté: le filtre inventaire aurait retiré "
                    f"{pre_filter_count - len(filtered)}/{pre_filter_count} produits — "
                    f"on garde TOUT (pas d'inventaire sur ce site)")
            else:
                products = filtered
                if pre_filter_count != len(products):
                    print(
                        f"\n🎯 Post-filtre inventaire: {len(products)}/{pre_filter_count} produits conservés")

        print(f"\n✅ {len(products)} produits extraits")

        # =====================================================
        # PROTECTION CACHE: Invalider si 0 produits extraits
        # =====================================================
        if len(products) == 0 and self.storage:
            print(f"⚠️  0 produits extraits → invalidation du cache")
            try:
                self.storage.delete_scraper(url)
            except Exception as e:
                print(
                    f"   ⚠️  Erreur lors de l'invalidation du cache: {e}")

        # =====================================================
        # ÉTAPE 4: SAUVEGARDE DES RÉSULTATS
        # =====================================================
        elapsed_time = time.time() - start_time

        if self.storage:
            self.storage.save_scraping_result(
                site_url=url,
                products=products,
                execution_time=elapsed_time,
                metadata={
                    'cache_status': cache_status,
                    'urls_processed': len(product_urls),
                    'categories': categories
                }
            )

        # Résumé du site (pas le résumé final global)
        print(f"\n{'='*70}")
        print(f"✅ SITE TERMINÉ: {url}")
        print(f"{'='*70}")
        print(f"📦 Produits extraits: {len(products)}")
        print(f"⏱️  Durée site: {elapsed_time:.1f}s")
        print(f"📊 Cache: {cache_status}")

        return {
            'products': products,
            'metadata': {
                'site_url': url,
                'products_count': len(products),
                'urls_processed': len(product_urls),
                'execution_time_seconds': round(elapsed_time, 2),
                'cache_status': cache_status,
                'categories': categories,
                'prompt_version': PROMPT_VERSION
            },
            'scraper_info': {
                'selectors': selectors,
                'product_urls_count': len(product_urls)
            }
        }

    def _check_site_connectivity(self, url: str, max_retries: int = 2, initial_wait: float = 2.0) -> bool:
        """Vérifie que le site est accessible avant de lancer l'exploration."""
        import socket

        parsed = urlparse(url)
        hostname = parsed.netloc or parsed.hostname

        print(f"\n🔌 Vérification de la connectivité: {hostname}...")

        for attempt in range(max_retries):
            try:
                socket.getaddrinfo(
                    hostname, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)

                response = self.session.head(
                    url, timeout=8, allow_redirects=True)
                if response.status_code < 500:
                    print(
                        f"   ✅ Site accessible (HTTP {response.status_code})")
                    return True
                else:
                    raise requests.exceptions.HTTPError(
                        f"HTTP {response.status_code}"
                    )

            except Exception as e:
                error_str = str(e).lower()
                is_transient = any(kw in error_str for kw in [
                    'nameresolution', 'name resolution', 'nodename nor servname',
                    'temporary failure', 'getaddrinfo', 'newconnectionerror',
                    'timeout', 'timed out', 'connectionerror', 'connection refused',
                    'connectionreset', 'remotedisconnected', 'max retries',
                    '502', '503', '504',
                ])

                if attempt < max_retries - 1 and is_transient:
                    wait_time = initial_wait * (2 ** attempt)
                    print(
                        f"   ⚠️ Tentative {attempt + 1}/{max_retries}: {e}")
                    print(f"   🔄 Nouvelle tentative dans {wait_time:.0f}s...")
                    time.sleep(wait_time)
                else:
                    print(
                        f"   ❌ Site inaccessible après {attempt + 1} tentative(s): {e}")
                    return False

        return False

    def _normalize_url(self, url: str) -> str:
        """Normalise une URL"""
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url

        # Supprimer le trailing slash
        url = url.rstrip('/')

        return url

    def _extract_site_name(self, url: str) -> str:
        """Extrait le nom du site depuis l'URL"""
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        return domain.split('.')[0].title()

    def _discover_product_urls(self, base_url: str, categories: List[str]) -> List[str]:
        """Découvre les URLs de produits via l'agent d'exploration"""
        print(f"\n   🔍 Découverte des URLs de produits...")
        print(f"   Catégories: {categories}")

        try:
            # Utiliser l'agent d'exploration
            inventory_only = getattr(self, '_inventory_only', False)
            result = self.exploration_agent.explore_and_extract(
                base_url, inventory_only=inventory_only)

            all_urls = result.get('product_urls', [])

            # Filtrer par catégorie si possible
            filtered_urls = self._filter_urls_by_category(
                all_urls, categories, base_url)

            print(
                f"   ✅ {len(filtered_urls)} URLs découvertes (filtré de {len(all_urls)})")

            return filtered_urls

        except Exception as e:
            print(f"   ❌ Erreur exploration: {e}")
            return []

    def _refresh_urls_from_listing(self, base_url: str, categories: List[str]) -> List[str]:
        """Découvre les URLs ACTUELLES en crawlant la page listing d'inventaire.

        Contrairement au sitemap (qui contient des URLs périmées de véhicules vendus),
        la page listing ne montre que les véhicules actuellement en vente.
        Parcourt la pagination automatiquement.
        """
        import re as _re
        try:
            tools = self.exploration_agent.ai_tools
            inventory_only = getattr(self, '_inventory_only', False)

            parsed = urlparse(base_url)
            base_domain = f"{parsed.scheme}://{parsed.netloc}"

            listing_paths = [
                '/inventaire/', '/inventory/',
                '/inventaire-neuf/', '/inventaire-occasion/',
                '/new-inventory/', '/used-inventory/',
                '/motos/', '/motorcycles/',
                '/catalogue/', '/catalog/',
                '/vehicles/', '/vehicules/',
                '/a-vendre/', '/for-sale/',
                '/en-stock/', '/in-stock/',
            ]

            listing_url = None
            session = tools._get_session() if hasattr(tools, '_get_session') else None
            if not session:
                import requests as _requests
                session = _requests.Session()
                session.headers.update({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })

            base_path = parsed.path.rstrip('/')

            def _test_listing(test_url):
                try:
                    resp = session.get(test_url, timeout=5, allow_redirects=True)
                    if resp.status_code == 200 and len(resp.text) > 5000:
                        return test_url
                except Exception:
                    pass
                return None

            candidate_urls = []
            for lp in listing_paths:
                if base_path:
                    candidate_urls.append(f"{base_domain}{base_path}{lp}")
                candidate_urls.append(f"{base_domain}{lp}")

            with ThreadPoolExecutor(max_workers=6) as pool:
                future_map = {pool.submit(_test_listing, u): u for u in candidate_urls}
                for future in as_completed(future_map, timeout=20):
                    try:
                        result = future.result(timeout=6)
                        if result:
                            listing_url = result
                            for f in future_map:
                                f.cancel()
                            break
                    except Exception:
                        continue

            if not listing_url:
                print(f"      ⚠️  Aucune page listing trouvée → fallback sitemap")
                return []

            print(f"      📋 Page listing trouvée: {listing_url}")

            all_product_links = set()
            max_pages = 20
            page_num = 1

            product_markers = [
                '/inventaire/', '/inventory/', '-a-vendre',
                '/occasion/', '/used/', '/pre-owned/',
                'a-vendre-', '-for-sale',
                '/motos/', '/motorcycles/', '/motocyclettes/',
                '/catalogue/', '/catalog/',
                '/vehicles/', '/vehicules/',
                '/scooters/', '/quads/',
            ]
            listing_endpoints = (
                '/inventaire', '/inventory',
                '/inventaire-neuf', '/inventaire-occasion',
                '/new-inventory', '/used-inventory',
                '/motos', '/motorcycles', '/catalogue', '/catalog',
                '/vehicles', '/vehicules',
            )

            # Détecter la pagination via ai_tools si disponible
            detected_pagination = None
            try:
                first_resp = session.get(listing_url, timeout=10)
                if first_resp.status_code == 200:
                    detected_pagination = self.exploration_agent.ai_tools.detect_pagination(
                        first_resp.text, listing_url)
            except Exception:
                pass

            while page_num <= max_pages:
                if page_num == 1:
                    page_url = listing_url
                elif detected_pagination:
                    page_url = self.exploration_agent.ai_tools.build_pagination_url(
                        listing_url, detected_pagination, page_num)
                else:
                    if '?' in listing_url:
                        page_url = f"{listing_url}&page={page_num}"
                    else:
                        page_url = f"{listing_url.rstrip('/')}?page={page_num}"

                try:
                    resp = session.get(page_url, timeout=10)
                    if resp.status_code != 200:
                        break

                    soup = BeautifulSoup(resp.text, 'lxml')
                    links_on_page = set()

                    for a_tag in soup.find_all('a', href=True):
                        href = a_tag['href']
                        full_url = urljoin(page_url, href)
                        if parsed.netloc not in full_url:
                            continue
                        url_lower = full_url.lower()
                        has_marker = any(
                            marker in url_lower for marker in product_markers)
                        last_seg = url_lower.rstrip('/').split('/')[-1]
                        has_detail = (
                            any(c.isdigit() for c in last_seg) and
                            len(last_seg) > 10 and
                            not _re.match(r'^(page|p)?\d+$', last_seg)
                        )
                        if has_marker or has_detail:
                            if not url_lower.rstrip('/').endswith(listing_endpoints):
                                links_on_page.add(full_url)

                    if not links_on_page:
                        break

                    new_links = links_on_page - all_product_links
                    all_product_links.update(links_on_page)

                    if not new_links and page_num > 1:
                        break

                    page_num += 1
                    time.sleep(0.3)

                except Exception:
                    break

            print(
                f"      ✅ {len(all_product_links)} URLs actuelles depuis le listing ({page_num - 1} pages)")

            if not all_product_links:
                return []

            # Déduplication et filtrage
            unique_urls = list(all_product_links)
            if inventory_only:
                agent = self.exploration_agent
                unique_urls = [
                    u for u in unique_urls
                    if agent._looks_like_inventory_url(u)
                    or agent._is_valid_product_url(u, inventory_only=True)
                ]

            result = self._filter_urls_by_category(
                unique_urls, categories, base_url)
            return result

        except Exception as e:
            print(f"      ❌ Erreur crawl listing: {e}")
            return []

    def _refresh_urls_only(self, base_url: str, categories: List[str]) -> List[str]:
        """Rafraîchit UNIQUEMENT les URLs sans appeler Gemini.

        Utilise le sitemap + filtrage pour découvrir les URLs actuelles.
        Les sélecteurs CSS du cache restent valides — aucun appel AI.
        """
        import re as _re
        print(f"   🔄 Rafraîchissement des URLs (sans AI)...")
        inventory_only = getattr(self, '_inventory_only', False)

        try:
            tools = self.exploration_agent.ai_tools

            # 1. Sitemap
            raw_urls = tools.get_sitemap_urls(base_url)
            if not raw_urls:
                print(f"      ⚠️  Aucun sitemap → abandon du rafraîchissement")
                return []
            print(f"      📋 {len(raw_urls)} URLs du sitemap")

            # 2. Dedup basique
            seen = {}
            for u in raw_urls:
                norm = tools.normalize_url_for_dedup(u)
                if norm not in seen or len(u) < len(seen[norm]):
                    seen[norm] = u

            # 3. Dedup model+year (préserve les stock codes)
            stock_pat = _re.compile(
                r'(?:ins|inv|mj)\d{3,}'
                r'|[/-][tu]\d{4,}'
                r'|a-vendre-[a-z]\d{3,}'
                r'|ms[-_]p?\d+[-_]\d+'
                r'|stock[-_]?\d{3,}'
                r'|sku[-_]?\d+'
            )
            final = {}
            for u in seen.values():
                if stock_pat.search(u.lower()):
                    final[u] = u
                else:
                    key = tools.normalize_url_by_model_year(u)
                    if key not in final:
                        final[key] = u
            unique = list(final.values())

            # 4. Filtrage inventaire si demandé
            if inventory_only:
                agent = self.exploration_agent
                unique = [
                    u for u in unique
                    if agent._looks_like_inventory_url(u)
                    and agent._is_valid_product_url(u, inventory_only=True)
                ]

            result = self._filter_urls_by_category(
                unique, categories, base_url)
            print(f"      ✅ {len(result)} URLs après filtrage (0 appel AI)")
            return result

        except Exception as e:
            print(f"      ❌ Erreur rafraîchissement URLs: {e}")
            return []

    @staticmethod
    def _is_non_product_url(url: str) -> bool:
        """Détecte les URLs qui ne sont clairement PAS des pages produit.

        Filtre les pages de blog, service, contact, info, et les pages
        de listing/catégorie génériques (sans identifiant produit).
        """
        import re
        url_lower = url.lower()

        non_product_segments = [
            '/blog/', '/blogue/', '/blog$',
            '/service/', '/service-entretien/', '/services/',
            '/contact/', '/nous-joindre/',
            '/team/', '/equipe/', '/a-propos/', '/about/',
            '/sell-your-', '/vendez-votre-',
            '/parts/', '/pieces/',
            '/entretien-et-reparation', '/maintenance-and-repair',
            '/faq/', '/aide/', '/help/',
            '/login/', '/connexion/', '/register/', '/inscription/',
            '/account/', '/compte/',
            '/cart/', '/panier/', '/checkout/',
            '/politique/', '/privacy/', '/cgv/', '/mentions-legales/',
            '/search/', '/recherche/',
            '/carriere/', '/careers/', '/emploi/',
            '/snowmobile-maintenance', '/atv-maintenance', '/motorcycle-maintenance',
            '/termes-et-conditions', '/terms-of-use', '/terms-and-conditions',
            '/politique-de-confidentialite', '/privacy-policy',
            '/financement/', '/financing/',
            '/promotions$',
        ]
        for seg in non_product_segments:
            if seg.endswith('$'):
                if url_lower.rstrip('/').endswith(seg[:-1]):
                    return True
            elif seg in url_lower:
                return True

        if re.search(r'/promotions?/local-', url_lower):
            return True

        parsed = urlparse(url)
        path = parsed.path.rstrip('/')
        if path in ('', '/fr', '/en', '/fr/', '/en/'):
            return True

        return False

    def _filter_urls_by_category(
        self,
        urls: List[str],
        categories: List[str],
        base_url: str
    ) -> List[str]:
        """Filtre les URLs par catégorie (inventaire, occasion, catalogue)

        IMPORTANT: Quand toutes les catégories sont incluses, cette méthode
        retourne TOUTES les URLs pour une extraction complète.
        L'état (neuf/usagé/catalogue) est ensuite détecté par produit.
        """
        if not categories:
            return urls

        # Si toutes les catégories sont incluses, pas de filtrage
        all_categories = {'inventaire', 'occasion', 'catalogue'}
        if all_categories.issubset(set(categories)):
            print(f"      ℹ️  Toutes les catégories actives - pas de filtrage URL")
            return urls

        # Mots-clés pour chaque catégorie
        category_keywords = {
            # NOTE: "neuf" est ambigu (peut être catalogue/showroom). On évite de l'utiliser comme indicateur inventaire.
            'inventaire': ['inventaire', 'inventory', 'stock', 'en-stock', 'disponible', 'a-vendre', 'for-sale'],
            'occasion': ['occasion', 'used', 'pre-owned', 'usag', 'seconde-main', 'd-occasion'],
            'catalogue': ['catalogue', 'catalog', 'modele', 'model', 'gamme', 'range']
        }

        # Mots-clés à exclure
        exclude_keywords = []
        if 'catalogue' not in categories:
            exclude_keywords.extend(
                ['catalogue', 'catalog', 'modele', 'model', 'gamme', 'range'])

        filtered = []
        for url in urls:
            url_lower = url.lower()

            # Vérifier si l'URL contient des mots-clés à exclure
            if any(kw in url_lower for kw in exclude_keywords):
                continue

            # Vérifier si l'URL contient des mots-clés de catégorie
            for cat in categories:
                if cat in category_keywords:
                    if any(kw in url_lower for kw in category_keywords[cat]):
                        filtered.append(url)
                        break
            else:
                # Si aucune catégorie spécifique, inclure par défaut
                # (sauf si explicitement exclu)
                if not exclude_keywords or not any(kw in url_lower for kw in exclude_keywords):
                    filtered.append(url)

        return filtered if filtered else urls

    def _fetch_html_samples(self, urls: List[str], max_samples: int = 5) -> Dict[str, str]:
        """Récupère des échantillons HTML de plusieurs URLs"""
        samples = {}

        for url in urls[:max_samples]:
            try:
                response = self.session.get(url, timeout=15)
                if response.status_code == 200:
                    samples[url] = response.text
                    print(f"      ✅ {url[:60]}...")
            except Exception as e:
                print(f"      ❌ {url[:60]}... ({e})")

        return samples

    def _extract_products(
        self,
        urls: List[str],
        selectors: Dict[str, str],
        base_url: str
    ) -> List[Dict]:
        """Extrait les produits avec concurrence adaptative.

        Démarre avec un nombre élevé de workers puis réduit automatiquement
        si le serveur throttle (détecté par un taux de timeout >40%).
        Pour les très gros sites, travaille par batches avec pauses.
        """
        pre_filter = len(urls)
        urls = [u for u in urls if not self._is_non_product_url(u)]
        if len(urls) < pre_filter:
            print(
                f"      🚫 {pre_filter - len(urls)} URLs non-produit filtrées (blog, service, etc.)")

        all_products = []
        skipped_empty = 0
        total = len(urls)
        extract_start = time.time()

        if total < 100:
            initial_workers = 8
        elif total < 500:
            initial_workers = 10
        else:
            initial_workers = 5

        batch_size = min(total, max(initial_workers * 3, 30))

        timeout_count = 0
        success_count = 0
        error_count = 0
        workers = initial_workers
        processed = 0
        failed_urls: List[str] = []

        remaining_urls = list(urls)

        print(f"      ⚙️  {workers} workers (adaptatif) pour {total} URLs")

        while remaining_urls:
            batch = remaining_urls[:batch_size]
            remaining_urls = remaining_urls[batch_size:]
            batch_timeouts = 0
            batch_successes = 0

            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {
                    executor.submit(self._extract_from_url, url, selectors, base_url): url
                    for url in batch
                }

                try:
                    for future in as_completed(futures, timeout=180):
                        url = futures[future]
                        processed += 1
                        try:
                            products = future.result(timeout=30)
                            if products:
                                all_products.extend(products)
                                batch_successes += 1
                                success_count += 1
                            else:
                                skipped_empty += 1
                                batch_successes += 1
                        except Exception as e:
                            err_str = str(e).lower()
                            if 'timeout' in err_str or 'timed out' in err_str or 'read timed out' in err_str:
                                batch_timeouts += 1
                                timeout_count += 1
                            else:
                                error_count += 1
                            failed_urls.append(url)

                        report_interval = 25 if total > 200 else 50
                        if processed % report_interval == 0 or processed == total:
                            elapsed = time.time() - extract_start
                            rate = processed / elapsed if elapsed > 0 else 0
                            eta = (total - processed) / rate if rate > 0 else 0
                            print(
                                f"      📊 [{processed}/{total}] {len(all_products)} produits — "
                                f"{rate:.1f} URLs/s — ETA {eta:.0f}s")
                except TimeoutError:
                    hung = len(batch) - processed + (total - len(batch) - len(remaining_urls))
                    print(f"      ⚠️  Batch timeout (180s) — {hung} URLs abandonnées")
                    timeout_count += hung

            batch_total = batch_successes + batch_timeouts
            if batch_total > 0 and batch_timeouts / batch_total > 0.25:
                old_workers = workers
                workers = max(3, workers * 2 // 3)
                if workers != old_workers:
                    print(
                        f"      🔽 Throttling ({batch_timeouts} timeouts/{batch_total}) — {old_workers}→{workers} workers")
                batch_size = max(workers * 3, 15)
                if remaining_urls:
                    time.sleep(0.5)
            elif batch_total >= 8 and batch_timeouts / batch_total < 0.05 and workers < initial_workers:
                old_workers = workers
                workers = min(initial_workers, workers + 1)
                if workers != old_workers:
                    print(
                        f"      🔼 Serveur stable — {old_workers}→{workers} workers")
                batch_size = max(workers * 3, 15)

        # ── Retry des URLs échouées (timeouts + erreurs) ──
        if failed_urls:
            retry_count = len(failed_urls)
            print(
                f"      🔄 Retry de {retry_count} URLs échouées (3 workers, timeout 12s)...")
            retry_workers = min(3, retry_count)

            old_timeout = self.session.timeout if hasattr(
                self.session, 'timeout') else 8

            retried = 0
            retry_successes = 0
            with ThreadPoolExecutor(max_workers=retry_workers) as executor:
                futures = {
                    executor.submit(self._extract_from_url, url, selectors, base_url): url
                    for url in failed_urls
                }
                try:
                    for future in as_completed(futures, timeout=120):
                        retried += 1
                        try:
                            products = future.result(timeout=15)
                            if products:
                                all_products.extend(products)
                                retry_successes += 1
                        except Exception:
                            pass
                except TimeoutError:
                    print(f"      ⚠️  Retry timeout (120s) — arrêt des retries restants")

            if retry_successes > 0:
                print(
                    f"      ✅ Retry: {retry_successes}/{retry_count} URLs récupérées")
            else:
                print(
                    f"      ℹ️  Retry: aucune URL récupérée sur {retry_count}")

        elapsed = time.time() - extract_start
        rate = total / elapsed if elapsed > 0 else 0

        if skipped_empty > 0:
            pct = (skipped_empty / total * 100) if total else 0
            print(
                f"      ⚠️  {skipped_empty}/{total} URLs sans produit ({pct:.0f}%)")
        if timeout_count > 0:
            print(f"      ⚠️  {timeout_count} timeouts, {error_count} erreurs")

        print(f"      ⏱️  Extraction: {elapsed:.1f}s ({rate:.1f} URLs/s)")

        unique_products = self._deduplicate_products(all_products)

        pre_name_filter = len(unique_products)
        unique_products = [
            p for p in unique_products
            if not self._is_listing_page_product(p)
        ]
        rejected_names = pre_name_filter - len(unique_products)
        if rejected_names > 0:
            print(
                f"      🚫 {rejected_names} produit(s) rejeté(s) (titre de page listing/blog/info)")

        return unique_products

    @staticmethod
    def _is_listing_page_product(product: Dict) -> bool:
        """Détecte un produit qui est en fait un titre de page listing ou non-produit.

        Patterns détectés:
        - "New Kawasaki Watercraft | Motoplex Mirabel" (listing page <title>)
        - "Motocyclette neufs | Dealer" (listing FR)
        - "Used Trailers in Mirabel | DealerName" (listing page)
        - "Maintenance and Repairs | DealerName" (service page)
        - "Politique de confidentialité | Dealer" (info page)
        """
        import re
        name = product.get('name', '')
        url = product.get('sourceUrl', '')

        if '|' in name:
            before_pipe = name.split('|')[0].strip()

            if re.search(
                r'^(?:New|Used|Neuf|Usag[ée]s?|Tous|All)\s+',
                before_pipe,
                re.IGNORECASE
            ):
                if not re.search(r'\b(19|20)\d{2}\b', before_pipe):
                    return True

            if re.search(
                r'\b(?:neufs?|usag.{0,3}e?s?)\s*(?:.{0,3}\s+\w+)?$',
                before_pipe,
                re.IGNORECASE
            ):
                return True

            non_product_keywords = [
                r'\b(?:Blog|Blogue|Service|Contact|Team|[EÉ]quipe)\b',
                r'\b(?:Parts|Accessories|Pi[eè]ces|Accessoires)\b',
                r'\b(?:Sell|Vendez|Vendre)\b',
                r'\b(?:Guide|Formation|Entretien|R[ée]paration|Maintenance)\b',
                r'\b(?:Promotions?|Cr[ée]dit|Dealership|Concessionnaire)\b',
                r'\b(?:Powersports|Vehicles?|V[ée]hicules?)\s+(?:de\s+sports|motoris|neufs?|usag)',
                r'\b(?:Meet the|Rencontrez)\b',
                r'\b(?:No credit|Aucun cr[ée]dit)\b',
                r'\b(?:Purchase your|Achetez)\b',
                r'\b(?:Financing|Financement)\b',
                r'\b(?:Privacy|Confidentialit[ée]|Politique)\b',
                r'\b(?:Terms|Termes|Conditions)\b',
                r'\b(?:Offers?|Your\s+\w+\s+Dealer)\b',
            ]
            for kw in non_product_keywords:
                if re.search(kw, before_pipe, re.IGNORECASE):
                    return True

        if re.search(r'/(?:blog|blogue)/', url, re.IGNORECASE):
            return True

        return False

    @staticmethod
    def _clean_product_name(name: str) -> str:
        """Nettoie un nom de produit en retirant les suffixes dealer/ville/condition."""
        import re
        if not name:
            return name

        _product_suffixes = {
            'edition', 'special', 'limited', 'pro', 'sport', 'touring',
            'adventure', 'rally', 'trail', 'custom', 'classic', 'premium',
            'standard', 'base', 'se', 'le', 'gt', 'abs', 'dct', 'es',
            'bobber', 'scout', 'chief', 'pursuit', 'chieftain', 'roadmaster',
            'challenger', 'springfield', 'vintage', 'dark horse',
        }

        # " - Nom du dealer" en fin de chaîne
        parts = name.rsplit(' - ', 1)
        if len(parts) == 2:
            after_dash = parts[1].strip()
            after_words = set(after_dash.lower().split())
            is_product_suffix = bool(after_words & _product_suffixes)
            has_year = bool(re.search(r'\b(19|20)\d{2}\b', after_dash))
            is_short_code = len(after_dash) <= 6 and re.match(
                r'^[A-Za-z0-9]+$', after_dash)
            if not is_product_suffix and not has_year and not is_short_code and len(after_dash) <= 50:
                name = parts[0].strip()

        # "d'occasion à [Ville]", "neuf à [Ville]", etc.
        name = re.sub(
            r"\s+d['\u2019]?occasion\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(r"\s+[àa]\s+vendre\s+[àa]\s+[\w\s.-]+$",
                      '', name, flags=re.I)
        name = re.sub(
            r"\s+(?:neuf|usag[ée]+|usage|occasion)\s+[àa]\s+[\w\s.-]+$", '', name, flags=re.I)
        name = re.sub(
            r"\s+(?:en\s+vente|disponible)\s+(?:[àa]|chez)\s+[\w\s.-]+$", '', name, flags=re.I)

        return name.strip()

    def _extract_from_url(
        self,
        url: str,
        selectors: Dict[str, str],
        base_url: str
    ) -> List[Dict]:
        """Extrait les produits d'une seule URL

        STRATÉGIE D'EXTRACTION (ordre de priorité):
        1. Données structurées (JSON-LD, Open Graph) - pour les pages de détail
        2. Sélecteurs CSS - pour les pages de listing

        Après extraction, enrichit chaque produit avec:
        - sourceCategorie (inventaire, catalogue, vehicules_occasion)
        - etat (neuf, occasion, demonstrateur)
        """
        try:
            response = self.session.get(url, timeout=10, allow_redirects=True)
            if response.status_code != 200:
                return []

            if response.history:
                from urllib.parse import urlparse
                original_path = urlparse(url).path.rstrip('/')
                final_path = urlparse(response.url).path.rstrip('/')
                if original_path != final_path:
                    orig_segments = [s for s in original_path.split('/') if s]
                    final_segments = [s for s in final_path.split('/') if s]
                    if not orig_segments or not final_segments:
                        return []
                    if orig_segments[-1] not in final_path:
                        return []

            html = response.text

            # ============================================================
            # FAST PATH: Extraire JSON-LD par regex SANS parser le HTML complet
            # Couvre ~80% des pages produit et évite BeautifulSoup entièrement
            # ============================================================
            product_fast = self._extract_jsonld_fast(html, url, base_url)
            if product_fast and product_fast.get('name') and product_fast.get('prix'):
                product_fast['name'] = self._clean_product_name(
                    product_fast['name'])
                product_fast['sourceSite'] = base_url
                product_fast['sourceUrl'] = url
                self._detect_product_condition(product_fast, url, html)
                return self._tag_with_inventory_signals(
                    [product_fast], html, url)

            # Parse HTML UNE SEULE FOIS (lxml ~3-5x plus rapide que html.parser)
            soup = BeautifulSoup(html, 'lxml')

            # ============================================================
            # PRIORITÉ 1: Extraction complète (JSON-LD + OG + Microdata)
            # ============================================================
            product_from_structured = self._extract_structured_data(
                html, url, base_url, soup=soup)

            if product_from_structured and product_from_structured.get('name') and product_from_structured.get('prix'):
                product_from_structured['name'] = self._clean_product_name(
                    product_from_structured['name'])
                product_from_structured['sourceSite'] = base_url
                product_from_structured['sourceUrl'] = url
                self._detect_product_condition(
                    product_from_structured, url, html, soup=soup)
                return self._tag_with_inventory_signals(
                    [product_from_structured], html, url)

            # ============================================================
            # PRIORITÉ 2: Extraction via sélecteurs CSS (pages listing)
            # ============================================================
            products = self.selector_detector.extract_with_selectors(
                html=html,
                selectors=selectors,
                base_url=base_url,
                soup=soup
            )

            for product in products:
                product['sourceUrl'] = product.get('sourceUrl') or url
                product['sourceSite'] = base_url
                if product.get('name'):
                    product['name'] = self._clean_product_name(product['name'])
                self._detect_product_condition(product, url, html, soup=soup)

            # ============================================================
            # HYBRIDE: Si les données structurées avaient un nom mais pas de prix,
            # essayer de trouver le prix, puis retourner les données structurées
            # ============================================================
            if product_from_structured and product_from_structured.get('name') and not product_from_structured.get('prix'):
                css_price = None
                for p in products:
                    if p.get('prix') and p['prix'] > 0:
                        css_price = p['prix']
                        break

                if css_price:
                    product_from_structured['prix'] = css_price

                if not product_from_structured.get('prix'):
                    from scraper_ai.extract import extract_price
                    import re
                    price_patterns = [
                        (r'data-price="([^"]+)"', True),
                        (r'class="[^"]*(?:current[_-]?price|sale[_-]?price)[^"]*"[^>]*>([^<]+)', True),
                        (r'itemprop="price"[^>]*content="([^"]+)"', True),
                        (r'class="[^"]*(?:price|prix)[^"]*"[^>]*>([^<]+)', False),
                    ]
                    for pattern, is_priority in price_patterns:
                        matches = re.findall(pattern, html, re.I)
                        for match_text in matches:
                            if not is_priority:
                                ctx_start = html.lower().find(match_text.lower())
                                if ctx_start > 0:
                                    ctx = html[max(0, ctx_start - 100)
                                                   :ctx_start].lower()
                                    if 'old-price' in ctx or 'list-price' in ctx or 'line-through' in ctx or 'was-price' in ctx:
                                        continue
                            price = extract_price(match_text)
                            if price and price > 0:
                                product_from_structured['prix'] = price
                                break
                        if product_from_structured.get('prix'):
                            break

                product_from_structured['name'] = self._clean_product_name(
                    product_from_structured['name'])
                product_from_structured['sourceSite'] = base_url
                product_from_structured['sourceUrl'] = url
                self._detect_product_condition(
                    product_from_structured, url, html, soup=soup)
                return self._tag_with_inventory_signals(
                    [product_from_structured], html, url)

            return self._tag_with_inventory_signals(products, html, url)

        except Exception as e:
            return []

    def _extract_jsonld_fast(self, html: str, url: str, base_url: str) -> Dict:
        """Extraction ultra-rapide JSON-LD par regex, sans BeautifulSoup.

        Extrait les blocs <script type="application/ld+json"> par regex et cherche
        un objet Product/Vehicle. Couvre ~80% des sites e-commerce.
        Retourne {} si rien de pertinent n'est trouvé.
        """
        import json
        import re
        from urllib.parse import urljoin

        product = {}
        pattern = re.compile(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            re.DOTALL | re.IGNORECASE
        )

        for match in pattern.finditer(html):
            try:
                raw = match.group(1).strip()
                if not raw:
                    continue
                data = json.loads(raw)

                items = []
                if isinstance(data, list):
                    items.extend(data)
                elif isinstance(data, dict):
                    items.append(data)
                    if '@graph' in data:
                        items.extend(data['@graph'])

                for item in items:
                    if not isinstance(item, dict):
                        continue
                    item_type = item.get('@type', '')
                    if isinstance(item_type, list):
                        type_str = ' '.join(t.lower() for t in item_type)
                    else:
                        type_str = item_type.lower()

                    if not any(t in type_str for t in ['product', 'vehicle', 'motorcycle', 'car']):
                        continue

                    if not product.get('name') and item.get('name'):
                        product['name'] = str(item['name']).strip()

                    if not product.get('prix'):
                        price = item.get('price') or item.get(
                            'lowPrice') or item.get('highPrice')
                        if not price:
                            offers = item.get('offers', {})
                            if isinstance(offers, list) and offers:
                                offers = offers[0]
                            if isinstance(offers, dict):
                                price = offers.get('price') or offers.get(
                                    'lowPrice') or offers.get('highPrice')
                        if price:
                            try:
                                product['prix'] = float(
                                    str(price).replace(',', '.').replace(' ', ''))
                            except (ValueError, TypeError):
                                pass

                    if not product.get('image'):
                        img = item.get('image')
                        if img:
                            if isinstance(img, list):
                                img = img[0]
                            if isinstance(img, dict):
                                img = img.get('url')
                            if img and isinstance(img, str):
                                product['image'] = urljoin(base_url, img)

                    if not product.get('marque'):
                        brand = item.get('brand') or item.get('manufacturer')
                        if brand:
                            if isinstance(brand, dict):
                                brand = brand.get('name')
                            if brand:
                                product['marque'] = str(brand)

                    if not product.get('modele'):
                        model = item.get('model')
                        if model:
                            if isinstance(model, dict):
                                model = model.get('name') or model.get('model')
                            if model and isinstance(model, str):
                                product['modele'] = str(model).strip()

                    if not product.get('annee'):
                        year = item.get(
                            'vehicleModelDate') or item.get('modelYear')
                        if year:
                            try:
                                product['annee'] = int(str(year)[:4])
                            except (ValueError, TypeError):
                                pass

                    if not product.get('etat'):
                        condition = item.get('itemCondition', '')
                        if not condition:
                            offers = item.get('offers', {})
                            if isinstance(offers, list) and offers:
                                offers = offers[0]
                            if isinstance(offers, dict):
                                condition = offers.get('itemCondition', '')
                        if condition:
                            cond_lower = str(condition).lower()
                            if 'new' in cond_lower or 'neuf' in cond_lower:
                                product['etat'] = 'neuf'
                            elif 'used' in cond_lower or 'occasion' in cond_lower:
                                product['etat'] = 'occasion'

                    if product.get('name'):
                        break
            except (json.JSONDecodeError, Exception):
                continue

        if product.get('name'):
            product['sourceUrl'] = url
            product['sourceSite'] = base_url

        return product

    def _extract_structured_data(self, html: str, url: str, base_url: str, soup=None) -> Dict:
        """Extrait les données produit depuis JSON-LD, Open Graph, et microdata

        Cette méthode est essentielle pour les pages de détail produit
        qui utilisent des données structurées standardisées.
        """
        import json
        import re
        from urllib.parse import urljoin

        if soup is None:
            soup = BeautifulSoup(html, 'lxml')
        product = {}

        # ========================================================
        # STRATÉGIE 1: JSON-LD (la plus fiable)
        # ========================================================
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                if not script.string:
                    continue
                data = json.loads(script.string)

                items_to_check = []
                if isinstance(data, list):
                    items_to_check.extend(data)
                elif isinstance(data, dict):
                    items_to_check.append(data)
                    if '@graph' in data:
                        items_to_check.extend(data['@graph'])

                for item in items_to_check:
                    if not isinstance(item, dict):
                        continue

                    item_type = item.get('@type', '')
                    if isinstance(item_type, list):
                        item_types = [t.lower() for t in item_type]
                    else:
                        item_types = [item_type.lower()]

                    # Types supportés
                    if any(t in ' '.join(item_types) for t in ['product', 'vehicle', 'motorcycle', 'car']):
                        # Nom
                        if not product.get('name') and item.get('name'):
                            product['name'] = str(item['name']).strip()

                        # Prix depuis offers OU directement depuis l'item
                        if not product.get('prix'):
                            price = None
                            # D'abord chercher directement dans l'item (certains sites)
                            price = item.get('price') or item.get(
                                'lowPrice') or item.get('highPrice')
                            # Sinon chercher dans offers (standard schema.org)
                            if not price:
                                offers = item.get('offers', {})
                                if isinstance(offers, list) and offers:
                                    offers = offers[0]
                                if isinstance(offers, dict):
                                    price = offers.get('price') or offers.get(
                                        'lowPrice') or offers.get('highPrice')
                            if price:
                                try:
                                    product['prix'] = float(
                                        str(price).replace(',', '.').replace(' ', ''))
                                except (ValueError, TypeError):
                                    pass

                        # Image
                        if not product.get('image'):
                            img = item.get('image')
                            if img:
                                if isinstance(img, list):
                                    img = img[0]
                                if isinstance(img, dict):
                                    img = img.get('url')
                                if img and isinstance(img, str):
                                    product['image'] = urljoin(base_url, img)

                        # Marque
                        if not product.get('marque'):
                            brand = item.get('brand') or item.get(
                                'manufacturer')
                            if brand:
                                if isinstance(brand, dict):
                                    brand = brand.get('name')
                                if brand:
                                    product['marque'] = str(brand)

                        # Modèle (champ schema.org 'model')
                        if not product.get('modele'):
                            model = item.get('model')
                            if model:
                                if isinstance(model, dict):
                                    model = model.get(
                                        'name') or model.get('model')
                                if model and isinstance(model, str):
                                    product['modele'] = str(model).strip()

                        # Année
                        if not product.get('annee'):
                            year = item.get(
                                'vehicleModelDate') or item.get('modelYear')
                            if year:
                                try:
                                    product['annee'] = int(str(year)[:4])
                                except (ValueError, TypeError):
                                    pass

                        # ========================================================
                        # CONDITION / ÉTAT du produit (schema.org itemCondition)
                        # ========================================================
                        if not product.get('etat'):
                            # Chercher directement dans l'item
                            condition = item.get('itemCondition', '')
                            # Chercher dans offers
                            if not condition:
                                offers = item.get('offers', {})
                                if isinstance(offers, list) and offers:
                                    offers = offers[0]
                                if isinstance(offers, dict):
                                    condition = offers.get('itemCondition', '')

                            if condition:
                                condition_str = str(condition).lower()
                                if 'new' in condition_str or 'neuf' in condition_str:
                                    product['etat'] = 'neuf'
                                elif 'used' in condition_str or 'occasion' in condition_str or 'refurbished' in condition_str:
                                    product['etat'] = 'occasion'
                                elif 'demo' in condition_str:
                                    product['etat'] = 'demonstrateur'

                        # Kilométrage (pour véhicules)
                        if not product.get('kilometrage'):
                            mileage = item.get('mileageFromOdometer')
                            if mileage:
                                if isinstance(mileage, dict):
                                    mileage = mileage.get('value')
                                if mileage:
                                    try:
                                        product['kilometrage'] = int(
                                            float(str(mileage).replace(',', '').replace(' ', '')))
                                    except (ValueError, TypeError):
                                        pass

                        if product.get('name'):
                            break
            except (json.JSONDecodeError, Exception):
                continue

        # ========================================================
        # STRATÉGIE 2: Open Graph meta tags
        # ========================================================
        if not product.get('name'):
            og_title = soup.find('meta', property='og:title')
            if og_title and og_title.get('content'):
                title = og_title['content'].strip()
                if len(title) >= 5:
                    product['name'] = title

        if not product.get('image'):
            og_image = soup.find('meta', property='og:image')
            if og_image and og_image.get('content'):
                product['image'] = urljoin(base_url, og_image['content'])

        if not product.get('prix'):
            for price_prop in ['og:price:amount', 'product:price:amount']:
                og_price = soup.find('meta', property=price_prop)
                if og_price and og_price.get('content'):
                    try:
                        product['prix'] = float(
                            og_price['content'].replace(',', '.'))
                        break
                    except (ValueError, TypeError):
                        continue

        # ========================================================
        # STRATÉGIE 3: Microdata (itemprop)
        # ========================================================
        if not product.get('name'):
            name_elem = soup.find(attrs={'itemprop': 'name'})
            if name_elem:
                product['name'] = name_elem.get_text(strip=True)

        if not product.get('prix'):
            price_elem = soup.find(attrs={'itemprop': 'price'})
            if price_elem:
                price_text = price_elem.get(
                    'content') or price_elem.get_text(strip=True)
                try:
                    product['prix'] = float(
                        re.sub(r'[^\d.]', '', str(price_text)))
                except (ValueError, TypeError):
                    pass

        if not product.get('image'):
            img_elem = soup.find(attrs={'itemprop': 'image'})
            if img_elem:
                img_src = img_elem.get('src') or img_elem.get('content')
                if img_src:
                    product['image'] = urljoin(base_url, img_src)

        # ========================================================
        # STRATÉGIE 3.5: Prix courant depuis le HTML (data-price / current-price)
        # ========================================================
        if not product.get('prix'):
            product['prix'] = self._extract_current_price_from_html(soup)

        # ========================================================
        # STRATÉGIE 4: Title de la page (fallback)
        # ========================================================
        if not product.get('name'):
            title_elem = soup.find('title')
            if title_elem:
                title = title_elem.get_text(strip=True)
                # Extraire la partie avant | ou - (souvent le nom du produit)
                for sep in ['|', ' - ', ' – ']:
                    if sep in title:
                        title = title.split(sep)[0].strip()
                        break
                if len(title) >= 5 and len(title) < 100:
                    product['name'] = title

        # Ajouter les métadonnées
        if product.get('name'):
            product['sourceUrl'] = url
            product['sourceSite'] = base_url

        return product

    _OLD_PRICE_KW = frozenset([
        'old', 'was', 'msrp', 'list-price', 'regular', 'compare',
        'original', 'crossed', 'strikethrough', 'previous', 'ancien', 'barr',
    ])

    def _extract_current_price_from_html(self, soup) -> float:
        """Extract the current/sale price from HTML, avoiding old/list prices."""
        import re
        from scraper_ai.extract import extract_price

        for el in soup.find_all(attrs={'data-price': True}):
            dp = el.get('data-price', '').strip()
            if dp:
                price = extract_price(dp)
                if price and price > 0:
                    return price

        for cls in ['current-price', 'sale-price', 'special-price',
                    'promo-price', 'discounted-price', 'final-price']:
            el = soup.find(class_=cls)
            if el:
                price = extract_price(el.get_text(strip=True))
                if price and price > 0:
                    return price

        for container_cls in ['product-price', 'price-financing', 'price-wrapper',
                              'price-block', 'price-box']:
            container = soup.find(class_=re.compile(container_cls, re.I))
            if not container:
                continue
            text = container.get_text(strip=True)
            price = extract_price(text)
            if price and price > 0:
                return price

        return 0.0

    def _detect_product_condition(self, product: Dict, url: str, html: str = '', soup=None) -> Dict:
        """Détecte l'état/condition du produit et le sourceCategorie.

        Analyse TOUTES les URLs disponibles (page courante + sourceUrl du produit)
        car l'état est souvent encodé dans l'URL.

        Args:
            product: Le produit à enrichir
            url: URL de la page courante (peut être une page listing)
            html: Contenu HTML de la page (optionnel)
            soup: BeautifulSoup pré-parsé (optionnel, évite double-parsing)

        Returns:
            Le produit enrichi avec sourceCategorie et etat
        """
        import re

        # Collecter TOUTES les URLs pertinentes pour l'analyse
        # L'URL du produit (sourceUrl) a priorité car plus spécifique
        product_url = product.get('sourceUrl', '')
        urls_to_check = [product_url, url]  # sourceUrl en premier
        all_urls_lower = ' '.join(u.lower() for u in urls_to_check if u)

        # ── Détection de sourceCategorie depuis les URLs ──
        if not product.get('sourceCategorie'):
            if any(x in all_urls_lower for x in ['occasion', 'used', 'pre-owned', 'usag',
                                                 'd-occasion', 'pre-possede', 'pre_possede',
                                                 'seconde-main', 'vehicules-occasion',
                                                 'vehicule-occasion', 'inventaire-usage']):
                product['sourceCategorie'] = 'vehicules_occasion'
            elif any(x in all_urls_lower for x in ['catalogue', 'catalog', 'showroom', 'gamme',
                                                   '/models/', '/modeles/']):
                product['sourceCategorie'] = 'catalogue'
            elif any(x in all_urls_lower for x in ['inventaire', 'inventory', 'stock', 'en-stock',
                                                   'a-vendre', 'for-sale']):
                product['sourceCategorie'] = 'inventaire'
            else:
                product['sourceCategorie'] = 'inventaire'  # Par défaut

        # ── Extraction du kilométrage depuis le HTML (si pas encore présent) ──
        # Le kilométrage est souvent écrit dans les informations produit même si
        # absent de l'URL. On l'extrait ici pour qu'il soit disponible pour
        # la détection de l'état.
        if html and product.get('kilometrage') is None:
            mileage_from_html = self._extract_mileage_from_html(html, soup=soup)
            if mileage_from_html is not None:
                product['kilometrage'] = mileage_from_html

        # ── Détection de l'état (etat) ──
        # Si déjà défini par données structurées ou selector_detector, ne pas écraser
        if not product.get('etat'):
            etat = None

            # Signal 0: "démo" / "démonstrateur" dans le nom ou le modèle
            name_and_modele = ' '.join(
                str(x) for x in [product.get('name'), product.get('modele')] if x
            ).lower()
            if re.search(r'\b(démo|démonstrateur|demonstrateur|demo)\b', name_and_modele):
                etat = 'demonstrateur'

            # Signal 1: URLs (sourceUrl du produit + URL de la page)
            # Analyser chaque URL séparément pour des patterns plus précis
            for check_url in urls_to_check:
                if not check_url or etat:
                    continue
                check_lower = check_url.lower()

                # Patterns occasion/usagé (les plus importants à détecter)
                if any(x in check_lower for x in ['/usage/', '/used/', '/occasion/', '/pre-owned/',
                                                  '/usag', '/d-occasion/', '/pre-possede/',
                                                  '-usage-', '-used-', '-occasion-',
                                                  'vehicules-occasion', 'vehicule-occasion',
                                                  'inventaire-usage', 'inventaire-occasion',
                                                  '/pre_possede/']):
                    etat = 'occasion'
                # Patterns démonstrateur
                elif any(x in check_lower for x in ['/demo/', '/demonstrat/', '-demo-', '-demonstr-',
                                                    'demonstrateur']):
                    etat = 'demonstrateur'
                # Patterns neuf
                elif any(x in check_lower for x in ['/neuf/', '/new/', '-neuf-', '-new-',
                                                    'inventaire-neuf']):
                    etat = 'neuf'

            # Signal 2A: Champ "Condition" explicite dans l'aperçu/spécifications.
            # C'est le signal le plus fiable : on isole la VALEUR du champ condition
            # pour éviter de mélanger avec d'autres textes de la page.
            if not etat and html:
                if soup is None:
                    soup = BeautifulSoup(html, 'lxml')

                condition_value = None
                for selector in ['li.condition', '[class="condition"]', 'dd.condition',
                                 'li.etat', '[class="etat"]', 'dd.etat']:
                    for elem in soup.select(selector):
                        value_span = elem.select_one('.value, .spec-value, span:last-child, dd')
                        if value_span:
                            condition_value = value_span.get_text(strip=True).lower()
                        else:
                            raw = elem.get_text(strip=True).lower()
                            for prefix in ['condition', 'état', 'etat', 'state']:
                                idx = raw.find(prefix)
                                if idx >= 0:
                                    condition_value = raw[idx + len(prefix):].lstrip(' :').strip()
                                    break
                            if not condition_value:
                                condition_value = raw
                        if condition_value:
                            break
                    if condition_value:
                        break

                # Chercher aussi dans les <li>/<tr> dont le label contient "condition"
                if not condition_value:
                    for elem in soup.find_all(['li', 'tr', 'div', 'dl']):
                        label_elem = elem.find(['span', 'th', 'dt', 'strong', 'b'],
                                               string=re.compile(r'condition', re.I))
                        if label_elem:
                            val_elem = label_elem.find_next_sibling(['span', 'td', 'dd'])
                            if val_elem:
                                condition_value = val_elem.get_text(strip=True).lower()
                            else:
                                full = elem.get_text(strip=True).lower()
                                m = re.search(r'condition\s*[:\s]+(.+)', full)
                                if m:
                                    condition_value = m.group(1).strip()
                            if condition_value:
                                break

                if condition_value:
                    if re.search(r'v[ée]hicule\s+d[\'\u2019]occasion|d[\'\u2019]occasion|usag[eé]e?|occasion|used|pre-owned', condition_value):
                        etat = 'occasion'
                        product['_condition_from_field'] = True
                    elif re.search(r'd[ée]mo|d[ée]monstrateur|demonstrat', condition_value):
                        etat = 'demonstrateur'
                        product['_condition_from_field'] = True
                    elif re.search(r'neuf|neuve|brand new|v[ée]hicule\s+neuf', condition_value):
                        etat = 'neuf'
                        product['_condition_from_field'] = True

            # Signal 2B: Contenu plus large (titre, breadcrumbs, badges, meta)
            if not etat and html:
                if soup is None:
                    soup = BeautifulSoup(html, 'lxml')

                title_elem = soup.find('title')
                title_text = title_elem.get_text(
                    strip=True).lower() if title_elem else ''

                badge_texts = []
                for selector in ['[class*="badge"]', '[class*="label"]', '[class*="tag"]',
                                 '[class*="state"]', '[class*="status"]',
                                 '.breadcrumb', 'nav[aria-label*="breadcrumb"]',
                                 '[class*="breadcrumb"]', '[class*="type-vehicle"]',
                                 '[class*="vehicle-type"]']:
                    for elem in soup.select(selector):
                        badge_texts.append(elem.get_text(strip=True).lower())

                meta_texts = []
                for meta in soup.find_all('meta', attrs={'name': True}):
                    meta_texts.append(str(meta.get('content', '')).lower())

                all_page_text = ' '.join(
                    [title_text] + badge_texts + meta_texts)

                if re.search(r'v[ée]hicule\s+d[\'\u2019]occasion', all_page_text):
                    etat = 'occasion'
                elif re.search(r'\b(usagée?|usag[eé]e?|occasion|used|pre-owned|pré-possédée?|d[\'\u2019]occasion)\b', all_page_text):
                    etat = 'occasion'
                elif re.search(r'\b(démonstrateur|demonstrateur|demo unit|démo)\b', all_page_text):
                    etat = 'demonstrateur'
                elif re.search(r'\b(neuf|neuve|brand new)\b', all_page_text):
                    etat = 'neuf'

            # Signal 3: Kilométrage depuis les infos produit (URL ou HTML)
            # Le km peut venir de l'URL ou des informations produit sur la page.
            # Si km > 0, le véhicule a roulé → occasion.
            if not etat:
                km = product.get('kilometrage', 0) or 0
                if isinstance(km, str):
                    try:
                        km = int(re.sub(r'[^\d]', '', km))
                    except (ValueError, TypeError):
                        km = 0
                if km > 0:
                    etat = 'occasion'

            # Signal 4: Déduire depuis sourceCategorie
            if not etat:
                src_cat = product.get('sourceCategorie', '')
                if src_cat == 'vehicules_occasion':
                    etat = 'occasion'
                elif src_cat == 'catalogue':
                    etat = 'neuf'  # Les catalogues sont des modèles neufs
                else:
                    etat = 'neuf'  # Par défaut l'inventaire est considéré neuf

            product['etat'] = etat

        # Règle métier de validation finale :
        # Si l'état a été détecté comme "occasion" par des signaux faibles (badges, meta),
        # on le confirme seulement si AU MOINS un critère fort est présent :
        #   - Kilométrage > 0
        #   - URL contient des marqueurs "usagé"
        #   - Le champ "Condition" explicite dit "occasion" (Signal 2A → _condition_from_field)
        # Si AUCUN critère fort → forcer neuf.
        if product.get('etat') == 'occasion':
            km_val = product.get('kilometrage', 0) or 0
            if isinstance(km_val, str):
                try:
                    km_val = int(re.sub(r'[^\d]', '', km_val))
                except (ValueError, TypeError):
                    km_val = 0
            url_has_usage = any(
                x in all_urls_lower for x in
                ['/usage/', '/used/', '/occasion/', 'usag', '-usage-', '-used-',
                 'd-occasion', 'pre-possede', 'pre-owned', 'vehicules-occasion', 'inventaire-usage'])
            has_explicit_condition = product.get('_condition_from_field', False)
            if km_val == 0 and not url_has_usage and not has_explicit_condition:
                product['etat'] = 'neuf'

        product.pop('_condition_from_field', None)
        return product

    def _extract_inventory_signals(self, html: str, url: str) -> dict:
        """Extrait les signaux d'inventaire vs catalogue depuis le HTML et l'URL.

        Analyse le contenu de la page pour déterminer si un produit est de l'inventaire
        réel (unité physique chez le concessionnaire) ou du catalogue/brochure
        (vitrine du fabricant).

        Returns:
            Dict avec des signaux booléens et valeurs extraites.
        """
        import re

        signals = {
            'has_stock_number': False,
            'has_vin': False,
            'has_mileage': False,
            'mileage_value': 0,
            'has_starting_at_price': False,
            'url_has_inventory_marker': False,
            'url_has_catalog_marker': False,
        }

        url_lower = (url or '').lower()

        # ── Signaux URL ──
        inventory_url_markers = [
            'inventaire', 'inventory', 'a-vendre', 'for-sale',
            'en-stock', 'in-stock', 'disponible',
            '/occasion/', '/usage/', '/used/', '/pre-owned/',
        ]
        if any(m in url_lower for m in inventory_url_markers):
            signals['url_has_inventory_marker'] = True

        catalog_url_markers = [
            'catalogue', 'catalog', 'showroom', 'w-get',
            '/models/', '/modeles/', '/gamme/',
        ]
        if any(m in url_lower for m in catalog_url_markers):
            signals['url_has_catalog_marker'] = True

        # Code de stock dans l'URL
        stock_url_patterns = [
            r'ins\d{3,}', r'inv\d{3,}', r'[/-][tu]\d{4,}',
            r'mj\d{2,}', r'ms[-_]p?\d+[-_]\d+',
            r'stock[-_]?\d{3,}', r'sku[-_]?\d+', r'ref[-_]?\d+',
            r'a-vendre-[a-z]\d{3,}',
        ]
        if any(re.search(p, url_lower) for p in stock_url_patterns):
            signals['has_stock_number'] = True

        # ── Signaux HTML ──
        if html:
            html_lower = html.lower() if isinstance(html, str) else ''

            # Numéro de stock/inventaire dans le contenu
            stock_content_patterns = [
                r'#\s*inventaire\s*[:\s]',
                r'inventaire\s*#?\s*:\s*\S+',
                r'#\s*stock\s*[:\s]',
                r'stock\s*#\s*[:\s]',
                r'stock\s*number',
                r'num[ée]ro\s+d[\'e ]\s*inventaire',
                r'inventory\s*#',
                r'no\.\s*(?:stock|inventaire)',
                r'n[°o]\s*(?:stock|inventaire)',
                r'vehicle\s*id\s*:',
            ]
            if any(re.search(p, html_lower) for p in stock_content_patterns):
                signals['has_stock_number'] = True

            # VIN/NIV dans le contenu
            vin_content_patterns = [
                r'(?:vin|niv)\s*[:\s]+\s*[A-HJ-NPR-Z0-9]{17}',
            ]
            if any(re.search(p, html, re.IGNORECASE) for p in vin_content_patterns):
                signals['has_vin'] = True

            # Kilométrage
            mileage_patterns = [
                r'(?:kilom[eé]trage|mileage)\s*[:\s]+\s*([\d\s,.\xa0]+)',
                r'([\d\s,.\xa0]+)\s*km\b(?!\s*/)',
            ]
            for pattern in mileage_patterns:
                match = re.search(pattern, html_lower)
                if match:
                    try:
                        km_str = re.sub(r'[^\d]', '', match.group(1))
                        if km_str:
                            km = int(km_str)
                            if 0 < km < 1_000_000:
                                signals['has_mileage'] = True
                                signals['mileage_value'] = km
                                break
                    except (ValueError, IndexError):
                        pass

            # "À partir de" / MSRP = signal catalogue
            starting_at_patterns = [
                r'[àa]\s+partir\s+de\s*[\s:]*\s*[\d$]',
                r'starting\s+(?:at|from)\s*[\s:]*\s*[\d$]',
                r'msrp\s*[\s:]*\s*[\d$]',
                r'prix\s+de\s+d[ée]tail\s+sugg[ée]r[ée]',
            ]
            if any(re.search(p, html_lower) for p in starting_at_patterns):
                signals['has_starting_at_price'] = True

        return signals

    def _extract_mileage_from_html(self, html: str, soup=None) -> Optional[int]:
        """Extrait le kilométrage depuis le contenu HTML.

        Utilise d'abord BeautifulSoup pour gérer les tags HTML entre le label
        et la valeur (ex: <span class="label">Kilométrage:</span><span>108</span>),
        puis fallback sur regex du HTML brut.

        Returns:
            Valeur en km (int), 0 pour "0 km", ou None si non trouvé.
        """
        if not html:
            return None
        import re

        # ── Méthode 1: BeautifulSoup (gère les tags entre label et valeur) ──
        try:
            if soup is None:
                soup = BeautifulSoup(html, 'lxml')

            # Chercher dans les éléments avec class contenant "km", "mileage", "kilometrage"
            for selector in ['[class*="km"]', '[class*="mileage"]', '[class*="kilometrage"]',
                             '[class*="odometer"]', '[class*="odometre"]']:
                for elem in soup.select(selector):
                    text = elem.get_text(strip=True).lower()
                    km_match = re.search(r'([\d\s,.\xa0]+)\s*(?:km|mi)?\b', text)
                    if km_match:
                        km_str = re.sub(r'[^\d]', '', km_match.group(1))
                        if km_str:
                            km = int(km_str)
                            if 0 <= km < 1_000_000:
                                return km

            # Chercher dans les <li>, <div>, <span> dont le texte contient "kilométrage"
            for elem in soup.find_all(['li', 'div', 'span', 'td', 'dd', 'p']):
                text = elem.get_text(strip=True).lower()
                if any(kw in text for kw in ['kilom', 'mileage', 'odom']):
                    km_match = re.search(
                        r'(?:kilom[eé]trage|mileage|odom[eè]tre|odometer)\s*[:\s]*\s*([\d\s,.\xa0]+)',
                        text)
                    if km_match:
                        km_str = re.sub(r'[^\d]', '', km_match.group(1))
                        if km_str:
                            km = int(km_str)
                            if 0 <= km < 1_000_000:
                                return km
        except Exception:
            pass

        # ── Méthode 2: Regex sur le HTML brut (fallback) ──
        html_lower = html.lower()

        labeled_patterns = [
            r'(?:kilom[eé]trage|mileage|odom[eè]tre|odometer)\s*[:\s]+\s*([\d\s,.\xa0]+)\s*(?:km|mi)?',
            r'(?:km|mileage)\s*:\s*([\d\s,.\xa0]+)',
        ]

        for pattern in labeled_patterns:
            match = re.search(pattern, html_lower)
            if match:
                try:
                    km_str = re.sub(r'[^\d]', '', match.group(1))
                    if not km_str:
                        return 0
                    km = int(km_str)
                    if 0 <= km < 1_000_000:
                        return km
                except (ValueError, IndexError):
                    pass

        return None

    def _extract_inventory_number(self, html: str) -> Optional[str]:
        """Extrait le numéro d'inventaire / stock depuis le HTML."""
        import re

        if not html:
            return None

        try:
            soup = BeautifulSoup(html, 'lxml')

            for selector in ['li.stock', '[class*="stock"]', '[class*="inventaire"]',
                              '[class*="inventory"]']:
                for elem in soup.select(selector):
                    text = elem.get_text(strip=True)
                    m = re.search(
                        r'(?:#\s*(?:inventaire|stock|inv)\.?\s*[:\s]*|'
                        r'(?:inventaire|stock|inventory)\s*(?:#|no\.?|n[°o])?\s*[:\s]*)'
                        r'([A-Za-z0-9][\w-]{1,20})',
                        text, re.IGNORECASE)
                    if m:
                        return m.group(1).strip()

            patterns = [
                r'#\s*inventaire\s*[:\s]+([A-Za-z0-9][\w-]{1,20})',
                r'inventaire\s*#?\s*:\s*([A-Za-z0-9][\w-]{1,20})',
                r'stock\s*#?\s*:\s*([A-Za-z0-9][\w-]{1,20})',
                r'inventory\s*#?\s*:\s*([A-Za-z0-9][\w-]{1,20})',
                r'no\.\s*(?:stock|inventaire)\s*:\s*([A-Za-z0-9][\w-]{1,20})',
            ]
            html_lower = html.lower()
            for pattern in patterns:
                m = re.search(pattern, html_lower)
                if m:
                    start = m.start(1)
                    return html[start:start + len(m.group(1))].strip()
        except Exception:
            pass

        return None

    def _tag_with_inventory_signals(self, products: List[Dict], html: str, url: str) -> List[Dict]:
        """Tague les produits avec les signaux d'inventaire et extrait le kilométrage.

        L'extraction du kilométrage se fait TOUJOURS (pas seulement en mode inventaire)
        car le kilométrage sert aussi à déterminer l'état neuf/occasion.
        Le tagage des signaux d'inventaire ne se fait qu'en mode inventaire seulement.
        """
        # TOUJOURS extraire le kilométrage du HTML (indépendant du mode inventaire)
        mileage = self._extract_mileage_from_html(html)
        if mileage is not None:
            for p in products:
                if p.get('kilometrage') is None:
                    p['kilometrage'] = mileage

        inv_number = self._extract_inventory_number(html)
        if inv_number:
            for p in products:
                if not p.get('inventaire'):
                    p['inventaire'] = inv_number

        # Les signaux d'inventaire ne sont nécessaires que pour le post-filtre
        if not getattr(self, '_inventory_only', False):
            return products

        signals = self._extract_inventory_signals(html, url)
        for p in products:
            p['_inventory_signals'] = signals
        return products

    def _filter_inventory_only_products(self, products: List[Dict]) -> List[Dict]:
        """Filtre les produits pour ne garder que l'inventaire réel du concessionnaire.

        Utilise une combinaison de signaux URL et contenu HTML pour distinguer
        l'inventaire réel (unités sur le plancher) des pages catalogue/brochure.

        Signaux d'inventaire (any → garder):
        - Numéro de stock (dans URL ou page)
        - VIN présent
        - URL contient /inventaire/, a-vendre, /occasion/, etc.
        - Kilométrage > 0 (véhicule usagé spécifique)

        Signaux catalogue (any → exclure):
        - URL contient w-get, /catalogue/, /showroom/
        - "À partir de" / MSRP sans numéro de stock
        """
        import re

        filtered = []
        excluded = 0

        for product in products:
            signals = product.get('_inventory_signals', {})
            is_inventory = False
            is_catalog = False

            # ── Signaux DÉFINITIFS d'inventaire (any → garder) ──
            if signals.get('has_stock_number'):
                is_inventory = True
            elif signals.get('has_vin'):
                is_inventory = True
            elif signals.get('url_has_inventory_marker'):
                is_inventory = True
            else:
                # Kilométrage > 0 = véhicule spécifique (usagé)
                km = signals.get('mileage_value', 0)
                if not km:
                    km = product.get('kilometrage', 0) or 0
                    if isinstance(km, str):
                        try:
                            km = int(re.sub(r'[^\d]', '', km))
                        except (ValueError, TypeError):
                            km = 0
                if km > 0:
                    is_inventory = True

            # ── Signaux DÉFINITIFS de catalogue (any → exclure) ──
            if not is_inventory:
                if signals.get('url_has_catalog_marker'):
                    is_catalog = True
                elif (signals.get('has_starting_at_price')
                      and not signals.get('has_stock_number')
                      and not signals.get('has_vin')):
                    is_catalog = True

            # ── Décision ──
            if is_inventory:
                filtered.append(product)
            elif is_catalog:
                excluded += 1
                if excluded <= 5:
                    name = product.get('name', 'N/A')[:60]
                    print(f"      🚫 Produit catalogue exclu: {name}")
            else:
                # Ambigu: inclure par défaut (le pré-filtre URL a déjà exclu les cas évidents)
                filtered.append(product)

            # Nettoyer le champ interne
            product.pop('_inventory_signals', None)

        if excluded > 5:
            print(
                f"      🚫 ... et {excluded - 5} autres produits catalogue exclus")

        if excluded > 0:
            print(
                f"      ✅ Filtre inventaire: {len(filtered)} produits conservés"
                f" ({excluded} produits catalogue exclus)")

        return filtered

    def _deduplicate_products(self, products: List[Dict]) -> List[Dict]:
        """Déduplique et regroupe les produits identiques (marque+modèle+année+état).

        Passe 1 : éliminer les vrais doublons (même sourceUrl ou même #inventaire).
        Passe 2 : regrouper les unités identiques (marque+modèle+année+état) avec
        un champ ``quantity`` et la liste ``groupedUrls``.
        """
        # ── Passe 1 : éliminer les doublons exacts (même page crawlée 2 fois) ──
        seen_urls: set = set()
        seen_inv: set = set()
        unique: List[Dict] = []
        for product in products:
            url = product.get('sourceUrl', '').rstrip('/')
            inv = product.get('inventaire', '')
            if url and url in seen_urls:
                continue
            if inv and inv in seen_inv:
                continue
            if url:
                seen_urls.add(url)
            if inv:
                seen_inv.add(inv)
            unique.append(product)

        # ── Passe 2 : regrouper par modèle identique ──
        groups: Dict[tuple, Dict] = {}

        for product in unique:
            marque = product.get('marque', '').lower().strip()
            modele = product.get('modele', '').lower().strip()

            if marque and modele:
                key = (marque, modele, product.get('annee', 0), product.get('etat', 'neuf'))
            else:
                key = (product.get('name', '').lower().strip(), product.get('annee', 0), product.get('etat', 'neuf'))

            if key not in groups:
                product['quantity'] = 1
                product['groupedUrls'] = [product.get('sourceUrl', '')]
                groups[key] = product
            else:
                groups[key]['quantity'] = groups[key].get('quantity', 1) + 1
                url = product.get('sourceUrl', '')
                if url:
                    groups[key].setdefault('groupedUrls', []).append(url)

        return list(groups.values())

    def _generate_scraper_code(
        self,
        url: str,
        selectors: Dict[str, str],
        product_urls: List[str]
    ) -> str:
        """Génère le code Python du scraper"""
        # Code simplifié pour le cache
        return f'''"""
Scraper généré automatiquement pour {url}
Version: {PROMPT_VERSION}
Date: {datetime.now().isoformat()}
"""

SITE_URL = "{url}"

SELECTORS = {json.dumps(selectors, indent=4)}

PRODUCT_URLS = {json.dumps(product_urls, indent=4)}

def scrape():
    """Fonction principale de scraping"""
    from bs4 import BeautifulSoup
    import requests
    
    session = requests.Session()
    session.headers.update({{
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }})
    
    products = []
    
    for url in PRODUCT_URLS:
        try:
            response = session.get(url, timeout=15)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'lxml')
                # Extraction avec les sélecteurs
                containers = soup.select(SELECTORS.get('product_container', ''))
                for container in containers:
                    product = {{}}
                    for field, selector in SELECTORS.items():
                        if field != 'product_container' and selector:
                            element = container.select_one(selector)
                            if element:
                                product[field] = element.get_text(strip=True)
                    if product:
                        product['sourceUrl'] = url
                        products.append(product)
        except Exception as e:
            print(f"Erreur {{url}}: {{e}}")
    
    return products

if __name__ == "__main__":
    results = scrape()
    print(f"{{len(results)}} produits extraits")
'''

    def _create_empty_result(
        self,
        url: str,
        start_time: float,
        error: str
    ) -> Dict[str, Any]:
        """Crée un résultat vide en cas d'erreur"""
        elapsed_time = time.time() - start_time

        return {
            'products': [],
            'metadata': {
                'site_url': url,
                'products_count': 0,
                'urls_processed': 0,
                'execution_time_seconds': round(elapsed_time, 2),
                'error': error,
                'prompt_version': PROMPT_VERSION
            },
            'scraper_info': {
                'selectors': {},
                'product_urls_count': 0
            }
        }


# =====================================================
# FONCTION PRINCIPALE POUR UTILISATION EN CLI
# =====================================================

def scrape_site(
    url: str,
    user_id: str,
    force_refresh: bool = False,
    categories: List[str] = None
) -> Dict[str, Any]:
    """Fonction utilitaire pour scraper un site

    Args:
        url: URL du site
        user_id: ID utilisateur (OBLIGATOIRE - doit être connecté)
        force_refresh: Forcer la régénération
        categories: Catégories à scraper

    Returns:
        Résultats du scraping

    Raises:
        ValueError: Si user_id n'est pas fourni
    """
    if not user_id:
        raise ValueError(
            "❌ Authentification requise: vous devez être connecté pour utiliser le scraper.")

    scraper = IntelligentScraper(user_id=user_id)
    return scraper.scrape(url, force_refresh=force_refresh, categories=categories)
