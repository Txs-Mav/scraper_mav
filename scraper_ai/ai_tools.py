"""
Outils exposés à l'agent IA pour explorer les sites web et générer des scrapers
"""
import json
import re
from pathlib import Path
from typing import List, Dict, Optional, Any
from urllib.parse import urljoin, urlparse, urlunparse
import requests
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET

try:
    from .config import CACHE_DIR
except ImportError:
    from config import CACHE_DIR

# Importer selenium_utils depuis le scraper principal
try:
    import sys
    from pathlib import Path
    scraper_path = Path(__file__).parent.parent / 'scraper'
    if scraper_path.exists():
        sys.path.insert(0, str(scraper_path.parent))
        from scraper.selenium_utils import SELENIUM_AVAILABLE, fetch_page_with_selenium  # type: ignore
    else:
        SELENIUM_AVAILABLE = False
        fetch_page_with_selenium = None
except ImportError:
    # Fallback si selenium_utils n'existe pas
    SELENIUM_AVAILABLE = False
    fetch_page_with_selenium = None


class AITools:
    """Outils pour l'agent IA"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.cache_dir = Path(CACHE_DIR)
        self.cache_dir.mkdir(exist_ok=True)
        self.discovered_urls: List[str] = []
        self.visited_urls: set = set()

    def get(self, url: str, use_selenium: bool = False) -> str:
        """
        Fetch raw HTML from a URL.

        Args:
            url: URL à récupérer
            use_selenium: Si True, utilise Selenium pour le rendu JavaScript

        Returns:
            HTML brut de la page
        """
        if url in self.visited_urls:
            return ""

        self.visited_urls.add(url)

        try:
            if use_selenium and SELENIUM_AVAILABLE and fetch_page_with_selenium:
                html = fetch_page_with_selenium(url)
            else:
                response = self.session.get(url, timeout=30)
                response.raise_for_status()
                html = response.text

            return html
        except Exception as e:
            print(f"⚠️ Erreur lors de la récupération de {url}: {e}")
            return ""

    def browser_get(self, url: str) -> str:
        """
        Return fully rendered HTML using headless browser.
        Utilise Selenium si disponible.

        Args:
            url: URL à récupérer

        Returns:
            HTML complètement rendu (après JavaScript)
        """
        return self.get(url, use_selenium=True)

    def parse_html(self, html: str, selector: str) -> List[str]:
        """
        Return elements matching a CSS selector.

        Args:
            html: HTML à parser
            selector: Sélecteur CSS (ex: "a[href]", ".product-title", "#price")

        Returns:
            Liste des textes/attributs des éléments correspondants
        """
        if not html:
            return []

        try:
            soup = BeautifulSoup(html, 'html.parser')
            elements = soup.select(selector)

            results = []
            for elem in elements:
                # Si c'est un lien, retourner l'URL
                if elem.name == 'a' and elem.get('href'):
                    results.append(elem.get('href', ''))
                # Si c'est une image, retourner le src
                elif elem.name == 'img' and elem.get('src'):
                    results.append(elem.get('src', ''))
                # Sinon, retourner le texte
                else:
                    text = elem.get_text(strip=True)
                    if text:
                        results.append(text)

            return results
        except Exception as e:
            print(f"⚠️ Erreur lors du parsing HTML: {e}")
            return []

    def normalize_url(self, base: str, link: str) -> str:
        """
        Convert relative link to full URL.

        Args:
            base: URL de base
            link: Lien relatif ou absolu

        Returns:
            URL complète normalisée
        """
        if not link:
            return ""

        # Nettoyer le lien
        link = link.strip()

        # Ignorer les ancres et javascript
        if link.startswith('#') or link.startswith('javascript:'):
            return ""

        # Si c'est déjà une URL complète, la retourner
        if link.startswith('http://') or link.startswith('https://'):
            return link

        # Normaliser avec urljoin
        try:
            normalized = urljoin(base, link)
            # Nettoyer les paramètres de requête et fragments
            parsed = urlparse(normalized)
            clean_url = urlunparse((
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                '',
                '',
                ''
            ))
            return clean_url.rstrip('/')
        except Exception as e:
            print(f"⚠️ Erreur lors de la normalisation de {link}: {e}")
            return ""

    def get_all_links(self, html: str, base_url: str) -> List[str]:
        """
        Extract all links from HTML and normalize them.

        Args:
            html: HTML à analyser
            base_url: URL de base pour normaliser les liens

        Returns:
            Liste des URLs normalisées
        """
        links = self.parse_html(html, "a[href]")
        normalized = []
        base_domain = urlparse(base_url).netloc.replace('www.', '')

        for link in links:
            normalized_link = self.normalize_url(base_url, link)
            if normalized_link:
                # Filtrer pour ne garder que les liens du même domaine
                link_domain = urlparse(
                    normalized_link).netloc.replace('www.', '')
                if link_domain == base_domain:
                    normalized.append(normalized_link)

        return list(set(normalized))  # Dédupliquer

    def get_sitemap_urls(self, url: str) -> List[str]:
        """
        Return all URLs from sitemap.xml with enhanced detection.

        Détection améliorée:
        - Cherche dans robots.txt pour Sitemap: directives
        - Supporte sitemaps multiples et sitemap index
        - Détection automatique de tous les sitemaps disponibles

        Args:
            url: URL de base du site

        Returns:
            Liste des URLs trouvées dans le sitemap
        """
        sitemap_urls = []
        sitemap_paths_to_try = []

        # ÉTAPE 1: Chercher dans robots.txt pour Sitemap: directives
        try:
            parsed = urlparse(url)
            robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
            response = self.session.get(robots_url, timeout=10)
            if response.status_code == 200:
                robots_content = response.text
                # Extraire toutes les directives Sitemap:
                sitemap_directives = re.findall(
                    r'[Ss]itemap:\s*(.+)', robots_content)
                for sitemap_directive in sitemap_directives:
                    sitemap_path = sitemap_directive.strip()
                    if sitemap_path:
                        sitemap_paths_to_try.append(sitemap_path)
                        print(
                            f"✅ Sitemap trouvé dans robots.txt: {sitemap_path}")
        except Exception as e:
            print(f"⚠️ Erreur lors de la lecture robots.txt: {e}")

        # ÉTAPE 2: Ajouter les URLs de sitemap communes
        common_paths = [
            '/sitemap.xml',
            '/sitemap_index.xml',
            '/sitemaps/sitemap.xml',
            '/wp-sitemap.xml',
            '/sitemap1.xml',
            '/sitemap-products.xml',
            '/sitemap-0.xml'
        ]
        sitemap_paths_to_try.extend(common_paths)

        # ÉTAPE 3: Essayer tous les sitemaps trouvés
        visited_sitemaps = set()

        def parse_sitemap(sitemap_url: str) -> List[str]:
            """Parse un sitemap et retourne ses URLs"""
            if sitemap_url in visited_sitemaps:
                return []
            visited_sitemaps.add(sitemap_url)

            urls = []
            try:
                response = self.session.get(sitemap_url, timeout=10)
                if response.status_code == 200:
                    content = response.text

                    # Parser le XML
                    try:
                        root = ET.fromstring(content)
                        ns = {
                            'sitemap': 'http://www.sitemaps.org/schemas/sitemap/0.9'}

                        # Si c'est un sitemap index
                        if root.tag.endswith('sitemapindex'):
                            sitemaps = root.findall('.//sitemap:sitemap', ns)
                            for sitemap in sitemaps:
                                loc = sitemap.find('sitemap:loc', ns)
                                if loc is not None:
                                    # Récursivement récupérer les URLs de ce sitemap
                                    urls.extend(parse_sitemap(loc.text))
                        # Si c'est un sitemap normal
                        elif root.tag.endswith('urlset'):
                            url_elems = root.findall('.//sitemap:url', ns)
                            for url_elem in url_elems:
                                loc = url_elem.find('sitemap:loc', ns)
                                if loc is not None:
                                    urls.append(loc.text)
                    except ET.ParseError:
                        # Si le parsing XML échoue, essayer de trouver les URLs avec regex
                        found_urls = re.findall(r'<loc>(.*?)</loc>', content)
                        urls.extend(found_urls)
            except Exception as e:
                print(f"⚠️ Erreur lors du parsing de {sitemap_url}: {e}")

            return urls

        # Essayer tous les sitemaps
        for path in sitemap_paths_to_try:
            if path.startswith('http'):
                sitemap_url = path
            else:
                sitemap_url = urljoin(url, path)

            urls = parse_sitemap(sitemap_url)
            if urls:
                sitemap_urls.extend(urls)
                print(f"✅ {len(urls)} URLs trouvées dans {sitemap_url}")

        return list(set(sitemap_urls))  # Dédupliquer

    def save_json(self, name: str, data: Dict[str, Any]) -> bool:
        """
        Save data to JSON file in cache directory.

        Args:
            name: Nom du fichier (sans extension)
            data: Données à sauvegarder

        Returns:
            True si succès, False sinon
        """
        try:
            file_path = self.cache_dir / f"{name}.json"
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"⚠️ Erreur lors de la sauvegarde de {name}: {e}")
            return False

    def load_json(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Load data from JSON file in cache directory.

        Args:
            name: Nom du fichier (sans extension)

        Returns:
            Données chargées ou None si erreur
        """
        try:
            file_path = self.cache_dir / f"{name}.json"
            if file_path.exists():
                with open(file_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return None
        except Exception as e:
            print(f"⚠️ Erreur lors du chargement de {name}: {e}")
            return None

    def write_file(self, path: str, content: str) -> bool:
        """
        Write the scraper code to a file.

        Args:
            path: Chemin du fichier (relatif au cache_dir ou absolu)
            content: Contenu à écrire

        Returns:
            True si succès, False sinon
        """
        try:
            # Si le chemin est relatif, le mettre dans le cache_dir
            if not Path(path).is_absolute():
                file_path = self.cache_dir / path
            else:
                file_path = Path(path)

            # Créer les dossiers parents si nécessaire
            file_path.parent.mkdir(parents=True, exist_ok=True)

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)

            return True
        except Exception as e:
            print(f"⚠️ Erreur lors de l'écriture de {path}: {e}")
            return False

    def discover_product_urls(self, html: str, base_url: str) -> List[str]:
        """
        Discover product URLs from HTML.
        Utilise des heuristiques pour identifier les pages de produits.

        Args:
            html: HTML à analyser
            base_url: URL de base

        Returns:
            Liste des URLs de produits potentiels
        """
        all_links = self.get_all_links(html, base_url)

        # Mots-clés pour identifier les pages de produits
        product_keywords = [
            'product', 'produit', 'item', 'article',
            'inventory', 'inventaire', 'stock',
            'detail', 'details', 'fiche',
            'moto', 'vehicle', 'vehicule',
            'quad', 'atv', 'snowmobile', 'motoneige'
        ]

        # Mots-clés à exclure (pages non-produits)
        exclude_keywords = [
            # Services et support
            'service', 'service-apres-vente', 'services', 'sav', 'support',
            'entretien', 'reparation', 'reparations', 'maintenance',
            # Articles et contenu
            'article', 'articles', 'blog', 'blogs', 'news', 'actualite', 'actualites',
            'conseil', 'conseils', 'guide', 'guides', 'tutoriel', 'tutoriels',
            # Formations et événements
            'formation', 'formations', 'evenement', 'evenements', 'event', 'events',
            'ouverture', 'invitation',
            # Promotions (pages de promotion, pas produits)
            'promotion', 'promotions', 'promo', 'promos', 'offre', 'offres',
            # Pages administratives
            'contact', 'about', 'a-propos', 'nous-joindre',
            'politique', 'privacy', 'cgv', 'mentions-legales', 'conditions',
            # E-commerce fonctionnel
            'cart', 'panier', 'checkout', 'paiement', 'payment',
            'login', 'connexion', 'register', 'inscription', 'account', 'compte',
            'search', 'recherche', 'wishlist', 'favoris',
            # Autres
            'faq', 'aide', 'help', 'assistance'
        ]

        product_urls = []
        for link in all_links:
            link_lower = link.lower()

            # Exclure si contient un mot-clé d'exclusion
            if any(keyword in link_lower for keyword in exclude_keywords):
                continue

            # Inclure si contient un mot-clé de produit
            if any(keyword in link_lower for keyword in product_keywords):
                product_urls.append(link)

        return list(set(product_urls))

    def detect_pagination(self, html: str, current_url: str) -> Optional[Dict[str, Any]]:
        """
        Detect pagination pattern from HTML and URL.

        Méthode de détection en 3 étapes:
        1. Cherche les patterns dans les liens HTML (a[href*="page="], etc.)
        2. Cherche les patterns dans l'URL actuelle (?page=1, ?paged=2, etc.)
        3. Si rien trouvé, TESTE automatiquement les patterns standards en construisant
           des URLs de test (page 2) et vérifiant si le contenu est différent

        Args:
            html: HTML de la page
            current_url: URL actuelle

        Returns:
            Dictionnaire avec type, pattern, exemple, current_page, detected_by, ou None
            - detected_by: 'html' (détecté dans HTML), 'url' (détecté dans URL), 'test' (détecté par test)
        """
        soup = BeautifulSoup(html, 'html.parser')

        # Chercher les liens de pagination
        pagination_patterns = [
            ('a[href*="page="]', 'url_params', 'page='),
            ('a[href*="paged="]', 'url_params', 'paged='),  # WordPress, FacetWP
            ('a[href*="fwp_paged="]', 'url_params', 'fwp_paged='),  # FacetWP
            ('a[href*="/page/"]', 'path', '/page/'),
            ('a[href*="?p="]', 'url_params', 'p='),
            ('a[href*="p="]', 'url_params', 'p='),
            ('a[href*="offset="]', 'url_params', 'offset='),
            ('a[href*="start="]', 'url_params', 'start='),
        ]

        for selector, ptype, pattern in pagination_patterns:
            links = soup.select(selector)
            if links:
                # Extraire le pattern
                first_link = links[0].get('href', '')
                # Essayer d'extraire le numéro de page depuis l'URL
                page_number = None
                if pattern in first_link:
                    try:
                        # Extraire le numéro après le pattern
                        match = re.search(
                            rf'{re.escape(pattern)}(\\d+)', first_link)
                        if match:
                            page_number = int(match.group(1))
                    except (ValueError, AttributeError):
                        pass

                return {
                    'type': ptype,
                    'pattern': pattern,
                    'selector': selector,
                    'example': first_link,
                    'current_page': page_number
                }

        # Chercher aussi dans l'URL actuelle si elle contient un pattern de pagination
        url_patterns = [
            r'[?&]fwp_paged=(\d+)',
            r'[?&]paged=(\d+)',
            r'[?&]page=(\d+)',
            r'[?&]p=(\d+)',
            r'/page/(\d+)',
        ]

        for pattern in url_patterns:
            match = re.search(pattern, current_url)
            if match:
                page_num = int(match.group(1))
                # Déterminer le pattern utilisé
                if 'fwp_paged=' in current_url:
                    return {
                        'type': 'url_params',
                        'pattern': 'fwp_paged=',
                        'example': current_url,
                        'current_page': page_num
                    }
                elif 'paged=' in current_url:
                    return {
                        'type': 'url_params',
                        'pattern': 'paged=',
                        'example': current_url,
                        'current_page': page_num
                    }
                elif 'page=' in current_url:
                    return {
                        'type': 'url_params',
                        'pattern': 'page=',
                        'example': current_url,
                        'current_page': page_num
                    }

        # Chercher le bouton "Suivant"
        next_buttons = soup.find_all(
            'a', string=re.compile(r'(next|suivant|>|→)', re.I))
        if next_buttons:
            next_href = next_buttons[0].get('href', '')
            if next_href:
                return {
                    'type': 'next_button',
                    'selector': 'a[contains(text(), "next")]',
                    'example': next_href
                }

        # Si aucun pattern détecté, tester les patterns standards
        # en construisant des URLs de test et vérifiant si elles retournent du contenu différent
        print("⚠️ Aucun pattern de pagination détecté, test des patterns standards...")

        # Patterns standards à tester (dans l'ordre de probabilité)
        standard_patterns = [
            ('page=', 'url_params'),
            ('paged=', 'url_params'),
            ('fwp_paged=', 'url_params'),
            ('p=', 'url_params'),
            ('offset=', 'url_params'),
            ('start=', 'url_params'),
        ]

        # Obtenir le contenu de la page actuelle pour comparaison
        current_content_length = len(html)
        current_product_count = len(
            self.discover_product_urls(html, current_url))

        for pattern, ptype in standard_patterns:
            # Construire URL de test (page 2)
            parsed = urlparse(current_url)
            query_params = {}

            # Parser les paramètres existants
            if parsed.query:
                from urllib.parse import parse_qs
                query_params = {k: v[0] if v else '' for k,
                                v in parse_qs(parsed.query).items()}

            # Ajouter le paramètre de pagination
            param_name = pattern.rstrip('=')
            query_params[param_name] = '2'

            # Reconstruire l'URL
            from urllib.parse import urlencode
            new_query = urlencode(query_params)
            test_url = urlunparse((
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                new_query,
                parsed.fragment
            ))

            # Tester l'URL
            try:
                response = self.session.get(test_url, timeout=10)
                if response.status_code == 200:
                    test_html = response.text
                    test_content_length = len(test_html)
                    test_product_count = len(
                        self.discover_product_urls(test_html, current_url))

                    # Vérifier si la page 2 est différente de la page 1
                    # (différent contenu OU différents produits)
                    if (test_content_length != current_content_length or
                            test_product_count != current_product_count):
                        print(
                            f"✅ Pattern détecté par test: {pattern} (page 2 différente de page 1)")
                        return {
                            'type': ptype,
                            'pattern': pattern,
                            'example': test_url,
                            'detected_by': 'test',
                            'current_page': 1
                        }
            except Exception as e:
                # Continuer avec le pattern suivant si erreur
                continue

        # Si aucun pattern ne fonctionne, retourner None
        print("⚠️ Aucun pattern de pagination standard ne fonctionne")
        return None

    def build_pagination_url(self, base_url: str, pagination_info: Dict, page_number: int) -> str:
        """
        Build pagination URL from base URL and pagination info.

        Args:
            base_url: URL de base
            pagination_info: Dictionnaire retourné par detect_pagination
            page_number: Numéro de page à construire

        Returns:
            URL complète avec pagination
        """
        if not pagination_info:
            return base_url

        pattern = pagination_info.get('pattern', '')
        ptype = pagination_info.get('type', 'url_params')

        # Nettoyer l'URL de base (enlever les paramètres de pagination existants)
        parsed = urlparse(base_url)
        query_params = {}

        # Parser les paramètres existants
        if parsed.query:
            from urllib.parse import parse_qs
            query_params = {k: v[0] if v else '' for k,
                            v in parse_qs(parsed.query).items()}

        # Construire l'URL selon le type
        if ptype == 'url_params':
            # Extraire le nom du paramètre (ex: "fwp_paged=" -> "fwp_paged")
            param_name = pattern.rstrip('=')
            query_params[param_name] = str(page_number)

            # Reconstruire l'URL
            from urllib.parse import urlencode
            new_query = urlencode(query_params)
            new_url = urlunparse((
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                new_query,
                parsed.fragment
            ))
            return new_url

        elif ptype == 'path':
            # Pattern comme /page/1/
            base_path = parsed.path.rstrip('/')
            new_path = f"{base_path}{pattern}{page_number}/"
            new_url = urlunparse((
                parsed.scheme,
                parsed.netloc,
                new_path,
                parsed.params,
                parsed.query,
                parsed.fragment
            ))
            return new_url

        else:
            # Fallback: ajouter ?page= au lieu de remplacer
            separator = '&' if '?' in base_url else '?'
            return f"{base_url}{separator}{pattern}{page_number}"

    def extract_url_filters(self, url: str) -> Dict[str, str]:
        """
        Extract filter parameters from URL.

        Args:
            url: URL à analyser

        Returns:
            Dictionnaire avec les filtres trouvés (ex: {'v1': 'Motocyclette', 'view': 'grid'})
        """
        try:
            parsed = urlparse(url)
            if not parsed.query:
                return {}

            from urllib.parse import parse_qs
            query_params = parse_qs(parsed.query)

            # Convertir en dict simple (prendre le premier élément des listes)
            filters = {k: v[0] if v and len(
                v) > 0 else '' for k, v in query_params.items()}

            # Exclure les paramètres de pagination connus
            pagination_params = ['page', 'paged',
                                 'fwp_paged', 'p', 'offset', 'start', 'view']
            filters = {k: v for k, v in filters.items()
                       if k not in pagination_params}

            return filters
        except Exception as e:
            print(f"⚠️ Erreur lors de l'extraction des filtres URL: {e}")
            return {}

    def build_url_with_filters(self, base_url: str, filters: Dict[str, str],
                               pagination: Optional[Dict] = None, page_number: int = 1) -> str:
        """
        Build URL with filters and optional pagination.

        Args:
            base_url: URL de base (sans paramètres)
            filters: Dictionnaire de filtres (ex: {'v1': 'Motocyclette'})
            pagination: Info de pagination (optionnel)
            page_number: Numéro de page (optionnel)

        Returns:
            URL complète avec filtres et pagination
        """
        try:
            parsed = urlparse(base_url)
            query_params = {}

            # Ajouter les filtres
            query_params.update(filters)

            # Ajouter la pagination si fournie
            if pagination and pagination.get('pattern'):
                pattern = pagination['pattern']
                param_name = pattern.rstrip('=')
                query_params[param_name] = str(page_number)

            # Reconstruire l'URL
            from urllib.parse import urlencode
            new_query = urlencode(query_params)
            new_url = urlunparse((
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                new_query,
                parsed.fragment
            ))
            return new_url
        except Exception as e:
            print(f"⚠️ Erreur lors de la construction de l'URL: {e}")
            return base_url

    def extract_json_ld(self, html: str) -> List[Dict]:
        """
        Extract JSON-LD structured data from HTML.

        Args:
            html: HTML à analyser

        Returns:
            Liste des objets JSON-LD trouvés
        """
        if not html:
            return []

        try:
            soup = BeautifulSoup(html, 'html.parser')
            scripts = soup.find_all('script', type='application/ld+json')

            json_ld_data = []
            for script in scripts:
                try:
                    data = json.loads(script.string)
                    if isinstance(data, list):
                        json_ld_data.extend(data)
                    else:
                        json_ld_data.append(data)
                except (json.JSONDecodeError, AttributeError):
                    continue

            return json_ld_data
        except Exception as e:
            print(f"⚠️ Erreur lors de l'extraction JSON-LD: {e}")
            return []

    def extract_opengraph(self, html: str) -> Dict:
        """
        Extract Open Graph metadata from HTML.

        Args:
            html: HTML à analyser

        Returns:
            Dictionnaire des métadonnées Open Graph
        """
        if not html:
            return {}

        try:
            soup = BeautifulSoup(html, 'html.parser')
            og_data = {}

            # Chercher les meta tags og:*
            meta_tags = soup.find_all(
                'meta', property=lambda x: x and x.startswith('og:'))
            for tag in meta_tags:
                property_name = tag.get('property', '').replace('og:', '')
                content = tag.get('content', '')
                if property_name and content:
                    og_data[property_name] = content

            return og_data
        except Exception as e:
            print(f"⚠️ Erreur lors de l'extraction Open Graph: {e}")
            return {}

    def clean_text(self, text: str) -> str:
        """
        Clean text by removing extra whitespace and special characters.

        Args:
            text: Texte à nettoyer

        Returns:
            Texte nettoyé
        """
        if not text:
            return ""

        # Enlever les espaces multiples
        text = re.sub(r'\s+', ' ', text)
        # Enlever les espaces en début/fin
        text = text.strip()
        # Enlever les caractères de contrôle
        text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text)

        return text

    def clean_html(self, html: str) -> str:
        """
        Clean HTML by removing invalid Unicode characters (surrogates) that can't be encoded to UTF-8.

        Args:
            html: HTML à nettoyer

        Returns:
            HTML nettoyé sans caractères invalides
        """
        if not html:
            return ""

        try:
            # Méthode 1: Encoder en UTF-8 avec gestion d'erreurs
            # Cela remplace automatiquement les caractères invalides
            html_encoded = html.encode('utf-8', errors='replace')
            html_clean = html_encoded.decode('utf-8', errors='replace')

            # Méthode 2: Supprimer explicitement les surrogates
            # Les surrogates sont dans la plage U+D800 à U+DFFF
            html_clean = re.sub(r'[\ud800-\udfff]', '', html_clean)

            return html_clean
        except Exception as e:
            print(f"⚠️ Erreur lors du nettoyage HTML: {e}")
            # Fallback: retourner le HTML original si le nettoyage échoue
            return html

    def prepare_html_for_prompt(self, html: str) -> str:
        """
        Prépare le HTML pour insertion sécurisée dans un prompt.

        Cette fonction:
        1. Nettoie les surrogates Unicode (évite UnicodeEncodeError)
        2. Échappe les accolades pour éviter les erreurs dans f-strings
        3. Remplace les triple backticks qui peuvent casser le formatage

        ⚠️ CRITIQUE: Utiliser cette fonction AVANT d'insérer le HTML dans un prompt
        (surtout dans des f-strings ou des templates).

        Args:
            html: HTML à préparer

        Returns:
            HTML préparé et sécurisé pour insertion dans un prompt
        """
        if not html:
            return ""

        # 1. Nettoyer les surrogates Unicode (CRITIQUE pour éviter UnicodeEncodeError)
        html = self.clean_html(html)

        # 2. Échapper les accolades pour éviter les erreurs dans f-strings
        # Si le HTML contient { ou }, cela causera une KeyError dans les f-strings
        html = html.replace('{', '{{').replace('}', '}}')

        # 3. Remplacer les triple backticks qui peuvent casser le formatage du prompt
        html = html.replace('```', '``')

        return html

    def normalize_url_for_dedup(self, url: str) -> str:
        """
        Normalise une URL pour la déduplication (supprime paramètres de tracking).

        Args:
            url: URL à normaliser

        Returns:
            URL normalisée sans paramètres de tracking
        """
        from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

        parsed = urlparse(url)

        # Paramètres à conserver (pagination, filtres importants)
        keep_params = ['page', 'paged', 'fwp_paged',
                       'p', 'offset', 'start', 'id', 'product_id']

        # Paramètres à supprimer (tracking, analytics, etc.)
        remove_params = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source',
                         'fbclid', 'gclid', '_ga', 'tracking', 'affiliate', 'view', 'sort']

        query_params = parse_qs(parsed.query)
        filtered_params = {}

        for key, values in query_params.items():
            key_lower = key.lower()
            if key_lower in keep_params:
                filtered_params[key] = values
            elif key_lower not in remove_params:
                # Garder les autres paramètres (filtres, etc.)
                filtered_params[key] = values

        # Reconstruire l'URL sans les paramètres de tracking
        new_query = urlencode(filtered_params, doseq=True)
        normalized = urlunparse((
            parsed.scheme, parsed.netloc, parsed.path,
            parsed.params, new_query, ''  # Supprimer le fragment
        ))
        return normalized

    def normalize_url_by_model_year(self, url: str) -> str:
        """
        Normalise une URL par modèle+année pour la déduplication (ignore les couleurs).

        Extrait le modèle + année depuis le path de l'URL et supprime les variantes de couleur.
        GARDE l'année mais ignore les couleurs.

        Exemples:
        - "kawasaki-ninja-h2-noir-2026" → "kawasaki-ninja-h2-2026"
        - "kawasaki-ninja-h2-carbon-2026" → "kawasaki-ninja-h2-2026"
        - "kawasaki-ninja-h2-noir-2025" → "kawasaki-ninja-h2-2025" (année différente)

        Args:
            url: URL à normaliser

        Returns:
            Clé normalisée (modèle+année) pour la déduplication
        """
        from urllib.parse import urlparse

        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.split('/') if p]

        if not path_parts:
            return url  # Fallback si pas de path

        # Trouver le dernier segment qui contient le nom du produit
        product_slug = path_parts[-1]

        # Extraire l'année (4 chiffres) à la fin du slug
        year_match = re.search(r'-(\d{4})(?:-\d+)?$', product_slug)
        year = year_match.group(1) if year_match else None

        if not year:
            # Si pas d'année trouvée, retourner le slug tel quel
            return product_slug

        # Supprimer l'année du slug pour extraire le modèle
        product_without_year = re.sub(r'-\d{4}(?:-\d+)?$', '', product_slug)

        # Liste des mots de couleur/variante à supprimer
        color_variants = [
            'noir', 'blanc', 'vert', 'rouge', 'gris', 'bleu', 'jaune', 'orange',
            'carbon', 'carbonne', 'mat', 'brillant', 'metallic', 'metallique',
            'black', 'white', 'green', 'red', 'gray', 'grey', 'blue', 'yellow',
            'lime', 'ebene', 'medium', 'greenblack', 'blackout', 'edition',
            'eps', 'se', 'lt', 'sno', 'pro', 'alpha', 'riot', 'special',
            'limited', 'edition', 'custom', 'premium'
        ]

        # Extraire marque + modèle (avant les couleurs/variantes)
        words = product_without_year.split('-')
        model_words = []

        for i, word in enumerate(words):
            word_lower = word.lower()
            # Arrêter si on rencontre une couleur/variante connue
            if word_lower in color_variants:
                break
            # Arrêter aussi si le mot est trop court et ressemble à une couleur
            if len(word) <= 3 and i >= 2:
                # Vérifier si c'est une abréviation de couleur
                if word_lower in ['blk', 'wht', 'grn', 'red', 'blu', 'gry']:
                    break
            model_words.append(word)

        # Reconstruire la clé: modèle + année
        model_key = '-'.join(model_words) if model_words else product_without_year
        normalized_key = f"{model_key}-{year}"

        return normalized_key

    def extract_price(self, text: str) -> Optional[float]:
        """
        Extract price from text.

        Args:
            text: Texte contenant un prix

        Returns:
            Prix extrait (float) ou None
        """
        if not text:
            return None

        # Patterns pour prix: $123.45, 123,45€, 1234.56, etc.
        patterns = [
            r'\$?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)',  # $1,234.56
            r'(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)\s*€',   # 1,234.56€
            # 1234.56 ou 1234,56
            r'(\d+(?:[.,]\d{2})?)',
        ]

        for pattern in patterns:
            match = re.search(pattern, text.replace(' ', ''))
            if match:
                price_str = match.group(1).replace(',', '').replace(' ', '')
                try:
                    return float(price_str)
                except ValueError:
                    continue

        return None

    def get_text_content(self, html: str, selector: Optional[str] = None) -> str:
        """
        Extract text content from HTML.

        Args:
            html: HTML à analyser
            selector: Sélecteur CSS optionnel pour limiter la zone

        Returns:
            Texte extrait
        """
        if not html:
            return ""

        try:
            soup = BeautifulSoup(html, 'html.parser')

            if selector:
                elements = soup.select(selector)
                texts = [elem.get_text(strip=True) for elem in elements]
                return ' '.join(texts)
            else:
                return soup.get_text(strip=True)
        except Exception as e:
            print(f"⚠️ Erreur lors de l'extraction de texte: {e}")
            return ""

    def check_robots_txt(self, url: str) -> Dict:
        """
        Check robots.txt for crawling restrictions.

        Args:
            url: URL de base du site

        Returns:
            Dictionnaire avec informations robots.txt
        """
        try:
            parsed = urlparse(url)
            robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"

            response = self.session.get(robots_url, timeout=10)
            if response.status_code == 200:
                return {
                    'exists': True,
                    'content': response.text,
                    'url': robots_url
                }
            else:
                return {'exists': False, 'url': robots_url}
        except Exception as e:
            print(f"⚠️ Erreur lors de la vérification robots.txt: {e}")
            return {'exists': False, 'error': str(e)}

    def find_search_form(self, html: str) -> Optional[Dict]:
        """
        Find search form in HTML and return form details.

        Args:
            html: HTML à analyser

        Returns:
            Dictionnaire avec détails du formulaire ou None
        """
        if not html:
            return None

        try:
            soup = BeautifulSoup(html, 'html.parser')
            forms = soup.find_all('form')

            for form in forms:
                # Chercher des formulaires de recherche
                action = form.get('action', '')
                method = form.get('method', 'get').lower()
                inputs = form.find_all(['input', 'select', 'textarea'])

                # Indicateurs de formulaire de recherche
                search_indicators = [
                    'search' in action.lower(),
                    'search' in form.get('id', '').lower(),
                    'search' in form.get('class', []),
                    any('search' in inp.get('name', '').lower() or 'search' in inp.get('id', '').lower()
                        for inp in inputs)
                ]

                if any(search_indicators):
                    input_fields = []
                    for inp in inputs:
                        input_fields.append({
                            'name': inp.get('name', ''),
                            'type': inp.get('type', 'text'),
                            'id': inp.get('id', ''),
                            'placeholder': inp.get('placeholder', '')
                        })

                    return {
                        'action': action,
                        'method': method,
                        'inputs': input_fields,
                        'form_html': str(form)
                    }

            return None
        except Exception as e:
            print(f"⚠️ Erreur lors de la recherche de formulaire: {e}")
            return None

    def extract_microdata(self, html: str) -> List[Dict]:
        """
        Extract microdata (schema.org) from HTML.

        Args:
            html: HTML à analyser

        Returns:
            Liste des objets microdata trouvés
        """
        if not html:
            return []

        try:
            soup = BeautifulSoup(html, 'html.parser')
            items = soup.find_all(attrs={'itemscope': True})

            microdata = []
            for item in items:
                item_data = {}
                item_type = item.get('itemtype', '')
                if item_type:
                    item_data['@type'] = item_type

                # Extraire les propriétés
                props = item.find_all(attrs={'itemprop': True})
                for prop in props:
                    prop_name = prop.get('itemprop', '')
                    prop_value = prop.get(
                        'content') or prop.get_text(strip=True)
                    if prop_name and prop_value:
                        if prop_name in item_data:
                            # Si déjà présent, convertir en liste
                            if not isinstance(item_data[prop_name], list):
                                item_data[prop_name] = [item_data[prop_name]]
                            item_data[prop_name].append(prop_value)
                        else:
                            item_data[prop_name] = prop_value

                if item_data:
                    microdata.append(item_data)

            return microdata
        except Exception as e:
            print(f"⚠️ Erreur lors de l'extraction microdata: {e}")
            return []

    def detect_api_endpoints(self, html: str) -> List[str]:
        """
        Detect API endpoints from HTML (JavaScript, fetch, axios calls).

        Args:
            html: HTML à analyser

        Returns:
            Liste des endpoints API potentiels trouvés
        """
        if not html:
            return []

        endpoints = []

        # Patterns pour détecter des appels API
        patterns = [
            r'["\']([^"\']*\/api\/[^"\']*)["\']',  # /api/...
            r'["\']([^"\']*\/graphql[^"\']*)["\']',  # /graphql
            r'fetch\(["\']([^"\']+)["\']',  # fetch('...')
            r'axios\.(get|post)\(["\']([^"\']+)["\']',  # axios.get('...')
            r'\.ajax\(["\']([^"\']+)["\']',  # .ajax('...')
            r'url:\s*["\']([^"\']+)["\']',  # url: '...'
            r'endpoint["\']?\s*[:=]\s*["\']([^"\']+)["\']',  # endpoint: '...'
        ]

        for pattern in patterns:
            matches = re.findall(pattern, html, re.IGNORECASE)
            for match in matches:
                if isinstance(match, tuple):
                    endpoint = match[-1]  # Prendre le dernier élément du tuple
                else:
                    endpoint = match

                # Filtrer les endpoints valides
                if endpoint and ('/api/' in endpoint or '/graphql' in endpoint or
                                 endpoint.startswith('http') or endpoint.startswith('/')):
                    if endpoint not in endpoints:
                        endpoints.append(endpoint)

        return endpoints

    def extract_script_data(self, html: str) -> Dict:
        """
        Extract data from JavaScript variables (window.__INITIAL_STATE__, etc.).

        Args:
            html: HTML à analyser

        Returns:
            Dictionnaire avec données extraites des scripts
        """
        if not html:
            return {}

        data = {}

        try:
            soup = BeautifulSoup(html, 'html.parser')
            scripts = soup.find_all('script')

            # Patterns pour données dans window.*
            patterns = [
                r'window\.__INITIAL_STATE__\s*=\s*({.+?});',
                r'window\.__PRELOADED_STATE__\s*=\s*({.+?});',
                r'window\.__DATA__\s*=\s*({.+?});',
                r'var\s+__INITIAL_DATA__\s*=\s*({.+?});',
            ]

            for script in scripts:
                if script.string:
                    script_content = script.string
                    for pattern in patterns:
                        matches = re.findall(
                            pattern, script_content, re.DOTALL)
                        for match in matches:
                            try:
                                parsed = json.loads(match)
                                if isinstance(parsed, dict):
                                    data.update(parsed)
                            except json.JSONDecodeError:
                                continue

            return data
        except Exception as e:
            print(f"⚠️ Erreur lors de l'extraction de données script: {e}")
            return {}

    def detect_infinite_scroll(self, html: str) -> bool:
        """
        Detect if page uses infinite scroll or lazy loading.

        Args:
            html: HTML à analyser

        Returns:
            True si infinite scroll détecté
        """
        if not html:
            return False

        indicators = [
            'infinite-scroll' in html.lower(),
            'lazy-load' in html.lower(),
            'data-lazy' in html.lower(),
            'loading="lazy"' in html.lower(),
            'scroll' in html.lower() and 'load' in html.lower(),
            'intersectionobserver' in html.lower(),
        ]

        return any(indicators)

    def find_filters(self, html: str) -> List[Dict]:
        """
        Find filter options in HTML (dropdowns, checkboxes, etc.).

        Args:
            html: HTML à analyser

        Returns:
            Liste des filtres trouvés avec leurs options
        """
        if not html:
            return []

        filters = []

        try:
            soup = BeautifulSoup(html, 'html.parser')

            # Chercher les selects (dropdowns)
            selects = soup.find_all('select')
            for select in selects:
                name = select.get('name', '')
                id_attr = select.get('id', '')
                options = []

                for option in select.find_all('option'):
                    value = option.get('value', '')
                    text = option.get_text(strip=True)
                    if value or text:
                        options.append({'value': value, 'text': text})

                if name or id_attr:
                    filters.append({
                        'type': 'select',
                        'name': name,
                        'id': id_attr,
                        'options': options
                    })

            # Chercher les checkboxes/radios groupés
            checkbox_groups = {}
            radios = soup.find_all(['input'], type=['checkbox', 'radio'])
            for radio in radios:
                name = radio.get('name', '')
                if name:
                    if name not in checkbox_groups:
                        checkbox_groups[name] = []
                    checkbox_groups[name].append({
                        'value': radio.get('value', ''),
                        'text': radio.find_next_sibling(string=True) or '',
                        'checked': radio.get('checked') is not None
                    })

            for name, options in checkbox_groups.items():
                filters.append({
                    'type': 'checkbox' if 'checkbox' in str(radios[0].get('type', '')) else 'radio',
                    'name': name,
                    'options': options
                })

            return filters
        except Exception as e:
            print(f"⚠️ Erreur lors de la recherche de filtres: {e}")
            return []

    def retry_get(self, url: str, max_retries: int = 3, backoff: float = 1.0,
                  use_selenium: bool = False) -> str:
        """
        Get URL with retry logic and exponential backoff.

        Args:
            url: URL à récupérer
            max_retries: Nombre maximum de tentatives
            backoff: Délai initial entre tentatives (secondes)
            use_selenium: Utiliser Selenium si True

        Returns:
            HTML de la page ou chaîne vide
        """
        import time

        for attempt in range(max_retries):
            try:
                html = self.get(url, use_selenium=use_selenium)
                if html:
                    return html
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = backoff * (2 ** attempt)  # Exponential backoff
                    print(
                        f"⚠️ Tentative {attempt + 1}/{max_retries} échouée, attente {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    print(f"❌ Échec après {max_retries} tentatives: {e}")

        return ""

    def detect_rate_limit(self, response_text: str, status_code: int) -> bool:
        """
        Detect if response indicates rate limiting.

        Args:
            response_text: Texte de la réponse
            status_code: Code de statut HTTP

        Returns:
            True si rate limit détecté
        """
        if status_code == 429:  # Too Many Requests
            return True

        rate_limit_indicators = [
            'rate limit' in response_text.lower(),
            'too many requests' in response_text.lower(),
            'quota exceeded' in response_text.lower(),
            'try again later' in response_text.lower(),
        ]

        return any(rate_limit_indicators)

    def wait_between_requests(self, seconds: float = 1.0):
        """
        Wait between requests to avoid rate limiting.

        Args:
            seconds: Nombre de secondes à attendre
        """
        import time
        time.sleep(seconds)

    def extract_number(self, text: str) -> Optional[float]:
        """
        Extract any number from text.

        Args:
            text: Texte contenant un nombre

        Returns:
            Nombre extrait (float) ou None
        """
        if not text:
            return None

        # Pattern pour nombres (avec ou sans décimales)
        pattern = r'(\d+(?:[.,]\d+)?)'
        match = re.search(pattern, text.replace(' ', ''))

        if match:
            number_str = match.group(1).replace(',', '.')
            try:
                return float(number_str)
            except ValueError:
                return None

        return None

    def validate_url(self, url: str) -> bool:
        """
        Validate if URL is well-formed and accessible.

        Args:
            url: URL à valider

        Returns:
            True si URL valide
        """
        if not url:
            return False

        try:
            parsed = urlparse(url)
            # Vérifier qu'on a au moins un scheme et un netloc
            return bool(parsed.scheme and parsed.netloc)
        except Exception:
            return False

    def find_iframes(self, html: str) -> List[str]:
        """
        Find all iframe sources in HTML.

        Args:
            html: HTML à analyser

        Returns:
            Liste des URLs des iframes
        """
        if not html:
            return []

        try:
            soup = BeautifulSoup(html, 'html.parser')
            iframes = soup.find_all('iframe')

            iframe_urls = []
            for iframe in iframes:
                src = iframe.get('src', '')
                if src:
                    iframe_urls.append(src)

            return iframe_urls
        except Exception as e:
            print(f"⚠️ Erreur lors de la recherche d'iframes: {e}")
            return []

    def detect_captcha(self, html: str) -> bool:
        """
        Detect if page contains CAPTCHA.

        Args:
            html: HTML à analyser

        Returns:
            True si CAPTCHA détecté
        """
        if not html:
            return False

        captcha_indicators = [
            'recaptcha' in html.lower(),
            'hcaptcha' in html.lower(),
            'captcha' in html.lower(),
            'g-recaptcha' in html.lower(),
            'data-sitekey' in html.lower(),
        ]

        return any(captcha_indicators)

    def analyze_url_patterns(self, urls: List[str]) -> Dict[str, Any]:
        """
        Analyze URL patterns to identify product URLs, categories, etc.

        Args:
            urls: Liste d'URLs à analyser

        Returns:
            Dictionnaire avec patterns détectés et catégories
        """
        if not urls:
            return {}

        patterns = {
            'product_patterns': [],
            'category_patterns': [],
            'common_base': '',
            'url_structure': {}
        }

        # Analyser les patterns communs
        product_keywords = ['product', 'produit', 'item',
                            'article', 'inventory', 'inventaire', 'detail', 'details']
        category_keywords = ['category', 'categorie',
                             'catalog', 'catalogue', 'collection']

        for url in urls[:100]:  # Analyser les 100 premières
            parsed = urlparse(url)
            path_parts = [p for p in parsed.path.split('/') if p]

            # Détecter patterns produits
            for keyword in product_keywords:
                if keyword in url.lower():
                    # Extraire le pattern (ex: /product/{id}, /item-{id})
                    pattern = self._extract_pattern_from_url(url, keyword)
                    if pattern and pattern not in patterns['product_patterns']:
                        patterns['product_patterns'].append(pattern)

            # Détecter patterns catégories
            for keyword in category_keywords:
                if keyword in url.lower():
                    pattern = self._extract_pattern_from_url(url, keyword)
                    if pattern and pattern not in patterns['category_patterns']:
                        patterns['category_patterns'].append(pattern)

        return patterns

    def _extract_pattern_from_url(self, url: str, keyword: str) -> Optional[str]:
        """Extract pattern from URL (ex: /product/{id} -> /product/*)"""
        try:
            parsed = urlparse(url)
            path = parsed.path.lower()
            if keyword in path:
                # Remplacer les IDs/nombres par *
                pattern = re.sub(r'/\d+', '/*', parsed.path)
                pattern = re.sub(
                    r'/[a-z0-9-]{20,}', '/*', pattern)  # Longs slugs
                return pattern
        except Exception:
            pass
        return None

    def detect_important_sections(self, html: str, base_url: str) -> Dict[str, List[str]]:
        """
        Detect important sections: navigation, categories, product listings.

        Args:
            html: HTML à analyser
            base_url: URL de base

        Returns:
            Dictionnaire avec sections détectées
        """
        sections = {
            'navigation': [],
            'categories': [],
            'product_listings': [],
            'breadcrumbs': []
        }

        try:
            soup = BeautifulSoup(html, 'html.parser')

            # Navigation principale
            nav_selectors = ['nav', '.navigation',
                             '.main-menu', '#main-nav', '[role="navigation"]']
            for selector in nav_selectors:
                navs = soup.select(selector)
                for nav in navs:
                    links = nav.find_all('a', href=True)
                    for link in links:
                        href = link.get('href', '')
                        normalized = self.normalize_url(base_url, href)
                        if normalized and normalized not in sections['navigation']:
                            sections['navigation'].append(normalized)

            # Catégories
            category_keywords = ['category', 'categorie',
                                 'catalog', 'catalogue', 'collection', 'type']
            all_links = self.get_all_links(html, base_url)
            for link in all_links:
                link_lower = link.lower()
                if any(kw in link_lower for kw in category_keywords):
                    if link not in sections['categories']:
                        sections['categories'].append(link)

            # Product listings (pages avec plusieurs produits)
            product_listing_indicators = [
                '.product-list', '.products-grid', '.inventory-list',
                '[data-product]', '.product-card', '.item-card'
            ]
            for selector in product_listing_indicators:
                elements = soup.select(selector)
                if len(elements) > 3:  # Au moins 3 produits
                    # Trouver la page actuelle
                    sections['product_listings'].append(base_url)
                    break

            # Breadcrumbs
            breadcrumb_selectors = ['.breadcrumb', '.breadcrumbs',
                                    '[aria-label*="breadcrumb"]', 'nav[aria-label*="breadcrumb"]']
            for selector in breadcrumb_selectors:
                breadcrumbs = soup.select(selector)
                for breadcrumb in breadcrumbs:
                    links = breadcrumb.find_all('a', href=True)
                    for link in links:
                        href = link.get('href', '')
                        normalized = self.normalize_url(base_url, href)
                        if normalized and normalized not in sections['breadcrumbs']:
                            sections['breadcrumbs'].append(normalized)

        except Exception as e:
            print(f"⚠️ Erreur lors de la détection des sections: {e}")

        return sections

    def detect_ajax_data_layer(self, html: str) -> Dict[str, Any]:
        """
        Detect AJAX calls and data layer (dataLayer, window.__INITIAL_STATE__, etc.).

        Args:
            html: HTML à analyser

        Returns:
            Dictionnaire avec données AJAX/data layer trouvées
        """
        data = {
            'data_layer': {},
            'ajax_endpoints': [],
            'initial_state': {},
            'api_calls': []
        }

        try:
            soup = BeautifulSoup(html, 'html.parser')
            scripts = soup.find_all('script')

            for script in scripts:
                if not script.string:
                    continue

                script_content = script.string

                # Détecter dataLayer (Google Tag Manager)
                data_layer_patterns = [
                    r'dataLayer\s*=\s*(\[.*?\]);',
                    r'dataLayer\.push\(({.*?})\);',
                ]
                for pattern in data_layer_patterns:
                    matches = re.findall(pattern, script_content, re.DOTALL)
                    for match in matches:
                        try:
                            parsed = json.loads(match)
                            if isinstance(parsed, dict):
                                data['data_layer'].update(parsed)
                            elif isinstance(parsed, list) and parsed:
                                data['data_layer'].update(
                                    parsed[0] if isinstance(parsed[0], dict) else {})
                        except json.JSONDecodeError:
                            continue

                # Détecter window.__INITIAL_STATE__ ou similaire
                initial_state_patterns = [
                    r'window\.__INITIAL_STATE__\s*=\s*({.+?});',
                    r'window\.__PRELOADED_STATE__\s*=\s*({.+?});',
                    r'window\.__DATA__\s*=\s*({.+?});',
                    r'var\s+__INITIAL_DATA__\s*=\s*({.+?});',
                ]
                for pattern in initial_state_patterns:
                    matches = re.findall(pattern, script_content, re.DOTALL)
                    for match in matches:
                        try:
                            parsed = json.loads(match)
                            if isinstance(parsed, dict):
                                data['initial_state'].update(parsed)
                        except json.JSONDecodeError:
                            continue

                # Détecter appels AJAX/fetch
                ajax_patterns = [
                    r'["\']([^"\']*\/api\/[^"\']*)["\']',
                    r'fetch\(["\']([^"\']+)["\']',
                    r'axios\.(get|post)\(["\']([^"\']+)["\']',
                    r'\.ajax\(["\']([^"\']+)["\']',
                    r'url:\s*["\']([^"\']+)["\']',
                ]
                for pattern in ajax_patterns:
                    matches = re.findall(
                        pattern, script_content, re.IGNORECASE)
                    for match in matches:
                        endpoint = match[-1] if isinstance(
                            match, tuple) else match
                        if endpoint and ('/api/' in endpoint or endpoint.startswith('http') or endpoint.startswith('/')):
                            if endpoint not in data['ajax_endpoints']:
                                data['ajax_endpoints'].append(endpoint)

        except Exception as e:
            print(f"⚠️ Erreur lors de la détection AJAX/data layer: {e}")

        return data

    def detect_internal_apis(self, html: str, base_url: str) -> List[Dict[str, str]]:
        """
        Detect internal APIs (wp-json, /api/products, Shopify Storefront, etc.).

        Args:
            html: HTML à analyser
            base_url: URL de base

        Returns:
            Liste des APIs détectées avec leurs endpoints
        """
        apis = []

        try:
            # Patterns d'APIs courantes
            api_patterns = [
                {
                    'name': 'WordPress REST API',
                    'endpoints': ['/wp-json/wp/v2/products', '/wp-json/wc/v3/products'],
                    'detection': lambda h: 'wp-json' in h.lower() or 'wordpress' in h.lower()
                },
                {
                    'name': 'Shopify Storefront API',
                    'endpoints': ['/api/graphql', '/api/2023-*/graphql.json'],
                    'detection': lambda h: 'shopify' in h.lower() or 'myshopify.com' in h.lower()
                },
                {
                    'name': 'Generic REST API',
                    'endpoints': ['/api/products', '/api/v1/products', '/api/items'],
                    'detection': lambda h: '/api/' in h.lower()
                },
                {
                    'name': 'WooCommerce API',
                    'endpoints': ['/wp-json/wc/v3/products'],
                    'detection': lambda h: 'woocommerce' in h.lower() or '/wc-api/' in h.lower()
                }
            ]

            for api_pattern in api_patterns:
                if api_pattern['detection'](html):
                    for endpoint_template in api_pattern['endpoints']:
                        # Construire l'endpoint complet
                        if endpoint_template.startswith('/'):
                            full_endpoint = urljoin(
                                base_url, endpoint_template)
                        else:
                            full_endpoint = endpoint_template

                        apis.append({
                            'name': api_pattern['name'],
                            'endpoint': full_endpoint,
                            'type': 'rest' if '/api/' in endpoint_template else 'graphql'
                        })

            # Chercher aussi dans les scripts
            ajax_data = self.detect_ajax_data_layer(html)
            for endpoint in ajax_data.get('ajax_endpoints', []):
                if '/api/' in endpoint or '/graphql' in endpoint:
                    apis.append({
                        'name': 'Detected API',
                        'endpoint': urljoin(base_url, endpoint) if endpoint.startswith('/') else endpoint,
                        'type': 'rest' if '/api/' in endpoint else 'graphql'
                    })

        except Exception as e:
            print(f"⚠️ Erreur lors de la détection d'APIs: {e}")

        # Dédupliquer
        return list({api['endpoint']: api for api in apis}.values())

    def smart_get(self, url: str, max_retries: int = 3) -> Dict[str, Any]:
        """
        Smart GET with intelligent fallback: requests → Selenium → API detection.

        Args:
            url: URL à récupérer
            max_retries: Nombre maximum de tentatives

        Returns:
            Dictionnaire avec html, method_used, api_detected, etc.
        """
        result = {
            'html': '',
            'method_used': 'none',
            'api_detected': False,
            'blocked': False,
            'requires_javascript': False
        }

        # ÉTAPE 1: Essayer requests classique
        try:
            response = self.session.get(url, timeout=30)
            if response.status_code == 200:
                html = response.text

                # Vérifier si contenu dynamique (peu de contenu visible)
                soup = BeautifulSoup(html, 'html.parser')
                visible_text = soup.get_text(strip=True)

                # Si peu de contenu ou détection de blocage
                if len(visible_text) < 500 or self.detect_blocking(html, response.status_code):
                    result['blocked'] = True
                    result['requires_javascript'] = True
                else:
                    result['html'] = html
                    result['method_used'] = 'requests'

                    # Détecter APIs disponibles
                    apis = self.detect_internal_apis(html, url)
                    if apis:
                        result['api_detected'] = True
                        result['apis'] = apis

                    return result
        except Exception as e:
            print(f"⚠️ Erreur requests: {e}")

        # ÉTAPE 2: Essayer Selenium si disponible
        if SELENIUM_AVAILABLE and fetch_page_with_selenium:
            try:
                html = fetch_page_with_selenium(url)
                if html and len(html) > 1000:
                    result['html'] = html
                    result['method_used'] = 'selenium'
                    result['requires_javascript'] = True

                    # Détecter APIs même avec Selenium
                    apis = self.detect_internal_apis(html, url)
                    if apis:
                        result['api_detected'] = True
                        result['apis'] = apis

                    return result
            except Exception as e:
                print(f"⚠️ Erreur Selenium: {e}")

        # ÉTAPE 3: Si API détectée, essayer de l'utiliser
        # (Cette logique sera dans le scraper généré)

        return result

    def detect_blocking(self, html: str, status_code: int) -> bool:
        """
        Detect if page is blocked (Cloudflare, bot detection, etc.).

        Args:
            html: HTML de la réponse
            status_code: Code de statut HTTP

        Returns:
            True si blocage détecté
        """
        if status_code == 403 or status_code == 429:
            return True

        blocking_indicators = [
            'cloudflare' in html.lower(),
            'checking your browser' in html.lower(),
            'access denied' in html.lower(),
            'bot detection' in html.lower(),
            'please enable javascript' in html.lower(),
            'captcha' in html.lower(),
            'challenge' in html.lower(),
            'ray id' in html.lower(),  # Cloudflare
        ]

        return any(blocking_indicators)

    def extract_with_hybrid_method(self, html: str, field_name: str, selectors: List[str]) -> Optional[str]:
        """
        Extract field using hybrid method: CSS/XPath first, then Gemini fallback.

        Args:
            html: HTML à analyser
            field_name: Nom du champ à extraire
            selectors: Liste de sélecteurs CSS à essayer

        Returns:
            Valeur extraite ou None
        """
        if not html:
            return None

        try:
            soup = BeautifulSoup(html, 'html.parser')

            # Essayer chaque sélecteur CSS
            for selector in selectors:
                elements = soup.select(selector)
                if elements:
                    # Prendre le premier élément trouvé
                    value = elements[0].get_text(strip=True)
                    if value:
                        return value

                    # Si pas de texte, essayer attributs
                    if elements[0].get('content'):
                        return elements[0].get('content')
                    if elements[0].get('value'):
                        return elements[0].get('value')
                    if elements[0].name == 'img' and elements[0].get('src'):
                        return elements[0].get('src')

            # Si rien trouvé, essayer JSON-LD
            json_ld_data = self.extract_json_ld(html)
            for item in json_ld_data:
                if isinstance(item, dict):
                    # Mapping des champs
                    field_mapping = {
                        'name': ['name', 'title'],
                        'price': ['price', 'offers.price', 'lowPrice', 'highPrice'],
                        'image': ['image', 'images'],
                        'description': ['description'],
                        'availability': ['availability', 'offers.availability']
                    }

                    if field_name in field_mapping:
                        for mapped_field in field_mapping[field_name]:
                            value = self._get_nested_value(item, mapped_field)
                            if value:
                                return str(value)

        except Exception as e:
            print(f"⚠️ Erreur lors de l'extraction hybride: {e}")

        return None

    def _get_nested_value(self, data: Dict, path: str) -> Any:
        """Get nested value from dict using dot notation (ex: offers.price)"""
        keys = path.split('.')
        value = data
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key)
            elif isinstance(value, list) and value:
                value = value[0].get(key) if isinstance(
                    value[0], dict) else None
            else:
                return None
        return value

    def standardize_field(self, field_name: str, value: Any) -> Any:
        """
        Standardize field value (price → float, availability → bool, etc.).

        Args:
            field_name: Nom du champ
            value: Valeur à standardiser

        Returns:
            Valeur standardisée
        """
        if value is None:
            return None

        if field_name == 'prix' or field_name == 'price':
            # Extraire prix et convertir en float
            if isinstance(value, str):
                price = self.extract_price(value)
                return price
            elif isinstance(value, (int, float)):
                return float(value)

        elif field_name == 'disponibilite' or field_name == 'availability':
            # Convertir en bool ou enum standardisé
            if isinstance(value, str):
                value_lower = value.lower()
                if any(kw in value_lower for kw in ['en stock', 'available', 'in stock', 'disponible']):
                    return 'en_stock'
                elif any(kw in value_lower for kw in ['épuisé', 'out of stock', 'sold out']):
                    return 'epuise'
                elif any(kw in value_lower for kw in ['sur commande', 'on order', 'pre-order']):
                    return 'sur_commande'
                else:
                    return 'non_disponible'
            elif isinstance(value, bool):
                return 'en_stock' if value else 'epuise'

        elif field_name == 'image' or field_name == 'images':
            # Normaliser URLs images
            if isinstance(value, str):
                # Si c'est une liste séparée par virgules
                if ',' in value:
                    images = [img.strip() for img in value.split(',')]
                else:
                    images = [value]
                # Nettoyer et normaliser
                cleaned_images = []
                for img in images:
                    if img.startswith('//'):
                        img = 'https:' + img
                    elif img.startswith('/'):
                        # Nécessite base_url, mais on fait de notre mieux
                        pass
                    if img and img not in cleaned_images:
                        cleaned_images.append(img)
                return cleaned_images[0] if len(cleaned_images) == 1 else cleaned_images

        elif field_name in ['name', 'marque', 'modele', 'description']:
            # Nettoyer texte
            if isinstance(value, str):
                return self.clean_text(value)

        return value

    def validate_product_data(self, product: Dict) -> Dict[str, Any]:
        """
        Validate product data and detect anomalies.

        Args:
            product: Dictionnaire produit à valider

        Returns:
            Dictionnaire avec validation, anomalies, corrections
        """
        validation = {
            'is_valid': True,
            'missing_fields': [],
            'anomalies': [],
            'corrected': {}
        }

        # Champs requis
        required_fields = ['name', 'prix']
        for field in required_fields:
            if not product.get(field):
                validation['missing_fields'].append(field)
                validation['is_valid'] = False

        # Détecter anomalies
        # Prix trop bas ou trop haut
        prix = product.get('prix')
        if prix:
            if isinstance(prix, (int, float)):
                if prix < 100:  # Prix suspectement bas pour un véhicule
                    validation['anomalies'].append(
                        f"Prix suspectement bas: {prix}$")
                if prix > 500000:  # Prix suspectement haut
                    validation['anomalies'].append(
                        f"Prix suspectement haut: {prix}$")

        # Image manquante ou invalide
        image = product.get('image')
        if image:
            if not image.startswith('http') and not image.startswith('/'):
                validation['anomalies'].append(f"URL image invalide: {image}")
        else:
            validation['anomalies'].append("Image manquante")

        # Auto-correction
        for field, value in product.items():
            standardized = self.standardize_field(field, value)
            if standardized != value:
                validation['corrected'][field] = standardized

        return validation

    def structural_preview(self, urls: List[str], sample_size: int = 10) -> Dict[str, Any]:
        """
        Analyze sample pages to detect global patterns (structure, selectors, etc.).

        Args:
            urls: Liste d'URLs à analyser
            sample_size: Nombre de pages à analyser

        Returns:
            Dictionnaire avec patterns globaux détectés
        """
        if not urls:
            return {}

        sample_urls = urls[:sample_size] if len(urls) > sample_size else urls
        patterns = {
            'common_selectors': {},
            'url_patterns': {},
            'structure_consistency': True,
            'recommended_selectors': {}
        }

        all_selectors_found = []

        for url in sample_urls:
            html = self.get(url)
            if not html:
                continue

            soup = BeautifulSoup(html, 'html.parser')

            # Chercher sélecteurs communs pour produits
            product_selectors = [
                '.product-title', '.product-name', 'h1.product', '[data-product-name]',
                '.price', '.product-price', '[data-price]',
                '.product-image', 'img.product', '[data-image]'
            ]

            for selector in product_selectors:
                elements = soup.select(selector)
                if elements:
                    all_selectors_found.append(selector)

        # Compter occurrences
        from collections import Counter
        selector_counts = Counter(all_selectors_found)

        # Recommander sélecteurs les plus fréquents
        for selector, count in selector_counts.most_common(10):
            if count >= len(sample_urls) * 0.5:  # Présent dans au moins 50% des pages
                patterns['recommended_selectors'][selector] = count

        return patterns
