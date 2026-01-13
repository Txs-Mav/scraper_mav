"""
Générateur de scraper qui remplit le template avec les données JSON
Étape 3 du nouveau flux : Génération de script (sans Gemini)
"""
import json
from pathlib import Path
from typing import Dict, Any, List, Optional
import re
from datetime import datetime
from urllib.parse import urlparse
import hashlib

try:
    from .config import CACHE_DIR, PROMPT_VERSION
except ImportError:
    from config import CACHE_DIR, PROMPT_VERSION


class ScraperGenerator:
    """Génère un script Python complet depuis un template et des données JSON"""

    def __init__(self):
        self.template_path = Path(__file__).parent / "templates" / "scraper_template.py"
        if not self.template_path.exists():
            raise FileNotFoundError(f"Template non trouvé: {self.template_path}")

    def generate_scraper(self, site_data: Dict[str, Any]) -> str:
        """Génère un script Python complet depuis les données du site

        Args:
            site_data: Dictionnaire avec les données d'exploration (depuis SiteDataStorage)

        Returns:
            Code Python complet et fonctionnel
        """
        print(f"\n{'='*60}")
        print(f"🔧 ÉTAPE 3: GÉNÉRATION DU SCRAPER (SANS GEMINI)")
        print(f"{'='*60}")

        # Charger le template
        template = self._load_template()
        print(f"   ✅ Template chargé: {self.template_path}")

        # Extraire les données nécessaires
        product_urls = site_data.get('product_urls', [])
        detected_selectors = site_data.get('detected_selectors', {})
        site_url = site_data.get('site_url', '')

        # Formater les données pour insertion dans le template
        product_urls_str = self._format_urls_list(product_urls)
        selectors_str = self._format_selectors_dict(detected_selectors)

        print(f"   📋 URLs à hardcoder: {len(product_urls)}")
        print(f"   🎯 Sélecteurs à hardcoder: {len(detected_selectors)}")

        # Remplir le template
        code = template.format(
            site_url=site_url,
            product_urls=product_urls_str,
            selectors=selectors_str
        )

        # Calculer le cache_key
        parsed = urlparse(site_url)
        domain = parsed.netloc.replace('www.', '')
        cache_key = hashlib.md5(domain.encode()).hexdigest()
        
        # Extraire le nom du site et le type de structure
        site_name = domain.split('.')[0] if domain else ''
        site_structure = site_data.get('site_structure', {})
        structure_type = site_structure.get('structure_type', 'unknown')

        # Ajouter les métadonnées en commentaires après la docstring
        metadata_comments = f"""
# Métadonnées de génération
# Version prompt: {PROMPT_VERSION}
# Cache key: {cache_key}
# Site URL: {site_url}
# Site name: {site_name}
# Structure type: {structure_type}
# Date génération: {datetime.now().isoformat()}
# URLs découvertes: {len(product_urls)}
# Sélecteurs détectés: {len(detected_selectors)}
"""
        
        # Insérer les métadonnées après la docstring (après les """)
        # Chercher la fin de la docstring
        docstring_end = code.find('"""', 3)  # Chercher après le premier """
        if docstring_end != -1:
            docstring_end = code.find('\n', docstring_end + 3)
            if docstring_end != -1:
                # Insérer les métadonnées après la docstring
                code = code[:docstring_end + 1] + metadata_comments + code[docstring_end + 1:]
            else:
                # Si pas de nouvelle ligne, ajouter avant les imports
                code = code + metadata_comments
        else:
            # Si pas de docstring, ajouter au début
            code = metadata_comments + code

        # Valider la syntaxe Python
        self._validate_python_syntax(code)

        print(f"   ✅ Script Python généré ({len(code)} caractères)")
        print(f"   ✅ Script valide et prêt à être exécuté")

        return code

    def _load_template(self) -> str:
        """Charge le template depuis le fichier"""
        with open(self.template_path, 'r', encoding='utf-8') as f:
            return f.read()

    def _format_urls_list(self, urls: List[str]) -> str:
        """Formate une liste d'URLs pour insertion dans le code Python"""
        if not urls:
            return "[]"

        # Limiter à 500 URLs pour éviter des scripts trop longs
        urls_limited = urls[:500]

        # Formater comme une liste Python
        urls_formatted = "[\n"
        for i, url in enumerate(urls_limited):
            # Échapper les guillemets dans l'URL
            url_escaped = url.replace('"', '\\"').replace("'", "\\'")
            urls_formatted += f'    "{url_escaped}"'
            if i < len(urls_limited) - 1:
                urls_formatted += ","
            urls_formatted += "\n"
        urls_formatted += "]"

        if len(urls) > 500:
            urls_formatted += f"  # Limité à 500 URLs sur {len(urls)} totales"

        return urls_formatted

    def _format_selectors_dict(self, selectors: Dict[str, str]) -> str:
        """Formate un dictionnaire de sélecteurs pour insertion dans le code Python"""
        if not selectors:
            return "{}"

        # Formater comme un dictionnaire Python
        selectors_formatted = "{\n"
        for i, (key, value) in enumerate(selectors.items()):
            # Échapper les guillemets dans les sélecteurs
            key_escaped = key.replace('"', '\\"').replace("'", "\\'")
            value_escaped = value.replace('"', '\\"').replace("'", "\\'")
            selectors_formatted += f'    "{key_escaped}": "{value_escaped}"'
            if i < len(selectors) - 1:
                selectors_formatted += ","
            selectors_formatted += "\n"
        selectors_formatted += "}"

        return selectors_formatted

    def _validate_python_syntax(self, code: str) -> None:
        """Valide que le code Python généré est syntaxiquement correct"""
        try:
            compile(code, '<string>', 'exec')
        except SyntaxError as e:
            print(f"\n❌ ERREUR DE SYNTAXE dans le code généré:")
            print(f"   Ligne {e.lineno}: {e.text}")
            print(f"   Message: {e.msg}")
            raise ValueError(f"Code généré invalide (syntaxe Python): {e}")

    def save_generated_scraper(self, site_data: Dict[str, Any], output_path: Optional[Path] = None) -> Path:
        """Génère et sauvegarde le scraper dans un fichier

        Args:
            site_data: Données d'exploration
            output_path: Chemin de sortie (optionnel, généré automatiquement si non fourni)

        Returns:
            Chemin du fichier sauvegardé
        """
        code = self.generate_scraper(site_data)

        if output_path is None:
            # Générer un chemin automatique
            site_url = site_data.get('site_url', '')
            from urllib.parse import urlparse
            import hashlib
            parsed = urlparse(site_url)
            domain = parsed.netloc.replace('www.', '')
            cache_key = hashlib.md5(domain.encode()).hexdigest()
            cache_dir = Path(CACHE_DIR)
            cache_dir.mkdir(exist_ok=True)
            output_path = cache_dir / f"{cache_key}_scraper.py"

        # Sauvegarder
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(code)

        print(f"   💾 Scraper sauvegardé: {output_path}")
        return output_path

