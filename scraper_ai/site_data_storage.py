"""
Module pour gérer le stockage structuré des données d'exploration par site
Format JSON optimisé pour faciliter la génération de scripts
"""
import json
import hashlib
from pathlib import Path
from typing import Dict, Optional, List, Any
from datetime import datetime
from urllib.parse import urlparse

try:
    from .config import CACHE_DIR
except ImportError:
    from config import CACHE_DIR


class SiteDataStorage:
    """Gère le stockage et la récupération des données d'exploration par site"""

    def __init__(self):
        self.cache_dir = Path(CACHE_DIR)
        self.cache_dir.mkdir(exist_ok=True)

    def _get_cache_key(self, url: str) -> str:
        """Génère une clé de cache basée sur l'URL (domaine uniquement)"""
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        return hashlib.md5(domain.encode()).hexdigest()

    def get_cache_path(self, url: str) -> Path:
        """Retourne le chemin du fichier de cache pour une URL"""
        cache_key = self._get_cache_key(url)
        return self.cache_dir / f"{cache_key}_data.json"

    def save_site_data(
        self,
        url: str,
        product_urls: List[str],
        html_samples: Dict[str, str],
        extracted_products: List[Dict[str, Any]],
        detected_selectors: Dict[str, str],
        site_structure: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Path:
        """Sauvegarde les données d'exploration dans un fichier JSON structuré

        Args:
            url: URL de base du site
            product_urls: Liste de toutes les URLs de produits découvertes
            html_samples: Dictionnaire {url: html_content} pour échantillons HTML
            extracted_products: Liste des produits extraits par Gemini
            detected_selectors: Dictionnaire des sélecteurs CSS détectés
            site_structure: Informations sur la structure du site (optionnel)
            metadata: Métadonnées supplémentaires (optionnel)

        Returns:
            Chemin du fichier sauvegardé
        """
        cache_path = self.get_cache_path(url)

        # Structure optimisée pour la génération de script
        site_data = {
            "site_url": url,
            "exploration_date": datetime.now().isoformat(),
            "product_urls": product_urls,
            "html_samples": html_samples,
            "extracted_products": extracted_products,
            "detected_selectors": detected_selectors,
            "site_structure": site_structure or {},
            "metadata": metadata or {}
        }

        try:
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(site_data, f, indent=2, ensure_ascii=False)
            print(f"✅ Données sauvegardées: {cache_path}")
            return cache_path
        except Exception as e:
            print(f"❌ Erreur lors de la sauvegarde: {e}")
            raise

    def load_site_data(self, url: str) -> Optional[Dict[str, Any]]:
        """Charge les données d'exploration depuis le cache

        Args:
            url: URL de base du site

        Returns:
            Dictionnaire avec les données ou None si non trouvé
        """
        cache_path = self.get_cache_path(url)

        if not cache_path.exists():
            return None

        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            print(f"✅ Données chargées depuis: {cache_path}")
            return data
        except Exception as e:
            print(f"⚠️ Erreur lors du chargement: {e}")
            return None

    def invalidate_cache(self, url: str) -> bool:
        """Invalide le cache pour un site spécifique

        Args:
            url: URL de base du site

        Returns:
            True si le cache a été supprimé, False sinon
        """
        cache_path = self.get_cache_path(url)

        if cache_path.exists():
            try:
                cache_path.unlink()
                print(f"✅ Cache invalidé: {cache_path}")
                return True
            except Exception as e:
                print(f"⚠️ Erreur lors de l'invalidation: {e}")
                return False
        return False

    def has_cached_data(self, url: str) -> bool:
        """Vérifie si des données sont en cache pour un site

        Args:
            url: URL de base du site

        Returns:
            True si des données sont en cache, False sinon
        """
        cache_path = self.get_cache_path(url)
        return cache_path.exists()

    def get_data_version(self, url: str) -> Optional[str]:
        """Récupère la version des données en cache (pour invalidation si nécessaire)

        Args:
            url: URL de base du site

        Returns:
            Version des données ou None si non trouvé
        """
        data = self.load_site_data(url)
        if data:
            return data.get('metadata', {}).get('data_version', None)
        return None

