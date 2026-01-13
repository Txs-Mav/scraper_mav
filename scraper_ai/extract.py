#!/usr/bin/env python3
"""
Script d'extraction locale sans Gemini
Utilise le scraper en cache mais remplace l'extraction Gemini par une extraction locale
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, urljoin, urlunparse, parse_qs, urlencode
from typing import Dict, List, Optional, Any
import requests
from bs4 import BeautifulSoup
import time

# Configuration
CACHE_DIR = Path(__file__).parent.parent / "scraper_cache"
CACHE_DIR.mkdir(exist_ok=True)


def get_cache_key(url: str) -> str:
    """Génère une clé de cache basée sur l'URL"""
    import hashlib
    parsed = urlparse(url)
    domain = parsed.netloc.replace('www.', '')
    return hashlib.md5(domain.encode()).hexdigest()


def load_cached_scraper(url: str) -> Optional[Dict]:
    """Charge le scraper depuis le cache (fichier Python)"""
    cache_key = get_cache_key(url)
    cache_path = CACHE_DIR / f"{cache_key}_scraper.py"
    if cache_path.exists():
        # Lire le fichier Python
        with open(cache_path, 'r', encoding='utf-8') as f:
            scraper_code = f.read()

        # Retourner au format attendu
        return {
            'scraperCode': scraper_code
        }
    return None


def clean_html(html: str) -> str:
    """Nettoie le HTML des caractères Unicode invalides"""
    if not html:
        return ""
    # Supprimer les surrogates Unicode invalides
    return html.encode('utf-8', errors='ignore').decode('utf-8', errors='ignore')


def extract_price(text: str) -> Optional[float]:
    """Extrait un prix depuis un texte"""
    if not text:
        return None
    # Chercher des patterns de prix: $1234.56, 1234,56$, 1234.56 CAD, etc.
    patterns = [
        r'\$[\s]*([\d,]+\.?\d*)',
        r'([\d,]+\.?\d*)[\s]*\$',
        r'([\d,]+\.?\d*)[\s]*(?:CAD|USD|EUR|€)',
        r'([\d,]+\.?\d*)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text.replace(',', ''))
        if match:
            try:
                return float(match.group(1).replace(',', ''))
            except:
                continue
    return None


def extract_year(text: str) -> Optional[int]:
    """Extrait une année depuis un texte"""
    if not text:
        return None
    # Chercher des années entre 1900 et 2100
    match = re.search(r'\b(19|20)\d{2}\b', text)
    if match:
        try:
            year = int(match.group(0))
            if 1900 <= year <= 2100:
                return year
        except:
            pass
    return None


def extract_vehicle_info(html: str, url: str) -> List[Dict[str, Any]]:
    """Extrait les informations des véhicules depuis le HTML"""
    soup = BeautifulSoup(html, 'html.parser')
    products = []

    # Patterns communs pour trouver les produits
    product_selectors = [
        '.product',
        '.inventory-item',
        '.vehicle',
        '.moto',
        '[class*="product"]',
        '[class*="inventory"]',
        '[class*="vehicle"]',
        'article',
        '.item',
    ]

    found_products = []
    for selector in product_selectors:
        items = soup.select(selector)
        if items:
            found_products = items
            break

    # Si aucun sélecteur spécifique, chercher par structure
    if not found_products:
        # Chercher des liens vers des pages de produits
        links = soup.find_all('a', href=True)
        for link in links:
            href = link.get('href', '')
            if any(keyword in href.lower() for keyword in ['product', 'inventory', 'moto', 'vehicle', 'vtt', 'quad']):
                if href.startswith('http') or href.startswith('/'):
                    product_url = urljoin(url, href)
                    title = link.get_text(strip=True)
                    if title and len(title) > 5:
                        products.append({
                            'name': title,
                            'sourceUrl': product_url,
                            'url': product_url
                        })

    # Extraire depuis les éléments trouvés
    # Limiter à 100 pour éviter trop de données
    for item in found_products[:100]:
        product = {}

        # Nom
        name_elem = item.select_one(
            'h1, h2, h3, .title, .name, [class*="title"], [class*="name"]')
        if name_elem:
            product['name'] = name_elem.get_text(strip=True)
        else:
            product['name'] = item.get_text(strip=True)[:200]

        if not product.get('name') or len(product['name']) < 3:
            continue

        # URL
        link = item.find('a', href=True)
        if link:
            product['sourceUrl'] = urljoin(url, link['href'])
        else:
            product['sourceUrl'] = url

        # Prix
        price_elem = item.select_one(
            '.price, .prix, [class*="price"], [class*="prix"]')
        if price_elem:
            price_text = price_elem.get_text(strip=True)
            price = extract_price(price_text)
            if price:
                product['price'] = price

        # Description
        desc_elem = item.select_one(
            '.description, .desc, [class*="description"], [class*="desc"]')
        if desc_elem:
            product['description'] = desc_elem.get_text(strip=True)[:500]

        # Année
        year = extract_year(product.get('name', '') + ' ' +
                            product.get('description', ''))
        if year:
            product['year'] = year

        # Marque et Modèle (depuis le nom)
        name = product.get('name', '')
        if name:
            # Patterns communs: "Kawasaki Ninja 500 2024"
            brand_patterns = [
                r'^(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson)',
                r'\b(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson)\b'
            ]
            for pattern in brand_patterns:
                match = re.search(pattern, name, re.I)
                if match:
                    product['brand'] = match.group(1)
                    # Modèle = reste du nom après la marque
                    model = name.replace(match.group(1), '').strip()
                    if model:
                        product['model'] = model.split(
                        )[0] if model.split() else model[:50]
                    break

        # Catégorie (détection basique)
        url_lower = url.lower()
        name_lower = name.lower()
        if any(x in url_lower or x in name_lower for x in ['moto', 'motorcycle', 'motocyclette']):
            product['category'] = 'moto'
        elif any(x in url_lower or x in name_lower for x in ['motoneige', 'snowmobile']):
            product['category'] = 'motoneige'
        elif any(x in url_lower or x in name_lower for x in ['vtt', 'atv', 'quad']):
            product['category'] = 'quad'
        elif any(x in url_lower or x in name_lower for x in ['cote-a-cote', 'side-by-side', 'sxs']):
            product['category'] = 'side-by-side'
        else:
            product['category'] = 'autre'

        # Image
        img = item.select_one('img')
        if img and img.get('src'):
            product['image'] = urljoin(url, img['src'])

        products.append(product)

    return products


def extract_from_html_dict(pages_html_dict: Dict[str, str]) -> List[Dict[str, Any]]:
    """Extrait les produits depuis un dictionnaire de pages HTML"""
    all_products = []

    for url, html in pages_html_dict.items():
        if not html or len(html) < 100:
            continue

        html_clean = clean_html(html)
        products = extract_vehicle_info(html_clean, url)

        for product in products:
            # Ajouter sourceSite
            product['sourceSite'] = urlparse(url).netloc
            if 'sourceUrl' not in product:
                product['sourceUrl'] = url

            all_products.append(product)

    return all_products


def standardize_field(field: str, value: Any) -> Any:
    """Standardise un champ"""
    if value is None:
        return None

    if field in ['price', 'prix']:
        if isinstance(value, str):
            return extract_price(value)
        return float(value) if value else None

    if field in ['year', 'annee']:
        if isinstance(value, str):
            return extract_year(value)
        return int(value) if value else None

    if isinstance(value, str):
        return value.strip()

    return value


def validate_product(product: Dict[str, Any]) -> bool:
    """Valide qu'un produit a les champs minimums"""
    if not product.get('name'):
        return False
    if len(product.get('name', '')) < 3:
        return False
    return True


def main():
    """Point d'entrée principal"""
    if len(sys.argv) < 2:
        print("Usage: python extract.py <url>")
        sys.exit(1)

    url = sys.argv[1].rstrip('/')

    print(f"🔍 Extraction locale pour: {url}")

    # Charger le scraper en cache
    scraper_data = load_cached_scraper(url)
    if not scraper_data:
        print(f"❌ Aucun scraper en cache trouvé pour {url}")
        print(f"   Lancez d'abord un scrape avec le système AI pour générer le scraper")
        sys.exit(1)

    scraper_code = scraper_data.get('scraperCode', '')
    if not scraper_code:
        print(f"❌ Le scraper en cache ne contient pas de code")
        sys.exit(1)

    print(f"✅ Scraper chargé depuis le cache")

    # Créer une session
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })

    # Namespace pour exécuter le scraper (sans Gemini)
    namespace = {
        'requests': requests,
        'BeautifulSoup': BeautifulSoup,
        'urljoin': urljoin,
        'urlparse': urlparse,
        'urlunparse': urlunparse,
        'parse_qs': parse_qs,
        'urlencode': urlencode,
        're': re,
        'json': json,
        'time': time,
        'url': url,
        'base_url': url,
        'session': session,
        'print': print,
        'Path': Path,
        'clean_html': clean_html,
    }

    # Importer AITools pour les fonctions utilitaires
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from ai_tools import AITools
        ai_tools = AITools(url)

        # Ajouter toutes les fonctions AITools au namespace
        namespace.update({
            'get': lambda u, selenium=False: ai_tools.get(u, selenium),
            'browser_get': lambda u: ai_tools.browser_get(u),
            'get_sitemap_urls': lambda u: ai_tools.get_sitemap_urls(u),
            'discover_product_urls': lambda html, base: ai_tools.discover_product_urls(html, base),
            'detect_pagination': lambda html, u: ai_tools.detect_pagination(html, u),
            'build_pagination_url': lambda base, info, page: ai_tools.build_pagination_url(base, info, page),
            'extract_url_filters': lambda u: ai_tools.extract_url_filters(u),
            'get_all_links': lambda html, base: ai_tools.get_all_links(html, base),
            'save_json': lambda name, data: ai_tools.save_json(name, data),
            'load_json': lambda name: ai_tools.load_json(name),
            'wait_between_requests': lambda sec=1.0: ai_tools.wait_between_requests(sec),
            'smart_get': lambda url, max_retries=3: ai_tools.smart_get(url, max_retries),
        })
    except ImportError:
        print("⚠️ AITools non disponible, certaines fonctionnalités peuvent être limitées")

    # Exécuter le scraper jusqu'à l'étape 2 (récupération HTML)
    print(f"\n🚀 Exécution du scraper (étapes 1-2)...")
    exec(scraper_code, namespace)

    # Récupérer les pages HTML collectées
    if 'pages_html_dict' not in namespace:
        print("❌ Le scraper n'a pas créé 'pages_html_dict'")
        sys.exit(1)

    pages_html_dict = namespace['pages_html_dict']
    print(f"\n✅ {len(pages_html_dict)} pages HTML récupérées")

    # ÉTAPE 3: EXTRACTION LOCALE (remplace Gemini)
    print(f"\n{'='*60}")
    print(f"🔍 EXTRACTION LOCALE (sans Gemini)")
    print(f"{'='*60}")

    all_products = extract_from_html_dict(pages_html_dict)
    print(f"✅ {len(all_products)} produits extraits localement")

    # ÉTAPE 4: VALIDATION
    print(f"\n{'='*60}")
    print(f"✅ VALIDATION")
    print(f"{'='*60}")

    validated_products = []
    for product in all_products:
        # Standardiser les champs
        for field, value in product.items():
            product[field] = standardize_field(field, value)

        # Valider
        if validate_product(product):
            validated_products.append(product)
        else:
            print(f"❌ Produit rejeté: {product.get('name', 'Unknown')}")

    print(f"✅ {len(validated_products)} produits validés sur {len(all_products)}")

    # Sauvegarder les résultats
    output_file = Path(__file__).parent.parent / \
        f"extracted_{get_cache_key(url)}.json"
    result = {
        'companyInfo': {},
        'products': validated_products
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Résultats sauvegardés: {output_file}")
    print(f"   - {len(validated_products)} produits extraits")

    return result


if __name__ == '__main__':
    main()
