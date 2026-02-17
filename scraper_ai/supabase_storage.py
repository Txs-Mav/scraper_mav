"""
Module de stockage Supabase pour les scrapers et résultats
Communique avec les APIs Next.js pour accéder à Supabase
"""
import os
import json
import hashlib
from datetime import datetime, timedelta
from typing import Dict, Optional, List, Any, Tuple
from urllib.parse import urlparse
import requests


class SupabaseStorage:
    """Gère le stockage des scrapers et résultats dans Supabase via les APIs Next.js"""

    CACHE_EXPIRY_DAYS = 7
    
    def __init__(self, user_id: Optional[str] = None):
        self.user_id = user_id
        self.api_url = os.environ.get('NEXTJS_API_URL', 'http://localhost:3000')
        self.timeout = 15
    
    def _get_cache_key(self, url: str) -> str:
        """Génère une clé de cache basée sur le domaine de l'URL"""
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        return hashlib.md5(domain.encode()).hexdigest()
    
    def _make_request(self, method: str, endpoint: str, **kwargs) -> Optional[Dict]:
        """Effectue une requête HTTP vers l'API Next.js"""
        try:
            url = f"{self.api_url}{endpoint}"
            kwargs['timeout'] = self.timeout
            
            response = getattr(requests, method)(url, **kwargs)
            
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 401:
                print(f"⚠️  Non authentifié - stockage local uniquement")
                return None
            elif response.status_code == 404:
                return None
            else:
                print(f"⚠️  Erreur API ({response.status_code}): {response.text[:200]}")
                return None
                
        except requests.exceptions.Timeout:
            print(f"⚠️  Timeout API - {endpoint}")
            return None
        except requests.exceptions.ConnectionError:
            print(f"⚠️  Connexion impossible - {endpoint}")
            return None
        except Exception as e:
            print(f"⚠️  Erreur API: {e}")
            return None

    # =====================================================
    # MÉTHODES SCRAPER CACHE
    # =====================================================
    
    def get_scraper(self, site_url: str) -> Optional[Dict]:
        """Récupère un scraper depuis Supabase
        
        Returns:
            Dict avec: scraper_code, selectors, product_urls, metadata, expires_at, status
            None si non trouvé ou erreur
        """
        if not self.user_id:
            return None
            
        cache_key = self._get_cache_key(site_url)
        
        result = self._make_request(
            'get',
            '/api/scraper-ai/cache/load',
            params={'user_id': self.user_id, 'cache_key': cache_key}
        )
        
        if result and result.get('found'):
            return {
                'scraper_code': result.get('scraper_code', ''),
                'selectors': result.get('selectors', {}),
                'product_urls': result.get('product_urls', []),
                'metadata': result.get('metadata', {}),
                'expires_at': result.get('expires_at'),
                'status': result.get('status', 'active'),
                'cache_key': cache_key
            }
        
        return None
    
    def save_scraper(
        self, 
        site_url: str, 
        scraper_code: str,
        selectors: Dict[str, str],
        product_urls: List[str],
        metadata: Optional[Dict] = None
    ) -> Optional[str]:
        """Sauvegarde un scraper dans Supabase
        
        Args:
            site_url: URL du site
            scraper_code: Code Python du scraper
            selectors: Sélecteurs CSS {nom: css_selector}
            product_urls: Liste des URLs de produits
            metadata: Métadonnées additionnelles
            
        Returns:
            cache_key si succès, None sinon
        """
        if not self.user_id:
            print("⚠️  Pas d'user_id - sauvegarde locale uniquement")
            return None
            
        cache_key = self._get_cache_key(site_url)
        
        # Préparer les métadonnées
        full_metadata = metadata or {}
        full_metadata.update({
            'site_url': site_url,
            'saved_at': datetime.now().isoformat(),
            'template_version': '2.0'
        })
        
        result = self._make_request(
            'post',
            '/api/scraper-ai/cache/save',
            json={
                'user_id': self.user_id,
                'site_url': site_url,
                'cache_key': cache_key,
                'scraper_code': scraper_code,
                'selectors': selectors,
                'product_urls': product_urls,
                'metadata': full_metadata
            }
        )
        
        if result and result.get('success'):
            print(f"✅ Scraper sauvegardé dans Supabase (cache_key: {cache_key})")
            return cache_key
            
        return None
    
    def update_scraper_urls(self, site_url: str, new_product_urls: List[str]) -> bool:
        """Met à jour uniquement les URLs des produits (cache < 7 jours)
        
        Args:
            site_url: URL du site
            new_product_urls: Nouvelles URLs de produits
            
        Returns:
            True si succès
        """
        if not self.user_id:
            return False
            
        cache_key = self._get_cache_key(site_url)
        
        result = self._make_request(
            'patch',
            '/api/scraper-ai/cache/update-urls',
            json={
                'user_id': self.user_id,
                'cache_key': cache_key,
                'product_urls': new_product_urls
            }
        )
        
        return result and result.get('success', False)
    
    def is_cache_valid(self, site_url: str) -> Tuple[bool, Optional[Dict]]:
        """Vérifie si le cache est valide (existe et non expiré)
        
        Returns:
            (is_valid, scraper_data) - is_valid est True si le cache existe et n'est pas expiré
        """
        scraper_data = self.get_scraper(site_url)
        
        if not scraper_data:
            return (False, None)
        
        # Vérifier l'expiration
        expires_at = scraper_data.get('expires_at')
        if expires_at:
            try:
                expiry_date = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                if expiry_date < datetime.now(expiry_date.tzinfo):
                    return (False, scraper_data)  # Expiré mais existe
            except Exception:
                pass
        
        # Vérifier le statut
        status = scraper_data.get('status', 'active')
        if status in ('expired', 'error'):
            return (False, scraper_data)
        
        return (True, scraper_data)
    
    def refresh_cache_expiry(self, site_url: str) -> bool:
        """Rafraîchit la date d'expiration du cache (remet à 7 jours)"""
        if not self.user_id:
            return False
            
        cache_key = self._get_cache_key(site_url)
        
        result = self._make_request(
            'post',
            '/api/scraper-ai/cache/refresh',
            json={
                'user_id': self.user_id,
                'cache_key': cache_key
            }
        )
        
        return result and result.get('success', False)
    
    def delete_scraper(self, site_url: str) -> bool:
        """Supprime un scraper du cache"""
        if not self.user_id:
            return False
            
        cache_key = self._get_cache_key(site_url)
        
        result = self._make_request(
            'delete',
            '/api/scraper-ai/cache',
            params={'user_id': self.user_id, 'cache_key': cache_key}
        )
        
        return result is not None
    
    # =====================================================
    # MÉTHODES SCRAPING RESULTS
    # =====================================================
    
    def save_scraping_result(
        self,
        site_url: str,
        products: List[Dict],
        execution_time: float,
        scraper_cache_id: Optional[str] = None,
        metadata: Optional[Dict] = None,
        status: str = 'success',
        error_message: Optional[str] = None
    ) -> Optional[str]:
        """Sauvegarde les résultats d'un scraping
        
        Returns:
            result_id si succès, None sinon
        """
        if not self.user_id:
            return None
        
        result = self._make_request(
            'post',
            '/api/scrapings/save',
            json={
                'user_id': self.user_id,
                # Compat: l'API dashboard attend reference_url
                'reference_url': site_url,
                'site_url': site_url,
                'scraper_cache_id': scraper_cache_id,
                'products': products,
                'product_count': len(products),
                'execution_time_seconds': round(execution_time, 2),
                'metadata': metadata or {},
                'status': status,
                'error_message': error_message
            }
        )
        
        if result and result.get('success'):
            return result.get('id')
        
        return None
    
    def get_scraping_history(
        self, 
        site_url: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict]:
        """Récupère l'historique des scrapings
        
        Args:
            site_url: Filtrer par site (optionnel)
            limit: Nombre maximum de résultats
            
        Returns:
            Liste des résultats de scraping
        """
        if not self.user_id:
            return []
        
        params = {'user_id': self.user_id, 'limit': limit}
        if site_url:
            params['site_url'] = site_url
        
        result = self._make_request(
            'get',
            '/api/scrapings',
            params=params
        )
        
        if result and result.get('scrapings'):
            return result['scrapings']
        
        return []
    
    def get_user_scrapers(self) -> List[Dict]:
        """Récupère tous les scrapers de l'utilisateur
        
        Returns:
            Liste des scrapers avec leurs métadonnées
        """
        if not self.user_id:
            return []
        
        result = self._make_request(
            'get',
            '/api/scraper-ai/cache',
            params={'user_id': self.user_id}
        )
        
        if result and result.get('scrapers'):
            return result['scrapers']
        
        return []
    
    # =====================================================
    # MÉTHODES UTILITAIRES
    # =====================================================
    
    def get_domain(self, url: str) -> str:
        """Extrait le domaine d'une URL"""
        parsed = urlparse(url)
        return parsed.netloc.replace('www.', '')
    
    def check_connection(self) -> bool:
        """Vérifie la connexion à l'API"""
        try:
            result = self._make_request('get', '/api/users/me')
            return result is not None
        except Exception:
            return False


# =====================================================
# SINGLETON POUR UTILISATION GLOBALE
# =====================================================

_storage_instance: Optional[SupabaseStorage] = None

def get_storage(user_id: Optional[str] = None) -> SupabaseStorage:
    """Retourne une instance de SupabaseStorage
    
    Args:
        user_id: ID de l'utilisateur (optionnel, pour le cache global)
        
    Returns:
        Instance de SupabaseStorage
    """
    global _storage_instance
    
    if user_id:
        return SupabaseStorage(user_id)
    
    if _storage_instance is None:
        _storage_instance = SupabaseStorage()
    
    return _storage_instance


def set_global_user(user_id: str):
    """Configure l'utilisateur global pour le storage"""
    global _storage_instance
    _storage_instance = SupabaseStorage(user_id)
