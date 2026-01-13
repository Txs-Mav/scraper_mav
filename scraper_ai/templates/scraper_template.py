"""
Scraper Python généré automatiquement pour {site_url}
Ce script est complètement autonome et ne nécessite pas Gemini
Amélioré avec support Selenium pour les pages nécessitant JavaScript
"""
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import re
from typing import Dict, List, Any, Optional, Tuple
import time
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

# Vérifier si Selenium est disponible
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

# URLs hardcodées (remplies depuis les données d'exploration)
PRODUCT_URLS = {product_urls}

# Sélecteurs hardcodés (remplis depuis les données d'exploration)
SELECTORS = {selectors}

# Configuration
MAX_RETRIES = 3
REQUEST_DELAY = 0.5  # Délai entre requêtes (secondes)
SELENIUM_TIMEOUT = 10  # Timeout pour Selenium (secondes)
MAX_WORKERS = 20  # Nombre de threads parallèles pour le scraping


def normalize_url(url: str, base_url: str) -> Optional[str]:
    """Normalise une URL (supprime les fragments, etc.)"""
    if not url or url.startswith('#') or url.startswith('javascript:') or url.startswith('mailto:'):
        return None

    try:
        absolute_url = urljoin(base_url, url)
        parsed = urlparse(absolute_url)
        normalized = f"{{{{parsed.scheme}}}}://{{{{parsed.netloc}}}}{{{{parsed.path}}}}"
        if parsed.query:
            normalized += f"?{{{{parsed.query}}}}"
        return normalized
    except:
        return url


def normalize_image_url(url: str, base_url: str) -> str:
    """Normalise une URL d'image (www vs non-www, etc.)"""
    if not url or str(url).lower() in ["null", "none", ""]:
        return ""
    try:
        parsed = urlparse(urljoin(base_url, url))
        base_netloc = urlparse(base_url).netloc
        if base_netloc.startswith('www.'):
            if not parsed.netloc.startswith('www.'):
                parsed = parsed._replace(netloc='www.' + parsed.netloc)
        else:
            if parsed.netloc.startswith('www.'):
                parsed = parsed._replace(netloc=parsed.netloc[4:])
        return parsed.geturl()
    except:
        return urljoin(base_url, url)


def fetch_page_with_selenium(url: str) -> Optional[str]:
    """Récupère le HTML d'une page avec Selenium (pour JavaScript)"""
    if not SELENIUM_AVAILABLE:
        return None

    driver = None
    try:
        print(f"      🤖 Utilisation de Selenium pour {{{{url[:60]}}}}...")

        # Configuration Chrome
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        chrome_options.add_argument(
            'user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')

        # Essayer de trouver chromedriver
        try:
            driver = webdriver.Chrome(options=chrome_options)
        except Exception as e:
            print(f"      ⚠️ Impossible de lancer Chrome: {{{{e}}}}")
            return None

        # Charger la page
        driver.get(url)

        # Attendre le chargement
        time.sleep(2)

        # Scroll pour charger le contenu dynamique
        driver.execute_script(
            "window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(1)
        driver.execute_script("window.scrollTo(0, 0);")
        time.sleep(0.5)

        # Gérer les popups (simplifié)
        try:
            # Chercher et fermer les popups courants
            popup_selectors = [
                "//button[contains(@class, 'close')]",
                "//button[contains(@aria-label, 'close')]",
                "//div[contains(@class, 'modal')]//button[contains(@class, 'close')]",
            ]
            for selector in popup_selectors:
                try:
                    elements = driver.find_elements(By.XPATH, selector)
                    for element in elements:
                        if element.is_displayed():
                            element.click()
                            time.sleep(0.5)
                            break
                except:
                    continue
        except:
            pass

        # Récupérer le HTML
        html = driver.page_source
        driver.quit()

        print(
            f"      ✅ HTML récupéré avec Selenium ({{{{len(html)}}}} caractères)")
        return html

    except Exception as e:
        print(f"      ❌ Erreur Selenium: {{{{e}}}}")
        if driver:
            try:
                driver.quit()
            except:
                pass
        return None


def get_html(url: str, session: requests.Session, base_url: str) -> str:
    """Récupère le HTML d'une URL avec retry et fallback Selenium"""
    # ESSAI 1 : Requests (rapide)
    for attempt in range(MAX_RETRIES):
        try:
            response = session.get(url, timeout=10)
            response.raise_for_status()
            html = response.text

            # Vérifier si HTML est valide
            if html and len(html) >= 1000:
                # Vérifier s'il y a des popups (détection simple)
                soup = BeautifulSoup(html, 'html.parser')
                popup_indicators = soup.find_all(['div', 'section'],
                                                 class_=re.compile(r'popup|modal|language|welcome|overlay', re.I))
                text = soup.get_text().lower()
                has_language_popup = any(term in text for term in [
                    'choisissez la langue', 'choose your language'])

                # Si popup détectée, utiliser Selenium
                if (popup_indicators or has_language_popup) and SELENIUM_AVAILABLE:
                    print(f"      🔍 Popup détecté, utilisation de Selenium...")
                    selenium_html = fetch_page_with_selenium(url)
                    if selenium_html:
                        return selenium_html

                # HTML valide avec requests
                return html
            else:
                # HTML trop court, essayer Selenium
                if SELENIUM_AVAILABLE:
                    print(
                        f"      ⚠️ HTML vide ou trop court ({{{{len(html) if html else 0}}}} chars), essai Selenium...")
                    selenium_html = fetch_page_with_selenium(url)
                    if selenium_html:
                        return selenium_html

        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(REQUEST_DELAY * (attempt + 1))
            else:
                # Dernière tentative : Selenium
                if SELENIUM_AVAILABLE:
                    print(f"      🔄 Erreur requests, essai Selenium...")
                    selenium_html = fetch_page_with_selenium(url)
                    if selenium_html:
                        return selenium_html
                print(
                    f"      ⚠️ Erreur lors de la récupération de {{{{url}}}}: {{{{e}}}}")
                return ""

    return ""


def extract_price(text: str) -> float:
    """Extrait un prix depuis un texte - amélioré"""
    if not text:
        return 0.0

    # Nettoyer le texte
    text_clean = text.replace(',', '').replace(' ', '').replace('$', '').replace(
        '€', '').replace('CAD', '').replace('USD', '').replace('EUR', '')

    # Patterns pour prix: $1234.56, 1234,56$, 1234.56 CAD, À partir de 12,999$, etc.
    patterns = [
        r'\$[\s]*([\d,]+\.?\d*)',
        r'([\d,]+\.?\d*)[\s]*\$',
        r'([\d,]+\.?\d*)[\s]*(?:CAD|USD|EUR|€)',
        r'à partir de[\s]*([\d,]+\.?\d*)',
        r'prix[\s]*:[\s]*([\d,]+\.?\d*)',
        r'([\d,]+\.?\d*)',
    ]

    for pattern in patterns:
        match = re.search(pattern, text_clean, re.I)
        if match:
            try:
                price_str = match.group(1).replace(',', '').replace(' ', '')
                return float(price_str)
            except (ValueError, AttributeError):
                continue

    return 0.0


def extract_year(text: str) -> int:
    """Extrait une année depuis un texte"""
    if not text:
        return 0

    # Chercher des années entre 1900 et 2100
    match = re.search(r'\b(19|20)\d{{2}}\b', text)
    if match:
        try:
            year = int(match.group(0))
            if 1900 <= year <= 2100:
                return year
        except (ValueError, AttributeError):
            pass

    return 0


def clean_text(text: str) -> str:
    """Nettoie le texte"""
    if not text:
        return ""

    # Enlever les espaces multiples
    text = re.sub(r'\s+', ' ', text)
    # Enlever les espaces en début/fin
    text = text.strip()
    # Enlever les caractères de contrôle
    text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text)

    return text


def is_in_header_nav_footer(elem) -> bool:
    """Vérifie si un élément est dans le header, nav ou footer"""
    if not elem:
        return False

    # Vérifier les parents
    parent = elem.parent
    max_depth = 10  # Limiter la profondeur de recherche
    depth = 0

    while parent and depth < max_depth:
        parent_tag = parent.name.lower() if parent.name else ''
        parent_classes = ' '.join(parent.get('class', [])).lower()
        parent_id = (parent.get('id') or '').lower()

        # Mots-clés à exclure
        exclude_keywords = ['header', 'nav', 'navbar', 'navigation',
                            'menu', 'footer', 'logo', 'site-name', 'brand']

        # Vérifier le tag
        if parent_tag in ['header', 'nav', 'footer']:
            return True

        # Vérifier les classes et id
        if any(keyword in parent_classes or keyword in parent_id for keyword in exclude_keywords):
            return True

        parent = parent.parent
        depth += 1

    # Vérifier les classes/id de l'élément lui-même
    elem_classes = ' '.join(elem.get('class', [])).lower()
    elem_id = (elem.get('id') or '').lower()
    exclude_keywords = ['header', 'nav', 'navbar', 'navigation',
                        'menu', 'footer', 'logo', 'site-name', 'brand']

    if any(keyword in elem_classes or keyword in elem_id for keyword in exclude_keywords):
        return True

    return False


def is_generic_name(name: str) -> bool:
    """Vérifie si un nom est générique (nom de site, etc.)"""
    if not name or len(name) < 5:
        return True

    name_lower = name.lower().strip()

    # Noms génériques à exclure
    generic_names = [
        'mvm motosport', 'motosport', 'accueil', 'home', 'contact', 'about',
        'nous joindre', 'a propos', 'menu', 'navigation', 'search', 'recherche',
        'login', 'connexion', 'register', 'inscription', 'cart', 'panier'
    ]

    if name_lower in generic_names:
        return True

    # Vérifier si c'est trop court ou ne contient pas d'indicateurs de produit
    if len(name_lower) < 5:
        return True

    return False


def is_label_text(text: str) -> bool:
    """Détecte si un texte ressemble à un label/placeholder (ex: 'Nom complet : *')"""
    if not text:
        return False
    t = text.strip().lower()
    label_keywords = [
        'nom complet', 'full name', 'name:', 'nom:', 'prénom', 'surname',
        'placeholder', 'label', 'requis'
    ]
    if any(k in t for k in label_keywords):
        return True
    if ':' in t or '*' in t:
        return True
    return False


def extract_product_from_html(html: str, url: str, base_url: str) -> Dict[str, Any]:
    """Extrait les informations d'un produit depuis le HTML - amélioré"""
    soup = BeautifulSoup(html, 'html.parser')
    product = {{}}

    # Extraire chaque champ avec les sélecteurs hardcodés
    # Si le sélecteur principal trouve quelque chose mais que c'est invalide, forcer les fallbacks
    name_from_selector_valid = False
    if 'name' in SELECTORS:
        name_elem = soup.select_one(SELECTORS['name'])
        if name_elem:
            # Vérifier que l'élément n'est pas dans le header/nav/footer
            if not is_in_header_nav_footer(name_elem):
                name_text = clean_text(name_elem.get_text())
                # Rejeter si c'est un label/placeholder
                if is_label_text(name_text):
                    name_text = ""
                # Valider que ce n'est pas un nom générique
                if name_text and not is_generic_name(name_text) and len(name_text) >= 5:
                    product['name'] = name_text
                    name_from_selector_valid = True

    # Forcer les fallbacks si le sélecteur principal n'a pas trouvé quelque chose de valide
    # Si le sélecteur principal a trouvé quelque chose mais que c'est invalide (label), forcer les fallbacks
    if not product.get('name') or not name_from_selector_valid:
        # Fallback: chercher dans le contenu principal (exclure header/nav/footer)
        # Prioriser les sélecteurs spécifiques aux pages de produits
        product_selectors = [
            # Sélecteurs très spécifiques (priorité haute)
            '.entry-title', '.woocommerce-product-title', '.product-title h1',
            '.product-info h1', '.product-detail h1', '.product-header h1',
            'article h1', 'article .title', '.single-product h1',
            # Sélecteurs dans conteneurs produits
            '.main h1', '.content h1', '.product h1',
            '.product-info h2', '.product-detail h2', '.product-header h2',
            '.product-title', '.product-name', '[class*="product-title"]', '[class*="product-name"]',
            '[itemprop="name"]', '[data-product-title]', '[data-name]',
            # Sélecteurs génériques (priorité basse)
            '.main .title', '.content .title', '.product-info .title',
            'h1', 'h2', '.title', '[class*="title"]', '[class*="name"]'
        ]

        for selector in product_selectors:
            elems = soup.select(selector)
            for elem in elems:
                # Exclure si dans header/nav/footer
                if is_in_header_nav_footer(elem):
                    continue

                name_text = clean_text(elem.get_text())
                # Rejeter si c'est un label/placeholder (même dans les fallbacks)
                if is_label_text(name_text):
                    continue
                # Valider que ce n'est pas un nom générique
                if name_text and not is_generic_name(name_text) and len(name_text) >= 5:
                    product['name'] = name_text
                    break

            if product.get('name'):
                break

    # PRIORISER LE PRIX ACTUEL (current-price) ET EXCLURE L'ANCIEN PRIX (old-price)
    price_from_selector_valid = False
    
    # ÉTAPE 1: Chercher d'abord le PRIX ACTUEL (priorité haute)
    current_price_selectors = [
        # Sélecteurs très spécifiques pour prix actuel (priorité maximale)
        '.current-price .value', '.current-price .number', '.current-price .price',
        '.current_price .value', '.current_price .number', '.current_price .price',
        '[class*="current-price"] .value', '[class*="current_price"] .value',
        '.price .current', '.price .current-price', '.price .current_price',
        '[data-price]', '[itemprop="price"]',  # Attributs data
        # Conteneurs avec prix actuel
        '.current-price', '.current_price', '[class*="current-price"]', '[class*="current_price"]'
    ]
    
    for selector in current_price_selectors:
        price_elem = soup.select_one(selector)
        if price_elem:
            # Exclure si dans header/nav/footer
            if not is_in_header_nav_footer(price_elem):
                # Exclure explicitement si c'est dans un conteneur old-price
                if price_elem.find_parent(class_=re.compile(r'old[-_]price', re.I)) or \
                   price_elem.find_parent('del'):
                    continue
                
                # Chercher aussi dans les enfants si c'est un conteneur
                if '.value' in selector or '.number' in selector or '.price' in selector:
                    # C'est un sélecteur spécifique, utiliser directement
                    price_text = price_elem.get_text() or price_elem.get('data-price', '') or price_elem.get('data-amount', '')
                else:
                    # C'est un conteneur, chercher .value ou .number dedans
                    value_elem = price_elem.select_one('.value, .number, [class*="number"]')
                    if value_elem:
                        price_text = value_elem.get_text()
                    else:
                        price_text = price_elem.get_text() or price_elem.get('data-price', '') or price_elem.get('data-amount', '')
                
                if price_text:
                    extracted_price = extract_price(price_text)
                    if extracted_price > 0:
                        product['prix'] = extracted_price
                        price_from_selector_valid = True
                        break
    
    # ÉTAPE 2: Si pas trouvé, utiliser le sélecteur configuré (mais exclure old-price)
    if not price_from_selector_valid and ('prix' in SELECTORS or 'price' in SELECTORS):
        price_selector = SELECTORS.get('prix') or SELECTORS.get('price')
        price_elem = soup.select_one(price_selector)
        if price_elem:
            # Exclure si dans header/nav/footer
            if not is_in_header_nav_footer(price_elem):
                # Exclure explicitement old-price
                if price_elem.find_parent(class_=re.compile(r'old[-_]price', re.I)) or \
                   price_elem.find_parent('del') or \
                   'old-price' in ' '.join(price_elem.get('class', [])).lower() or \
                   'old_price' in ' '.join(price_elem.get('class', [])).lower():
                    # C'est un ancien prix, ne pas l'utiliser
                    pass
                else:
                    price_text = price_elem.get_text() or price_elem.get('data-price', '')
                    extracted_price = extract_price(price_text)
                    if extracted_price > 0:
                        product['prix'] = extracted_price
                        price_from_selector_valid = True

    # ÉTAPE 3: Fallback général (exclure explicitement old-price)
    if not product.get('prix') or product.get('prix', 0) == 0 or not price_from_selector_valid:
        # Prioriser les sélecteurs spécifiques aux pages de produits
        price_selectors = [
            # Sélecteurs très spécifiques (priorité haute)
            '.woocommerce-price', '.woocommerce-Price-amount', '[itemprop="price"]',
            '.product-price .amount', '.product-price .price', '.product-info .price',
            '.product-detail .price', '.product-header .price',
            # Sélecteurs dans conteneurs produits
            '.main .price', '.content .price', '.product .price',
            '.product-info .prix', '.product-detail .prix', '.product-header .prix',
            '.product-info [class*="price"]', '.product-detail [class*="price"]',
            # Sélecteurs génériques (priorité basse)
            '.price', '.prix', '[class*="price"]', '[class*="prix"]', '[data-price]'
        ]

        for selector in price_selectors:
            price_elems = soup.select(selector)
            for price_elem in price_elems:
                # Exclure si dans header/nav/footer
                if is_in_header_nav_footer(price_elem):
                    continue
                
                # EXCLURE explicitement les anciens prix
                elem_classes = ' '.join(price_elem.get('class', [])).lower()
                if 'old-price' in elem_classes or 'old_price' in elem_classes:
                    continue
                if price_elem.find_parent(class_=re.compile(r'old[-_]price', re.I)) or \
                   price_elem.find_parent('del'):
                    continue
                # Exclure les éléments <del> qui contiennent généralement l'ancien prix
                if price_elem.name == 'del':
                    continue

                # Essayer plusieurs sources pour le prix
                price_text = (price_elem.get_text() or
                              price_elem.get('data-price', '') or
                              price_elem.get('data-amount', '') or
                              price_elem.get('content', ''))

                if price_text:
                    extracted_price = extract_price(price_text)
                    if extracted_price > 0:
                        product['prix'] = extracted_price
                        break

            if product.get('prix') and product.get('prix', 0) > 0:
                break

        # Chercher aussi dans les métadonnées JSON-LD
        if (not product.get('prix') or product.get('prix', 0) == 0):
            try:
                json_ld_scripts = soup.find_all(
                    'script', type='application/ld+json')
                for script in json_ld_scripts:
                    try:
                        import json
                        data = json.loads(script.string)
                        if isinstance(data, dict):
                            offers = data.get('offers', {{}})
                            if isinstance(offers, list) and len(offers) > 0:
                                offers = offers[0]
                            price = offers.get('price') if isinstance(
                                offers, dict) else None
                            if price:
                                try:
                                    price_float = float(str(price))
                                    if price_float > 0:
                                        product['prix'] = price_float
                                        break
                                except (ValueError, TypeError):
                                    pass
                    except (json.JSONDecodeError, AttributeError, TypeError):
                        continue
            except Exception:
                pass

    # Extraction de l'image - Priorité 1 : Sélecteur spécifique
    # Si le sélecteur principal trouve quelque chose mais que c'est invalide, forcer les fallbacks
    image_from_selector_valid = False
    if 'image' in SELECTORS:
        img_elem = soup.select_one(SELECTORS['image'])
        if img_elem:
            # Exclure si dans header/nav/footer
            if not is_in_header_nav_footer(img_elem):
                # Essayer plusieurs attributs pour l'image (lazy loading support)
                img_src = (img_elem.get('src') or
                           img_elem.get('data-src') or
                           img_elem.get('data-lazy-src') or
                           img_elem.get('data-original') or
                           img_elem.get('data-lazy') or
                           img_elem.get('data-image'))
                if img_src:
                    img_norm = normalize_image_url(img_src, url)
                    # Éviter les logos
                    if 'logo' not in img_norm.lower():
                        product['image'] = img_norm
                        image_from_selector_valid = True

    # Priorité 2 : Images dans des galleries ou conteneurs produits
    # Forcer les fallbacks si le sélecteur principal n'a pas trouvé quelque chose de valide
    if not product.get('image') or not image_from_selector_valid:
        # Chercher dans des galleries avec sélecteurs plus spécifiques
        gallery_selectors = [
            # Sélecteurs très spécifiques (priorité haute)
            '.woocommerce-product-gallery img', '.product-gallery img', '.image-gallery img',
            '.product-images img', '.product-photos img', 'figure img',
            '[class*="gallery"] img', '[class*="product-image"]', '[class*="product-img"]',
            '[itemprop="image"]', '[data-product-image]', '[data-image-large]',
            # Sélecteurs génériques (priorité basse)
            '.gallery img', '[class*="gallery"] img'
        ]
        for selector in gallery_selectors:
            img_elem = soup.select_one(selector)
            if img_elem:
                # Essayer plusieurs attributs pour l'image
                img_src = (img_elem.get('src') or
                           img_elem.get('data-src') or
                           img_elem.get('data-lazy-src') or
                           img_elem.get('data-original') or
                           img_elem.get('data-image') or
                           img_elem.get('data-src-large') or
                           img_elem.get('data-full-image'))
                if img_src:
                    img_norm = normalize_image_url(img_src, url)
                    # Éviter les logos même dans les fallbacks
                    if 'logo' not in img_norm.lower():
                        product['image'] = img_norm
                        break

    # Priorité 3 : Première image dans le contenu principal (exclure logos/banners)
    if not product.get('image'):
        # Mots-clés à exclure pour les images
        exclude_keywords = [
            'logo', 'logotype', 'icon', 'banner', 'ad', 'advertisement',
            'header', 'footer', 'nav', 'navigation', 'menu', 'button',
            'badge', 'badges', 'social', 'facebook', 'twitter', 'instagram',
            'placeholder', 'loading', 'spinner', 'arrow', 'chevron'
        ]

        # Chercher toutes les images, en priorisant celles dans le contenu principal
        # D'abord chercher dans les sections de contenu
        content_sections = soup.select(
            'main, article, .content, .main-content, .product-content, .entry-content')
        images_found = False

        for section in content_sections:
            if is_in_header_nav_footer(section):
                continue
            for img in section.select('img'):
                img_src = (img.get('src') or
                           img.get('data-src') or
                           img.get('data-lazy-src') or
                           img.get('data-original') or
                           img.get('data-lazy') or
                           img.get('data-image') or
                           img.get('data-src-large'))

                if not img_src:
                    continue

                img_src_lower = img_src.lower()

                # Exclure si c'est un logo/banner/etc.
                if any(skip in img_src_lower for skip in exclude_keywords):
                    continue

                # Exclure les images trop petites (probablement des icônes)
                width = img.get('width')
                height = img.get('height')
                if width and height:
                    try:
                        if int(width) < 100 or int(height) < 100:
                            continue
                    except (ValueError, TypeError):
                        pass

                # Vérifier les classes CSS de l'image
                img_classes = ' '.join(img.get('class', [])).lower()
                if any(skip in img_classes for skip in exclude_keywords):
                    continue

                # Image valide trouvée
                product['image'] = normalize_image_url(img_src, url)
                images_found = True
                break

            if images_found:
                break

        # Si aucune image trouvée dans les sections de contenu, chercher partout
        if not product.get('image'):
            for img in soup.select('img'):
                # Exclure si dans header/nav/footer
                if is_in_header_nav_footer(img):
                    continue

                img_src = (img.get('src') or
                           img.get('data-src') or
                           img.get('data-lazy-src') or
                           img.get('data-original') or
                           img.get('data-lazy') or
                           img.get('data-image'))

                if not img_src:
                    continue

                img_src_lower = img_src.lower()

                # Exclure si c'est un logo/banner/etc.
                if any(skip in img_src_lower for skip in exclude_keywords):
                    continue

                # Exclure les images trop petites (probablement des icônes)
                width = img.get('width')
                height = img.get('height')
                if width and height:
                    try:
                        if int(width) < 100 or int(height) < 100:
                            continue
                    except (ValueError, TypeError):
                        pass

                # Vérifier les classes CSS de l'image
                img_classes = ' '.join(img.get('class', [])).lower()
                if any(skip in img_classes for skip in exclude_keywords):
                    continue

                # Image valide trouvée
                product['image'] = normalize_image_url(img_src, url)
                break

    # Description désactivée - non nécessaire pour l'utilisateur
    # if 'description' in SELECTORS:
    #     desc_elem = soup.select_one(SELECTORS['description'])
    #     if desc_elem:
    #         product['description'] = clean_text(desc_elem.get_text()[:500])
    #
    # # Fallback pour description
    # if not product.get('description'):
    #     for desc_tag in ['.description', '[class*="description"]', '[class*="content"]']:
    #         desc_elem = soup.select_one(desc_tag)
    #         if desc_elem:
    #             product['description'] = clean_text(desc_elem.get_text()[:500])
    #             break

    # Extraire marque et modèle depuis le nom - amélioré
    name = product.get('name', '')
    if name:
        # Patterns communs améliorés
        brand_patterns = [
            r'^(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson|Ski-Doo|Sea-Doo|CFMoto|Triumph|Kawasaki|Husqvarna|Beta|Sherco|GasGas|TM|Aprilia|Moto Guzzi|Vespa|Piaggio)',
            r'\b(Kawasaki|Honda|Yamaha|Suzuki|Arctic Cat|Polaris|Can-Am|BRP|KTM|Ducati|BMW|Harley-Davidson|Ski-Doo|Sea-Doo|CFMoto|Triumph|Kawasaki|Husqvarna|Beta|Sherco|GasGas|TM|Aprilia|Moto Guzzi|Vespa|Piaggio)\b'
        ]
        for pattern in brand_patterns:
            match = re.search(pattern, name, re.I)
            if match:
                product['marque'] = match.group(1)
                # Modèle = reste du nom après la marque
                model = name.replace(match.group(1), '').strip()
                if model:
                    # Prendre les premiers mots comme modèle
                    model_words = model.split()
                    product['modele'] = ' '.join(model_words[:3]) if len(
                        model_words) > 3 else model[:50]
                break

    # Extraire année (sans description)
    year = extract_year(name)
    if year:
        product['annee'] = year

    # Catégorie (détection améliorée - sans description)
    url_lower = url.lower()
    name_lower = name.lower()
    combined = url_lower + ' ' + name_lower

    if any(x in combined for x in ['moto', 'motorcycle', 'motocyclette', 'bike']):
        product['category'] = 'moto'
    elif any(x in combined for x in ['motoneige', 'snowmobile', 'snow mobile']):
        product['category'] = 'motoneige'
    elif any(x in combined for x in ['motocross', 'mx', 'cross']):
        product['category'] = 'motocross'
    elif any(x in combined for x in ['vtt', 'atv', 'quad', 'four wheeler']):
        product['category'] = 'quad'
    elif any(x in combined for x in ['cote-a-cote', 'side-by-side', 'sxs', 'side by side', 'utv']):
        product['category'] = 'side-by-side'
    elif any(x in combined for x in ['scooter', 'scoot']):
        product['category'] = 'scooter'
    else:
        product['category'] = 'autre'

    # Champs requis
    product['sourceUrl'] = url
    product['sourceSite'] = base_url
    # Détection basée sur URL si possible
    product['sourceCategorie'] = 'inventaire'
    if any(x in url.lower() for x in ['occasion', 'used', 'usagé']):
        product['sourceCategorie'] = 'vehicules_occasion'
    elif any(x in url.lower() for x in ['catalogue', 'catalog']):
        product['sourceCategorie'] = 'catalogue'

    product['disponibilite'] = 'en_stock'  # Par défaut
    # Détection basique de disponibilité (sans description)
    if name:
        name_lower = name.lower()
        if any(term in name_lower for term in ['epuise', 'sold out', 'out of stock', 'indisponible']):
            product['disponibilite'] = 'epuise'
        elif any(term in name_lower for term in ['sur commande', 'on order', 'pre-order']):
            product['disponibilite'] = 'sur_commande'

    if not product.get('prix'):
        product['prix'] = 0.0

    return product


def filter_valid_products(products: List[Dict]) -> List[Dict]:
    """Filtre les produits pour ne garder que les véhicules réels"""
    if not products:
        return []

    # Mots-clés à exclure (catégories génériques, liens de navigation)
    invalid_keywords = [
        'catalogue', 'catalogues', 'inventaire', 'inventory',
        'contact', 'nous joindre', 'about', 'à propos', 'a propos',
        'accueil', 'home', 'menu', 'navigation', 'nav',
        'marque', 'brand', 'modèle', 'model',
        'catégorie', 'category', 'gamme', 'range',
        'promotion', 'promotions', 'nouveauté', 'nouveautés',
        'service', 'services', 'garantie', 'warranty',
        'financement', 'financing', 'location', 'rental'
    ]

    valid_products = []
    for product in products:
        name = str(product.get('name', '')).strip().lower()
        marque = str(product.get('marque', '')).strip().lower()
        modele = str(product.get('modele', '')).strip().lower()

        # Exclure si le nom est vide ou trop court
        if not name or len(name) < 3:
            continue

        # Exclure si le nom correspond à un mot-clé invalide
        if any(keyword in name for keyword in invalid_keywords):
            continue

        # Exclure si c'est juste "marque" ou "modèle" sans valeur réelle
        if name in ['marque', 'modèle', 'model', 'brand']:
            continue

        # Un produit valide doit avoir au moins une marque OU un modèle spécifique
        has_valid_marque = marque and marque not in [
            '-', '', 'marque', 'brand', 'modèle', 'model']
        has_valid_modele = modele and modele not in [
            '-', '', 'marque', 'brand', 'modèle', 'model']

        # Si ni marque ni modèle valide, mais le nom contient des mots qui ressemblent à une catégorie
        if not has_valid_marque and not has_valid_modele:
            if any(cat_word in name for cat_word in ['catalogue', 'inventaire', 'gamme', 'sélection']):
                continue

        # Produit valide
        valid_products.append(product)

    return valid_products


def scrape_single_url(product_url: str, base_url: str, index: int, total: int) -> Optional[Dict[str, Any]]:
    """Scrape une seule URL - fonction pour le threading"""
    # Créer une session par thread (thread-safe)
    session = requests.Session()
    session.headers.update({{
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }})

    try:
        print(f"   [{{{{index}}}}/{{{{total}}}}] Extraction: {{{{product_url[:80]}}}}...")

        # Récupérer le HTML (avec fallback Selenium automatique)
        html = get_html(product_url, session, base_url)

        if not html:
            print(f"      ❌ Impossible de récupérer le HTML")
            return None

        # Extraire le produit
        product = extract_product_from_html(html, product_url, base_url)

        # Valider que le produit a au moins un nom
        if product.get('name') and len(product['name']) >= 3:
            print(f"      ✅ {{{{product.get('name', 'Unknown')[:50]}}}}")
            return product
        else:
            print(f"      ⚠️ Produit invalide (nom manquant ou trop court)")
            return None

    except Exception as e:
        print(f"      ❌ Erreur: {{{{e}}}}")
        return None


def scrape(base_url: str) -> Dict[str, Any]:
    """
    Scraper autonome complet - fonctionne sans Gemini
    Utilise les URLs et sélecteurs hardcodés
    Support Selenium pour les pages nécessitant JavaScript

    Args:
        base_url: URL de base du site

    Returns:
        Dictionnaire avec companyInfo et products
    """
    print(f"\\n{{{{'='*60}}}}")
    print(f"🚀 EXÉCUTION DU SCRAPER AUTONOME")
    print(f"{{{{'='*60}}}}")
    print(f"🌐 Site: {{{{base_url}}}}")
    print(f"📋 URLs de produits: {{{{len(PRODUCT_URLS)}}}}")
    if SELENIUM_AVAILABLE:
        print(f"🤖 Selenium disponible (fallback automatique)")
    else:
        print(f"⚠️ Selenium non disponible (requests uniquement)")
    print()

    # Filtrer les URLs invalides (pages non-produits)
    def is_valid_product_url(url: str) -> bool:
        """Valide qu'une URL est une page de produit d'inventaire (pas de catalogue)"""
        url_lower = url.lower()
        
        # EXCLURE explicitement les URLs de catalogue
        if 'catalogue' in url_lower or 'catalog' in url_lower:
            return False
        
        exclude_segments = [
            '/catalogue', '/catalog',  # URLs de catalogue (déjà vérifié ci-dessus mais ajout pour sécurité)
            '/service', '/service-', '/services', '/sav',
            '/article', '/articles', '/blog', '/blogs',
            '/conseil', '/conseils', '/guide', '/guides',
            '/formation', '/formations', '/evenement', '/evenements',
            '/contact', '/about', '/a-propos', '/nous-joindre',
            '/politique', '/privacy', '/cgv', '/mentions-legales',
            '/cart', '/panier', '/checkout', '/paiement',
            '/login', '/connexion', '/register', '/inscription',
            '/account', '/compte', '/search', '/recherche',
            '/faq', '/aide', '/help', '/assistance',
            '/entretien', '/reparation', '/reparations', '/maintenance',
            '/tutoriel', '/tutoriels', '/news', '/actualite', '/actualites',
            '/event', '/events', '/ouverture', '/invitation'
        ]
        for exclude_segment in exclude_segments:
            if exclude_segment in url_lower:
                # Exception pour promotions de produits
                if 'promo' in exclude_segment or 'promotion' in exclude_segment:
                    product_indicators = [
                        'moto', 'vehicule', 'inventaire', 'vendre', 'a-vendre']
                    if any(indicator in url_lower for indicator in product_indicators):
                        continue
                return False
        
        # INDIQUEURS pour pages d'INVENTAIRE (pas de catalogue)
        # Prioriser les mots-clés d'inventaire/vente
        inventory_indicators = [
            'inventaire', 'inventory', 'vendre', 'a-vendre', 'a-vendre-',
            'stock', 'en-stock', 'disponible'
        ]
        has_inventory_indicator = any(
            indicator in url_lower for indicator in inventory_indicators)
        
        # Indicateurs généraux de produits (fallback si pas d'indicateur d'inventaire spécifique)
        product_indicators = [
            'moto', 'motorcycle', 'motocyclette', 'vehicule', 'vehicle',
            'quad', 'atv', 'vtt', 'motoneige', 'snowmobile',
            'cote-a-cote', 'side-by-side', 'sxs', 'utv',
            'produit', 'product', 'detail', 'details', 'fiche'
        ]
        has_product_indicator = any(
            indicator in url_lower for indicator in product_indicators)
        
        # Prioriser les indicateurs d'inventaire
        has_valid_indicator = has_inventory_indicator or has_product_indicator
        
        has_structured_format = (
            any(char.isdigit() for char in url.split('/')[-1]) or
            len(url.split('/')) >= 4 or
            any(part.isdigit() for part in url.split('/') if len(part) > 3)
        )
        return has_valid_indicator and has_structured_format

    # Filtrer les URLs valides
    valid_urls = []
    excluded_urls = []
    for url in PRODUCT_URLS:
        if is_valid_product_url(url):
            valid_urls.append(url)
        else:
            excluded_urls.append(url)

    if excluded_urls:
        print(f"🚫 {{{{len(excluded_urls)}}}} URL(s) exclue(s) (pages non-produits):")
        for excluded_url in excluded_urls[:5]:
            print(f"   - {{{{excluded_url[:80]}}}}...")
        if len(excluded_urls) > 5:
            print(f"   ... et {{{{len(excluded_urls) - 5}}}} autres")
        print()

    if not valid_urls:
        print(f"❌ Aucune URL de produit valide trouvée!")
        return {{'companyInfo': {{}}, 'products': []}}

    print(f"✅ {{{{len(valid_urls)}}}} URL(s) de produits valides à scraper\\n")

    # Extraire les produits depuis chaque URL (PARALLÈLE)
    products = []
    requests_count = 0
    selenium_count = 0
    errors_count = 0

    print(f"🚀 Démarrage du scraping parallèle ({{{{MAX_WORKERS}}}} threads)...\\n")

    # Utiliser ThreadPoolExecutor pour le parallélisme
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Soumettre toutes les tâches et créer un mapping future -> url
        future_to_url = dict()
        for i, url in enumerate(valid_urls):
            future = executor.submit(
                scrape_single_url,
                url,
                base_url,
                i+1,
                len(valid_urls)
            )
            future_to_url[future] = url

        # Traiter les résultats au fur et à mesure
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            try:
                product = future.result()
                if product:
                    products.append(product)
                    # Compter la méthode utilisée (approximation basée sur la taille du HTML)
                    # Les produits avec Selenium ont souvent plus de données
                    if product.get('image') and len(product.get('image', '')) > 50:
                        selenium_count += 1
                    else:
                        requests_count += 1
                else:
                    errors_count += 1
            except Exception as e:
                print(f"      ❌ Erreur pour {{{{url[:80]}}}}: {{{{e}}}}")
                errors_count += 1

    # Filtrer les produits valides
    print(f"\\n🔍 Filtrage des produits valides...")
    valid_products = filter_valid_products(products)
    filtered_count = len(products) - len(valid_products)

    if filtered_count > 0:
        print(
            f"   🚫 {{{{filtered_count}}}} produit(s) exclu(s) (catégories génériques)")

    print(
        f"\\n✅ {{{{len(valid_products)}}}} produits valides extraits sur {{{{len(valid_urls)}}}} URLs")
    print(
        f"   📊 Stats: Requests: ~{{{{requests_count}}}}, Selenium: ~{{{{selenium_count}}}}, Erreurs: {{{{errors_count}}}}")

    return {{
        'companyInfo': {{}},
        'products': valid_products
    }}


# Point d'entrée si exécuté directement
if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print("Usage: python scraper_template.py <base_url>")
        sys.exit(1)

    base_url = sys.argv[1].rstrip('/')
    result = scrape(base_url)

    print(f"\\n📊 Résultat:")
    print(f"   - Produits: {{{{len(result.get('products', []))}}}}")
    print(f"   - CompanyInfo: {{{{bool(result.get('companyInfo', {{{{}}}}))}}}}")
