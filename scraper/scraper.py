"""
Classe principale SupplierScraper refactorisée
"""
import os
import re
import json
import time
from typing import Dict, List, Optional, Set, Tuple, Any
from urllib.parse import urljoin, urlparse
from threading import Lock
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from bs4 import BeautifulSoup
from google.genai import types

from .config import (
    EXTRACTION_SCHEMA, PAGE_SELECTION_SCHEMA, IMAGE_FILTER_SCHEMA, MAX_PAGES_TO_VISIT,
    MIN_PRODUCTS_TARGET, MIN_COMPANY_INFO_FIELDS, MAX_IMAGES,
    MAX_IMAGE_SIZE_MB, MAX_TOTAL_SIZE_MB, SUPPORTED_IMAGE_MIMES
)
from .selenium_utils import (
    SELENIUM_AVAILABLE, fetch_page_with_selenium, extract_navigation_links_selenium
)
from .extractors import (
    extract_contact_info_from_links, extract_visible_text, extract_images,
    download_image, extract_navigation_links
)
from .gemini_client import GeminiClient


class SupplierScraper:
    """Scraper principal pour extraire les données des fournisseurs"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.parsed_base = urlparse(base_url)
        self.visited_urls: Set[str] = set()
        self.visited_urls_list: List[str] = []
        self.all_data: Dict = {
            "companyInfo": {},
            "products": []
        }
        self.page_outputs: List[Dict] = []
        self.gemini_client = GeminiClient()
        self.session = requests.Session()
        
        # Créer le dossier assets pour les images
        from pathlib import Path
        project_root = Path(__file__).parent.parent.parent
        self.assets_dir = project_root / 'assets' / 'scraped-images'
        os.makedirs(self.assets_dir, exist_ok=True)
        print(f"📁 Dossier assets: {self.assets_dir}")
        
        # Dictionnaires pour stocker les images
        self.page_product_images: Dict[str, List[Dict]] = {}
        self.page_logo_images: Dict[str, List[Dict]] = {}
        
        # Verrou pour la thread-safety
        self.lock = Lock()
    
    def is_same_domain(self, url: str) -> bool:
        """Vérifie si l'URL appartient au même domaine"""
        try:
            parsed = urlparse(url)
            return parsed.netloc == self.parsed_base.netloc or parsed.netloc == ''
        except:
            return False
    
    def normalize_image_url(self, url: str) -> str:
        """Normalise une URL d'image (www vs non-www, etc.)"""
        if not url or str(url).lower() in ["null", "none", ""]:
            return ""
        try:
            parsed = urlparse(url)
            base_netloc = self.parsed_base.netloc
            if base_netloc.startswith('www.'):
                if not parsed.netloc.startswith('www.'):
                    parsed = parsed._replace(netloc='www.' + parsed.netloc)
            else:
                if parsed.netloc.startswith('www.'):
                    parsed = parsed._replace(netloc=parsed.netloc[4:])
            return parsed.geturl()
        except:
            return url
    
    def normalize_url(self, url: str) -> str:
        """Normalise une URL (supprime les fragments, etc.)"""
        if url.startswith('#'):
            return None
        if url.startswith('javascript:'):
            return None
        if url.startswith('mailto:'):
            return None
        
        absolute_url = urljoin(self.base_url, url)
        parsed = urlparse(absolute_url)
        
        normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        if parsed.query:
            normalized += f"?{parsed.query}"
        
        return normalized
    
    def fetch_page(self, url: str, use_selenium: bool = False) -> Tuple[Optional[BeautifulSoup], Optional[Any]]:
        """Récupère et parse une page HTML"""
        driver = None
        try:
            print(f"📄 Fetching: {url}")
            
            if use_selenium and SELENIUM_AVAILABLE:
                print(f"   🤖 Utilisation de Selenium...")
                result = fetch_page_with_selenium(
                    url, return_driver=True,
                    normalize_url_func=self.normalize_url,
                    is_same_domain_func=self.is_same_domain
                )
                if result:
                    soup, driver = result
                    return soup, driver
                return None, None
            
            # Essayer d'abord avec requests
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = self.session.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Vérifier s'il y a des popups
            popup_indicators = soup.find_all(['div', 'section'], 
                class_=re.compile(r'popup|modal|language|welcome|overlay', re.I))
            text = soup.get_text().lower()
            has_language_popup = any(term in text for term in ['choisissez la langue', 'choose your language'])
            
            if (popup_indicators or has_language_popup) and SELENIUM_AVAILABLE:
                print(f"   🔍 Popup détecté, utilisation de Selenium...")
                result = fetch_page_with_selenium(
                    url, return_driver=True,
                    normalize_url_func=self.normalize_url,
                    is_same_domain_func=self.is_same_domain
                )
                if result:
                    soup, driver = result
                    return soup, driver
            
            return soup, None
        except Exception as e:
            print(f"❌ Error fetching {url}: {e}")
            if SELENIUM_AVAILABLE:
                print(f"   🔄 Tentative avec Selenium...")
                result = fetch_page_with_selenium(
                    url, return_driver=True,
                    normalize_url_func=self.normalize_url,
                    is_same_domain_func=self.is_same_domain
                )
                if result:
                    soup, driver = result
                    return soup, driver
            return None, None
    
    def select_pages_and_extract_contact_info(self, all_links: List[str], contact_info_from_links: Dict[str, str]) -> Dict:
        """Premier appel Gemini: sélectionner les 5 pages + extraire infos de contact"""
        print(f"\n{'='*60}")
        print(f"🤖 APPEL GEMINI #1: SÉLECTION DES PAGES + EXTRACTION CONTACT")
        print(f"{'='*60}")
        
        empty_schema = {"companyInfo": {}, "products": []}
        
        contact_info_text = ""
        if contact_info_from_links.get("email"):
            contact_info_text += f"📧 Email trouvé dans mailto: {contact_info_from_links['email']}\n"
        if contact_info_from_links.get("phone"):
            contact_info_text += f"📞 Téléphone trouvé dans tel: {contact_info_from_links['phone']}\n"
        if contact_info_from_links.get("address"):
            contact_info_text += f"📍 Adresse trouvée dans Google Maps: {contact_info_from_links['address'][:100]}...\n"
        
        prompt = f"""Tu es un expert en navigation web pour un système de campagnes de financement scolaire.

TÂCHE: Sélectionner les 5 pages les plus pertinentes (incluant la page d'accueil) pour extraire les données d'un fournisseur alimentaire selon le schéma suivant:

SCHÉMA CIBLE (vide - ce qu'on doit remplir):
{json.dumps(empty_schema, ensure_ascii=False, indent=2)}

INFORMATIONS DE CONTACT DÉJÀ EXTRAITES DEPUIS LES LIENS:
{contact_info_text if contact_info_text else "Aucune information de contact trouvée dans les liens"}

LIENS DISPONIBLES (incluant la page d'accueil):
{chr(10).join([f"{i+1}. {link}" for i, link in enumerate(all_links[:50])])}

INSTRUCTIONS CRITIQUES:
1. **SÉLECTION DES 5 PAGES**:
   - Tu dois sélectionner EXACTEMENT 5 pages maximum
   - PRIORITÉ #1: Page de catalogue/produits avec LISTE DE PRODUITS INDIVIDUELS
   - PRIORITÉ #2: Pages de catégories qui LISTENT des produits individuels
   - PRIORITÉ #3: Page contact/nous joindre
   - PRIORITÉ #4: Page à propos
   - ⚠️ IMPORTANT: Privilégie les pages qui contiennent des LISTES de produits individuels

2. **EXTRACTION DES INFOS DE CONTACT**:
   - Si tu vois des liens mailto:, tel:, ou Google Maps, extrais-les
   - Complète les infos déjà extraites

Retourne un JSON avec cette structure:
{{
  "selectedPages": ["url1", "url2", "url3", "url4", "url5"],
  "contactInfo": {{
    "email": "email@example.com" ou "",
    "phone": "819 295-3325" ou "",
    "address": "Adresse complète" ou ""
  }},
  "reasoning": "Explication"
}}"""
        
        schema = PAGE_SELECTION_SCHEMA
        
        try:
            # Utiliser gemini-flash-latest pour la sélection (rapide)
            result = self.gemini_client.call(prompt, schema, show_prompt=False, use_flash=True)
            
            selected_pages = result.get("selectedPages", [])
            contact_info = result.get("contactInfo", {})
            reasoning = result.get("reasoning", "")
            
            # Fusionner les infos de contact
            final_contact_info = contact_info_from_links.copy()
            for key, value in contact_info.items():
                if value and not final_contact_info.get(key):
                    final_contact_info[key] = value
            
            print(f"✅ {len(selected_pages)} pages sélectionnées:")
            for i, page in enumerate(selected_pages, 1):
                print(f"   {i}. {page}")
            print(f"\n💭 Raisonnement: {reasoning[:300]}...")
            print(f"\n📧 Infos de contact extraites:")
            print(f"   Email: {final_contact_info.get('email', 'N/A')}")
            print(f"   Téléphone: {final_contact_info.get('phone', 'N/A')}")
            print(f"   Adresse: {final_contact_info.get('address', 'N/A')[:80]}...")
            print(f"{'='*60}\n")
            
            return {
                "selectedPages": selected_pages,
                "contactInfo": final_contact_info
            }
        except Exception as e:
            print(f"❌ Erreur lors de la sélection des pages: {e}")
            # Fallback
            fallback_pages = [self.base_url]
            product_keywords = ["produit", "catalogue", "menu", "gamme"]
            contact_keywords = ["contact", "nous-joindre", "about", "a-propos"]
            
            for link in all_links[:20]:
                link_lower = link.lower()
                if len(fallback_pages) < 5:
                    if any(kw in link_lower for kw in product_keywords) or any(kw in link_lower for kw in contact_keywords):
                        if link not in fallback_pages:
                            fallback_pages.append(link)
            
            print(f"🔄 Fallback: {len(fallback_pages)} pages sélectionnées")
            return {
                "selectedPages": fallback_pages[:5],
                "contactInfo": contact_info_from_links
            }
    
    def filter_images_with_gemini(self, pages_data: List[Dict]) -> Dict[str, List[str]]:
        """Deuxième appel Gemini: Filtrer les images pour ne garder que logo + produits
        NOTE: On ne passe QUE les métadonnées (URL, alt text, contexte), pas les images elles-mêmes
        pour éviter d'uploader trop d'images. On uploadera seulement les images filtrées dans le mega call."""
        print(f"\n{'='*60}")
        print(f"🔍 APPEL GEMINI #2: FILTRAGE DES IMAGES (MÉTADONNÉES SEULEMENT)")
        print(f"{'='*60}")
        
        # Collecter toutes les images avec leur contexte (sans uploader les images)
        all_images_info = []
        for page_data in pages_data:
            url = page_data["url"]
            images = page_data["images"]
            
            for img in images:
                if img.get("url"):
                    all_images_info.append({
                        "url": img["url"],
                        "alt": img.get("alt", ""),
                        "context_before": img.get("context_before", ""),
                        "context_after": img.get("context_after", ""),
                        "page_url": url,
                        "is_logo": img.get("is_logo", False)
                    })
        
        if not all_images_info:
            print("   ⚠️ Aucune image à filtrer")
            return {"logoImage": None, "productImages": []}
        
        print(f"📊 {len(all_images_info)} images à analyser pour filtrage (métadonnées seulement)")
        
        # Construire le prompt avec toutes les métadonnées d'images (pas les images elles-mêmes)
        images_context = ""
        for i, img_info in enumerate(all_images_info, 1):
            images_context += f"\n--- Image {i} ---\n"
            images_context += f"URL: {img_info['url']}\n"
            if img_info.get('alt'):
                images_context += f"Alt text: {img_info['alt']}\n"
            if img_info.get('context_before'):
                images_context += f"Contexte avant: {img_info['context_before']}\n"
            if img_info.get('context_after'):
                images_context += f"Contexte après: {img_info['context_after']}\n"
            images_context += f"Page: {img_info['page_url']}\n"
            if img_info.get('is_logo'):
                images_context += f"⚠️ Potentiel logo détecté\n"
        
        prompt = f"""Tu es un expert en analyse d'images pour un système de campagnes de financement scolaire.

TÂCHE: Filtrer les images pour ne garder que:
1. **LE LOGO PRINCIPAL** (un seul, le meilleur) - pour l'entreprise
2. **LES IMAGES DE PRODUITS INDIVIDUELS** (pas de catégories, pas de doublons) - pour le catalogue

IMAGES TROUVÉES ({len(all_images_info)} images) - MÉTADONNÉES SEULEMENT:
{images_context}

INSTRUCTIONS CRITIQUES:
1. **LOGO**:
   - Sélectionne UN SEUL logo principal (le meilleur, le plus clair)
   - Utilise l'URL, l'alt text et le contexte pour identifier le logo
   - Ignore les logos dupliqués, les logos de footer, les logos flous
   - Le logo doit être de bonne qualité et représentatif de l'entreprise

2. **IMAGES DE PRODUITS**:
   - ⚠️ CRITIQUE: Garde SEULEMENT les images de PRODUITS INDIVIDUELS avec NOMS SPÉCIFIQUES
   - Exemples de PRODUITS INDIVIDUELS (✅ GARDER): "Le Cendrillon" (fromage), "Tarte aux pommes artisanale", "Chocolat noir 70%"
   - Exemples de CATÉGORIES (❌ IGNORER): "Sélection de fromages", "Assortiment d'épicerie", "Gamme de produits"
   - Utilise l'alt text et le contexte (texte avant/après) pour identifier le nom du produit
   - Ignore les images décoratives, les bannières, les icônes, les images de catégories
   - Ignore les doublons (même produit, même image)
   - Les images doivent être de qualité suffisante pour un magasin en ligne
   - PRIORITÉ: Produits adaptés aux campagnes de financement scolaire

3. **FILTRAGE**:
   - Utilise l'alt text et le contexte autour de l'image pour identifier le type
   - Si l'image n'a pas de nom de produit spécifique dans son contexte, ignore-la
   - Garde seulement les images qui peuvent être utilisées directement dans le catalogue

Retourne un JSON avec:
- logoImage: {{url, reason}} ou null si aucun logo valide
- productImages: [{{url, productName, reason}}] - liste des images de produits individuels
- reasoning: Explication du filtrage"""
        
        try:
            # Appel Gemini avec seulement le texte (pas d'images uploadées)
            result = self.gemini_client.call(prompt, IMAGE_FILTER_SCHEMA, show_prompt=False)
            
            logo_url = result.get("logoImage", {}).get("url") if result.get("logoImage") else None
            product_images = result.get("productImages", [])
            reasoning = result.get("reasoning", "")
            
            print(f"✅ Filtrage terminé:")
            if logo_url:
                print(f"   🏢 Logo: {logo_url[:80]}...")
            else:
                print(f"   🏢 Logo: Aucun logo valide trouvé")
            print(f"   📦 Images produits: {len(product_images)}")
            print(f"   💭 Raisonnement: {reasoning[:200]}...")
            print(f"{'='*60}\n")
            
            return {
                "logoImage": logo_url,
                "productImages": [img["url"] for img in product_images],
                "productImageDetails": product_images  # Garder les détails pour référence
            }
        except Exception as e:
            print(f"❌ Erreur lors du filtrage d'images: {e}")
            # Fallback: garder toutes les images
            return {"logoImage": None, "productImages": [img["url"] for img in all_images_info[:50]]}
    
    def extract_all_data_mega_call(self, pages_data: List[Dict], contact_info: Dict[str, str]) -> Dict:
        """Deuxième appel Gemini: mega prompt avec HTML complet des pages
        On passe le HTML complet pour que Gemini puisse voir la structure DOM et associer automatiquement les images aux produits."""
        print(f"\n{'='*60}")
        print(f"🤖 APPEL GEMINI #2: EXTRACTION MEGA CALL (HTML COMPLET)")
        print(f"{'='*60}")
        print(f"📊 {len(pages_data)} pages à analyser avec HTML complet")
        
        # Préparer le contexte avec HTML complet
        pages_html = ""
        total_size = 0
        
        for i, page_data in enumerate(pages_data, 1):
            url = page_data["url"]
            html_content = page_data.get("html", "")
            
            if not html_content:
                print(f"   ⚠️ Pas de HTML pour {url}, utilisation du texte")
                html_content = f"<html><body>{page_data.get('text', '')}</body></html>"
            
            html_size = len(html_content)
            total_size += html_size
            
            pages_html += f"\n{'─'*60}\n"
            pages_html += f"PAGE {i}: {url}\n"
            pages_html += f"{'─'*60}\n"
            pages_html += f"HTML COMPLET ({html_size} caractères, {html_size/1024:.1f} KB):\n"
            pages_html += html_content
            pages_html += f"\n\n"
        
        total_size_mb = total_size / 1024 / 1024
        print(f"📊 Taille totale HTML: {total_size} caractères ({total_size_mb:.2f} MB)")
        
        # Vérifier si ça rentre dans le contexte (1M tokens ≈ 4M caractères)
        # On est largement en dessous même avec 5 pages HTML complètes
        if total_size > 3_000_000:  # ~750K tokens, laisser de la marge
            print(f"⚠️ HTML très volumineux ({total_size_mb:.2f} MB), tronquage possible")
            # Tronquer chaque page proportionnellement
            max_size_per_page = 3_000_000 // len(pages_data)
            pages_html = ""
            for i, page_data in enumerate(pages_data, 1):
                url = page_data["url"]
                html_content = page_data.get("html", "")
                if len(html_content) > max_size_per_page:
                    html_content = html_content[:max_size_per_page] + "\n[... HTML tronqué ...]"
                pages_html += f"\n{'─'*60}\nPAGE {i}: {url}\n{'─'*60}\n{html_content}\n\n"
        
        # Préparer les infos de contact
        contact_info_text = ""
        if contact_info.get("email"):
            contact_info_text += f"📧 Email: {contact_info['email']}\n"
        if contact_info.get("phone"):
            contact_info_text += f"📞 Téléphone: {contact_info['phone']}\n"
        if contact_info.get("address"):
            contact_info_text += f"📍 Adresse: {contact_info['address']}\n"
        
        prompt = f"""Tu es un expert en extraction de données pour un système de campagnes de financement scolaire.

TÂCHE: Extraire TOUTES les données d'un fournisseur alimentaire depuis {len(pages_data)} pages web analysées.

INFORMATIONS DE CONTACT DÉJÀ EXTRAITES DEPUIS LES LIENS:
{contact_info_text if contact_info_text else "Aucune information de contact trouvée dans les liens"}

HTML COMPLET DES {len(pages_data)} PAGES (après chargement JavaScript):
{pages_html}

IMPORTANT: Le HTML contient la structure DOM complète après chargement JavaScript. Utilise cette structure pour:
- Identifier les produits individuels et leurs images associées (même div, même container)
- Comprendre la hiérarchie et les relations entre éléments
- Extraire les images directement depuis les balises <img> dans le HTML (attributs src, data-src, data-lazy-src)
- Associer chaque image à son produit correspondant basé sur la structure DOM (proximité dans le HTML)
- Les images sont déjà dans le HTML, pas besoin de les télécharger séparément

INSTRUCTIONS CRITIQUES:
1. **EXTRACTION DES PRODUITS (PRIORITÉ ABSOLUE)**:
   - ⚠️ CRITIQUE: Extrais des PRODUITS INDIVIDUELS avec NOMS SPÉCIFIQUES, pas des catégories!
   - Exemples de PRODUITS INDIVIDUELS (✅ BON): "Le Cendrillon" (fromage), "Tarte aux pommes artisanale"
   - Exemples de CATÉGORIES (❌ À ÉVITER): "Sélection de fromages", "Assortiment d'épicerie"
   - PRIORITÉ: Produits adaptés aux campagnes de financement scolaire
   - Chaque produit doit avoir: name, description, pricePickup, image
   - **IMAGES**: Utilise la structure DOM pour trouver l'image associée à chaque produit
     * Les images sont généralement dans le même container/div que le nom du produit
     * Cherche les balises <img> proches du nom/description du produit
     * Utilise les attributs src, data-src, ou data-lazy-src des images
     * Si plusieurs images sont dans le même container produit, prends la première/principale
   - Si un prix n'est pas trouvé, mets 0

2. **INFORMATIONS ENTREPRISE**:
   - Utilise les infos de contact déjà extraites
   - Complète avec les infos trouvées dans les pages
   - Champs requis: name, email, phone, address, logo, description, website

3. **IMAGES**:
   - Les images sont dans le HTML - utilise les balises <img> pour les extraire
   - Identifie les images de produits vs logos (logos souvent dans header/footer)
   - Associe chaque image à son produit en utilisant la structure DOM (même container/div)
   - Pour chaque produit, trouve l'image la plus proche dans le HTML

4. **COMPLÉTUDE DES CHAMPS (TRÈS IMPORTANT)**:
   - ⚠️ CRITIQUE: Remplis TOUS les champs du schéma pour chaque produit, même si les données exactes ne sont pas disponibles
   - Si une donnée exacte n'est pas disponible, fais une ESTIMATION RAISONNABLE basée sur:
     * Le type de produit (ex: fromage = réfrigéré, chocolat = non réfrigéré)
     * Les images du produit
     * Le contexte du site
     * Les standards de l'industrie
   - Pour les prix manquants, utilise 0
   - Pour les autres champs, fais ton meilleur effort pour les remplir avec des valeurs réalistes

5. **QUALITÉ**:
   - Assure-toi que le schéma final est le PLUS COMPLET possible
   - Ne perds AUCUNE information importante
   - Élimine les doublons de produits (même nom = même produit)

Retourne un JSON conforme au schéma EXTRACTION_SCHEMA avec TOUTES les données extraites."""
        
        try:
            # Construire le contenu avec seulement le prompt (HTML inclus dans le prompt)
            # Pas besoin d'uploader les images - elles sont dans le HTML
            contents = [prompt]
            
            print(f"📊 Envoi à Gemini:")
            print(f"   - {len(pages_data)} pages HTML complètes")
            print(f"   - {total_size} caractères HTML ({total_size_mb:.2f} MB)")
            print(f"   - Images incluses dans le HTML (structure DOM)")
            
            # Utiliser gemini-2.5-pro pour l'extraction (précis)
            final_schema = self.gemini_client.call(
                contents, EXTRACTION_SCHEMA, show_prompt=False, use_flash=False
            )
            
            print(f"✅ Extraction terminée!")
            print(f"📦 Produits extraits: {len(final_schema.get('products', []))}")
            print(f"🏢 Champs entreprise: {len([k for k, v in final_schema.get('companyInfo', {}).items() if v])}")
            print(f"{'='*60}\n")
            
            return final_schema
        except Exception as e:
            print(f"❌ Erreur lors de l'extraction mega call: {e}")
            return {"companyInfo": {}, "products": []}
    
    def scrape(self) -> Dict:
        """Fonction principale de scraping - OPTIMISÉE: 2 appels Gemini seulement"""
        print(f"🚀 Démarrage du scraping pour: {self.base_url}")
        print(f"⚙️ Configuration: MAX_PAGES={MAX_PAGES_TO_VISIT}")
        print(f"📋 Flow optimisé: 2 appels Gemini (sélection pages + extraction mega call avec HTML complet)")
        
        # ÉTAPE 1: Récupérer la page d'accueil et extraire tous les liens + infos de contact
        print(f"\n{'='*60}")
        print(f"📍 ÉTAPE 1: RÉCUPÉRATION PAGE D'ACCUEIL + EXTRACTION LIENS")
        print(f"{'='*60}")
        
        soup, driver = self.fetch_page(self.base_url)
        if not soup:
            print(f"❌ Impossible de récupérer la page d'accueil")
            return self.all_data
        
        # Extraire les informations de contact
        contact_info_from_links = extract_contact_info_from_links(soup)
        print(f"📧 Infos de contact extraites depuis les liens:")
        if contact_info_from_links.get("email"):
            print(f"   Email: {contact_info_from_links['email']}")
        if contact_info_from_links.get("phone"):
            print(f"   Téléphone: {contact_info_from_links['phone']}")
        if contact_info_from_links.get("address"):
            print(f"   Adresse: {contact_info_from_links['address'][:80]}...")
        
        # Extraire tous les liens de navigation
        if driver:
            all_links = extract_navigation_links_selenium(
                driver, self.base_url, self.normalize_url, self.is_same_domain
            )
            driver.quit()
        else:
            all_links = extract_navigation_links(
                soup, self.base_url, self.normalize_url, self.is_same_domain
            )
        
        # Ajouter la page d'accueil si elle n'est pas dans la liste
        if self.base_url not in all_links:
            all_links.insert(0, self.base_url)
        
        print(f"🔗 {len(all_links)} liens trouvés (incluant la page d'accueil)")
        
        # ÉTAPE 2: Premier appel Gemini - Sélectionner les 5 pages + extraire infos de contact
        selection_result = self.select_pages_and_extract_contact_info(all_links, contact_info_from_links)
        selected_pages = selection_result["selectedPages"]
        final_contact_info = selection_result["contactInfo"]
        
        # Limiter à 5 pages maximum
        selected_pages = selected_pages[:5]
        
        print(f"\n{'='*60}")
        print(f"📍 ÉTAPE 2: TÉLÉCHARGEMENT PARALLÈLE DES {len(selected_pages)} PAGES SÉLECTIONNÉES")
        print(f"{'='*60}")
        
        # Fonction pour télécharger une page
        def fetch_single_page(url: str) -> Optional[Dict]:
            """Télécharge une page et retourne ses données"""
            try:
                print(f"📥 Téléchargement: {url}")
                page_soup, page_driver = self.fetch_page(url, use_selenium=True)
                if not page_soup:
                    print(f"   ⚠️ Impossible de récupérer {url}")
                    return None
                
                # Récupérer le HTML complet après chargement JavaScript
                if page_driver:
                    # Attendre que la page soit complètement chargée
                    time.sleep(2)
                    # Scroll pour charger le contenu dynamique
                    page_driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                    time.sleep(2)
                    page_driver.execute_script("window.scrollTo(0, 0);")
                    time.sleep(1)
                    # Récupérer le HTML complet
                    html_content = page_driver.page_source
                    page_driver.quit()
                else:
                    # Fallback: utiliser BeautifulSoup pour obtenir le HTML
                    html_content = str(page_soup)
                
                # Extraire aussi le texte pour référence (mais on utilisera le HTML)
                text = extract_visible_text(page_soup)
                
                html_size_kb = len(html_content) / 1024
                print(f"   ✅ {url}: {len(html_content)} caractères HTML ({html_size_kb:.1f} KB), {len(text)} caractères texte")
                
                return {
                    "url": url,
                    "html": html_content,
                    "text": text  # Garder pour référence/debug
                }
            except Exception as e:
                print(f"   ❌ Erreur sur {url}: {e}")
                return None
        
        # Télécharger toutes les pages en parallèle
        pages_data = []
        with ThreadPoolExecutor(max_workers=5) as executor:
            # Lancer tous les téléchargements en parallèle
            future_to_url = {executor.submit(fetch_single_page, url): url for url in selected_pages}
            
            # Collecter les résultats au fur et à mesure qu'ils arrivent
            for future in as_completed(future_to_url):
                url = future_to_url[future]
                try:
                    page_data = future.result()
                    if page_data:
                        pages_data.append(page_data)
                except Exception as e:
                    print(f"   ❌ Exception lors du téléchargement de {url}: {e}")
        
        print(f"✅ {len(pages_data)}/{len(selected_pages)} pages téléchargées avec succès")
        
        if not pages_data:
            print(f"❌ Aucune page téléchargée avec succès")
            return self.all_data
        
        # ÉTAPE 3: Deuxième appel Gemini - Extraction mega call avec HTML complet
        # On passe le HTML complet pour que Gemini puisse voir la structure DOM et associer les images aux produits
        final_schema = self.extract_all_data_mega_call(pages_data, final_contact_info)
        
        # Mettre à jour all_data avec le schéma final
        self.all_data = final_schema
        
        # Afficher les résultats finaux
        company_info = self.all_data.get('companyInfo', {})
        company_fields_filled = len([k for k, v in company_info.items() if v and str(v).lower() not in ["null", "none", ""]])
        products_count = len(self.all_data.get('products', []))
        
        print(f"\n{'='*60}")
        print(f"✅ SCRAPING TERMINÉ!")
        print(f"🏢 Informations entreprise: {company_fields_filled} champs remplis (objectif: {MIN_COMPANY_INFO_FIELDS})")
        print(f"📦 Produits trouvés: {products_count} (objectif: {MIN_PRODUCTS_TARGET})")
        
        # Afficher si les objectifs sont atteints
        if products_count >= MIN_PRODUCTS_TARGET and company_fields_filled >= MIN_COMPANY_INFO_FIELDS:
            print(f"✅ Objectifs atteints - scraping optimisé!")
        elif products_count >= MIN_PRODUCTS_TARGET:
            print(f"⚠️ Produits OK mais infos entreprise incomplètes")
        elif company_fields_filled >= MIN_COMPANY_INFO_FIELDS:
            print(f"⚠️ Infos entreprise OK mais produits insuffisants")
        else:
            print(f"⚠️ Objectifs non atteints")
        
        print(f"{'='*60}\n")
        
        return self.all_data

