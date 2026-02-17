"""
Module pour analyser le HTML avec Gemini et générer un scraper spécifique
Le scraper généré utilise Gemini pour extraire (comme scraper.py) mais avec pagination spécifique au site
"""
import json
import hashlib
import re
import time
import os
from pathlib import Path
from typing import Dict, Optional, List, Set
from urllib.parse import urlparse, urljoin
import requests
from bs4 import BeautifulSoup

try:
    from .config import SCRAPER_GENERATION_SCHEMA, CACHE_DIR, EXTRACTION_SCHEMA, PROMPT_VERSION
    from .gemini_client import GeminiClient
    from .ai_tools import AITools
    from .exploration_agent import ExplorationAgent
    from .site_data_storage import SiteDataStorage
    from .scraper_generator import ScraperGenerator
except ImportError:
    from config import SCRAPER_GENERATION_SCHEMA, CACHE_DIR, EXTRACTION_SCHEMA, PROMPT_VERSION
    from gemini_client import GeminiClient
    from ai_tools import AITools
    from exploration_agent import ExplorationAgent
    from site_data_storage import SiteDataStorage
    from scraper_generator import ScraperGenerator


# Schéma pour la sélection de pages à analyser
PAGE_SELECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "needsMorePages": {
            "type": "boolean",
            "description": "True si des pages supplémentaires sont nécessaires pour générer un scraper complet"
        },
        "selectedPages": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Liste des URLs à analyser en plus (max 5 pages)"
        },
        "reasoning": {
            "type": "string",
            "description": "Explication de pourquoi ces pages sont nécessaires"
        }
    },
    "required": ["needsMorePages", "selectedPages", "reasoning"]
}

# PROMPT_VERSION est maintenant défini dans config.py pour éviter les imports circulaires


class HTMLAnalyzer:
    """Analyse le HTML d'un site et génère un scraper spécifique

    Le scraper généré utilise Gemini pour extraire les produits (comme scraper.py)
    mais avec une logique de pagination spécifique au site analysé.
    """

    def __init__(self, user_id: Optional[str] = None):
        self.gemini_client = GeminiClient()
        self.cache_dir = Path(CACHE_DIR)
        self.cache_dir.mkdir(exist_ok=True)
        self.user_id = user_id
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.ai_tools = None  # Sera initialisé avec l'URL de base

    def _get_cache_key(self, url: str) -> str:
        """Génère une clé de cache basée sur l'URL"""
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        return hashlib.md5(domain.encode()).hexdigest()

    def _get_cache_path(self, url: str) -> Path:
        """Retourne le chemin du fichier de cache pour une URL"""
        cache_key = self._get_cache_key(url)
        return self.cache_dir / f"{cache_key}_scraper.py"

    def _load_cached_scraper(self, url: str) -> Optional[Dict]:
        """Charge un scraper depuis le cache (Supabase ou local)

        PRIORITÉ: Supabase si user_id fourni, sinon local.
        Si trouvé dans Supabase, supprime le fichier local pour éviter les doublons.
        Vérifie aussi la version du prompt depuis les commentaires.
        Si la version ne correspond pas, le cache est considéré comme invalide et sera régénéré.
        """
        cache_key = self._get_cache_key(url)

        # PRIORITÉ 1: Essayer Supabase si utilisateur connecté
        if self.user_id:
            try:
                scraper_data = self._load_from_supabase(cache_key)
                if scraper_data:
                    scraper_code = scraper_data.get('scraper_code', '')
                    metadata = scraper_data.get('metadata', {})

                    # Vérifier la version du prompt
                    cached_version = metadata.get('prompt_version', '1.0')
                    if cached_version != PROMPT_VERSION:
                        print(
                            f"⚠️ Version du prompt différente (cache: {cached_version}, actuelle: {PROMPT_VERSION})")
                        print(f"   Le prompt a été modifié, invalidation du cache...")
                        # Supprimer de Supabase
                        self._delete_from_supabase(cache_key)
                        return None

                    # Supprimer le fichier local s'il existe (priorité Supabase)
                    cache_path = self._get_cache_path(url)
                    if cache_path.exists():
                        try:
                            cache_path.unlink()
                            print(
                                f"🗑️  Fichier local supprimé (données dans Supabase)")
                        except Exception as e:
                            print(f"⚠️  Erreur suppression fichier local: {e}")

                    # Reconstruire le format de données attendu
                    cached_data = {
                        'scraperCode': scraper_code,
                        'siteAnalysis': {
                            'siteName': metadata.get('site_name', ''),
                            'siteUrl': metadata.get('site_url', url),
                            'structureType': metadata.get('structure_type', 'unknown')
                        },
                        'fieldMappings': {
                            'products': metadata.get('selectors', {})
                        },
                        'metadata': metadata
                    }

                    print(
                        f"✅ Scraper chargé depuis Supabase (cache_key: {cache_key})")
                    print(f"   Version prompt: {cached_version}")
                    return cached_data
            except Exception as e:
                print(f"⚠️ Erreur Supabase: {e}, fallback sur cache local")

        # PRIORITÉ 2: Fallback sur cache local
        cache_path = self._get_cache_path(url)
        if cache_path.exists():
            try:
                # Lire le fichier Python
                with open(cache_path, 'r', encoding='utf-8') as f:
                    scraper_code = f.read()

                # Extraire les métadonnées depuis les commentaires
                metadata = self._extract_metadata_from_code(scraper_code)

                # Vérifier la version du prompt
                cached_version = metadata.get('prompt_version', '1.0')
                if cached_version != PROMPT_VERSION:
                    print(
                        f"⚠️ Version du prompt différente (cache: {cached_version}, actuelle: {PROMPT_VERSION})")
                    print(f"   Le prompt a été modifié, invalidation du cache...")
                    cache_path.unlink()  # Supprimer le cache obsolète
                    return None

                # Reconstruire le format de données attendu
                cached_data = {
                    'scraperCode': scraper_code,
                    'siteAnalysis': {
                        'siteName': metadata.get('site_name', ''),
                        'siteUrl': metadata.get('site_url', url),
                        'structureType': metadata.get('structure_type', 'unknown')
                    },
                    'fieldMappings': {
                        'products': metadata.get('selectors', {})
                    },
                    'metadata': metadata
                }

                print(f"✅ Scraper chargé depuis le cache local: {cache_path}")
                print(f"   Version prompt: {cached_version}")
                return cached_data
            except Exception as e:
                print(f"⚠️ Erreur lors du chargement du cache local: {e}")
        return None

    def _extract_metadata_from_code(self, code: str) -> Dict:
        """Extrait les métadonnées depuis les commentaires du code Python"""
        metadata = {}

        # Chercher les métadonnées dans les commentaires/docstring
        # Format attendu: # Version prompt: 3.3
        patterns = {
            'prompt_version': r'Version prompt:\s*([\d.]+)',
            'cache_key': r'Cache key:\s*([a-f0-9]+)',
            'site_url': r'Site URL:\s*(https?://[^\s]+)',
            'site_name': r'Site name:\s*([^\n]+)',
            'structure_type': r'Structure type:\s*([^\n]+)',
            'generation_date': r'Date génération:\s*([^\n]+)',
            'urls_count': r'URLs découvertes:\s*(\d+)',
            'selectors_count': r'Sélecteurs détectés:\s*(\d+)'
        }

        for key, pattern in patterns.items():
            match = re.search(pattern, code, re.IGNORECASE)
            if match:
                value = match.group(1).strip()
                # Convertir les nombres
                if key in ['urls_count', 'selectors_count']:
                    try:
                        metadata[key] = int(value)
                    except ValueError:
                        pass
                else:
                    metadata[key] = value

        # Extraire les sélecteurs depuis le code (SELECTORS = {...})
        # Chercher SELECTORS = { ... } avec support multi-lignes
        selectors_match = re.search(
            r'SELECTORS\s*=\s*(\{.*?\})', code, re.DOTALL)
        if selectors_match:
            try:
                # Évaluer le dictionnaire de sélecteurs en Python
                selectors_str = selectors_match.group(1)
                # Utiliser eval() avec un contexte sécurisé (seulement pour les sélecteurs)
                # Les sélecteurs sont des chaînes simples, donc relativement sûr
                metadata['selectors'] = eval(
                    selectors_str, {"__builtins__": {}})
            except:
                # Fallback: essayer avec json si possible
                try:
                    selectors_str = selectors_match.group(1).replace("'", '"')
                    metadata['selectors'] = json.loads(selectors_str)
                except:
                    pass

        return metadata

    def _save_scraper_to_cache(self, url: str, scraper_data: Dict) -> str:
        """Sauvegarde un scraper dans le cache (fichier Python) et retourne le chemin du fichier"""
        cache_path = self._get_cache_path(url)
        try:
            # Le code Python contient déjà les métadonnées en commentaires
            scraper_code = scraper_data.get('scraperCode', '')
            if not scraper_code:
                raise ValueError("Le scraper_data doit contenir 'scraperCode'")

            # Sauvegarder directement le code Python
            with open(cache_path, 'w', encoding='utf-8') as f:
                f.write(scraper_code)
            return cache_path
        except Exception as e:
            print(f"⚠️ Erreur lors de la sauvegarde du cache: {e}")
            return ""

    def _save_to_supabase(self, site_url: str, cache_key: str, scraper_code: str, metadata: Dict) -> Optional[str]:
        """Sauvegarde un scraper dans Supabase via l'API"""
        try:
            api_url = os.environ.get('NEXTJS_API_URL', 'http://localhost:3000')
            save_url = f"{api_url}/api/scraper-ai/cache/save"

            response = requests.post(
                save_url,
                json={
                    "user_id": self.user_id,
                    "site_url": site_url,
                    "cache_key": cache_key,
                    "scraper_code": scraper_code,
                    "metadata": metadata
                },
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    return result.get('cache_key', cache_key)
                else:
                    raise Exception(
                        f"Supabase API error: {result.get('error', 'Unknown error')}")
            else:
                raise Exception(f"Supabase API error: {response.status_code}")

        except requests.exceptions.Timeout:
            raise Exception("Timeout: Supabase ne répond pas")
        except requests.exceptions.ConnectionError:
            raise Exception("Connexion impossible: Supabase inaccessible")
        except requests.exceptions.RequestException as e:
            raise Exception(f"Erreur réseau: {e}")

    def _load_from_supabase(self, cache_key: str) -> Optional[Dict]:
        """Charge un scraper depuis Supabase via l'API"""
        try:
            api_url = os.environ.get('NEXTJS_API_URL', 'http://localhost:3000')
            load_url = f"{api_url}/api/scraper-ai/cache/load"

            response = requests.get(
                load_url,
                params={
                    "user_id": self.user_id,
                    "cache_key": cache_key
                },
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('found'):
                    return {
                        'scraper_code': result.get('scraper_code', ''),
                        'metadata': result.get('metadata', {})
                    }
            elif response.status_code == 404:
                return None
            else:
                raise Exception(f"Supabase API error: {response.status_code}")

        except requests.exceptions.Timeout:
            raise Exception("Timeout: Supabase ne répond pas")
        except requests.exceptions.ConnectionError:
            raise Exception("Connexion impossible: Supabase inaccessible")
        except requests.exceptions.RequestException as e:
            raise Exception(f"Erreur réseau: {e}")

    def _delete_from_supabase(self, cache_key: str) -> bool:
        """Supprime un scraper de Supabase via l'API"""
        try:
            api_url = os.environ.get('NEXTJS_API_URL', 'http://localhost:3000')
            delete_url = f"{api_url}/api/scraper-ai/cache"

            response = requests.delete(
                delete_url,
                params={
                    "user_id": self.user_id,
                    "cache_key": cache_key
                },
                timeout=10
            )

            return response.status_code == 200
        except Exception as e:
            print(f"⚠️ Erreur suppression Supabase: {e}")
            return False

    def _enforce_local_cache_limit(self):
        """Applique la limite de 10 scrapers locaux pour utilisateurs non connectés"""
        try:
            # Lister tous les fichiers .py dans le cache
            cache_files = list(self.cache_dir.glob("*_scraper.py"))

            if len(cache_files) >= 10:
                # Trier par date de modification (plus ancien en premier)
                cache_files.sort(key=lambda f: f.stat().st_mtime)

                # Supprimer le plus ancien
                oldest_file = cache_files[0]
                oldest_file.unlink()
                print(
                    f"🗑️  Scraper local supprimé (limite 10 atteinte): {oldest_file.name}")
        except Exception as e:
            print(f"⚠️ Erreur lors de l'application de la limite: {e}")

    def _fetch_html(self, url: str, max_retries: int = 3) -> str:
        """Récupère le contenu HTML d'une URL avec retry pour erreurs transitoires.

        Args:
            url: URL à récupérer
            max_retries: Nombre maximum de tentatives (défaut: 3)
        """
        import time as _time
        last_error = None

        for attempt in range(max_retries):
            try:
                response = self.session.get(url, timeout=30)
                response.raise_for_status()
                return response.text
            except Exception as e:
                last_error = e
                error_str = str(e).lower()
                is_transient = any(kw in error_str for kw in [
                    'nameresolution', 'name resolution', 'nodename nor servname',
                    'timeout', 'timed out', 'connectionerror', 'connection refused',
                    'connectionreset', 'remotedisconnected', 'max retries exceeded',
                    'newconnectionerror', '502', '503', '504',
                ])
                if attempt < max_retries - 1 and is_transient:
                    wait_time = 2 ** attempt * 2  # 2s, 4s, 8s
                    print(
                        f"⚠️ Tentative {attempt + 1}/{max_retries} échouée pour {url}: {e}")
                    print(f"   🔄 Retry dans {wait_time}s...")
                    _time.sleep(wait_time)
                else:
                    break

        print(f"⚠️ Erreur lors de la récupération de {url}: {last_error}")
        return ""

    def _extract_links(self, html_content: str, base_url: str) -> List[str]:
        """Extrait tous les liens d'une page HTML"""
        soup = BeautifulSoup(html_content, 'html.parser')
        parsed_base = urlparse(base_url)
        base_domain = parsed_base.netloc.replace('www.', '')

        links = set()
        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            if not href or href.startswith('#') or href.startswith('javascript:'):
                continue

            full_url = urljoin(base_url, href)
            parsed = urlparse(full_url)
            link_domain = parsed.netloc.replace('www.', '')
            if link_domain == base_domain:
                clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
                if parsed.query:
                    clean_url += f"?{parsed.query}"
                links.add(clean_url)

        return sorted(list(links))

    def _ask_gemini_which_pages_to_analyze(self, url: str, html_content: str,
                                           available_links: List[str]) -> Dict:
        """Demande à Gemini quelles pages supplémentaires analyser"""
        links_to_show = available_links[:100]
        links_str = "\n".join([f"- {link}" for link in links_to_show])

        prompt = f"""Tu es un expert en scraping web. Analyse la page d'accueil d'un site de vente de véhicules motorisés et décide si tu as besoin de voir d'autres pages.

URL DE BASE: {url}

CONTENU HTML DE LA PAGE D'ACCUEIL (extrait):
{html_content[:30000]}

LIENS DISPONIBLES:
{links_str}

QUESTION: As-tu besoin d'autres pages pour comprendre la structure complète? (max 5 pages)

Sélectionne des pages de:
- Listing de produits (inventaire, catalogue)
- Détail d'un produit
- Contact (pour infos entreprise)
"""

        try:
            result = self.gemini_client.call(
                prompt=prompt,
                schema=PAGE_SELECTION_SCHEMA,
                show_prompt=True
            )
            return result
        except Exception as e:
            print(f"⚠️ Erreur lors de la sélection de pages: {e}")
            return {"needsMorePages": False, "selectedPages": [], "reasoning": "Erreur"}

    def _generate_scraper_with_context(self, url: str, pages_content: Dict[str, str]) -> Dict:
        """Génère le scraper avec tout le contexte des pages analysées

        Le scraper généré utilise Gemini pour extraire (comme scraper.py)
        mais avec une logique de pagination spécifique au site.
        """
        schema_str = json.dumps(EXTRACTION_SCHEMA, indent=2)

        pages_context = ""
        for page_url, html_content in pages_content.items():
            truncated = html_content[:20000]
            pages_context += f"\n\n{'='*40}\nPAGE: {page_url}\n{'='*40}\n{truncated}"

        prompt = f"""Tu es un expert en scraping web. Génère un scraper Python pour ce site de vente de véhicules motorisés.

URL DE BASE: {url}

PAGES ANALYSÉES:
{pages_context}

SCHÉMA JSON À RESPECTER:
{schema_str}

APPROCHE REQUISE:
Le scraper DOIT utiliser l'extraction locale avec BeautifulSoup (SANS Gemini), en utilisant les URLs déjà découvertes et dédupliquées par l'AI Agent.

⚠️ CRITIQUE - SCRIPT D'EXTRACTION PUR ET EXPLICITE (0% AMBIVALENT):
Le script généré DOIT être un script d'extraction Python PUR, pas une explication de ce que l'AI Agent a fait.
- Les URLs sont DÉJÀ découvertes et dédupliquées par l'AI Agent (une URL par modèle+année, couleurs ignorées)
- Le script généré doit utiliser ces URLs comme outils pour savoir exactement où aller chercher les données
- Chaque étape d'extraction doit être 100% EXPLICITE et sans ambiguïté:
  * Quelle méthode utiliser pour récupérer le HTML (get/browser_get/smart_get) et POURQUOI
  * Quelle stratégie d'extraction utiliser (JSON-LD → fieldMappings → patterns génériques) et dans quel ordre
  * Comment extraire chaque champ (sélecteur CSS exact, code d'extraction détaillé)
- Le script ne doit PAS expliquer comment les URLs ont été découvertes, mais doit être explicite sur comment les utiliser pour l'extraction

⚠️ CRITIQUE - HARDCODER LES DONNÉES DANS LE SCRIPT:
Le script généré DOIT contenir les URLs et sélecteurs HARDCODÉS directement dans le code Python.
- NE PAS utiliser exploration_result.get() au runtime - les URLs doivent être dans une liste Python hardcodée
- NE PAS utiliser field_mappings au runtime - les sélecteurs doivent être dans un dictionnaire Python hardcodé
- Format OBLIGATOIRE:
  ```python
  # URLs hardcodées (déjà découvertes par l'AI Agent)
  PRODUCT_URLS = [
      "https://site.com/product1",
      "https://site.com/product2",
      # ... toutes les URLs de exploration_result['all_product_urls']
  ]
  
  # Sélecteurs hardcodés (détectés par l'AI Agent)
  SELECTORS = {{
      'name': 'h1.product-title',
      'prix': '.price',
      'image': 'img.product-image::attr(src)',
      # ... tous les sélecteurs de field_mappings['products']
  }}
  ```
- Le script doit être COMPLÈTEMENT AUTONOME - pas besoin de exploration_result ou field_mappings au runtime

STRUCTURE DU SCRAPER À GÉNÉRER:

```python
def scrape(base_url):
    \"\"\"
    Scraper généré pour {url}
    Utilise Gemini pour extraire les produits (comme scraper.py)
    
    IMPORTANT: gemini_client et session sont déjà disponibles dans le namespace global.
    NE PAS les passer en paramètres, les utiliser directement.
    \"\"\"
    # gemini_client et session sont déjà disponibles globalement
    # Utiliser directement: gemini_client.call(prompt, EXTRACTION_SCHEMA)
    
    # ÉTAPE 1: UTILISER LES URLs PRÉ-DÉCOUVERTES PAR L'AI AGENT
    # ⚠️ CRITIQUE: Les URLs ont DÉJÀ été découvertes par l'AI Agent et sont dédupliquées
    # NE PAS redécouvrir les URLs - utiliser directement exploration_result['all_product_urls']
    
    print(f"\\n{{'='*60}}")
    print(f"📍 ÉTAPE 1: UTILISATION DES URLs PRÉ-DÉCOUVERTES")
    print(f"{{'='*60}}")
    
    # Récupérer les URLs déjà découvertes par l'AI Agent
    all_product_urls = exploration_result.get('all_product_urls', [])
    
    if not all_product_urls:
        print("❌ Aucune URL de produit pré-découverte par l'AI Agent")
        return {{'companyInfo': {{}}, 'products': []}}
    
    print(f"✅ {{len(all_product_urls)}} URLs de produits pré-découvertes (déjà dédupliquées)")
    print(f"   Exemples: {{all_product_urls[:3]}}")
    response = session.get(base_url)
    soup = BeautifulSoup(response.text, 'html.parser')
    html_content = str(soup)
    
    # Extraire tous les liens de la page
    all_links = []
    for a_tag in soup.find_all('a', href=True):
        href = a_tag['href']
        if href and not href.startswith('#') and not href.startswith('javascript:'):
            full_url = urljoin(base_url, href)
            all_links.append(full_url)
    
    print(f"   ✅ {{len(all_links)}} liens trouvés")
    
    # ÉTAPE 2: FILTRER les URLs pour ne garder que les pages de produits
    # Mots-clés de pages de produits: inventory, inventaire, products, moto, vehicle, listing, stock, catalog, catalogue, vehicule, quad, atv, motoneige, etc.
    # Mots-clés à EXCLURE: contact, about, policy, privacy, terms, blog, news, service, appointment, financing, home, index, login, register, account, cart, checkout, wishlist, search, faq
    product_keywords = ['inventory', 'inventaire', 'products', 'product', 'moto', 'vehicle', 'listing', 'stock', 'shop', 'category',
        'catalog', 'catalogue', 'vehicule', 'quad', 'atv', 'motoneige', 'snowmobile', 'scooter', 'marine', 'moto-marine', 'side-by-side', 'sxs']
    exclude_keywords = ['contact', 'about', 'policy', 'privacy', 'terms', 'blog', 'news', 'service', 'appointment',
        'financing', 'home', 'index', 'login', 'register', 'account', 'cart', 'checkout', 'wishlist', 'search', 'faq']
    
    product_pages = []
    for link in all_links:
        link_lower = link.lower()
        # Exclure si contient un mot-clé d'exclusion
        if any(keyword in link_lower for keyword in exclude_keywords):
            continue
        # Inclure si contient un mot-clé de produit OU si c'est la page d'accueil
        if any(keyword in link_lower for keyword in product_keywords) or link == base_url:
            product_pages.append(link)
    
    print(
        f"   ✅ {{len(product_pages)}} pages de produits identifiées (sur {{len(all_links)}} liens)")
    
    if not product_pages:
        print(f"   ⚠️ Aucune page de produits trouvée, utilisation de la page d'accueil")
        product_pages = [base_url]
    
    # ÉTAPE 3: DÉTECTER LE PATTERN DE PAGINATION
    # Analyser les liens de pagination dans le HTML
    # Chercher: ?page=2, /page/2/, ?p=2, etc.
    # Chercher le bouton "Suivant" / "Next" et son href
    
    pagination_pattern = None
    pagination_type = None
    
    # Exemples de détection:
    pagination_links = soup.find_all('a', href=re.compile(r'page|p=\\d+', re.I))
    if pagination_links:
        # Analyser le premier lien pour trouver le pattern
        first_link = pagination_links[0].get('href', '')
        # Extraire le pattern: ?page=, /page/, ?p=, etc.
    
    # ÉTAPE 4: BOUCLE DE PAGINATION (max 100 pages)
    all_product_pages = list(set(product_pages))  # Dédupliquer
    visited_urls = set(all_product_pages)
    page = 1
    max_pages = 100
    
    while page <= max_pages:
        # Construire l'URL de la page selon le pattern détecté
        # Exemples selon le site:
        # - page_url = f"{{base_url}}?page={{page}}"
        # - page_url = f"{{base_url}}/page/{{page}}/"
        # - page_url = f"{{base_url}}/inventaire?p={{page}}"
        # - page_url = urljoin(base_url, f"/inventaire/page/{{page}}/")
        
        # IMPORTANT: Adapter selon le pattern réel détecté dans le HTML
        # Si aucun pattern détecté, essayer les patterns communs
        
        # Éviter les doublons
        if page_url in visited_urls:
            break
        
        visited_urls.add(page_url)
        
        # Récupérer la page
        try:
            page_response = session.get(page_url, timeout=30)
            page_response.raise_for_status()
            page_soup = BeautifulSoup(page_response.text, 'html.parser')
            
            # Vérifier s'il y a des produits sur cette page
            # Si pas de produits ou page vide, arrêter
            # Exemple: if not page_soup.find_all(class_='product'): break
            
            all_product_pages.append(page_url)
            print(f"   Page {{page}} trouvée: {{page_url}}")
            
            # Vérifier s'il y a une page suivante
            # Chercher le bouton "Suivant" ou le lien de la page suivante
            # Si non trouvé, break
            
            page += 1
        except Exception as e:
            print(f"   Erreur page {{page}}: {{e}}")
            break
    
    print(f"   ✅ Total pages de produits trouvées: {{len(all_product_pages)}}")
    
    # 3. RÉCUPÉRER LE HTML DE TOUTES LES PAGES
    pages_data = []
    for page_url in all_product_pages:
        response = session.get(page_url)
        soup = BeautifulSoup(response.text, 'html.parser')
        pages_data.append({{
            'url': page_url,
            'html': str(soup),
            'text': soup.get_text()
        }})
        print(f"HTML récupéré: {{page_url}} ({{len(str(soup))}} caractères)")
    
    # 4. UTILISER GEMINI POUR EXTRAIRE (comme scraper.py)
    # Préparer le prompt avec tout le HTML
    pages_html = ""
    for i, page_data in enumerate(pages_data, 1):
        pages_html += f"\\n{{'─'*60}}\\n"
        pages_html += f"PAGE {{i}}: {{page_data['url']}}\\n"
        pages_html += f"{{'─'*60}}\\n"
        pages_html += f"{{page_data['html']}}\\n\\n"
    
    prompt = f\"\"\"Tu es un expert en extraction de données. Extrais TOUS les véhicules motorisés depuis ces pages HTML.

HTML COMPLET DES PAGES:
{{pages_html}}

Extrais UNIQUEMENT les VÉHICULES INDIVIDUELS avec marque et modèle spécifiques.
Ignore les catégories, les liens de navigation, les pages d'information.

Pour chaque véhicule, extrais:
- name, description, category, marque, modele, prix, disponibilite, image, annee, kilometrage, cylindree
- sourceUrl: URL de la page où le produit a été trouvé
- sourceSite: base_url
- sourceCategorie: "inventaire", "catalogue", ou "vehicules_occasion"
\"\"\"
    
    # Appeler Gemini avec le schéma (gemini_client est déjà dans le namespace)
    result = gemini_client.call(
        prompt=prompt,
        schema=EXTRACTION_SCHEMA,
        show_prompt=False
    )
    
    products_count = len(result.get('products', []))
    print(f"✅ Gemini a extrait {{products_count}} produits")
    
    # 5. Retourner le résultat
    return {{
        'companyInfo': result.get('companyInfo', {{}}),
        'products': result.get('products', [])
    }}
```

CRITIQUE - PAGINATION:
1. ANALYSE le HTML fourni pour identifier le pattern de pagination exact
2. IMPLÉMENTE une boucle qui trouve TOUTES les pages
3. UTILISE Gemini pour extraire (comme scraper.py) - ne pas essayer d'extraire manuellement avec BeautifulSoup
4. LOGS: Affiche chaque page visitée et le nombre de produits trouvés

IMPORTANT - SIGNATURE DE LA FONCTION:
La fonction scrape() DOIT avoir UN SEUL paramètre: base_url
NE PAS ajouter gemini_client ou session comme paramètres - ils sont déjà disponibles globalement.

Exemple correct:
```python
def scrape(base_url):
    # gemini_client et session sont disponibles globalement
    # Utiliser directement sans les passer en paramètres
    response = session.get(base_url)
    result = gemini_client.call(prompt, EXTRACTION_SCHEMA)
```

Exemple INCORRECT (ne pas faire):
```python
def scrape(base_url, gemini_client, session):  # ❌ NE PAS FAIRE
```

GÉNÈRE LE CODE COMPLET ET FONCTIONNEL avec la bonne signature.
"""

        try:
            result = self.gemini_client.call(
                prompt=prompt,
                schema=SCRAPER_GENERATION_SCHEMA,
                show_prompt=True
            )
            return result
        except Exception as e:
            print(f"❌ Erreur lors de la génération du scraper: {e}")
            raise

    def analyze_and_generate_scraper(self, url: str, html_content: str,
                                     force_refresh: bool = False) -> Dict:
        r"""Analyse le HTML et génère un scraper spécifique pour le site

        Nouveau flux en 4 étapes :
        1. ExplorationAgent : Découvre URLs et extrait infos via Gemini
        2. SiteDataStorage : Sauvegarde données structurées
        3. ScraperGenerator : Génère script depuis template (sans Gemini)
        4. Retourne résultat pour exécution
        """
        # Vérifier le cache du scraper (format ancien ou nouveau)
        if not force_refresh:
            cached = self._load_cached_scraper(url)
            if cached:
                print(f"\n💾 Scraper chargé depuis le cache")
                print(
                    f"   ✅ Le scraper en cache sera utilisé pour accélérer l'extraction")
                print(
                    f"   📝 Code scraper présent: {len(cached.get('scraperCode', ''))} caractères")
                return cached

        # Vérifier si les données d'exploration existent dans le cache
        storage = SiteDataStorage()
        cached_site_data = storage.load_site_data(url)

        if cached_site_data and not force_refresh:
            print(f"\n{'='*60}")
            print(f"✅ DONNÉES D'EXPLORATION TROUVÉES DANS LE CACHE")
            print(f"{'='*60}")
            print(f"🌐 URL: {url}")
            print(
                f"📅 Date d'exploration: {cached_site_data.get('exploration_date', 'N/A')}")
            print(
                f"📋 URLs de produits: {len(cached_site_data.get('product_urls', []))}")
            print(
                f"🎯 Sélecteurs détectés: {len(cached_site_data.get('detected_selectors', {}))}")
            print(
                f"\n   ⚡ Réutilisation des données existantes (pas de re-exploration Gemini)")
            print(f"   🔧 Génération du scraper depuis les données en cache...\n")

            # Convertir les données au format attendu par ScraperGenerator
            site_data = {
                'site_url': cached_site_data.get('site_url', url),
                'product_urls': cached_site_data.get('product_urls', []),
                'detected_selectors': cached_site_data.get('detected_selectors', {}),
                'site_structure': cached_site_data.get('site_structure', {}),
                'metadata': cached_site_data.get('metadata', {})
            }
        else:
            # Les données n'existent pas, faire l'exploration complète
            print(f"\n{'='*60}")
            print(f"🔍 NOUVEAU FLUX : 4 ÉTAPES DISTINCTES")
            print(f"{'='*60}")
            print(f"🌐 URL: {url}")
            print(f"📄 Taille HTML: {len(html_content)} caractères\n")

            # ÉTAPE 1 : ExplorationAgent (Gemini)
            print(f"\n📍 ÉTAPE 1 : EXPLORATION ET EXTRACTION GEMINI")
            exploration_agent = ExplorationAgent()
            exploration_data = exploration_agent.explore_and_extract(
                url, html_content)

            # ÉTAPE 2 : SiteDataStorage (Sauvegarde structurée)
            print(f"\n💾 ÉTAPE 2 : STOCKAGE STRUCTURÉ")
            site_data = {
                'site_url': url,
                'product_urls': exploration_data['product_urls'],
                'html_samples': exploration_data['html_samples'],
                'extracted_products': exploration_data['extracted_products'],
                'detected_selectors': exploration_data['detected_selectors'],
                'site_structure': exploration_data['site_structure'],
                'metadata': {
                    'data_version': '1.0',
                    'exploration_date': exploration_data.get('exploration_date')
                }
            }
            storage.save_site_data(
                url=url,
                product_urls=site_data['product_urls'],
                html_samples=site_data['html_samples'],
                extracted_products=site_data['extracted_products'],
                detected_selectors=site_data['detected_selectors'],
                site_structure=site_data['site_structure'],
                metadata=site_data['metadata']
            )

        # ÉTAPE 3 : ScraperGenerator (Template, sans Gemini)
        print(f"\n🔧 ÉTAPE 3 : GÉNÉRATION DU SCRAPER (SANS GEMINI)")
        generator = ScraperGenerator()
        scraper_code = generator.generate_scraper(site_data)

        # Construire le résultat au format attendu
        site_structure = site_data.get('site_structure', {})
        result = {
            'scraperCode': scraper_code,
            'siteAnalysis': {
                'siteName': site_structure.get('domain', ''),
                'siteUrl': url,
                'structureType': site_structure.get('structure_type', 'unknown')
            },
            'fieldMappings': {
                'products': site_data['detected_selectors']
            },
            'metadata': {
                'url': url,
                'cache_key': self._get_cache_key(url),
                'data_version': '1.0',
                'prompt_version': PROMPT_VERSION  # Garder pour compatibilité
            }
        }

        # Sauvegarder dans le cache (format ancien pour compatibilité)
        print(f"\n💾 Sauvegarde du scraper dans le cache...")
        cache_path = self._save_scraper_to_cache(url, result)
        print(f"   ✅ Scraper sauvegardé: {cache_path}")
        print(f"   📝 Version: {PROMPT_VERSION}")
        print(f"\n🚀 Démarrage immédiat de l'extraction avec le scraper généré...")

        return result

    def _explore_site_with_ai_tools(self, url: str, initial_html: str) -> Dict:
        """Explore le site en utilisant les outils AI de manière flexible

        L'agent explore le site de manière exhaustive pour maximiser la flexibilité.
        """

        # Utiliser les outils pour explorer
        tools = self.ai_tools

        # 1. Extraire tous les liens
        print(f"   📍 Extraction des liens...")
        all_links = tools.get_all_links(initial_html, url)
        print(f"      ✅ {len(all_links)} liens trouvés")

        # 2. Détecter les URLs de produits (avec plusieurs stratégies EXHAUSTIVES)
        print(f"   🔍 Détection EXHAUSTIVE des pages de produits...")
        product_urls = tools.discover_product_urls(initial_html, url)

        # Essayer aussi avec des sélecteurs CSS spécifiques (plus de sélecteurs)
        product_selectors = [
            'a[href*="product"]',
            'a[href*="inventory"]',
            'a[href*="inventaire"]',
            'a[href*="moto"]',
            'a[href*="vehicle"]',
            'a[href*="vehicule"]',
            'a[href*="quad"]',
            'a[href*="atv"]',
            'a[href*="snowmobile"]',
            'a[href*="motoneige"]',
            '.product-link',
            '.product-card a',
            '[class*="product"] a',
            '[class*="item"] a',
            '[data-product-id]',
            'a[href*="/detail"]',
            'a[href*="/fiche"]'
        ]

        additional_product_urls = []
        for selector in product_selectors:
            links = tools.parse_html(initial_html, selector)
            for link in links:
                normalized = tools.normalize_url(url, link)
                if normalized and normalized not in product_urls:
                    additional_product_urls.append(normalized)

        product_urls.extend(additional_product_urls)
        product_urls = list(set(product_urls))  # Dédupliquer
        print(
            f"      ✅ {len(product_urls)} URLs de produits potentielles détectées")
        print(
            f"      🎯 Ces URLs serviront de point de départ pour trouver TOUS les produits")

        # 3. Détecter la pagination (avec plusieurs méthodes) - CRITIQUE pour trouver TOUS les produits
        print(f"   📑 Détection de la pagination (CRITIQUE pour exhaustivité)...")
        pagination = tools.detect_pagination(initial_html, url)
        if pagination:
            print(
                f"      ✅ Pagination détectée: {pagination.get('type', 'unknown')}")
            print(f"      🎯 Pattern: {pagination.get('pattern', 'N/A')}")
            print(f"      ⚠️ IMPORTANT: Le scraper devra boucler sur TOUTES les pages")
        else:
            print(
                f"      ⚠️ Aucune pagination détectée - devra explorer tous les liens manuellement")

        # 4. Essayer de récupérer le sitemap (plusieurs emplacements) - PRIORITÉ ABSOLUE
        print(f"   🗺️ Recherche du sitemap (PRIORITÉ pour trouver TOUS les produits)...")
        sitemap_urls = tools.get_sitemap_urls(url)
        if sitemap_urls:
            print(f"      ✅ {len(sitemap_urls)} URLs trouvées dans le sitemap")
            print(f"      🎯 Le sitemap contient probablement TOUS les produits du site")
        else:
            print(
                f"      ⚠️ Aucun sitemap trouvé - devra utiliser pagination/navigation exhaustive")

        # 5. Récupérer plusieurs types de pages pour analyse complète
        pages_to_analyze = [url]  # Commencer par la page d'accueil

        # Ajouter des URLs de produits (jusqu'à 10 pour avoir une bonne variété)
        for product_url in product_urls[:10]:
            if product_url not in pages_to_analyze:
                pages_to_analyze.append(product_url)

        # Ajouter des pages de catégories si trouvées (plusieurs catégories)
        category_keywords = ['category', 'categorie', 'catalog',
                             'catalogue', 'shop', 'boutique', 'inventory', 'inventaire']
        category_pages_found = 0
        for link in all_links[:100]:  # Examiner plus de liens
            link_lower = link.lower()
            if any(keyword in link_lower for keyword in category_keywords):
                if link not in pages_to_analyze and category_pages_found < 5:
                    pages_to_analyze.append(link)
                    category_pages_found += 1

        # Si sitemap disponible, analyser quelques URLs du sitemap pour comprendre la structure
        if sitemap_urls:
            for sitemap_url in sitemap_urls[:5]:
                if sitemap_url not in pages_to_analyze and len(pages_to_analyze) < 15:
                    pages_to_analyze.append(sitemap_url)

        # Récupérer le HTML de ces pages
        pages_content = {}
        print(
            f"\n   📥 Récupération de {len(pages_to_analyze)} pages pour analyse...")
        for page_url in pages_to_analyze:
            print(f"      Récupération: {page_url}")
            # Essayer d'abord avec requests, puis avec Selenium si nécessaire
            page_html = tools.get(page_url, use_selenium=False)
            if not page_html or len(page_html) < 1000:
                # Si le HTML est trop court, essayer avec Selenium
                print(f"         ⚠️ HTML court, essai avec Selenium...")
                page_html = tools.browser_get(page_url)

            if page_html:
                pages_content[page_url] = page_html
                print(f"      ✅ {len(page_html)} caractères")

        # 6. Analyser la structure HTML pour identifier les patterns
        print(f"   🔬 Analyse de la structure HTML...")
        structure_info = {}
        # Analyser les 3 premières pages
        for page_url, html in list(pages_content.items())[:3]:
            # Détecter les sélecteurs communs pour les produits
            product_containers = tools.parse_html(
                html, '.product, .item, .card, [class*="product"], [class*="item"]')
            if product_containers:
                structure_info[page_url] = {
                    'has_product_containers': True,
                    'container_count': len(product_containers)
                }

        # 7. DÉCOUVRIR TOUTES LES URLs DE PRODUITS
        print(f"\n   🔍 Découverte complète de toutes les URLs de produits...")
        all_product_urls_list = []

        # Utiliser le sitemap si disponible (priorité absolue)
        if sitemap_urls:
            print(f"      📋 Utilisation du sitemap: {len(sitemap_urls)} URLs")
            all_product_urls_list.extend(sitemap_urls)

        # Parcourir toutes les pages de pagination si pagination détectée
        if pagination:
            print(f"      📑 Parcours de la pagination...")
            page = 1
            consecutive_empty = 0
            max_pages = 200
            max_urls = 500  # Limite de sécurité

            while page <= max_pages and len(all_product_urls_list) < max_urls:
                try:
                    page_url = tools.build_pagination_url(
                        url, pagination, page)
                    print(f"         Page {page}: {page_url[:80]}...")

                    page_html = tools.get(page_url, use_selenium=False)
                    if not page_html or len(page_html) < 1000:
                        consecutive_empty += 1
                        if consecutive_empty >= 3:
                            print(
                                f"         ⚠️ 3 pages vides consécutives, arrêt de la pagination")
                            break
                        page += 1
                        continue

                    # Extraire les URLs de produits de cette page
                    page_product_urls = tools.discover_product_urls(
                        page_html, page_url)
                    if page_product_urls:
                        all_product_urls_list.extend(page_product_urls)
                        consecutive_empty = 0
                        print(
                            f"         ✅ {len(page_product_urls)} URLs trouvées (total: {len(all_product_urls_list)})")
                    else:
                        consecutive_empty += 1
                        if consecutive_empty >= 3:
                            print(
                                f"         ⚠️ 3 pages sans produits consécutives, arrêt")
                            break

                    page += 1
                    time.sleep(0.3)  # Rate limiting
                except Exception as e:
                    print(f"         ⚠️ Erreur page {page}: {e}")
                    consecutive_empty += 1
                    if consecutive_empty >= 3:
                        break
                    page += 1

        # 8. DÉDUPLIQUER LES URLs
        print(f"\n   🔄 Déduplication des URLs...")
        normalized_urls_dict = {}
        for url in all_product_urls_list:
            normalized = tools.normalize_url_for_dedup(url)
            # Garder l'URL originale la plus courte
            if normalized not in normalized_urls_dict or len(url) < len(normalized_urls_dict[normalized]):
                normalized_urls_dict[normalized] = url

        all_product_urls = list(normalized_urls_dict.values())
        print(
            f"      ✅ {len(all_product_urls)} URLs uniques après déduplication (sur {len(all_product_urls_list)} totales)")

        # 8.5. DÉDUPLIQUER PAR MODÈLE+ANNÉE (ignorer les couleurs)
        print(f"\n   🔄 Déduplication par modèle+année (ignorer les couleurs)...")
        model_year_urls_dict = {}
        for url in all_product_urls:
            model_year_key = tools.normalize_url_by_model_year(url)
            # Garder la première URL trouvée pour chaque combinaison modèle+année
            if model_year_key not in model_year_urls_dict:
                model_year_urls_dict[model_year_key] = url

        all_product_urls = list(model_year_urls_dict.values())
        print(
            f"      ✅ {len(all_product_urls)} URLs uniques après déduplication par modèle+année (une URL par modèle+année, couleurs ignorées)")

        # 9. FILTRER POUR NE GARDER QUE LES PAGES DE PRODUITS
        print(f"\n   🎯 Filtrage pour ne garder que les pages de produits...")
        filtered_product_urls = []

        # Mots-clés indicateurs de pages de produits
        product_keywords = ['product', 'inventory', 'inventaire', 'moto', 'vehicle', 'vehicule',
                            'quad', 'atv', 'snowmobile', 'motoneige', 'detail', 'fiche']
        exclude_keywords = ['contact', 'about', 'policy', 'privacy', 'terms', 'blog', 'news',
                            'service', 'appointment', 'financing', 'home', 'index', 'login',
                            'register', 'account', 'cart', 'checkout', 'wishlist', 'search', 'faq']

        # Vérifier un échantillon pour identifier les patterns
        sample_size = min(50, len(all_product_urls))
        for url in all_product_urls[:sample_size]:
            url_lower = url.lower()
            # Exclure si contient un mot-clé d'exclusion
            if any(keyword in url_lower for keyword in exclude_keywords):
                continue
            # Inclure si contient un mot-clé de produit
            if any(keyword in url_lower for keyword in product_keywords):
                filtered_product_urls.append(url)

        # Si filtrage trop strict, utiliser toutes les URLs
        if len(filtered_product_urls) < len(all_product_urls) * 0.1 and len(all_product_urls) > 50:
            print(
                f"      ⚠️ Filtrage trop strict ({len(filtered_product_urls)}/{len(all_product_urls)}), utilisation de toutes les URLs")
            filtered_product_urls = all_product_urls
        else:
            # Appliquer le même filtrage au reste
            for url in all_product_urls[sample_size:]:
                url_lower = url.lower()
                if any(keyword in url_lower for keyword in exclude_keywords):
                    continue
                if any(keyword in url_lower for keyword in product_keywords):
                    filtered_product_urls.append(url)

        print(
            f"      ✅ {len(filtered_product_urls)} URLs de produits filtrées")

        return {
            # Beaucoup plus de liens pour trouver TOUS les produits
            'all_links': all_links[:500],
            # Plus d'URLs de produits pour analyse
            'product_urls': product_urls[:200],
            'pagination': pagination,
            # TOUTES les URLs du sitemap si disponible
            'sitemap_urls': sitemap_urls[:500] if sitemap_urls else [],
            # NOUVEAU: Toutes les URLs de produits découvertes et dédupliquées
            'all_product_urls': filtered_product_urls,
            'discovered_pages': list(pages_content.keys()),
            # Plus de contenu HTML
            'pages_content': {k: v[:100000] for k, v in pages_content.items()},
            'structure_info': structure_info,
            'exploration_metadata': {
                'total_links_found': len(all_links),
                'total_product_urls': len(product_urls),
                'total_sitemap_urls': len(sitemap_urls),
                'total_all_product_urls': len(filtered_product_urls),
                'pages_analyzed': len(pages_content),
                'has_sitemap': len(sitemap_urls) > 0,
                'has_pagination': pagination is not None,
                # Indique si le sitemap semble complet
                'sitemap_is_complete': len(sitemap_urls) > 100
            }
        }

    def _generate_scraper_with_ai_exploration(self, url: str, exploration_result: Dict) -> Dict:
        """Génère le scraper basé sur l'exploration avec les outils AI"""

        schema_str = json.dumps(EXTRACTION_SCHEMA, indent=2)

        # Préparer le contexte d'exploration
        exploration_context = f"""
EXPLORATION DU SITE AVEC LES OUTILS AI:

1. LIENS DÉCOUVERTS: {len(exploration_result.get('all_links', []))} liens internes
   Exemples: {exploration_result.get('all_links', [])[:10]}

2. PAGES DE PRODUITS DÉTECTÉES: {len(exploration_result.get('product_urls', []))} URLs
   Exemples: {exploration_result.get('product_urls', [])[:5]}

3. PAGINATION:
   {json.dumps(exploration_result.get('pagination'), indent=2) if exploration_result.get(
            'pagination') else 'Aucune pagination détectée'}

4. SITEMAP:
   {len(exploration_result.get('sitemap_urls', []))} URLs trouvées dans le sitemap

5. URLs DE PRODUITS PRÉ-DÉCOUVERTES (DÉJÀ DÉDUPLIQUÉES):
   {len(exploration_result.get('all_product_urls', []))} URLs de produits découvertes par l'AI Agent
   ⚠️ CRITIQUE: Ces URLs sont DÉJÀ dédupliquées et filtrées - utiliser directement dans le script
   Exemples: {exploration_result.get('all_product_urls', [])[:5]}

6. PAGES ANALYSÉES:
"""

        for page_url, html_content in exploration_result.get('pages_content', {}).items():
            truncated = html_content[:30000]  # Limiter la taille
            exploration_context += f"\n   PAGE: {page_url}\n   HTML (tronqué):\n{truncated[:1000]}...\n"

        # Préparer les métadonnées d'exploration
        exploration_meta = exploration_result.get('exploration_metadata', {})

        prompt = rf"""Tu es un expert en scraping web. Génère un scraper Python robuste et exhaustif pour ce site de vente de véhicules motorisés.

═══════════════════════════════════════════════════════════════
1. CONTEXTE DU SITE
═══════════════════════════════════════════════════════════════

URL DE BASE: {url}

{exploration_context}

MÉTADONNÉES D'EXPLORATION:
- Total liens trouvés: {exploration_meta.get('total_links_found', 0)}
- URLs de produits détectées: {exploration_meta.get('total_product_urls', 0)}
- URLs dans sitemap: {exploration_meta.get('total_sitemap_urls', 0)}
- Pages analysées: {exploration_meta.get('pages_analyzed', 0)}
- Sitemap disponible: {'Oui (COMPLET)' if exploration_meta.get('has_sitemap') and exploration_meta.get('sitemap_is_complete') else 'Oui (partiel)' if exploration_meta.get('has_sitemap') else 'Non'}
- Pagination détectée: {'Oui' if exploration_meta.get('has_pagination') else 'Non'}

⚠️ CRITIQUE - URLs PRÉ-DÉCOUVERTES:
L'AI Agent a déjà découvert TOUTES les URLs de produits du site et les a dédupliquées.
Ces URLs sont disponibles dans exploration_result['all_product_urls'].
Le script généré DOIT utiliser ces URLs directement - NE PAS les redécouvrir.

Total URLs de produits pré-découvertes: {exploration_meta.get('total_all_product_urls', 0)}
Exemples: {exploration_result.get('all_product_urls', [])[:5]}

═══════════════════════════════════════════════════════════════
2. OBJECTIF
═══════════════════════════════════════════════════════════════

⚠️ CRITIQUE: Trouver TOUS les produits du site, pas seulement un échantillon.

Le scraper DOIT ABSOLUMENT:
- ⚠️ OBLIGATOIRE ET NON-NÉGOCIABLE: Utiliser DIRECTEMENT les URLs pré-découvertes (exploration_result['all_product_urls'])
- ⚠️ INTERDIT ABSOLUMENT: NE JAMAIS redécouvrir les URLs (déjà fait par l'AI Agent avant génération du script)
- ⚠️ INTERDIT ABSOLUMENT: NE JAMAIS appeler get_sitemap_urls(), detect_pagination(), ou discover_product_urls() dans l'ÉTAPE 1
- ⚠️ INTERDIT ABSOLUMENT: NE JAMAIS utiliser optimized_path, load_json('optimized_path'), ou faire de découverte complète
- ⚠️ INTERDIT ABSOLUMENT: NE JAMAIS créer normalized_urls_dict ou add_url_with_dedup() - les URLs sont DÉJÀ dédupliquées
- Respecter le schéma JSON fourni
- ⚠️ CRITIQUE: Faire l'extraction LOCALEMENT avec BeautifulSoup (SANS Gemini)
- Utiliser les fieldMappings détectés pour extraction CSS/XPath
- Fallback sur patterns génériques si fieldMappings échouent
- Gérer les erreurs et cas limites

⚠️ RÈGLE ABSOLUE: L'ÉTAPE 1 doit COMMENCER par:
   all_product_urls = exploration_result.get('all_product_urls', [])
   
   Et rien d'autre. Pas de sitemap, pas de pagination, pas de découverte.

SCHÉMA JSON À RESPECTER:
{schema_str}

═══════════════════════════════════════════════════════════════
3. OUTILS DISPONIBLES
═══════════════════════════════════════════════════════════════

Tous ces outils sont disponibles dans le namespace d'exécution:

REQUÊTES WEB:
- get(url, use_selenium=False): HTML rapide (requests)
- browser_get(url): HTML rendu (Selenium pour JavaScript)
   - session: Session requests réutilisable

PARSING HTML:
- parse_html(html, selector): Extraire éléments avec CSS
- get_text_content(html, selector=None): Extraire texte brut
   - BeautifulSoup: Parser HTML complet

LIENS & URLS:
- get_all_links(html, base_url): Tous les liens normalisés
- discover_product_urls(html, base_url): URLs de produits
   - normalize_url(base, link): Normaliser liens relatifs
   - urljoin, urlparse: Manipulation d'URLs

EXPLORATION AVANCÉE:
- get_sitemap_urls(url): Récupérer TOUTES les URLs du sitemap (AMÉLIORÉ: cherche aussi dans robots.txt)
  - Cherche dans robots.txt pour directives Sitemap:
  - Supporte sitemaps multiples et sitemap index
  - Détection automatique de tous les sitemaps disponibles
- detect_pagination(html, url): Détecter pattern de pagination AUTOMATIQUEMENT
  - Cherche d'abord dans les liens HTML
  - Cherche ensuite dans l'URL actuelle
  - Si rien trouvé, TESTE automatiquement les patterns standards (page=, paged=, fwp_paged=, p=, offset=, start=)
  - Retourne: type, pattern, exemple, current_page, detected_by ('html', 'url', ou 'test')
- build_pagination_url(base_url, pagination_info, page_number): Construire URL de pagination (préserve les filtres existants)
- extract_url_filters(url): Extraire filtres depuis URL (ex: {{'v1': 'Motocyclette'}} depuis ?v1=Motocyclette)
- build_url_with_filters(base_url, filters, pagination=None, page_number=1): Construire URL avec filtres + pagination
- discover_product_urls(html, base_url): Découvrir URLs produits via heuristiques (mots-clés)
- get_all_links(html, base_url): Tous les liens normalisés du même domaine

DÉTECTION INTELLIGENTE:
- analyze_url_patterns(urls): Analyser patterns d'URL pour identifier produits, catégories (/product/*, /item/*, etc.)
- detect_important_sections(html, base_url): Détecter sections importantes (navigation, catégories, product listings, breadcrumbs)
- detect_ajax_data_layer(html): Détecter AJAX calls et data layer (dataLayer, window.__INITIAL_STATE__, etc.)
- detect_internal_apis(html, base_url): Détecter APIs internes (wp-json, /api/products, Shopify Storefront, etc.)

RÉCUPÉRATION INTELLIGENTE:
- smart_get(url, max_retries=3): GET intelligent avec fallback (requests → Selenium → API detection)
  - Retourne: html, method_used, api_detected, blocked, requires_javascript
- detect_blocking(html, status_code): Détecter si page bloquée (Cloudflare, bot detection, CAPTCHA)

EXTRACTION HYBRIDE:
- extract_with_hybrid_method(html, field_name, selectors): Extraction hybride (CSS/XPath → Gemini fallback)
  - Essaie d'abord sélecteurs CSS fournis
  - Si échec, essaie JSON-LD
  - Fallback Gemini si nécessaire

DONNÉES STRUCTURÉES:
- extract_json_ld(html): Extraire données JSON-LD (peut contenir listes de produits)
- extract_opengraph(html): Extraire métadonnées Open Graph (peut contenir URLs produits)
- extract_microdata(html): Extraire microdata (schema.org) depuis HTML
- extract_script_data(html): Extraire données depuis variables JavaScript (window.__INITIAL_STATE__, etc.)

FORMULAIRES & RECHERCHE:
- find_search_form(html): Trouver formulaires de recherche (action, method, inputs)
- find_filters(html): Trouver filtres (selects, checkboxes) avec leurs options

APIS & ENDPOINTS:
- detect_api_endpoints(html): Détecter endpoints API depuis JavaScript (fetch, axios, etc.)

GESTION AVANCÉE:
- retry_get(url, max_retries=3, backoff=1.0, use_selenium=False): Retry avec backoff exponentiel
- detect_rate_limit(response_text, status_code): Détecter rate limiting (429, etc.)
- wait_between_requests(seconds=1.0): Attendre entre requêtes pour éviter rate limiting
- validate_url(url): Valider qu'une URL est bien formée

DÉTECTION AVANCÉE:
- detect_infinite_scroll(html): Détecter infinite scroll / lazy loading
- detect_captcha(html): Détecter présence de CAPTCHA
- find_iframes(html): Trouver toutes les iframes et leurs sources

UTILITAIRES:
- clean_text(text): Nettoyer texte (espaces, caractères spéciaux)
- clean_html(html): Nettoyer HTML des caractères Unicode invalides (surrogates) - ⚠️ CRITIQUE pour éviter UnicodeEncodeError
- prepare_html_for_prompt(html): ⚠️ CRITIQUE - Prépare HTML pour insertion sécurisée dans prompts
  - Nettoie les surrogates Unicode
  - Échappe les accolades {{ }} pour éviter erreurs dans f-strings
  - Remplace les triple backticks ``` qui peuvent casser le formatage
  - TOUJOURS utiliser avant d'insérer HTML dans un prompt (surtout dans f-strings)
- extract_price(text): Extraire prix depuis texte
- extract_number(text): Extraire n'importe quel nombre depuis texte
- check_robots_txt(url): Vérifier robots.txt

STANDARDISATION & VALIDATION:
- standardize_field(field_name, value): Standardiser champ (prix → float, disponibilité → enum, images → liste)
- validate_product_data(product): Valider données produit et détecter anomalies
  - Détecte champs manquants
  - Détecte anomalies (prix suspect, image invalide)
  - Auto-corrige les valeurs
- structural_preview(urls, sample_size=10): Prélecture structurelle - analyser échantillon pages pour patterns globaux
  - Détecte sélecteurs communs
  - Recommande sélecteurs les plus fiables
  - Vérifie cohérence structure

EXTRACTION LOCALE:
- BeautifulSoup: Parser HTML pour extraction locale
- extract_price(text): Extraire prix depuis texte
- extract_year(text): Extraire année depuis texte
- Patterns génériques: Sélecteurs CSS communs pour produits (h1, .price, .description, etc.)

═══════════════════════════════════════════════════════════════
4. WORKFLOW À SUIVRE
═══════════════════════════════════════════════════════════════

⚠️ ORDRE CRITIQUE DES ÉTAPES:
1. D'abord: Utiliser les URLs pré-découvertes par l'AI Agent (ÉTAPE 1)
2. Ensuite: Récupérer le HTML de chaque URL (ÉTAPE 2)
3. Puis: Extraire les données de chaque produit LOCALEMENT (ÉTAPE 3) - SANS Gemini
4. Enfin: Valider et retourner les résultats (ÉTAPE 4)

ÉTAPE 1: UTILISER LES URLs PRÉ-DÉCOUVERTES
   ⚠️ CRITIQUE: Les URLs ont DÉJÀ été découvertes par l'AI Agent et sont dédupliquées.
   ⚠️ NE PAS redécouvrir les URLs - utiliser directement exploration_result['all_product_urls']
   
   Code OBLIGATOIRE (avec URLs HARDCODÉES):
   ```python
   # ÉTAPE 1: URLs hardcodées (déjà découvertes par l'AI Agent)
   print(f"\\n{{'='*60}}")
   print(f"📍 ÉTAPE 1: UTILISATION DES URLs PRÉ-DÉCOUVERTES")
   print(f"{{'='*60}}")
   
   # ⚠️ CRITIQUE: URLs HARDCODÉES directement dans le script
   # Utiliser exploration_result['all_product_urls'] pour remplir cette liste lors de la génération
   PRODUCT_URLS = [
       "https://site.com/product1",
       "https://site.com/product2",
       # ... TOUTES les URLs de exploration_result['all_product_urls'] doivent être ici
   ]
   
   if not PRODUCT_URLS:
       print("❌ Aucune URL de produit pré-découverte par l'AI Agent")
       return {{'companyInfo': {{}}, 'products': []}}
   
   print(f"✅ {{len(PRODUCT_URLS)}} URLs de produits pré-découvertes (hardcodées dans le script)")
   print(f"   Exemples: {{PRODUCT_URLS[:3]}}")
   ```
   
   ⚠️ IMPORTANT: 
   - Les URLs sont DÉJÀ dédupliquées (pas besoin de redédupliquer)
   - Les URLs sont DÉJÀ filtrées pour ne garder que les pages de produits
   - Passer directement à l'ÉTAPE 2 (récupération HTML)

ÉTAPE 2: RÉCUPÉRER LE HTML (MÉTHODE INTELLIGENTE)
      if sitemap_urls and len(sitemap_urls) > 10:
          for url in sitemap_urls:
              add_url_with_dedup(url)  # ⚠️ Déduplication immédiate
          print(f"✅ {{len(sitemap_urls)}} URLs depuis sitemap (COMPLET)")
          print(f"   Après déduplication: {{len(normalized_urls_dict)}} URLs uniques")
          
          # NOUVEAU: Analyser les patterns d'URL pour identifier structure
          url_patterns = analyze_url_patterns(list(sitemap_urls)[:100])  # Analyser échantillon
          print(f"📊 Patterns détectés: {{url_patterns.get('product_patterns', [])}}")
          
          # Si sitemap complet, tu peux skip la pagination, mais vérifie quand même
      else:
          print(f"⚠️ Sitemap vide ou incomplet ({{len(sitemap_urls) if sitemap_urls else 0}} URLs), utiliser pagination")
      
      # NOUVEAU: Prélecture structurelle pour détecter patterns globaux
      if len(all_product_urls) > 0:
          sample_urls = list(all_product_urls)[:10]
          structural_info = structural_preview(sample_urls, sample_size=10)
          print(f"🔍 Sélecteurs recommandés: {{structural_info.get('recommended_selectors', {{}})}}")

   2. Pagination EXHAUSTIVE (TOUJOURS essayer, même si sitemap existe - pour vérification)
      DÉCISION: Si pagination_info est None, essaie quand même de construire des URLs avec ?page=1, ?paged=1, etc.
      
      # ÉTAPE A: Extraire les filtres de l'URL (IMPORTANT pour préserver les filtres)
      url_filters = extract_url_filters(base_url)
      print(f"📋 Filtres détectés dans l'URL: {{url_filters}}")
      
      # ÉTAPE B: Détecter la pagination (détecte automatiquement les patterns standards si nécessaire)
      pagination_info = detect_pagination(html, base_url)
      
      if pagination_info:
          detected_by = pagination_info.get('detected_by', 'html_or_url')
          print(f"✅ Pagination détectée: {{pagination_info.get('pattern')}} (type: {{pagination_info.get('type')}}, méthode: {{detected_by}})")
          
          # Utiliser build_pagination_url pour construire les URLs correctement
          # (préserve automatiquement les filtres existants dans l'URL)
   page = 1
          consecutive_empty_pages = 0
          consecutive_no_new_products = 0
          previous_total = 0
          
          max_pages = 200  # Limite de sécurité stricte pour éviter boucles infinies
          while page <= max_pages:  # Limite sécurité réduite
              # ⚠️ LIMITE: Arrêter à 500 URLs pour passer à l'étape suivante
              if len(normalized_urls_dict) >= 500:
                  print(f"   ✅ Limite de 500 URLs atteinte, passage à l'étape suivante")
                  break
              
              page_url = build_pagination_url(base_url, pagination_info, page)
              print(f"   🔍 Test page {{page}}: {{page_url}}")
              
       html = get(page_url)
              if not html or len(html) < 1000:
                  print(f"   ⚠️ Page {{page}} vide ou erreur, arrêt")
           break
              
              products = discover_product_urls(html, base_url)
              
              # Vérifier si nouveaux produits trouvés (avec déduplication immédiate)
              current_total = len(normalized_urls_dict)
              for url in products:
                  add_url_with_dedup(url)  # ⚠️ Déduplication immédiate
              new_total = len(normalized_urls_dict)
              new_products_count = new_total - current_total
              
              # ⚠️ LIMITE: Vérifier à nouveau après ajout
              if len(normalized_urls_dict) >= 500:
                  print(f"   ✅ Limite de 500 URLs atteinte, passage à l'étape suivante")
                  break
              
              # Log détaillé pour déboguer
              print(f"   📊 Page {{page}}: {{len(products)}} produits trouvés, {{new_products_count}} nouveaux (Total: {{new_total}})")
              
              if not products:
                  consecutive_empty_pages += 1
                  # Vérifier si message "Aucun produit" ou similaire
                  if "aucun produit" in html.lower() or "no products" in html.lower() or consecutive_empty_pages >= 3:
                      print(f"   ⚠️ Plus de produits trouvés après {{consecutive_empty_pages}} pages vides")
                      break
              elif new_products_count == 0:
                  # Page avec produits mais tous déjà connus (déjà dans all_product_urls = DOUBLONS)
                  consecutive_no_new_products += 1
                  duplicates = len(products) - new_products_count
                  print(f"   ⚠️ Page {{page}}: {{len(products)}} produits trouvés mais {{duplicates}} doublons (Total: {{new_total}}, consecutive: {{consecutive_no_new_products}}/3)")
                  
                  # Arrêter si 3 pages consécutives sans nouveaux produits
                  if consecutive_no_new_products >= 3:
                      print(f"   ✅ Arrêt: {{consecutive_no_new_products}} pages consécutives sans nouveaux produits")
                      print(f"   ✅ Toutes les pages ont été filtrées. Total unique: {{new_total}} URLs")
                      break
              else:
                  # Nouveaux produits trouvés
                  consecutive_empty_pages = 0
                  consecutive_no_new_products = 0
                  print(f"   ✅ Page {{page}}: {{new_products_count}} nouveaux produits ({{len(products)}} trouvés, Total: {{new_total}})")
              
              previous_total = new_total
       page += 1
              wait_between_requests(0.5)  # Attendre entre pages pour éviter rate limiting
          
          if page > max_pages:
              print(f"   ⚠️ Limite de sécurité atteinte ({{max_pages}} pages)")
              print(f"   ⚠️ Si le site a plus de pages, augmentez max_pages ou vérifiez la logique de pagination")
          
          print(f"✅ Pagination terminée: {{len(normalized_urls_dict)}} URLs uniques trouvées sur {{page-1}} pages")
      else:
          print("❌ Aucune pagination détectée même après tests des patterns standards")
          print("   Le site n'utilise peut-être pas de pagination, ou utilise un système non standard")
          print("   Essayer d'explorer les catégories ou utiliser browser_get() pour JavaScript")

   3. Exploration de Catégories AMÉLIORÉE (si nécessaire)
      # NOUVEAU: Détection automatique des sections importantes
      sections = detect_important_sections(html, base_url)
      print(f"📂 Sections détectées:")
      print(f"   - Navigation: {{len(sections.get('navigation', []))}} liens")
      print(f"   - Catégories: {{len(sections.get('categories', []))}} catégories")
      print(f"   - Product listings: {{len(sections.get('product_listings', []))}} pages")
      
      # Utiliser les catégories détectées automatiquement
      categories = sections.get('categories', [])
      if not categories:
          # Fallback: chercher manuellement
          all_links = get_all_links(html, base_url)
          categories = [link for link in all_links if 'category' in link.lower() or 'categorie' in link.lower()]
      
      # Pour chaque catégorie, explorer et trouver produits (avec pagination si nécessaire)
      for category_url in categories:
          print(f"   📁 Exploration catégorie: {{category_url}}")
          cat_html = get(category_url)
          cat_products = discover_product_urls(cat_html, base_url)
          for url in cat_products:
              add_url_with_dedup(url)  # ⚠️ Déduplication immédiate

   4. Découverte Heuristique (toujours utiliser)
      product_urls = discover_product_urls(html, base_url)
      for url in product_urls:
          add_url_with_dedup(url)  # ⚠️ Déduplication immédiate

   5. Parsing avec Sélecteurs CSS (si structure connue)
      # Utiliser parse_html avec sélecteurs spécifiques
      product_links = parse_html(html, "a.product-link[href]")
      product_links = parse_html(html, ".product-card a[href]")
      # Normaliser et ajouter

   6. Données Structurées (JSON-LD, Open Graph)
      json_ld = extract_json_ld(html)
      # Extraire URLs de produits depuis JSON-LD
      og_data = extract_opengraph(html)
      # Extraire URLs depuis Open Graph

   7. Exploration Récursive (si autres méthodes échouent)
      # Explorer les liens prometteurs récursivement (avec limite de profondeur)

   8. Sites avec API AMÉLIORÉE (si détecté)
      # NOUVEAU: Détection automatique d'APIs internes (wp-json, Shopify, etc.)
      internal_apis = detect_internal_apis(html, base_url)
      if internal_apis:
          print(f"✅ APIs internes détectées: {{[api['name'] for api in internal_apis]}}")
          for api in internal_apis:
              print(f"   🔌 API: {{api['name']}} - {{api['endpoint']}}")
              # Essayer d'appeler l'API
              try:
                  response = session.get(api['endpoint'], timeout=10)
                  if response.status_code == 200:
                      api_data = response.json()
                      # Extraire produits depuis réponse API
                      # Structure dépend de l'API (adapter selon le type)
              except Exception as e:
                  print(f"   ⚠️ Erreur API {{api['name']}}: {{e}}")
      
      # Aussi chercher dans AJAX/data layer
      ajax_data = detect_ajax_data_layer(html)
      if ajax_data.get('ajax_endpoints'):
          print(f"✅ Endpoints AJAX détectés: {{len(ajax_data['ajax_endpoints'])}}")
          # Essayer endpoints AJAX trouvés

   9. Données dans JavaScript (SPA - Single Page Apps)
      script_data = extract_script_data(html)
      if script_data:
          # Extraire URLs produits depuis window.__INITIAL_STATE__ ou similaire
          # Beaucoup de sites modernes chargent les données ainsi

   10. Formulaires de Recherche (si nécessaire)
       search_form = find_search_form(html)
       if search_form:
           # Utiliser le formulaire pour rechercher des produits
           # Essayer différentes requêtes de recherche

   11. Filtres (pour explorer différentes combinaisons)
       filters = find_filters(html)
       if filters:
           # Explorer différentes combinaisons de filtres
           # Pour trouver tous les produits dans chaque catégorie/filtre

   ⚠️ IMPORTANT: 
   - COMBINER plusieurs stratégies en parallèle pour être sûr de ne rien manquer
   - ⚠️ LIMITE CRITIQUE: Arrêter la découverte à 500 URLs et passer à l'étape suivante (récupération HTML)
   - Vérifier `len(normalized_urls_dict) >= 500` dans TOUTES les boucles de découverte
   - Dès que 500 URLs sont atteintes, BREAK immédiatement et passe à l'ÉTAPE 1.5 (filtrage)
   - Toujours dédupliquer: all_product_urls = list(set(all_product_urls))
   - Logger le nombre total trouvé: print(f"✅ TOTAL: {{len(all_product_urls)}} URLs")
   - Si aucune stratégie ne fonctionne, utiliser browser_get() pour JavaScript
   - Utiliser retry_get() et wait_between_requests() pour éviter rate limiting
   - Si CAPTCHA détecté: utiliser browser_get() et attendre plus longtemps
   
   ⚠️ CRITIQUE - FILTRAGE DES URLs (NOUVEAU):
   Après avoir trouvé TOUTES les URLs, tu DOIS filtrer pour ne garder QUE les pages de produits.
   Élimine les URLs qui mènent à des catégories, pages d'accueil, pages de service, etc.
   
   Code OBLIGATOIRE après la découverte:
   ```python
   # ÉTAPE 1.5: FILTRAGE DES URLs - Ne garder que les pages de produits
   print(f"\\n{{'='*60}}")
   print(f"🔍 ÉTAPE 1.5: FILTRAGE DES URLs")
   print(f"{{'='*60}}")
   
   # Normaliser et dédupliquer les URLs (supprimer paramètres de tracking, etc.)
   def normalize_url_for_dedup(url):
       \"\"\"Normalise une URL pour la déduplication (supprime paramètres inutiles)\"\"\"
       from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
       parsed = urlparse(url)
       
       # Paramètres à conserver (pagination, filtres importants)
       keep_params = ['page', 'paged', 'fwp_paged', 'p', 'offset', 'start', 'id', 'product_id']
       
       # Paramètres à supprimer (tracking, analytics, etc.)
       remove_params = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source', 
                        'fbclid', 'gclid', '_ga', 'tracking', 'affiliate']
       
       query_params = parse_qs(parsed.query)
       filtered_params = {{}}
       
       for key, values in query_params.items():
           if key.lower() in keep_params:
               filtered_params[key] = values
           elif key.lower() not in remove_params:
               # Garder les autres paramètres (filtres, etc.)
               filtered_params[key] = values
       
       # Reconstruire l'URL sans les paramètres de tracking
       new_query = urlencode(filtered_params, doseq=True)
       normalized = urlunparse((
           parsed.scheme, parsed.netloc, parsed.path,
           parsed.params, new_query, ''  # Supprimer le fragment
       ))
       return normalized
   
   # Normaliser toutes les URLs pour déduplication
   normalized_urls = {{}}
   for url in all_product_urls:
       normalized = normalize_url_for_dedup(url)
       # Garder l'URL originale la plus courte (sans paramètres de tracking)
       if normalized not in normalized_urls or len(url) < len(normalized_urls[normalized]):
           normalized_urls[normalized] = url
   
   all_product_urls = list(normalized_urls.values())
   print(f"✅ Après normalisation: {{len(all_product_urls)}} URLs uniques")
   
   # Filtrer pour ne garder QUE les pages de produits
   # Vérifier chaque URL pour confirmer qu'elle mène à un produit
   filtered_product_urls = []
   sample_size = min(50, len(all_product_urls))  # Vérifier un échantillon pour identifier patterns
   
   print(f"🔍 Vérification d'un échantillon de {{sample_size}} URLs pour identifier les patterns...")
   sample_urls = list(all_product_urls)[:sample_size]
   product_patterns = []
   non_product_patterns = []
   
   for url in sample_urls:
       try:
           html = get(url)
           if not html or len(html) < 1000:
               continue
           
           # Vérifier si c'est une page de produit
           is_product = False
           
           # Indicateurs positifs (page de produit)
           product_indicators = [
               'prix' in html.lower() or 'price' in html.lower(),
               'ajouter au panier' in html.lower() or 'add to cart' in html.lower(),
               'disponible' in html.lower() or 'available' in html.lower(),
               'product-detail' in html.lower() or 'product_detail' in html.lower(),
               'inventory-item' in html.lower() or 'inventaire' in html.lower(),
               'fiche technique' in html.lower() or 'specifications' in html.lower(),
               'marque' in html.lower() and 'modèle' in html.lower(),
               'brand' in html.lower() and 'model' in html.lower(),
           ]
           
           # Indicateurs négatifs (PAS une page de produit)
           non_product_indicators = [
               'liste' in html.lower() and 'produit' not in html.lower(),
               'category' in html.lower() and 'product' not in html.lower(),
               'categorie' in html.lower() and 'produit' not in html.lower(),
               ("page d'accueil" in html.lower() or 'homepage' in html.lower()),
               'contact' in html.lower() and 'product' not in html.lower(),
               'about' in html.lower() and 'product' not in html.lower(),
           ]
           
           # Si au moins 1 indicateur positif ET pas d'indicateurs négatifs forts
           # (Assouplir les critères pour ne pas éliminer trop de pages)
           has_positive = sum(product_indicators) >= 1
           has_strong_negative = any([
               'liste' in html.lower() and 'produit' not in html.lower() and 'product' not in html.lower(),
               'category' in html.lower() and 'product' not in html.lower() and 'produit' not in html.lower(),
               ("page d'accueil" in html.lower() or 'homepage' in html.lower()),
           ])
           
           if has_positive and not has_strong_negative:
               is_product = True
               # Analyser le pattern de l'URL
               from urllib.parse import urlparse
               parsed = urlparse(url)
               path_parts = [p for p in parsed.path.split('/') if p]
               if path_parts:
                   product_patterns.append('/'.join(path_parts[-2:]))  # Derniers segments
           else:
               # Analyser le pattern pour exclusion
               from urllib.parse import urlparse
               parsed = urlparse(url)
               path_parts = [p for p in parsed.path.split('/') if p]
               if path_parts:
                   non_product_patterns.append('/'.join(path_parts[-2:]))
           
           if is_product:
               filtered_product_urls.append(url)
           
           wait_between_requests(0.2)  # Attendre entre vérifications
       except Exception as e:
           print(f"   ⚠️ Erreur lors de la vérification de {{url}}: {{e}}")
           continue
   
   # Identifier les patterns les plus fréquents
   from collections import Counter
   product_pattern_counter = Counter(product_patterns)
   non_product_pattern_counter = Counter(non_product_patterns)
   
   print(f"📊 Patterns de produits identifiés: {{dict(product_pattern_counter.most_common(5))}}")
   print(f"📊 Patterns NON-produits identifiés: {{dict(non_product_pattern_counter.most_common(5))}}")
   
   # Filtrer le reste des URLs basé sur les patterns identifiés
   if product_pattern_counter:
       # Utiliser les patterns pour filtrer rapidement
       common_product_patterns = [p for p, count in product_pattern_counter.most_common(3) if count >= 2]
       common_non_product_patterns = [p for p, count in non_product_pattern_counter.most_common(3) if count >= 2]
       
       print(f"🔍 Application des patterns sur les {{len(all_product_urls) - sample_size}} URLs restantes...")
       
       for url in all_product_urls[sample_size:]:
           from urllib.parse import urlparse
           parsed = urlparse(url)
           path_parts = [p for p in parsed.path.split('/') if p]
           if path_parts:
               url_pattern = '/'.join(path_parts[-2:])
               
               # Exclure si pattern non-produit identifié
               if any(non_p in url_pattern for non_p in common_non_product_patterns):
                   continue
               
               # Inclure si pattern produit identifié
               if any(p in url_pattern for p in common_product_patterns):
                   filtered_product_urls.append(url)
               else:
                   # Si pattern inconnu, utiliser discover_product_urls pour vérifier
                   # (mais seulement si on a peu d'URLs restantes pour éviter trop de requêtes)
                   if len(all_product_urls) - sample_size < 100:
                       try:
                           html = get(url)
                           if html and len(html) > 1000:
                               discovered = discover_product_urls(html, base_url)
                               if url in discovered or any(url in d for d in discovered):
                                   filtered_product_urls.append(url)
                           wait_between_requests(0.2)
                       except:
                           pass
   else:
       # Si pas de patterns clairs, vérifier toutes les URLs avec discover_product_urls
       print(f"⚠️ Pas de patterns clairs, vérification complète de toutes les URLs...")
       for url in all_product_urls[sample_size:]:
           try:
               html = get(url)
               if html and len(html) > 1000:
                   discovered = discover_product_urls(html, base_url)
                   if url in discovered or any(url in d for d in discovered):
                       filtered_product_urls.append(url)
               wait_between_requests(0.2)
           except:
               continue
   
   # Dédupliquer final
   all_product_urls = list(set(filtered_product_urls))
   print(f"\\n✅ FILTRAGE TERMINÉ: {{len(all_product_urls)}} URLs de produits confirmées (sur {{len(normalized_urls)}} URLs initiales)")
   
   # ⚠️ IMPORTANT: Si le filtrage a éliminé trop d'URLs, utiliser les URLs originales
   # (le filtrage peut être trop strict sur certains sites)
   if len(all_product_urls) < len(normalized_urls) * 0.1:  # Si moins de 10% des URLs passent
       print(f"⚠️ Filtrage trop strict ({{len(all_product_urls)}}/{{len(normalized_urls)}}), utilisation des URLs originales")
       all_product_urls = list(normalized_urls.values())
       print(f"✅ Utilisation de {{len(all_product_urls)}} URLs (filtrage assoupli)")
   
   if not all_product_urls:
       print("❌ Aucune URL de produit valide trouvée après filtrage!")
       return {{'companyInfo': {{}}, 'products': []}}
   ```
   
   ⚠️ CRITIQUE - NE PAS GÉNÉRER DE CHEMIN OPTIMISÉ:
   Les URLs sont DÉJÀ dans exploration_result['all_product_urls'].
   NE PAS générer ou sauvegarder de chemin optimisé.
   NE PAS appeler save_json('optimized_path', ...).
   Les URLs sont déjà découvertes, dédupliquées et filtrées par l'AI Agent.
   
ÉTAPE 2: RÉCUPÉRATION DU HTML
   ⚠️ CRITIQUE: Cette étape récupère le HTML de TOUTES les URLs pré-découvertes dans exploration_result.
   La méthode de récupération est standardisée et toujours la même.
   
   ⚠️ EXIGENCE D'EXPLICITE (0% AMBIVALENT):
   - Utiliser 'get' par défaut (les URLs sont déjà filtrées, pas besoin de smart_get)
   - Montrer exactement comment récupérer le HTML pour chaque URL
   
   Code OBLIGATOIRE:
```python
   print(f"\\n{'='*60}")
   print(f"📥 RÉCUPÉRATION DU HTML")
   print(f"{'='*60}")
   print(f"✅ {{len(all_product_urls)}} URLs à traiter")
   
   # Récupérer le HTML de chaque URL
   pages_html_dict = {{}}  # Dictionnaire URL -> HTML
   
   # ⚠️ EXPLICITE: Utiliser 'get' par défaut (les URLs sont déjà filtrées)
   html_retrieval_method = 'get'
   print(f"   Méthode de récupération: {{html_retrieval_method}} (par défaut)")
   print(f"   Raison: Les URLs sont déjà filtrées par l'AI Agent, utilisation de get() standard")
   
   for idx, url in enumerate(all_product_urls, 1):
       print(f"   📥 {{idx}}/{{len(all_product_urls)}}: {{url[:80]}}...")
       
       # ⚠️ EXPLICITE: Utiliser la méthode spécifiée avec explication
       if html_retrieval_method == 'browser_get':
           # Méthode browser_get: nécessaire si le site utilise JavaScript pour charger le contenu
           html = browser_get(url)
       elif html_retrieval_method == 'smart_get':
           # Méthode smart_get: essaie get() d'abord, puis browser_get() si nécessaire
           result = smart_get(url, max_retries=3)
           html = result.get('html', '')
       else:  # 'get' par défaut
           # Méthode get(): pour sites statiques sans JavaScript
           html = get(url)
       
       if html:
           # ⚠️ CRITIQUE: Préparer le HTML pour insertion sécurisée dans le prompt
           # prepare_html_for_prompt() nettoie les surrogates, échappe les accolades, remplace triple backticks
           html = ai_tools.prepare_html_for_prompt(html)
           pages_html_dict[url] = html
       
       wait_between_requests(0.3)  # Attendre entre requêtes
   
   print(f"✅ {{len(pages_html_dict)}} pages HTML récupérées et nettoyées")
   ```

ÉTAPE 3: EXTRACTION LOCALE (SANS GEMINI)
   ⚠️ CRITIQUE: Cette étape fait l'extraction LOCALEMENT avec BeautifulSoup - SANS utiliser Gemini.
   Utilise les sélecteurs CSS HARDCODÉS comme méthode principale, avec fallback sur patterns génériques.
   
   ⚠️ IMPORTANT: Le scraper généré DOIT utiliser les sélecteurs HARDCODÉS dans le dictionnaire SELECTORS.
   Les sélecteurs doivent être hardcodés directement dans le script, pas récupérés depuis field_mappings au runtime.
   Si les sélecteurs hardcodés échouent, utiliser des patterns génériques (comme dans extract.py).
   
   ⚠️ EXIGENCE D'EXPLICITE (0% AMBIVALENT):
   Chaque étape d'extraction doit être EXPLICITE et détaillée:
   - Indiquer clairement quelle méthode utiliser pour chaque champ (JSON-LD, fieldMappings, ou patterns génériques)
   - Montrer exactement quel sélecteur CSS utiliser pour chaque champ
   - Montrer exactement comment extraire la valeur (get_text_content, parse_html, BeautifulSoup.select_one, etc.)
   - Ne pas utiliser de fonctions génériques comme "extract_product_data" - montrer le code d'extraction complet
   - Pour chaque URL, montrer exactement où aller chercher les données dans le HTML
   
   Code OBLIGATOIRE (à exécuter après ÉTAPE 2) avec sélecteurs HARDCODÉS:
```python
   print(f"\\n{{'='*60}}")
   print(f"🔍 ÉTAPE 3: EXTRACTION AVEC SÉLECTEURS HARDCODÉS")
   print(f"{'='*60}")
   print(f"✅ {{len(pages_html_dict)}} pages HTML à extraire")
   
   all_products = []
   
   # ⚠️ CRITIQUE: Sélecteurs HARDCODÉS directement dans le script
   # Utiliser field_mappings['products'] pour remplir ce dictionnaire lors de la génération
   SELECTORS = {{
       'name': 'h1.product-title',
       'prix': '.price',
       'image': 'img.product-image::attr(src)',
       # ... TOUS les sélecteurs de field_mappings['products'] doivent être ici
   }}
   
   # Pour chaque page, extraire avec les sélecteurs CSS détectés
   # ⚠️ EXPLICITE: Montrer exactement comment extraire chaque champ pour chaque URL
   for url, html in pages_html_dict.items():
       print(f"   🔍 Extraction: {{url[:60]}}...")
       
       product = {{}}
       
       # 3.1: Essayer JSON-LD d'abord (le plus fiable)
       # ⚠️ EXPLICITE: Montrer exactement comment extraire depuis JSON-LD
       json_ld_data = extract_json_ld(html)
       product_extracted = False
       
       if json_ld_data and isinstance(json_ld_data, list):
           for item in json_ld_data:
               if item.get('@type') in ['Product', 'Vehicle', 'Motorcycle', 'Car']:
                   # Extraction EXPLICITE de chaque champ depuis JSON-LD
                   product['name'] = item.get('name', '')
                   product['description'] = item.get('description', '')
                   if 'offers' in item:
                       product['prix'] = item['offers'].get('price', '')
                   product['image'] = item.get('image', '')
                   product['marque'] = item.get('brand', {{}}).get('name', '') if isinstance(item.get('brand'), dict) else item.get('brand', '')
                   product['sourceUrl'] = url
                   
                   if product.get('name'):
                       all_products.append(product)
                       product_extracted = True
                       print(f"      ✅ Produit extrait via JSON-LD: {{product.get('name', 'Unknown')[:50]}}")
                       break
       
       # 3.2: Si JSON-LD échoue, utiliser fieldMappings pour extraction CSS directe
       # ⚠️ EXPLICITE: Montrer exactement quel sélecteur CSS utiliser pour chaque champ
       if not product_extracted:
           extraction_success = False
           
           # Extraire chaque champ avec les sélecteurs CSS HARDCODÉS
           # ⚠️ EXPLICITE: Pour chaque champ, montrer le sélecteur exact et la méthode d'extraction
           for field, selector in SELECTORS.items():
               if selector:
                   # Utiliser parse_html pour extraire avec le sélecteur CSS
                   elements = parse_html(html, selector)
                   if elements:
                       # Si le sélecteur contient ::attr(), extraire l'attribut
                       # Utiliser find() pour éviter les problèmes de syntaxe avec les parenthèses
                       attr_marker = '::attr'
                       if attr_marker in selector:
                           # Extraire le nom de l'attribut entre ::attr( et )
                           start_idx = selector.find(attr_marker) + len(attr_marker) + 1
                           end_idx = selector.find(')', start_idx)
                           if end_idx > start_idx:
                               attr_name = selector[start_idx:end_idx]
                               value = elements[0].get(attr_name, '') if hasattr(elements[0], 'get') else ''
                           else:
                               value = get_text_content(html, selector)
                       else:
                           value = get_text_content(html, selector)
                       
                       if value:
                           product[field] = value
                           extraction_success = True
           
           # Si extraction CSS réussie, ajouter le produit
           if extraction_success and product.get('name'):
               product['sourceUrl'] = url
               all_products.append(product)
               print(f"      ✅ Produit extrait via CSS (fieldMappings): {{product.get('name', 'Unknown')[:50]}}")
           else:
               # 3.3: Fallback: Utiliser patterns génériques (extraction locale sans Gemini)
               # ⚠️ EXPLICITE: Montrer exactement quels sélecteurs CSS génériques utiliser
               print(f"      ⚠️ Extraction CSS échouée, fallback patterns génériques...")
               
               # Extraction avec patterns génériques (comme dans extract.py)
               soup = BeautifulSoup(html, 'html.parser')
               
               # Chercher le nom - EXPLICITE: sélecteurs CSS exacts
               name_elem = soup.select_one('h1, h2, h3, .title, .name, [class*="title"], [class*="name"]')
               if name_elem:
                   product['name'] = name_elem.get_text(strip=True)
               
               # Chercher le prix - EXPLICITE: sélecteurs CSS exacts
               price_elem = soup.select_one('.price, .prix, [class*="price"], [class*="prix"]')
               if price_elem:
                   price_text = price_elem.get_text(strip=True)
                   price = extract_price(price_text)
                   if price:
                       product['prix'] = price
               
               # Chercher la description - EXPLICITE: sélecteurs CSS exacts
               desc_elem = soup.select_one('.description, .desc, [class*="description"], [class*="desc"]')
               if desc_elem:
                   product['description'] = desc_elem.get_text(strip=True)[:500]
               
               # Chercher l'image - EXPLICITE: sélecteur CSS exact
               img = soup.select_one('img')
               if img and img.get('src'):
                   product['image'] = urljoin(base_url, img['src'])
               
               # Extraire année depuis le nom/description - EXPLICITE: regex exact
               name_desc = (product.get('name', '') + ' ' + product.get('description', '')).lower()
               year_match = re.search(r'\\b(19|20)\\d{{2}}\\b', name_desc)
               if year_match:
                   try:
                       year = int(year_match.group(0))
                       if 1900 <= year <= 2100:
                           product['annee'] = year
                   except:
                       pass
               
               # Extraire marque et modèle depuis le nom - EXPLICITE: patterns regex exacts
               name = product.get('name', '')
               if name:
                   brand_patterns = [
                       r'^(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson)',
                       r'\\b(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson)\\b'
                   ]
                   for pattern in brand_patterns:
                       match = re.search(pattern, name, re.I)
                       if match:
                           product['marque'] = match.group(1)
                           model = name.replace(match.group(1), '').strip()
                           if model:
                               product['modele'] = model.split()[0] if model.split() else model[:50]
                           break
               
               # Ajouter le produit si au moins le nom est présent
               if product.get('name') and len(product.get('name', '')) >= 3:
                   product['sourceUrl'] = url
                   all_products.append(product)
                   print(f"      ✅ Produit extrait via patterns génériques: {{product.get('name', 'Unknown')[:50]}}")
               else:
                   print(f"      ❌ Aucun produit extrait (nom manquant ou trop court)")
       
       wait_between_requests(0.2)
   
   print(f"\\n✅ {{len(all_products)}} produits extraits au total (extraction locale sans Gemini)")
   ```

ÉTAPE 4: VALIDATION, STANDARDISATION ET RETOUR
   ⚠️ NOUVEAU: Validation automatique avec détection d'anomalies et auto-correction
   
   Code OBLIGATOIRE:
   ```python
   # Valider et standardiser tous les produits
   validated_products = []
   anomalies_found = []
   
   for product in all_products:
       # Standardiser tous les champs
       for field, value in product.items():
           product[field] = standardize_field(field, value)
       
       # Valider et détecter anomalies
       validation = validate_product_data(product)
       
       if validation['is_valid']:
           # Appliquer corrections automatiques
           product.update(validation.get('corrected', {{}}))
           validated_products.append(product)
           
           # Logger anomalies si présentes
           if validation.get('anomalies'):
               anomalies_found.extend(validation['anomalies'])
               print(f"⚠️ Anomalies détectées pour {{product.get('name', 'Unknown')}}: {{validation['anomalies']}}")
       else:
           print(f"❌ Produit rejeté (champs manquants: {{validation['missing_fields']}}): {{product.get('name', 'Unknown')}}")
   
   # Rapport final
   print(f"✅ {{len(validated_products)}} produits validés sur {{len(all_products)}}")
   if anomalies_found:
       print(f"⚠️ {{len(anomalies_found)}} anomalies détectées (vérifier manuellement)")
   
   # Retourner au format EXTRACTION_SCHEMA
   return {{
       'companyInfo': {{}},
       'products': validated_products
   }}
   ```

═══════════════════════════════════════════════════════════════
5. STRUCTURE DU CODE
═══════════════════════════════════════════════════════════════

SIGNATURE OBLIGATOIRE:
```python
def scrape(base_url):
    \"\"\"
    Scraper généré pour {url}
    IMPORTANT: gemini_client et session sont disponibles globalement.
    NE PAS les passer en paramètres.
    \"\"\"
    # Code ici
```

═══════════════════════════════════════════════════════════════
6. EXEMPLE COMPLET DE RÉFÉRENCE (CHECKLIST DE VÉRIFICATION)
═══════════════════════════════════════════════════════════════

⚠️ IMPORTANT: Utilise cet exemple comme REFERENCE et CHECKLIST pour vérifier que ton scraper est complet.

STRUCTURE ATTENDUE DU SCRAPER GÉNÉRÉ:

```python
def scrape(base_url):
    \"\"\"
    Scraper généré pour {url}
    IMPORTANT: gemini_client et session sont disponibles globalement.
    NE PAS les passer en paramètres.
    \"\"\"
    
    # ============================================================
    # ÉTAPE 0: INITIALISATION
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"🚀 DÉMARRAGE DU SCRAPER")
    print(f"{{'='*60}}")
    print(f"🌐 URL: {{base_url}}")
    
    # ============================================================
    # ÉTAPE 1: UTILISATION DES URLs PRÉ-DÉCOUVERTES PAR L'AI AGENT
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"📍 ÉTAPE 1: UTILISATION DES URLs PRÉ-DÉCOUVERTES")
    print(f"{{'='*60}}")
    
    # ⚠️ CRITIQUE: URLs HARDCODÉES directement dans le script
    # L'AI Agent a exploré le site et découvert toutes les URLs - elles sont maintenant hardcodées ici
    # NE PAS utiliser exploration_result au runtime - les URLs sont dans PRODUCT_URLS
    PRODUCT_URLS = [
        "https://site.com/product1",
        "https://site.com/product2",
        # ... TOUTES les URLs de exploration_result['all_product_urls'] doivent être hardcodées ici
    ]
    
    if not PRODUCT_URLS:
        print("❌ Aucune URL de produit pré-découverte par l'AI Agent")
        return {{'companyInfo': {{}}, 'products': []}}
    
    print(f"✅ {{len(PRODUCT_URLS)}} URLs de produits pré-découvertes (hardcodées dans le script)")
    print(f"   Exemples: {{PRODUCT_URLS[:3]}}")
    
    # ⚠️ CRITIQUE: Sélecteurs CSS HARDCODÉS directement dans le script
    # L'AI Agent a détecté les sélecteurs CSS - ils sont maintenant hardcodés ici
    # NE PAS utiliser field_mappings au runtime - les sélecteurs sont dans SELECTORS
    SELECTORS = {{
        'name': 'h1.product-title',
        'prix': '.price',
        'image': 'img.product-image::attr(src)',
        # ... TOUS les sélecteurs de field_mappings['products'] doivent être hardcodés ici
    }}
    
    # ============================================================
    # ÉTAPE 2: RÉCUPÉRATION DU HTML (SEULEMENT PAGES DE PRODUITS)
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"📥 ÉTAPE 2: RÉCUPÉRATION HTML")
    print(f"{{'='*60}}")
    
    pages_html_dict = {{}}
    # Utiliser 'get' par défaut (les URLs sont déjà filtrées, pas besoin de smart_get)
    html_retrieval_method = 'get'
    
    for idx, url in enumerate(all_product_urls, 1):
        print(f"   📥 {{idx}}/{{len(all_product_urls)}}: {{url[:80]}}...")
        
        if html_retrieval_method == 'browser_get':
            html = browser_get(url)
        elif html_retrieval_method == 'smart_get':
            result = smart_get(url, max_retries=3)
            html = result.get('html', '')
        else:
            html = get(url)
        
        if html:
            html = clean_html(html)  # ⚠️ CRITIQUE: Nettoyer Unicode invalide
            pages_html_dict[url] = html
        
        wait_between_requests(0.3)
    
    print(f"✅ {{len(pages_html_dict)}} pages HTML récupérées et nettoyées")
    
    # ============================================================
    # ÉTAPE 3: EXTRACTION LOCALE (SANS GEMINI)
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"🔍 ÉTAPE 3: EXTRACTION LOCALE")
    print(f"{{'='*60}}")
    
    all_products = []
    
    # Utiliser fieldMappings pour extraction CSS directe
    product_mappings = field_mappings.get('products', {{}}) if 'field_mappings' in locals() else {{}}
    
    # Pour chaque page, extraire avec les sélecteurs CSS détectés
    for url, html in pages_html_dict.items():
        print(f"   🔍 Extraction: {{url[:60]}}...")
        
        # Essayer JSON-LD d'abord (le plus fiable)
        json_ld_data = extract_json_ld(html)
        product_extracted = False
        
        if json_ld_data and isinstance(json_ld_data, list):
            for item in json_ld_data:
                if item.get('@type') in ['Product', 'Vehicle', 'Motorcycle', 'Car']:
                    product = {{}}
                    product['name'] = item.get('name', '')
                    product['description'] = item.get('description', '')
                    if 'offers' in item:
                        product['prix'] = item['offers'].get('price', '')
                    product['image'] = item.get('image', '')
                    product['marque'] = item.get('brand', {{}}).get('name', '') if isinstance(item.get('brand'), dict) else item.get('brand', '')
                    product['sourceUrl'] = url
                    
                    if product.get('name'):
                        all_products.append(product)
                        product_extracted = True
                        print(f"      ✅ Produit extrait via JSON-LD: {{product.get('name', 'Unknown')[:50]}}")
                        break
        
        # Si JSON-LD échoue, utiliser fieldMappings pour extraction CSS directe
        if not product_extracted:
            product = {{}}
            extraction_success = False
            
            # Extraire chaque champ avec les sélecteurs CSS détectés
            for field, selector in product_mappings.items():
                if selector:
                    elements = parse_html(html, selector)
                    if elements:
                        # Si le sélecteur contient ::attr(), extraire l'attribut
                        # Utiliser find() pour éviter les problèmes de syntaxe avec les parenthèses
                        attr_marker = '::attr'
                        if attr_marker in selector:
                            # Extraire le nom de l'attribut entre ::attr( et )
                            start_idx = selector.find(attr_marker) + len(attr_marker) + 1
                            end_idx = selector.find(')', start_idx)
                            if end_idx > start_idx:
                                attr_name = selector[start_idx:end_idx]
                                value = elements[0].get(attr_name, '') if hasattr(elements[0], 'get') else ''
                            else:
                                value = get_text_content(html, selector)
                        else:
                            value = get_text_content(html, selector)
                        
                        if value:
                            product[field] = value
                            extraction_success = True
            
            # Si extraction CSS réussie, ajouter le produit
            if extraction_success and product.get('name'):
                product['sourceUrl'] = url
                all_products.append(product)
                print(f"      ✅ Produit extrait via CSS (fieldMappings): {{product.get('name', 'Unknown')[:50]}}")
            else:
                # Fallback: Utiliser patterns génériques (extraction locale sans Gemini)
                soup = BeautifulSoup(html, 'html.parser')
                
                # Chercher le nom
                name_elem = soup.select_one('h1, h2, h3, .title, .name, [class*="title"], [class*="name"]')
                if name_elem:
                    product['name'] = name_elem.get_text(strip=True)
                
                # Chercher le prix
                price_elem = soup.select_one('.price, .prix, [class*="price"], [class*="prix"]')
                if price_elem:
                    price_text = price_elem.get_text(strip=True)
                    price = extract_price(price_text)
                    if price:
                        product['prix'] = price
                
                # Chercher la description
                desc_elem = soup.select_one('.description, .desc, [class*="description"], [class*="desc"]')
                if desc_elem:
                    product['description'] = desc_elem.get_text(strip=True)[:500]
                
                # Chercher l'image
                img = soup.select_one('img')
                if img and img.get('src'):
                    product['image'] = urljoin(base_url, img['src'])
                
                # Extraire année depuis le nom/description
                name_desc = (product.get('name', '') + ' ' + product.get('description', '')).lower()
                year_match = re.search(r'\\b(19|20)\\d{{2}}\\b', name_desc)
                if year_match:
                    try:
                        year = int(year_match.group(0))
                        if 1900 <= year <= 2100:
                            product['annee'] = year
                    except:
                        pass
                
                # Extraire marque et modèle depuis le nom
                name = product.get('name', '')
                if name:
                    brand_patterns = [
                        r'^(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson)',
                        r'\\b(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson)\\b'
                    ]
                    for pattern in brand_patterns:
                        match = re.search(pattern, name, re.I)
                        if match:
                            product['marque'] = match.group(1)
                            model = name.replace(match.group(1), '').strip()
                            if model:
                                product['modele'] = model.split()[0] if model.split() else model[:50]
                            break
                
                # Ajouter le produit si au moins le nom est présent
                if product.get('name') and len(product.get('name', '')) >= 3:
                    product['sourceUrl'] = url
                    all_products.append(product)
                    print(f"      ✅ Produit extrait via patterns génériques: {{product.get('name', 'Unknown')[:50]}}")
                else:
                    print(f"      ❌ Aucun produit extrait (nom manquant ou trop court)")
    
    print(f"✅ {{len(all_products)}} produits extraits au total (extraction locale sans Gemini)")
    
    # ============================================================
    # ÉTAPE 4: VALIDATION ET STANDARDISATION
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"✅ ÉTAPE 4: VALIDATION")
    print(f"{{'='*60}}")
    
    validated_products = []
    anomalies_found = []
    
    for product in all_products:
        # Standardiser tous les champs
        for field, value in product.items():
            product[field] = standardize_field(field, value)
        
        # Valider et détecter anomalies
        validation = validate_product_data(product)
        
        if validation['is_valid']:
            product.update(validation.get('corrected', {{}}))
            validated_products.append(product)
            
            if validation.get('anomalies'):
                anomalies_found.extend(validation['anomalies'])
        else:
            print(f"❌ Produit rejeté: {{product.get('name', 'Unknown')}}")
    
    print(f"✅ {{len(validated_products)}} produits validés sur {{len(all_products)}}")
    
    # ============================================================
    # ÉTAPE 5: RETOUR DES RÉSULTATS
    # ============================================================
    return {{
        'companyInfo': {{}},
        'products': validated_products
    }}
```

═══════════════════════════════════════════════════════════════
7. CHECKLIST DE VÉRIFICATION (À UTILISER APRÈS GÉNÉRATION)
═══════════════════════════════════════════════════════════════

⚠️ AVANT DE RETOURNER LE SCRAPER, VÉRIFIE QUE:

✅ STRUCTURE:
   [ ] La fonction s'appelle bien `scrape(base_url)`
   [ ] Pas de paramètres supplémentaires (gemini_client, session)
   [ ] Docstring présente avec URL du site

✅ ÉTAPE 1 - UTILISATION URLs PRÉ-DÉCOUVERTES:
   [ ] Utilise `exploration_result['all_product_urls']` directement
   [ ] NE PAS redécouvrir les URLs (déjà fait par l'AI Agent)
   [ ] Vérifie si aucune URL pré-découverte (retourne vide)
   [ ] Logs pour indiquer le nombre d'URLs pré-découvertes

✅ ÉTAPE 2 - RÉCUPÉRATION HTML:
   [ ] Récupère HTML SEULEMENT sur les URLs filtrées (pages de produits)
   [ ] Utilise `html_retrieval_method` du chemin optimisé (si disponible)
   [ ] Appelle `clean_html()` sur chaque HTML récupéré
   [ ] Utilise `wait_between_requests(0.3)` entre requêtes
   [ ] Gère les erreurs (si html vide, skip)
   [ ] Ne récupère PAS les URLs de catégories ou pages d'accueil

✅ ÉTAPE 3 - EXTRACTION LOCALE:
   [ ] Utilise fieldMappings pour extraction CSS directe
   [ ] Fallback sur patterns génériques si fieldMappings échouent
   [ ] Utilise BeautifulSoup pour parsing HTML
   [ ] Extrait nom, prix, description, image, année, marque, modèle
   [ ] N'utilise JAMAIS gemini_client.call() (extraction locale uniquement)

✅ ÉTAPE 4 - VALIDATION:
   [ ] Appelle `standardize_field()` pour chaque champ
   [ ] Appelle `validate_product_data()` pour chaque produit
   [ ] Applique les corrections automatiques
   [ ] Rejette les produits invalides avec log
   [ ] Compte les anomalies détectées

✅ ÉTAPE 5 - RETOUR:
   [ ] Retourne au format EXTRACTION_SCHEMA
   [ ] Structure: {{'companyInfo': {{}}, 'products': [...]}}
   [ ] Tous les produits sont validés

✅ GESTION ERREURS:
   [ ] Try/except pour les opérations critiques
   [ ] Vérifie si HTML vide avant traitement
   [ ] Vérifie si aucune URL trouvée (retourne vide)
   [ ] Logs avec emojis (✅ ⚠️ ❌) pour clarté

✅ ANTI-HALLUCINATIONS:
   [ ] N'invente JAMAIS de données qui ne sont pas dans le HTML
   [ ] Si un champ n'est pas trouvé, laisse-le vide ou None
   [ ] N'extrait que ce qui est réellement présent dans le HTML
   [ ] Utilise les outils (extract_price, etc.) au lieu d'inventer

✅ OPTIMISATIONS:
   [ ] Utilise directement exploration_result['all_product_urls'] (déjà optimisé par l'AI Agent)
   [ ] Traite par lots si contenu volumineux
   [ ] Nettoie le HTML avant extraction locale
   [ ] Évite les requêtes inutiles

═══════════════════════════════════════════════════════════════
8. EXEMPLE COMPLET (VERSION SIMPLIFIÉE POUR RÉFÉRENCE)
═══════════════════════════════════════════════════════════════

⚠️ CRITIQUE: Cet exemple montre la BONNE approche - utiliser exploration_result directement.

EXEMPLE COMPLET:
```python
def scrape(base_url):
    \"\"\"
    Scraper généré pour {url}
    IMPORTANT: gemini_client et session sont disponibles globalement.
    \"\"\"
    
    # ============================================================
    # ÉTAPE 1: UTILISATION DES URLs PRÉ-DÉCOUVERTES PAR L'AI AGENT
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"📍 ÉTAPE 1: UTILISATION DES URLs PRÉ-DÉCOUVERTES")
    print(f"{{'='*60}}")
    
    # ⚠️ CRITIQUE: Les URLs ont DÉJÀ été découvertes par l'AI Agent avant la génération de ce script
    # L'AI Agent a exploré le site, trouvé le sitemap, parcouru la pagination, et dédupliqué toutes les URLs
    # NE PAS redécouvrir les URLs - utiliser directement exploration_result['all_product_urls']
    
    # Récupérer les URLs déjà découvertes par l'AI Agent
    all_product_urls = exploration_result.get('all_product_urls', [])
    
    if not all_product_urls:
        print("❌ Aucune URL de produit pré-découverte par l'AI Agent")
        print("   Le scraper ne peut pas fonctionner sans URLs pré-découvertes")
        return {{'companyInfo': {{}}, 'products': []}}
    
    print(f"✅ {{len(all_product_urls)}} URLs de produits pré-découvertes (déjà dédupliquées)")
    print(f"   Exemples: {{all_product_urls[:3]}}")
    print(f"   ⚠️ IMPORTANT: Ces URLs sont DÉJÀ dédupliquées et filtrées par l'AI Agent")
    print(f"   ⚠️ NE PAS appeler get_sitemap_urls(), detect_pagination(), ou discover_product_urls()")
    print(f"   ⚠️ Passer directement à l'ÉTAPE 2 (récupération HTML)")
    
    # ============================================================
    # ÉTAPE 2: RÉCUPÉRATION DU HTML (SEULEMENT PAGES DE PRODUITS)
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"📥 ÉTAPE 2: RÉCUPÉRATION HTML")
    print(f"{{'='*60}}")
    
    pages_html_dict = {{}}
    html_retrieval_method = 'get'
    
    for idx, url in enumerate(all_product_urls, 1):
        print(f"   📥 {{idx}}/{{len(all_product_urls)}}: {{url[:80]}}...")
        
        if html_retrieval_method == 'browser_get':
            html = browser_get(url)
        elif html_retrieval_method == 'smart_get':
            result = smart_get(url, max_retries=3)
            html = result.get('html', '')
        else:
            html = get(url)
        
        if html:
            html = clean_html(html)  # ⚠️ CRITIQUE: Nettoyer Unicode invalide
            pages_html_dict[url] = html
        
        wait_between_requests(0.3)
    
    print(f"✅ {{len(pages_html_dict)}} pages HTML récupérées et nettoyées")
    
    # ============================================================
    # ÉTAPE 3: EXTRACTION LOCALE (SANS GEMINI)
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"🔍 ÉTAPE 3: EXTRACTION LOCALE")
    print(f"{{'='*60}}")
    
    all_products = []
    product_mappings = field_mappings.get('products', {{}}) if 'field_mappings' in locals() else {{}}
    
    for url, html in pages_html_dict.items():
        print(f"   🔍 Extraction: {{url[:60]}}...")
        
        # Essayer JSON-LD d'abord
        json_ld_data = extract_json_ld(html)
        product_extracted = False
        
        if json_ld_data and isinstance(json_ld_data, list):
            for item in json_ld_data:
                if item.get('@type') in ['Product', 'Vehicle', 'Motorcycle', 'Car']:
                    product = {{}}
                    product['name'] = item.get('name', '')
                    product['description'] = item.get('description', '')
                    if 'offers' in item:
                        product['prix'] = item['offers'].get('price', '')
                    product['image'] = item.get('image', '')
                    product['marque'] = item.get('brand', {{}}).get('name', '') if isinstance(item.get('brand'), dict) else item.get('brand', '')
                    product['sourceUrl'] = url
                    
                    if product.get('name'):
                        all_products.append(product)
                        product_extracted = True
                        break
        
        # Si JSON-LD échoue, utiliser fieldMappings
        if not product_extracted:
            product = {{}}
            extraction_success = False
            
            for field, selector in product_mappings.items():
                if selector:
                    elements = parse_html(html, selector)
                    if elements:
                        value = get_text_content(html, selector)
                        if value:
                            product[field] = value
                            extraction_success = True
            
            if extraction_success and product.get('name'):
                product['sourceUrl'] = url
                all_products.append(product)
            else:
                # Fallback: patterns génériques
                soup = BeautifulSoup(html, 'html.parser')
                name_elem = soup.select_one('h1, h2, h3, .title, .name')
                if name_elem:
                    product['name'] = name_elem.get_text(strip=True)
                price_elem = soup.select_one('.price, .prix, [class*="price"]')
                if price_elem:
                    price = extract_price(price_elem.get_text(strip=True))
                    if price:
                        product['prix'] = price
                if product.get('name'):
                    product['sourceUrl'] = url
                    all_products.append(product)
    
    # ============================================================
    # ÉTAPE 4: VALIDATION
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"✅ ÉTAPE 4: VALIDATION")
    print(f"{{'='*60}}")
    
    validated_products = []
    for product in all_products:
        for field, value in product.items():
            product[field] = standardize_field(field, value)
        validation = validate_product_data(product)
        if validation['is_valid']:
            product.update(validation.get('corrected', {{}}))
            validated_products.append(product)
    
    print(f"✅ {{len(validated_products)}} produits validés sur {{len(all_products)}}")
    
    return {{'companyInfo': {{}}, 'products': validated_products}}
```
            if not html or len(html) < 1000:
                break
            product_links = discover_product_urls(html, base_url)
            if not product_links:
                break
            for url in product_links:
                add_url_with_dedup(url)  # ⚠️ Déduplication immédiate
            print(f"   Page {{page}}: {{len(product_links)}} produits (Total unique: {{len(normalized_urls_dict)}})")
            page += 1
    
    # Les URLs sont déjà dédupliquées dans normalized_urls_dict
    all_product_urls = list(normalized_urls_dict.values())
    print(f"✅ TOTAL: {{len(all_product_urls)}} URLs trouvées")
    
    # Si découverte complète, générer et sauvegarder le chemin optimisé
    all_product_urls = list(normalized_urls_dict.values())
    if not optimized_path and all_product_urls:
        # Générer le chemin optimisé (SIMPLIFIÉ: seulement chemin vers produits + méthode HTML)
        if sitemap_urls and len(sitemap_urls) > 10:
            optimized_path = {{
                'sitemap_url': base_url,  # Chemin pour trouver les URLs
                'html_retrieval_method': 'get'  # Chemin pour récupérer les infos
            }}
        elif pagination_info:
            optimized_path = {{
                'pagination_info': pagination_info,  # Chemin pour trouver les URLs
                'html_retrieval_method': 'get'  # Chemin pour récupérer les infos
            }}
        else:
            optimized_path = {{
                'sitemap_url': base_url,
                'html_retrieval_method': 'get'
            }}
        save_json('optimized_path', optimized_path)
        print(f"✅ Chemin optimisé sauvegardé pour les prochains scrapes")

    if not all_product_urls:
        return {{'companyInfo': {{}}, 'products': []}}

    # ÉTAPE 2: Récupérer HTML (utiliser méthode du chemin optimisé si disponible)
    print(f"\\n📥 Récupération du HTML...")
    pages_html_dict = {{}}
    # Utiliser 'get' par défaut (les URLs sont déjà filtrées, pas besoin de smart_get)
    html_retrieval_method = 'get'
    
    for idx, url in enumerate(all_product_urls, 1):
        print(f"   📥 {{idx}}/{{len(all_product_urls)}}: {{url[:80]}}...")
        html = get(url) if html_retrieval_method == 'get' else browser_get(url) if html_retrieval_method == 'browser_get' else smart_get(url, max_retries=3).get('html', '')
        if html:
            html = clean_html(html)  # Nettoyer caractères invalides
            pages_html_dict[url] = html
        wait_between_requests(0.3)
    
    print(f"✅ {{len(pages_html_dict)}} pages HTML récupérées")

    # ÉTAPE 3: Extraction avec Gemini (méthode standardisée)
    print(f"\\n🤖 Extraction avec Gemini...")
    pages_html = ""
    separator = "─" * 60
    for url, html in pages_html_dict.items():
        # Préparer le HTML avant insertion (sécurise contre accolades, surrogates, etc.)
        html_prepared = ai_tools.prepare_html_for_prompt(html)
        pages_html += f"\\n{{separator}}\\nPAGE: {{url}}\\n{{separator}}\\n{{html_prepared}}\\n"
    
    prompt = f\"\"\"Extrais TOUS les véhicules motorisés depuis ces pages HTML.
    IMPORTANT: Extrais UNIQUEMENT les VÉHICULES INDIVIDUELS avec marque et modèle spécifiques.
    Ignore les catégories, les pages d'accueil, les pages de service.
    
    {{pages_html}}
    \"\"\"

    result = gemini_client.call(prompt, EXTRACTION_SCHEMA)
    products_count = len(result.get('products', []))
    print(f"✅ {{products_count}} produits extraits")

    # ÉTAPE 4: Retourner résultats
    return result
```

═══════════════════════════════════════════════════════════════
6. EXEMPLE DE RÉFÉRENCE ET CHECKLIST DE VÉRIFICATION
═══════════════════════════════════════════════════════════════

⚠️ CRITIQUE: Utilise cet exemple comme REFERENCE et CHECKLIST pour vérifier que ton scraper est complet et correct.

STRUCTURE ATTENDUE DU SCRAPER GÉNÉRÉ:

```python
def scrape(base_url):
    \"\"\"
    Scraper généré pour {url}
    IMPORTANT: gemini_client et session sont disponibles globalement.
    NE PAS les passer en paramètres.
    \"\"\"
    
    # ============================================================
    # ÉTAPE 0: INITIALISATION
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"🚀 DÉMARRAGE DU SCRAPER")
    print(f"{{'='*60}}")
    print(f"🌐 URL: {{base_url}}")
    
    # ============================================================
    # ÉTAPE 1: UTILISATION DES URLs PRÉ-DÉCOUVERTES PAR L'AI AGENT
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"📍 ÉTAPE 1: UTILISATION DES URLs PRÉ-DÉCOUVERTES")
    print(f"{{'='*60}}")
    
    # ⚠️ CRITIQUE: Les URLs ont DÉJÀ été découvertes par l'AI Agent avant la génération de ce script
    # L'AI Agent a exploré le site, trouvé le sitemap, parcouru la pagination, et dédupliqué toutes les URLs
    # NE PAS redécouvrir les URLs - utiliser directement exploration_result['all_product_urls']
    
    # Récupérer les URLs déjà découvertes par l'AI Agent
    all_product_urls = exploration_result.get('all_product_urls', [])
    
    if not all_product_urls:
        print("❌ Aucune URL de produit pré-découverte par l'AI Agent")
        print("   Le scraper ne peut pas fonctionner sans URLs pré-découvertes")
        return {{'companyInfo': {{}}, 'products': []}}
    
    print(f"✅ {{len(all_product_urls)}} URLs de produits pré-découvertes (déjà dédupliquées)")
    print(f"   Exemples: {{all_product_urls[:3]}}")
    print(f"   ⚠️ IMPORTANT: Ces URLs sont DÉJÀ dédupliquées et filtrées par l'AI Agent")
    print(f"   ⚠️ NE PAS appeler get_sitemap_urls(), detect_pagination(), ou discover_product_urls()")
    print(f"   ⚠️ Passer directement à l'ÉTAPE 2 (récupération HTML)")
    
    # ============================================================
    # ÉTAPE 2: RÉCUPÉRATION DU HTML (SEULEMENT PAGES DE PRODUITS)
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"📥 ÉTAPE 2: RÉCUPÉRATION HTML")
    print(f"{{'='*60}}")
    
    pages_html_dict = {{}}
    # Utiliser 'get' par défaut (les URLs sont déjà filtrées, pas besoin de smart_get)
    html_retrieval_method = 'get'
    
    for idx, url in enumerate(all_product_urls, 1):
        print(f"   📥 {{idx}}/{{len(all_product_urls)}}: {{url[:80]}}...")
        
        if html_retrieval_method == 'browser_get':
            html = browser_get(url)
        elif html_retrieval_method == 'smart_get':
            result = smart_get(url, max_retries=3)
            html = result.get('html', '')
        else:
            html = get(url)
        
        if html:
            html = clean_html(html)  # ⚠️ CRITIQUE: Nettoyer Unicode invalide
            pages_html_dict[url] = html
        
        wait_between_requests(0.3)
    
    print(f"✅ {{len(pages_html_dict)}} pages HTML récupérées et nettoyées")
    
    # ============================================================
    # ÉTAPE 3: EXTRACTION LOCALE (SANS GEMINI)
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"🔍 ÉTAPE 3: EXTRACTION LOCALE")
    print(f"{{'='*60}}")
    
    all_products = []
    
    # Utiliser fieldMappings pour extraction CSS directe
    product_mappings = field_mappings.get('products', {{}}) if 'field_mappings' in locals() else {{}}
    
    # Pour chaque page, extraire avec les sélecteurs CSS détectés
    for url, html in pages_html_dict.items():
        print(f"   🔍 Extraction: {{url[:60]}}...")
        
        # Essayer JSON-LD d'abord (le plus fiable)
        json_ld_data = extract_json_ld(html)
        product_extracted = False
        
        if json_ld_data and isinstance(json_ld_data, list):
            for item in json_ld_data:
                if item.get('@type') in ['Product', 'Vehicle', 'Motorcycle', 'Car']:
                    product = {{}}
                    product['name'] = item.get('name', '')
                    product['description'] = item.get('description', '')
                    if 'offers' in item:
                        product['prix'] = item['offers'].get('price', '')
                    product['image'] = item.get('image', '')
                    product['marque'] = item.get('brand', {{}}).get('name', '') if isinstance(item.get('brand'), dict) else item.get('brand', '')
                    product['sourceUrl'] = url
                    
                    if product.get('name'):
                        all_products.append(product)
                        product_extracted = True
                        print(f"      ✅ Produit extrait via JSON-LD: {{product.get('name', 'Unknown')[:50]}}")
                        break
        
        # Si JSON-LD échoue, utiliser fieldMappings pour extraction CSS directe
        if not product_extracted:
            product = {{}}
            extraction_success = False
            
            # Extraire chaque champ avec les sélecteurs CSS détectés
            for field, selector in product_mappings.items():
                if selector:
                    elements = parse_html(html, selector)
                    if elements:
                        # Si le sélecteur contient ::attr(), extraire l'attribut
                        # Utiliser find() pour éviter les problèmes de syntaxe avec les parenthèses
                        attr_marker = '::attr'
                        if attr_marker in selector:
                            # Extraire le nom de l'attribut entre ::attr( et )
                            start_idx = selector.find(attr_marker) + len(attr_marker) + 1
                            end_idx = selector.find(')', start_idx)
                            if end_idx > start_idx:
                                attr_name = selector[start_idx:end_idx]
                                value = elements[0].get(attr_name, '') if hasattr(elements[0], 'get') else ''
                            else:
                                value = get_text_content(html, selector)
                        else:
                            value = get_text_content(html, selector)
                        
                        if value:
                            product[field] = value
                            extraction_success = True
            
            # Si extraction CSS réussie, ajouter le produit
            if extraction_success and product.get('name'):
                product['sourceUrl'] = url
                all_products.append(product)
                print(f"      ✅ Produit extrait via CSS (fieldMappings): {{product.get('name', 'Unknown')[:50]}}")
            else:
                # Fallback: Utiliser patterns génériques (extraction locale sans Gemini)
                soup = BeautifulSoup(html, 'html.parser')
                
                # Chercher le nom
                name_elem = soup.select_one('h1, h2, h3, .title, .name, [class*="title"], [class*="name"]')
                if name_elem:
                    product['name'] = name_elem.get_text(strip=True)
                
                # Chercher le prix
                price_elem = soup.select_one('.price, .prix, [class*="price"], [class*="prix"]')
                if price_elem:
                    price_text = price_elem.get_text(strip=True)
                    price = extract_price(price_text)
                    if price:
                        product['prix'] = price
                
                # Chercher la description
                desc_elem = soup.select_one('.description, .desc, [class*="description"], [class*="desc"]')
                if desc_elem:
                    product['description'] = desc_elem.get_text(strip=True)[:500]
                
                # Chercher l'image
                img = soup.select_one('img')
                if img and img.get('src'):
                    product['image'] = urljoin(base_url, img['src'])
                
                # Extraire année depuis le nom/description
                name_desc = (product.get('name', '') + ' ' + product.get('description', '')).lower()
                year_match = re.search(r'\\b(19|20)\\d{{2}}\\b', name_desc)
                if year_match:
                    try:
                        year = int(year_match.group(0))
                        if 1900 <= year <= 2100:
                            product['annee'] = year
                    except:
                        pass
                
                # Extraire marque et modèle depuis le nom
                name = product.get('name', '')
                if name:
                    brand_patterns = [
                        r'^(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson)',
                        r'\\b(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson)\\b'
                    ]
                    for pattern in brand_patterns:
                        match = re.search(pattern, name, re.I)
                        if match:
                            product['marque'] = match.group(1)
                            model = name.replace(match.group(1), '').strip()
                            if model:
                                product['modele'] = model.split()[0] if model.split() else model[:50]
                            break
                
                # Ajouter le produit si au moins le nom est présent
                if product.get('name') and len(product.get('name', '')) >= 3:
                    product['sourceUrl'] = url
                    all_products.append(product)
                    print(f"      ✅ Produit extrait via patterns génériques: {{product.get('name', 'Unknown')[:50]}}")
                else:
                    print(f"      ❌ Aucun produit extrait (nom manquant ou trop court)")
    
    print(f"✅ {{len(all_products)}} produits extraits au total (extraction locale sans Gemini)")
    
    # ============================================================
    # ÉTAPE 4: VALIDATION ET STANDARDISATION
    # ============================================================
    print(f"\\n{{'='*60}}")
    print(f"✅ ÉTAPE 4: VALIDATION")
    print(f"{{'='*60}}")
    
    validated_products = []
    anomalies_found = []
    
    for product in all_products:
        # Standardiser tous les champs
        for field, value in product.items():
            product[field] = standardize_field(field, value)
        
        # Valider et détecter anomalies
        validation = validate_product_data(product)
        
        if validation['is_valid']:
            product.update(validation.get('corrected', {{}}))
            validated_products.append(product)
            
            if validation.get('anomalies'):
                anomalies_found.extend(validation['anomalies'])
        else:
            print(f"❌ Produit rejeté: {{product.get('name', 'Unknown')}}")
    
    print(f"✅ {{len(validated_products)}} produits validés sur {{len(all_products)}}")
    
    # ============================================================
    # ÉTAPE 5: RETOUR DES RÉSULTATS
    # ============================================================
    return {{
        'companyInfo': {{}},
        'products': validated_products
    }}
```

═══════════════════════════════════════════════════════════════
7. CHECKLIST DE VÉRIFICATION (À UTILISER APRÈS GÉNÉRATION)
═══════════════════════════════════════════════════════════════

⚠️ AVANT DE RETOURNER LE SCRAPER, VÉRIFIE QUE:

✅ STRUCTURE:
   [ ] La fonction s'appelle bien `scrape(base_url)`
   [ ] Pas de paramètres supplémentaires (gemini_client, session)
   [ ] Docstring présente avec URL du site

✅ ÉTAPE 1 - UTILISATION URLs PRÉ-DÉCOUVERTES:
   [ ] Utilise `exploration_result['all_product_urls']` directement
   [ ] NE PAS redécouvrir les URLs (déjà fait par l'AI Agent)
   [ ] Vérifie si aucune URL pré-découverte (retourne vide)
   [ ] Logs pour indiquer le nombre d'URLs pré-découvertes

✅ ÉTAPE 2 - RÉCUPÉRATION HTML:
   [ ] Utilise `html_retrieval_method = 'get'` par défaut (les URLs sont déjà filtrées)
   [ ] Appelle `clean_html()` sur chaque HTML récupéré
   [ ] Utilise `wait_between_requests(0.3)` entre requêtes
   [ ] Gère les erreurs (si html vide, skip)

✅ ÉTAPE 3 - EXTRACTION LOCALE:
   [ ] Utilise fieldMappings pour extraction CSS directe
   [ ] Fallback sur patterns génériques si fieldMappings échouent
   [ ] Utilise BeautifulSoup pour parsing HTML
   [ ] Extrait nom, prix, description, image, année, marque, modèle
   [ ] N'utilise JAMAIS gemini_client.call() (extraction locale uniquement)

✅ ÉTAPE 4 - VALIDATION:
   [ ] Appelle `standardize_field()` pour chaque champ
   [ ] Appelle `validate_product_data()` pour chaque produit
   [ ] Applique les corrections automatiques
   [ ] Rejette les produits invalides avec log
   [ ] Compte les anomalies détectées

✅ ÉTAPE 5 - RETOUR:
   [ ] Retourne au format EXTRACTION_SCHEMA
   [ ] Structure: {{'companyInfo': {{}}, 'products': [...]}}
   [ ] Tous les produits sont validés

✅ GESTION ERREURS:
   [ ] Try/except pour les opérations critiques
   [ ] Vérifie si HTML vide avant traitement
   [ ] Vérifie si aucune URL trouvée (retourne vide)
   [ ] Logs avec emojis (✅ ⚠️ ❌) pour clarté

✅ ANTI-HALLUCINATIONS:
   [ ] N'invente JAMAIS de données qui ne sont pas dans le HTML
   [ ] Si un champ n'est pas trouvé, laisse-le vide ou None
   [ ] N'extrait que ce qui est réellement présent dans le HTML
   [ ] Utilise les outils (extract_price, etc.) au lieu d'inventer

✅ OPTIMISATIONS:
   [ ] Utilise directement exploration_result['all_product_urls'] (déjà optimisé par l'AI Agent)
   [ ] Traite par lots si contenu volumineux
   [ ] Nettoie le HTML avant extraction locale
   [ ] Évite les requêtes inutiles

═══════════════════════════════════════════════════════════════

Génère un code COMPLET, FONCTIONNEL et PRÊT À EXÉCUTER.
Utilise cet exemple comme référence et vérifie chaque point de la checklist.
"""

        try:
            result = self.gemini_client.call(
                prompt=prompt,
                schema=SCRAPER_GENERATION_SCHEMA,
                show_prompt=True
            )
            return result
        except Exception as e:
            print(f"❌ Erreur lors de la génération du scraper: {e}")
            raise

    def get_scraper_for_site(self, url: str) -> Optional[Dict]:
        """Récupère un scraper depuis le cache"""
        return self._load_cached_scraper(url)

    def invalidate_cache(self, url: str) -> bool:
        """Invalide le cache pour un site donné"""
        cache_path = self._get_cache_path(url)
        if cache_path.exists():
            try:
                cache_path.unlink()
                print(f"🗑️ Cache invalidé pour: {url}")
                return True
            except Exception as e:
                print(f"⚠️ Erreur lors de l'invalidation du cache: {e}")
        return False
