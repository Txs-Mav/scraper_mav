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
except ImportError:
    from supabase_storage import SupabaseStorage, get_storage
    from selector_detector import SelectorDetector
    from exploration_agent import ExplorationAgent
    from scraper_generator import ScraperGenerator
    from config import CACHE_DIR, PROMPT_VERSION


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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })

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

        print(f"\n{'='*70}")
        print(f"🚀 SCRAPER INTELLIGENT v{PROMPT_VERSION}")
        print(f"{'='*70}")
        print(f"🌐 Site: {url}")
        print(f"👤 User ID: {self.user_id or 'Non connecté (local)'}")
        print(f"🔄 Force refresh: {force_refresh}")
        print(f"📦 Inventaire seulement: {'Oui' if inventory_only else 'Non'}")

        # Normaliser l'URL
        url = self._normalize_url(url)

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
                        'categories': categories
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

        print(f"\n✅ {len(products)} produits extraits")

        # =====================================================
        # PROTECTION CACHE: Invalider si 0 produits extraits
        # =====================================================
        # Un scraper qui ne trouve aucun produit est probablement cassé.
        # Supprimer le cache pour forcer une nouvelle détection au prochain essai.
        if len(products) == 0 and cache_status in ("miss", "expired"):
            if self.storage:
                print(
                    f"⚠️  0 produits extraits → invalidation du cache pour éviter de réutiliser un scraper cassé")
                try:
                    self.storage.delete_scraper(url)
                except Exception as e:
                    print(
                        f"   ⚠️  Erreur lors de l'invalidation du cache: {e}")
        elif len(products) == 0 and cache_status == "hit":
            # Le cache existait déjà mais n'a rien extrait → invalider aussi
            if self.storage:
                print(f"⚠️  Cache existant mais 0 produits → invalidation du cache")
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

        # Résumé final
        print(f"\n{'='*70}")
        print(f"✅ SCRAPING TERMINÉ!")
        print(f"{'='*70}")
        print(f"📦 Produits extraits: {len(products)}")
        print(f"⏱️  Temps total: {elapsed_time:.1f}s")
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

    def _check_site_connectivity(self, url: str, max_retries: int = 4, initial_wait: float = 3.0) -> bool:
        """Vérifie que le site est accessible avant de lancer l'exploration.

        Effectue un HEAD request avec retry et exponential backoff.
        Gère spécifiquement les erreurs DNS transitoires.

        Args:
            url: URL du site à vérifier
            max_retries: Nombre maximum de tentatives (défaut: 4)
            initial_wait: Délai initial en secondes (défaut: 3s)

        Returns:
            True si le site est accessible, False sinon
        """
        import socket

        parsed = urlparse(url)
        hostname = parsed.netloc or parsed.hostname

        print(f"\n🔌 Vérification de la connectivité: {hostname}...")

        for attempt in range(max_retries):
            try:
                # 1. Vérifier la résolution DNS
                socket.getaddrinfo(
                    hostname, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)

                # 2. Vérifier l'accès HTTP (HEAD request rapide)
                response = self.session.head(
                    url, timeout=15, allow_redirects=True)
                # Accepter tout code < 500 (même 403/404 = site accessible)
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
                is_dns = any(kw in error_str for kw in [
                    'nameresolution', 'name resolution', 'nodename nor servname',
                    'temporary failure', 'getaddrinfo', 'newconnectionerror',
                ])
                is_transient = is_dns or any(kw in error_str for kw in [
                    'timeout', 'timed out', 'connectionerror', 'connection refused',
                    'connectionreset', 'remotedisconnected', 'max retries',
                    '502', '503', '504',
                ])

                if attempt < max_retries - 1 and is_transient:
                    wait_time = initial_wait * \
                        (2 ** attempt)  # 3s, 6s, 12s, 24s
                    error_type = "DNS" if is_dns else "connexion"
                    print(
                        f"   ⚠️ Tentative {attempt + 1}/{max_retries}: Erreur {error_type} → {e}")
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
        """Extrait les produits de toutes les URLs"""
        all_products = []

        # Utiliser le multithreading pour accélérer
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {
                executor.submit(self._extract_from_url, url, selectors, base_url): url
                for url in urls
            }

            for future in as_completed(futures):
                url = futures[future]
                try:
                    products = future.result()
                    if products:
                        all_products.extend(products)
                        print(
                            f"      ✅ {len(products)} produits de {url[:50]}...")
                except Exception as e:
                    print(f"      ❌ Erreur {url[:50]}...: {e}")

        # Dédupliquer les produits
        unique_products = self._deduplicate_products(all_products)

        return unique_products

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
            response = self.session.get(url, timeout=15)
            if response.status_code != 200:
                return []

            html = response.text

            # ============================================================
            # PRIORITÉ 1: Extraction depuis données structurées (JSON-LD, OG)
            # C'est la méthode la plus fiable pour les pages de détail produit
            # ============================================================
            product_from_structured = self._extract_structured_data(
                html, url, base_url)

            if product_from_structured and product_from_structured.get('name') and product_from_structured.get('prix'):
                # Extraction structurée réussie AVEC un prix — utiliser ce résultat
                # IMPORTANT: Toujours forcer sourceSite au site en cours (pas conditionnel)
                product_from_structured['sourceSite'] = base_url
                product_from_structured['sourceUrl'] = url
                # Détecter l'état/condition du produit
                self._detect_product_condition(
                    product_from_structured, url, html)
                return [product_from_structured]

            # ============================================================
            # PRIORITÉ 2: Extraction via sélecteurs CSS (pages listing)
            # ============================================================
            products = self.selector_detector.extract_with_selectors(
                html=html,
                selectors=selectors,
                base_url=base_url
            )

            # IMPORTANT: Toujours FORCER sourceUrl et sourceSite (pas conditionnel)
            # Cela garantit qu'un produit extrait d'un site ne sera jamais attribué à un autre
            for product in products:
                product['sourceUrl'] = product.get('sourceUrl') or url
                # Toujours forcer le site source
                product['sourceSite'] = base_url
                # Détecter l'état/condition du produit
                self._detect_product_condition(product, url, html)

            # ============================================================
            # HYBRIDE: Si les données structurées avaient un nom mais pas de prix,
            # essayer de trouver le prix, puis retourner les données structurées
            # (MÊME SANS PRIX — c'est mieux que des données CSS garbage)
            # ============================================================
            if product_from_structured and product_from_structured.get('name') and not product_from_structured.get('prix'):
                # Chercher un prix dans les produits CSS
                css_price = None
                for p in products:
                    if p.get('prix') and p['prix'] > 0:
                        css_price = p['prix']
                        break

                if css_price:
                    product_from_structured['prix'] = css_price

                # Essayer aussi le fallback regex sur le HTML brut
                if not product_from_structured.get('prix'):
                    from scraper_ai.templates.scraper_template import extract_price
                    import re
                    price_patterns = [
                        r'class="[^"]*(?:price|prix)[^"]*"[^>]*>([^<]+)',
                        r'itemprop="price"[^>]*content="([^"]+)"',
                        r'data-price="([^"]+)"',
                        r'<span[^>]*class="[^"]*amount[^"]*"[^>]*>([^<]+)',
                    ]
                    for pattern in price_patterns:
                        matches = re.findall(pattern, html, re.I)
                        for match_text in matches:
                            price = extract_price(match_text)
                            if price > 0:
                                product_from_structured['prix'] = price
                                break
                        if product_from_structured.get('prix'):
                            break

                # IMPORTANT: Retourner les données structurées MÊME SANS PRIX
                # Un produit avec nom+marque+modèle sans prix est bien plus utile
                # qu'un produit CSS garbage sans nom ni modèle
                product_from_structured['sourceSite'] = base_url
                product_from_structured['sourceUrl'] = url
                self._detect_product_condition(
                    product_from_structured, url, html)
                return [product_from_structured]

            return products

        except Exception as e:
            return []

    def _extract_structured_data(self, html: str, url: str, base_url: str) -> Dict:
        """Extrait les données produit depuis JSON-LD, Open Graph, et microdata

        Cette méthode est essentielle pour les pages de détail produit
        qui utilisent des données structurées standardisées.
        """
        import json
        import re
        from urllib.parse import urljoin

        soup = BeautifulSoup(html, 'html.parser')
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

    def _detect_product_condition(self, product: Dict, url: str, html: str = '') -> Dict:
        """Détecte l'état/condition du produit et le sourceCategorie.

        Analyse TOUTES les URLs disponibles (page courante + sourceUrl du produit)
        car l'état est souvent encodé dans l'URL:
          - /usage/motocyclette/inventaire/... → occasion
          - /neuf/motoneige/... → neuf
          - /inventaire-occasion/... → occasion

        Signaux utilisés (par priorité):
        1. Données structurées (déjà extraites dans product['etat'] via JSON-LD)
        2. URL du produit (sourceUrl) - souvent le signal le plus fiable
        3. URL de la page courante (listing page)
        4. Contenu HTML de la page (badges, breadcrumbs, titre)
        5. Kilométrage (si > 100km, probablement occasion)
        6. Fallback: déduire depuis sourceCategorie

        Args:
            product: Le produit à enrichir
            url: URL de la page courante (peut être une page listing)
            html: Contenu HTML de la page (optionnel)

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

        # ── Détection de l'état (etat) ──
        # Si déjà défini par données structurées ou selector_detector, ne pas écraser
        if not product.get('etat'):
            etat = None

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

            # Signal 2: Contenu HTML (titre, breadcrumbs, badges)
            if not etat and html:
                soup = BeautifulSoup(html, 'html.parser')

                # Chercher dans le titre de la page
                title_elem = soup.find('title')
                title_text = title_elem.get_text(
                    strip=True).lower() if title_elem else ''

                # Chercher dans les breadcrumbs et badges
                badge_texts = []
                for selector in ['[class*="badge"]', '[class*="label"]', '[class*="tag"]',
                                 '[class*="condition"]', '[class*="etat"]', '[class*="state"]',
                                 '[class*="stock"]', '[class*="status"]',
                                 '.breadcrumb', 'nav[aria-label*="breadcrumb"]',
                                 '[class*="breadcrumb"]', '[class*="type-vehicle"]',
                                 '[class*="vehicle-type"]']:
                    for elem in soup.select(selector):
                        badge_texts.append(elem.get_text(strip=True).lower())

                # Chercher dans les métadonnées de la page
                meta_texts = []
                for meta in soup.find_all('meta', attrs={'name': True}):
                    meta_texts.append(str(meta.get('content', '')).lower())

                all_page_text = ' '.join(
                    [title_text] + badge_texts + meta_texts)

                # Détection dans le contenu avec regex pour mots entiers
                if re.search(r'\b(usagé|usag[eé]|occasion|used|pre-owned|pré-possédé)\b', all_page_text):
                    etat = 'occasion'
                elif re.search(r'\b(démonstrateur|demonstrateur|demo unit|démo)\b', all_page_text):
                    etat = 'demonstrateur'
                elif re.search(r'\b(neuf|brand new)\b', all_page_text):
                    etat = 'neuf'

            # Signal 3: Kilométrage comme indicateur
            if not etat:
                km = product.get('kilometrage', 0) or 0
                if isinstance(km, str):
                    try:
                        km = int(re.sub(r'[^\d]', '', km))
                    except (ValueError, TypeError):
                        km = 0
                if km > 100:
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

        return product

    def _deduplicate_products(self, products: List[Dict]) -> List[Dict]:
        """Déduplique les produits basé sur le nom et le prix"""
        seen = set()
        unique = []

        for product in products:
            # Créer une clé unique
            key = (
                product.get('name', '').lower().strip(),
                product.get('prix', 0),
                product.get('sourceUrl', '')
            )

            if key not in seen:
                seen.add(key)
                unique.append(product)

        return unique

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

PRODUCT_URLS = {json.dumps(product_urls[:100], indent=4)}  # Limité à 100 URLs

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
                soup = BeautifulSoup(response.text, 'html.parser')
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
