"""
Agent d'exploration qui utilise Gemini pour découvrir URLs et extraire infos produits
Étape 1 du nouveau flux : Exploration + Extraction Gemini
"""
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

    def explore_and_extract(self, url: str, initial_html: Optional[str] = None) -> Dict[str, Any]:
        """Explore le site et extrait les infos produits via Gemini

        Args:
            url: URL de base du site
            initial_html: HTML initial de la page d'accueil (optionnel)

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
        product_urls = self._discover_product_urls(url, initial_html)
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

    def _discover_product_urls(self, url: str, initial_html: Optional[str] = None) -> List[str]:
        """Découvre toutes les URLs de produits (sitemap, pagination, navigation)"""
        tools = self.ai_tools

        # Récupérer HTML initial si non fourni
        if not initial_html:
            initial_html = tools.get(url, use_selenium=False)
            if not initial_html or len(initial_html) < 1000:
                initial_html = tools.browser_get(url)

        all_product_urls = []

        # 1. Essayer le sitemap (priorité absolue)
        print(f"      🗺️ Recherche du sitemap...")
        sitemap_urls = tools.get_sitemap_urls(url)
        if sitemap_urls:
            print(
                f"         ✅ {len(sitemap_urls)} URLs trouvées dans le sitemap")
            all_product_urls.extend(sitemap_urls[:500])  # Limite de sécurité
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
            max_pages = 100
            max_urls = 500

            while page <= max_pages and len(all_product_urls) < max_urls:
                try:
                    page_url = tools.build_pagination_url(
                        url, pagination, page)
                    page_html = tools.get(page_url, use_selenium=False)
                    if not page_html or len(page_html) < 1000:
                        consecutive_empty += 1
                        if consecutive_empty >= 3:
                            break
                        page += 1
                        continue

                    # Extraire URLs de produits de cette page
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
                    time.sleep(0.3)  # Rate limiting
                except Exception as e:
                    print(f"         ⚠️ Erreur page {page}: {e}")
                    consecutive_empty += 1
                    if consecutive_empty >= 3:
                        break
                    page += 1
        else:
            print(f"         ⚠️ Aucune pagination détectée")

        # 3. Découvrir depuis les liens de la page d'accueil
        if len(all_product_urls) < 50:
            print(f"      🔗 Découverte depuis les liens...")
            discovered_urls = tools.discover_product_urls(initial_html, url)
            all_product_urls.extend(discovered_urls)

        # Dédupliquer
        normalized_urls_dict = {}
        for url_item in all_product_urls:
            normalized = tools.normalize_url_for_dedup(url_item)
            if normalized not in normalized_urls_dict or len(url_item) < len(normalized_urls_dict[normalized]):
                normalized_urls_dict[normalized] = url_item

        # Dédupliquer par modèle+année (ignorer les couleurs)
        model_year_urls_dict = {}
        for url_item in normalized_urls_dict.values():
            model_year_key = tools.normalize_url_by_model_year(url_item)
            if model_year_key not in model_year_urls_dict:
                model_year_urls_dict[model_year_key] = url_item

        unique_urls = list(model_year_urls_dict.values())
        print(f"      ✅ {len(unique_urls)} URLs uniques après déduplication")

        # Filtrer les URLs invalides (pages non-produits)
        filtered_urls = []
        excluded_count = 0
        for url in unique_urls:
            if self._is_valid_product_url(url):
                filtered_urls.append(url)
            else:
                excluded_count += 1
                if excluded_count <= 5:  # Afficher seulement les 5 premières exclusions
                    print(f"      🚫 URL exclue (non-produit): {url[:80]}...")

        if excluded_count > 5:
            print(f"      🚫 ... et {excluded_count - 5} autres URLs exclues")

        print(
            f"      ✅ {len(filtered_urls)} URLs de produits valides après filtrage")
        return filtered_urls

    def _is_valid_product_url(self, url: str) -> bool:
        """Valide qu'une URL est bien une page de produit d'inventaire (pas de catalogue) et non une page de service/article/etc.

        Args:
            url: URL à valider

        Returns:
            True si l'URL est une page de produit d'inventaire valide, False sinon
        """
        url_lower = url.lower()
        
        # EXCLURE explicitement les URLs de catalogue
        if 'catalogue' in url_lower or 'catalog' in url_lower:
            return False

        # Segments de chemin à exclure (pages non-produits)
        exclude_segments = [
            '/catalogue', '/catalog',  # URLs de catalogue (déjà vérifié ci-dessus mais ajout pour sécurité)
            '/service', '/service-', '/services', '/sav',
            '/article', '/articles', '/blog', '/blogs',
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
            '/offre', '/offres', '/wishlist', '/favoris'
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

        # INDIQUEURS pour pages d'INVENTAIRE (prioriser sur les indicateurs généraux)
        inventory_indicators = [
            'inventaire', 'inventory', 'vendre', 'a-vendre', 'a-vendre-',
            'stock', 'en-stock', 'disponible'
        ]
        has_inventory_indicator = any(
            indicator in url_lower for indicator in inventory_indicators)
        
        # Mots-clés qui indiquent une page de produit (fallback)
        product_indicators = [
            'moto', 'motorcycle', 'motocyclette', 'vehicule', 'vehicle',
            'quad', 'atv', 'vtt', 'motoneige', 'snowmobile',
            'cote-a-cote', 'side-by-side', 'sxs', 'utv',
            'produit', 'product', 'detail', 'details', 'fiche'
        ]

        # L'URL doit contenir au moins un indicateur de produit (prioriser inventaire)
        has_product_indicator = has_inventory_indicator or any(
            indicator in url_lower for indicator in product_indicators)

        # Vérifier aussi le format : les URLs de produits ont souvent :
        # - Un identifiant (ex: /t96538/, /u00380/)
        # - Un modèle spécifique (ex: /ktm-1290-adv-r-2024/)
        # - Un format structuré (ex: /motocyclette/ktm-350-xc-f/)
        has_structured_format = (
            # Contient des chiffres
            any(char.isdigit() for char in url.split('/')[-1]) or
            # Au moins 4 segments (ex: /fr/motocyclette/model/)
            len(url.split('/')) >= 4 or
            any(part.isdigit() for part in url.split('/')
                if len(part) > 3)  # Segment avec chiffres
        )

        return has_product_indicator and has_structured_format

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

            products = result.get('products', [])
            all_products.extend(products)

            # Essayer d'extraire les sélecteurs depuis la réponse
            if 'detected_selectors' in result:
                detected_selectors.update(result['detected_selectors'])

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
