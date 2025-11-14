"""
Fonctions d'extraction de données depuis les pages web
"""
import os
import re
import hashlib
import requests
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse, unquote, parse_qs
from bs4 import BeautifulSoup
from google.genai import types

from .config import SUPPORTED_IMAGE_MIMES


def extract_contact_info_from_links(soup: BeautifulSoup) -> Dict[str, str]:
    """Extrait les informations de contact depuis les liens (mailto:, tel:, maps)"""
    contact_info = {
        "email": "",
        "phone": "",
        "address": ""
    }
    
    # Chercher tous les liens
    for link in soup.find_all('a', href=True):
        href = link.get('href', '')
        
        # Extraire l'email depuis mailto:
        if href.startswith('mailto:'):
            email = href.replace('mailto:', '').strip()
            # Nettoyer l'email (enlever les paramètres comme ?subject=...)
            email = email.split('?')[0].split('&')[0].strip()
            if email and '@' in email:
                contact_info["email"] = email
                print(f"   📧 Email trouvé dans mailto: {email}")
        
        # Extraire le téléphone depuis tel:
        elif href.startswith('tel:'):
            phone = href.replace('tel:', '').strip()
            # Nettoyer le téléphone (enlever les espaces, tirets, etc.)
            phone = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '').strip()
            if phone:
                # Formater le téléphone (ajouter des espaces/tirets si nécessaire)
                if len(phone) >= 10:
                    # Format: 819 295-3325 ou (819) 295-3325
                    if len(phone) == 10:
                        phone = f"{phone[:3]} {phone[3:6]}-{phone[6:]}"
                    contact_info["phone"] = phone
                    print(f"   📞 Téléphone trouvé dans tel: {phone}")
        
        # Extraire l'adresse depuis Google Maps
        elif 'google.com/maps' in href or 'maps.google.com' in href:
            # Essayer d'extraire l'adresse depuis l'URL Google Maps
            try:
                # Méthode 1: Extraire depuis /place/
                if '/place/' in href:
                    place_part = href.split('/place/')[1]
                    if '/@' in place_part:
                        place_part = place_part.split('/@')[0]
                    elif '?hl=' in place_part:
                        place_part = place_part.split('?hl=')[0]
                    
                    address = unquote(place_part).replace('+', ' ')
                    address = address.replace('%2C', ',').replace('%20', ' ')
                    
                    if address and len(address) > 5:
                        contact_info["address"] = address
                        print(f"   📍 Adresse trouvée dans Google Maps (/place/): {address[:80]}...")
                
                # Méthode 2: Extraire depuis les paramètres de requête
                elif '?q=' in href or '&q=' in href:
                    parsed_url = urlparse(href)
                    query_params = parse_qs(parsed_url.query)
                    if 'q' in query_params:
                        address = unquote(query_params['q'][0]).replace('+', ' ')
                        if address and len(address) > 5:
                            contact_info["address"] = address
                            print(f"   📍 Adresse trouvée dans Google Maps (query): {address[:80]}...")
                
                # Méthode 3: Extraire depuis le texte du lien
                link_text = link.get_text(strip=True)
                if link_text and len(link_text) > 10 and any(char.isdigit() for char in link_text):
                    contact_info["address"] = link_text
                    print(f"   📍 Adresse trouvée dans le texte du lien Google Maps: {link_text[:80]}...")
                    
            except Exception as e:
                print(f"   ⚠️ Erreur extraction adresse Google Maps: {e}")
                pass
    
    return contact_info


def extract_visible_text(soup: BeautifulSoup) -> str:
    """Extrait tout le texte visible de la page"""
    # Supprimer les scripts et styles
    for script in soup(["script", "style", "meta", "link"]):
        script.decompose()
    
    # Extraire le texte
    text = soup.get_text(separator=' ', strip=True)
    # Nettoyer les espaces multiples
    text = ' '.join(text.split())
    return text


def extract_images(soup: BeautifulSoup, base_url: str) -> List[Dict]:
    """Extrait toutes les images de la page avec leurs URLs"""
    images = []
    for img in soup.find_all('img'):
        src = img.get('src') or img.get('data-src') or img.get('data-lazy-src')
        if src:
            # Convertir en URL absolue
            img_url = urljoin(base_url, src)
            alt = img.get('alt', '')
            
            # Identifier si c'est potentiellement un logo
            is_logo = False
            img_url_lower = img_url.lower()
            alt_lower = alt.lower() if alt else ''
            
            # Critères pour identifier un logo
            logo_indicators = [
                'logo' in img_url_lower,
                'logo' in alt_lower,
                'brand' in img_url_lower,
                'brand' in alt_lower,
                'header' in img_url_lower and 'logo' in img_url_lower,
                'footer' in img_url_lower and 'logo' in img_url_lower,
                '/logo.' in img_url_lower,
                'site-logo' in img_url_lower,
                'company-logo' in img_url_lower,
                'main-logo' in img_url_lower
            ]
            
            # Vérifier aussi les classes et IDs du parent
            parent = img.parent
            if parent:
                parent_class = parent.get('class', [])
                parent_id = parent.get('id', '')
                parent_class_str = ' '.join(parent_class).lower() if isinstance(parent_class, list) else str(parent_class).lower()
                parent_id_str = str(parent_id).lower()
                
                if any(['logo' in parent_class_str, 'logo' in parent_id_str, 'brand' in parent_class_str, 'brand' in parent_id_str]):
                    is_logo = True
            
            if any(logo_indicators):
                is_logo = True
            
            # Extraire le contexte autour de l'image (texte avant/après)
            context_before = ""
            context_after = ""
            
            # Chercher le texte avant l'image (dans le parent et les siblings précédents)
            if parent:
                # Texte du parent avant l'image
                parent_text = parent.get_text(separator=' ', strip=True)
                img_index = parent_text.find(alt) if alt else -1
                if img_index > 0:
                    context_before = parent_text[max(0, img_index - 200):img_index].strip()
                
                # Chercher les éléments précédents
                prev_sibling = img.find_previous_sibling()
                if prev_sibling:
                    prev_text = prev_sibling.get_text(separator=' ', strip=True)
                    context_before = prev_text[-200:] + " " + context_before
                
                # Texte après l'image
                next_sibling = img.find_next_sibling()
                if next_sibling:
                    context_after = next_sibling.get_text(separator=' ', strip=True)[:200]
            
            images.append({
                "url": img_url,
                "alt": alt,
                "is_logo": is_logo,
                "context_before": context_before[:300],  # Limiter à 300 caractères
                "context_after": context_after[:300]
            })
    return images


def download_image(url: str, assets_dir: str = None, save_to_disk: bool = False, filename: Optional[str] = None) -> Optional[Tuple[bytes, str, Optional[str]]]:
    """Télécharge une image depuis une URL et retourne (bytes, mime_type, local_path)
    Si save_to_disk=True, sauvegarde aussi l'image dans le dossier assets"""
    try:
        # Ignorer les images SVG en data URI - elles ne peuvent pas être téléchargées avec requests
        if url.startswith('data:image/svg+xml') or url.startswith('data:image/'):
            print(f"   ⚠️ Image data URI ignorée (SVG ou format non supporté): {url[:80]}...")
            return None
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(url, headers=headers, timeout=10, stream=True)
        response.raise_for_status()
        
        # Vérifier le type MIME
        content_type = response.headers.get('content-type', '').split(';')[0].strip()
        if not content_type.startswith('image/'):
            return None
        
        # Limiter la taille (max 5MB pour éviter les problèmes)
        content = response.content
        if len(content) > 5 * 1024 * 1024:
            print(f"   ⚠️ Image trop grande ({len(content)} bytes), ignorée")
            return None
        
        # S'assurer que le type MIME est supporté par Gemini
        if content_type not in SUPPORTED_IMAGE_MIMES:
            # Essayer de détecter depuis l'extension
            if url.lower().endswith('.png'):
                content_type = 'image/png'
            elif url.lower().endswith(('.jpg', '.jpeg')):
                content_type = 'image/jpeg'
            elif url.lower().endswith('.webp'):
                content_type = 'image/webp'
            elif url.lower().endswith(('.heic', '.heif')):
                content_type = 'image/heic' if url.lower().endswith('.heic') else 'image/heif'
            else:
                content_type = 'image/jpeg'  # Par défaut
        
        local_path = None
        if save_to_disk and assets_dir:
            # Générer un nom de fichier si non fourni
            if not filename:
                # Extraire le nom de fichier de l'URL
                parsed_url = urlparse(url)
                url_filename = os.path.basename(parsed_url.path)
                if not url_filename or '.' not in url_filename:
                    # Générer un nom basé sur l'URL
                    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
                    ext = 'jpg' if 'jpeg' in content_type else content_type.split('/')[-1]
                    url_filename = f"image_{url_hash}.{ext}"
                
                # Nettoyer le nom de fichier
                url_filename = re.sub(r'[^\w\-_\.]', '_', url_filename)
                filename = url_filename
            
            # Sauvegarder l'image
            file_path = os.path.join(assets_dir, filename)
            with open(file_path, 'wb') as f:
                f.write(content)
            local_path = file_path
            print(f"      💾 Sauvegardée: {os.path.basename(file_path)}")
        
        return (content, content_type, local_path)
    except Exception as e:
        print(f"⚠️ Erreur téléchargement image {url}: {e}")
        return None


def extract_navigation_links(soup: BeautifulSoup, current_url: str, normalize_url_func, is_same_domain_func) -> List[str]:
    """Extrait tous les liens de navigation de la page"""
    links = set()
    all_links_found = 0
    for a in soup.find_all('a', href=True):
        all_links_found += 1
        href = a.get('href')
        normalized = normalize_url_func(href)
        if normalized and is_same_domain_func(normalized):
            links.add(normalized)
    links_list = list(links)
    print(f"   🔍 Liens extraits: {len(links_list)} (sur {all_links_found} liens totaux trouvés)")
    return links_list

