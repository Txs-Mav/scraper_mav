"""
Module pour exécuter les scrapers générés par Gemini
"""
import json
import re
from typing import Dict, List, Optional, Any
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup
import time

import os

try:
    from .html_analyzer import HTMLAnalyzer
    from .config import EXTRACTION_SCHEMA
    from .gemini_client import GeminiClient
except ImportError:
    from html_analyzer import HTMLAnalyzer
    from config import EXTRACTION_SCHEMA
    from gemini_client import GeminiClient


class ScraperExecutor:
    """Exécute les scrapers générés par Gemini"""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.html_analyzer = HTMLAnalyzer()

    def fetch_html(self, url: str) -> str:
        """Récupère le contenu HTML d'une URL"""
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.text
        except Exception as e:
            print(f"❌ Erreur lors de la récupération de {url}: {e}")
            raise

    def execute_scraper(self, url: str, scraper_data: Dict,
                        reference_url: Optional[str] = None) -> Dict:
        """Exécute un scraper généré pour extraire les données

        Args:
            url: URL de base du site à scraper
            scraper_data: Données du scraper généré (depuis HTMLAnalyzer)
            reference_url: URL du site de référence pour comparaison de prix

        Returns:
            Dict au format EXTRACTION_SCHEMA avec companyInfo et products
        """
        print(f"\n{'='*60}")
        print(f"🚀 EXÉCUTION DU SCRAPER GÉNÉRÉ")
        print(f"{'='*60}")
        print(f"🌐 URL: {url}\n")

        try:
            # Charger le code du scraper
            scraper_code = scraper_data.get('scraperCode', '')
            site_analysis = scraper_data.get('siteAnalysis', {})
            field_mappings = scraper_data.get('fieldMappings', {})
            # Récupérer exploration_result pour passer les URLs pré-découvertes
            exploration_result = scraper_data.get(
                'metadata', {}).get('exploration_data', {})
            # Si pas dans metadata, chercher directement
            if not exploration_result:
                exploration_result = scraper_data.get('exploration_data', {})

            if not scraper_code:
                raise ValueError("Le scraper généré ne contient pas de code")

            print(f"📋 Site analysé: {site_analysis.get('siteName', 'N/A')}")
            print(
                f"📄 Type de structure: {site_analysis.get('structureType', 'N/A')}")

            pagination = site_analysis.get('paginationStrategy', {})
            if pagination:
                print(f"📑 Pagination: {pagination.get('type', 'none')}")
                if pagination.get('pattern'):
                    print(f"   Pattern: {pagination.get('pattern')}")

            # Créer un namespace pour exécuter le code du scraper
            # NOUVEAU FLUX : Scripts autonomes sans dépendance Gemini
            # Le script généré est complètement indépendant et n'utilise pas Gemini

            # Imports de base (sans Gemini)
            from concurrent.futures import ThreadPoolExecutor, as_completed

            # Créer le namespace avec les outils de base uniquement
            namespace = {
                'requests': requests,
                'BeautifulSoup': BeautifulSoup,
                'urljoin': urljoin,
                'urlparse': urlparse,
                're': re,
                'json': json,
                'time': time,
                'os': os,
                'url': url,
                'base_url': url,  # Alias pour compatibilité
                'session': self.session,
                'EXTRACTION_SCHEMA': EXTRACTION_SCHEMA,
                # Pour compatibilité avec anciens scrapers
                'field_mappings': field_mappings,
                'site_analysis': site_analysis,
                'exploration_result': exploration_result,
                # Pour compatibilité
                'Path': Path,
                'ThreadPoolExecutor': ThreadPoolExecutor,
                'as_completed': as_completed,
                'print': print  # S'assurer que print fonctionne
            }

            # NOUVEAU FLUX : Les scripts générés sont autonomes et n'ont pas besoin d'outils AI
            # Les URLs et sélecteurs sont hardcodés dans le script
            print(f"   ✅ Namespace configuré pour script autonome (sans Gemini)")

            print(f"\n🔧 Vérification du namespace d'exécution...")
            # Vérifier que les imports de base sont présents
            required_namespace_items = [
                'BeautifulSoup', 'requests', 'urljoin', 'urlparse', 're', 'json', 'time'
            ]
            missing_items = [
                item for item in required_namespace_items if item not in namespace]
            if missing_items:
                print(
                    f"   ⚠️  ATTENTION: Éléments manquants dans le namespace: {missing_items}")
            else:
                print(
                    f"   ✅ Tous les imports de base sont présents dans le namespace")

            print(f"\n🔧 Exécution du code du scraper...")
            print(f"   Longueur du code: {len(scraper_code)} caractères")

            # Vérifier que le code contient bien une fonction scrape
            if 'def scrape' not in scraper_code and 'def main' not in scraper_code:
                print(
                    f"   ⚠️  ATTENTION: Le code généré ne contient pas de fonction 'scrape' ou 'main'")

            # VALIDATION: Vérifier que le scraper est autonome (sans Gemini)
            print(f"\n🔍 Validation du scraper autonome...")
            workflow_checks = {
                'URLs hardcodées (PRODUCT_URLS)': 'PRODUCT_URLS' in scraper_code,
                'Sélecteurs hardcodés (SELECTORS)': 'SELECTORS' in scraper_code,
                'Extraction locale (BeautifulSoup)': any(keyword in scraper_code.lower() for keyword in [
                    'beautifulsoup', 'soup.select', 'soup.find'
                ]),
                'Pas de dépendance Gemini': 'gemini_client' not in scraper_code.lower() and 'GeminiClient' not in scraper_code,
                'Fonction scrape()': 'def scrape' in scraper_code
            }

            all_checks_passed = all(workflow_checks.values())
            for step, passed in workflow_checks.items():
                status = "✅" if passed else "⚠️"
                print(f"   {status} {step}: {'OK' if passed else 'MANQUANT'}")

            if not all_checks_passed:
                print(
                    f"\n   ⚠️  ATTENTION: Le scraper généré ne semble pas être complètement autonome.")
                print(
                    f"   Certaines fonctionnalités peuvent être manquantes.")
            else:
                print(
                    f"\n   ✅ Le scraper est autonome et prêt à être exécuté (sans Gemini)")

            # Nettoyer et valider le code Python avant exécution
            print(f"   🔍 Validation du code Python généré...")

            # Nettoyer le code (enlever markdown si présent)
            cleaned_code = scraper_code
            if '```python' in cleaned_code:
                # Extraire le code entre ```python et ```
                match = re.search(r'```python\s*\n(.*?)\n```',
                                  cleaned_code, re.DOTALL)
                if match:
                    cleaned_code = match.group(1)
                    print(f"   ⚠️  Markdown détecté et retiré du code")
                else:
                    # Essayer avec ``` seul
                    match = re.search(r'```\s*\n(.*?)\n```',
                                      cleaned_code, re.DOTALL)
                    if match:
                        cleaned_code = match.group(1)
                        print(f"   ⚠️  Markdown détecté et retiré du code")

            # Valider la syntaxe Python
            try:
                compile(cleaned_code, '<string>', 'exec')
                print(f"   ✅ Syntaxe Python valide")
            except SyntaxError as e:
                print(f"   ❌ ERREUR DE SYNTAXE dans le code généré:")
                print(f"      Ligne {e.lineno}: {e.text}")
                print(f"      Message: {e.msg}")
                raise ValueError(f"Code généré invalide (syntaxe Python): {e}")

            # Utiliser le code nettoyé
            scraper_code = cleaned_code

            # Exécuter le code du scraper
            try:
                print(f"   🔄 Exécution du code du scraper...")
                exec(scraper_code, namespace)
                print(f"   ✅ Code exécuté sans erreur de syntaxe")
            except SyntaxError as e:
                print(f"   ❌ ERREUR DE SYNTAXE dans le code généré:")
                print(f"      Ligne {e.lineno}: {e.text}")
                raise
            except Exception as e:
                print(f"   ❌ ERREUR lors de l'exécution du code:")
                print(f"      {type(e).__name__}: {e}")
                import traceback
                traceback.print_exc()
                raise

            # Appeler la fonction principale du scraper
            # Essayer différentes signatures de fonction
            if 'scrape' in namespace:
                print(f"   Appel de la fonction 'scrape'...")
                scrape_func = namespace['scrape']
                import inspect
                sig = inspect.signature(scrape_func)
                params = list(sig.parameters.keys())

                # Adapter l'appel selon les paramètres de la fonction
                if len(params) == 1:
                    result = scrape_func(url)
                elif len(params) == 2:
                    if 'session' in params:
                        result = scrape_func(url, self.session)
                    elif 'gemini_client' in params:
                        result = scrape_func(url, gemini_client)
                    else:
                        result = scrape_func(url, namespace.get(params[1]))
                elif len(params) == 3:
                    result = scrape_func(url, gemini_client, self.session)
                else:
                    # Essayer avec tous les paramètres du namespace
                    kwargs = {p: namespace.get(p)
                              for p in params if p in namespace}
                    result = scrape_func(url, **kwargs)

            elif 'main' in namespace:
                print(f"   Appel de la fonction 'main'...")
                main_func = namespace['main']
                import inspect
                sig = inspect.signature(main_func)
                params = list(sig.parameters.keys())

                if len(params) == 1:
                    result = main_func(url)
                elif len(params) == 2:
                    if 'session' in params:
                        result = main_func(url, self.session)
                    elif 'gemini_client' in params:
                        result = main_func(url, gemini_client)
                    else:
                        result = main_func(url, namespace.get(params[1]))
                elif len(params) == 3:
                    result = main_func(url, gemini_client, self.session)
                else:
                    kwargs = {p: namespace.get(p)
                              for p in params if p in namespace}
                    result = main_func(url, **kwargs)
            else:
                print(
                    f"   ❌ ERREUR: Aucune fonction 'scrape' ou 'main' trouvée dans le code généré")
                print(
                    f"   Fonctions disponibles: {[k for k in namespace.keys() if callable(namespace[k]) and not k.startswith('_')]}")
                raise ValueError(
                    "Le scraper généré doit contenir une fonction 'scrape' ou 'main'")

            # Valider le format du résultat
            if not isinstance(result, dict):
                raise ValueError("Le scraper doit retourner un dictionnaire")

            if 'companyInfo' not in result:
                result['companyInfo'] = {}
            if 'products' not in result:
                result['products'] = []

            print(f"\n📊 Résultat du scraper:")
            print(f"   - Produits trouvés: {len(result.get('products', []))}")
            print(f"   - CompanyInfo: {bool(result.get('companyInfo', {}))}")

            # NOUVEAU FLUX : Pas de vérification Gemini (script autonome)
            print(f"\n✅ Script autonome exécuté (sans dépendance Gemini)")

            # Ajouter sourceSite à chaque produit
            for product in result.get('products', []):
                if 'sourceSite' not in product:
                    product['sourceSite'] = url
                if 'sourceUrl' not in product:
                    product['sourceUrl'] = url

            products_count = len(result.get('products', []))

            if products_count == 0:
                print(f"\n❌ PROBLÈME: Aucun produit extrait!")
                print(f"   Le scraper n'a pas réussi à extraire de produits.")
                print(f"\n   🔍 Diagnostic:")
                print(f"   ⚠️  Le scraper autonome n'a pas trouvé de produits")
                print(f"\n   Raisons possibles:")
                print(f"   - Les URLs hardcodées sont incorrectes ou obsolètes")
                print(f"   - Les sélecteurs CSS hardcodés ne correspondent plus au HTML")
                print(f"   - Le site a changé sa structure")
                print(f"   - Le site nécessite JavaScript (Selenium requis)")
                print(f"\n   💡 Solutions:")
                print(f"   1. Utilisez --force-refresh pour régénérer le scraper")
                print(
                    f"   2. Vérifiez les logs ci-dessus pour voir où le scraper a échoué")
                print(
                    f"   3. Vérifiez que le site est toujours accessible et n'a pas changé")
            else:
                print(
                    f"\n✅ Scraping terminé: {products_count} produits extraits")

            # Avertissement si très peu de produits (possible problème de pagination)
            if 0 < products_count < 10:
                print(
                    f"\n⚠️  ATTENTION: Seulement {products_count} produits trouvés.")
                print(f"   Vérifiez si la pagination fonctionne correctement.")
                print(f"   Le site pourrait avoir plus de produits sur d'autres pages.")

            return result

        except SyntaxError as e:
            print(f"❌ Erreur de syntaxe dans le scraper généré: {e}")
            print(f"   Ligne: {e.lineno}")
            print(f"   Code problématique: {e.text}")
            import traceback
            traceback.print_exc()
            return {"companyInfo": {}, "products": []}
        except Exception as e:
            print(f"❌ Erreur lors de l'exécution du scraper: {e}")
            import traceback
            traceback.print_exc()
            return {"companyInfo": {}, "products": []}

    def scrape_site(self, url: str, reference_url: Optional[str] = None,
                    force_refresh: bool = False) -> Dict:
        """Scrape un site complet: analyse + génération + exécution

        Args:
            url: URL du site à scraper
            reference_url: URL du site de référence pour comparaison de prix
            force_refresh: Si True, ignore le cache et régénère le scraper

        Returns:
            Dict au format EXTRACTION_SCHEMA
        """
        print(f"\n{'='*60}")
        print(f"🔍 DÉMARRAGE DU SCRAPING AI")
        print(f"{'='*60}")
        print(f"🌐 Site: {url}")
        if force_refresh:
            print(f"🔄 Mode: Force refresh (ignore le cache)")

        # Étape 1: Récupérer le HTML de la page d'accueil
        print(f"\n📥 Récupération du HTML de la page d'accueil...")
        html_content = self.fetch_html(url)
        print(f"   ✅ {len(html_content)} caractères récupérés")

        # Étape 2: Analyser et générer le scraper
        # Gemini peut demander des pages supplémentaires si nécessaire
        print(f"\n🔍 Analyse du site (Gemini peut demander plus de pages)...")
        scraper_data = self.html_analyzer.analyze_and_generate_scraper(
            url=url,
            html_content=html_content,
            force_refresh=force_refresh
        )

        # Afficher les pages analysées
        metadata = scraper_data.get('metadata', {})
        analyzed_pages = metadata.get('analyzed_pages', [url])
        print(f"\n📊 Pages analysées: {len(analyzed_pages)}")
        for page in analyzed_pages:
            print(f"   - {page}")

        # Afficher les informations du cache si c'est un nouveau scraper
        cache_key = metadata.get('cache_key', '')
        if cache_key:
            print(f"\n💾 Scraper disponible dans le cache")
            print(f"   📁 Clé de cache: {cache_key}")
            print(
                f"   📝 Version du prompt: {metadata.get('prompt_version', 'N/A')}")

        # Étape 3: Exécuter le scraper immédiatement après la génération
        print(f"\n{'='*60}")
        print(f"🚀 EXÉCUTION DU SCRAPER GÉNÉRÉ")
        print(f"{'='*60}")
        print(f"🔄 Démarrage de l'extraction avec le scraper sauvegardé...\n")
        result = self.execute_scraper(
            url=url,
            scraper_data=scraper_data,
            reference_url=reference_url
        )

        return result
