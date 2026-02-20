"""
Scraper Python généré automatiquement pour {site_url}
Ce script est complètement autonome et ne nécessite pas Gemini
Amélioré avec support Selenium pour les pages nécessitant JavaScript
"""
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import re
import json
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
        normalized = f"{{parsed.scheme}}://{{parsed.netloc}}{{parsed.path}}"
        if parsed.query:
            normalized += f"?{{parsed.query}}"
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
        print(f"      🤖 Utilisation de Selenium pour {{url[:60]}}...")

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
            print(f"      ⚠️ Impossible de lancer Chrome: {{e}}")
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
            f"      ✅ HTML récupéré avec Selenium ({{len(html)}} caractères)")
        return html

    except Exception as e:
        print(f"      ❌ Erreur Selenium: {{e}}")
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

            # Détecter les redirections (véhicule vendu → page listing)
            final_url = response.url
            if final_url != url:
                original_path = urlparse(url).path.rstrip('/')
                redirect_path = urlparse(final_url).path.rstrip('/')
                # Si redirigé vers une page plus courte (listing au lieu de détail)
                if len(redirect_path) < len(original_path) * 0.6:
                    return ""

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
                        f"      ⚠️ HTML vide ou trop court ({{len(html) if html else 0}} chars), essai Selenium...")
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
                    f"      ⚠️ Erreur lors de la récupération de {{url}}: {{e}}")
                return ""

    return ""


def split_concatenated_price(price_str: str) -> float:
    """Découpe un prix aberrant qui est en fait deux prix concaténés.

    Exemple: "113308995" → "11330" + "8995" → retourne 8995 (le prix actuel/dernier)

    Logique: Le prix actuel est généralement le DERNIER dans la concaténation.
    On essaie différents points de découpe et on prend le MEILLEUR:
    - Les deux parties doivent être des prix valides (1000-99999 typiquement)
    - On préfère les découpages où les deux prix sont similaires en magnitude
    - On prend le DERNIER prix (prix actuel)
    """
    if not price_str or not price_str.isdigit():
        return 0.0

    price_len = len(price_str)

    # Collecter tous les découpages valides
    valid_splits = []

    # Essayer différents points de découpe
    # Au moins 3 chiffres de chaque côté
    for split_point in range(3, price_len - 2):
        first_part = price_str[:split_point]
        second_part = price_str[split_point:]

        # Ignorer si le second part commence par 0 (pas un prix valide)
        if second_part.startswith('0'):
            continue

        try:
            first_price = float(first_part)
            second_price = float(second_part)

            # Les deux prix doivent être valides pour des véhicules
            # Prix typiques: 500$ à 200000$ (motos haut de gamme, side-by-side, etc.)
            if 500 <= first_price <= 200000 and 500 <= second_price <= 200000:
                # Calculer un score basé sur la similarité des prix
                # Les anciens et nouveaux prix sont généralement proches
                ratio = min(first_price, second_price) / \
                    max(first_price, second_price)
                # Bonus si les deux parties ont des longueurs similaires
                len_diff = abs(len(first_part) - len(second_part))
                # Pénaliser les grandes différences de longueur
                score = ratio - (len_diff * 0.1)

                valid_splits.append((score, first_price, second_price))

        except ValueError:
            continue

    if not valid_splits:
        # Essayer avec une plage de prix plus large
        for split_point in range(3, price_len - 2):
            first_part = price_str[:split_point]
            second_part = price_str[split_point:]

            if second_part.startswith('0'):
                continue

            try:
                first_price = float(first_part)
                second_price = float(second_part)

                if 100 <= first_price <= 300000 and 100 <= second_price <= 300000:
                    ratio = min(first_price, second_price) / \
                        max(first_price, second_price)
                    len_diff = abs(len(first_part) - len(second_part))
                    score = ratio - (len_diff * 0.1)
                    valid_splits.append((score, first_price, second_price))

            except ValueError:
                continue

    if valid_splits:
        # Trier par score (meilleur en premier)
        valid_splits.sort(key=lambda x: x[0], reverse=True)
        # Retourner le DERNIER prix (prix actuel) du meilleur découpage
        return valid_splits[0][2]

    return 0.0


def extract_price(text: str) -> float:
    """Extrait un prix depuis un texte - ROBUSTE avec validation stricte

    Valide que le prix est réaliste pour un véhicule (motos, quads, motoneiges):
    - Prix minimum: 100$ (aucun véhicule ne coûte moins)
    - Prix maximum: 500,000$ (même les véhicules de luxe ne dépassent pas ça)
    - Exclure: timestamps Unix, numéros de téléphone, codes produit, dates

    IMPORTANT: Gère le cas où plusieurs prix sont concaténés (ancien + nouveau prix)
    """
    if not text:
        return 0.0

    text_original = text.strip()

    # ============================================================
    # DÉTECTION DE PRIX MULTIPLES CONCATÉNÉS
    # Ex: "14 694 $11 995 $" → prendre le dernier (prix actuel)
    # ============================================================

    # Si le texte contient plusieurs symboles $ ou €, extraire chaque prix séparément
    dollar_count = text_original.count('$')
    euro_count = text_original.count('€')

    if dollar_count > 1 or euro_count > 1:
        # Il y a plusieurs prix - extraire tous les prix individuels
        # Pattern: nombre suivi de $ ou € (ou précédé par $ ou €)
        all_prices = []

        # Pattern pour prix avec $ ou €
        multi_price_patterns = [
            r'\$[\s]*([\d,\s]+(?:\.\d{{1,2}})?)',          # $12,999
            r'([\d,\s]+(?:\.\d{{1,2}})?)[\s]*\$',          # 12,999$
            r'€[\s]*([\d,\s]+(?:,\d{{1,2}})?)',            # €12,999
            r'([\d,\s]+(?:,\d{{1,2}})?)[\s]*€',            # 12,999€
        ]

        for pattern in multi_price_patterns:
            matches = re.findall(pattern, text_original, re.I)
            for match in matches:
                try:
                    price_str = match.replace(',', '').replace(
                        ' ', '').replace('$', '').replace('€', '')
                    price_float = float(price_str)
                    if 50 <= price_float <= 1000000:
                        all_prices.append(price_float)
                except (ValueError, AttributeError):
                    continue

        if all_prices:
            # Prendre le DERNIER prix (généralement le prix actuel/promo)
            return all_prices[-1]

    # ============================================================
    # PRÉ-VALIDATION: Rejeter les textes qui ne sont clairement pas des prix
    # ============================================================

    # Si le texte contient des indicateurs de non-prix, ignorer
    non_price_indicators = [
        'tel', 'phone', 'fax', 'mobile', 'cell',  # Numéros de téléphone
        'sku', 'ref', 'code', 'id', 'num', '#',    # Codes produit
        'date', 'time', 'heure',                   # Dates/heures
        'km', 'kilomètre', 'mile',                 # Kilométrage (pas un prix)
        'cc', 'cm3', 'cylindrée',                  # Cylindrée (pas un prix)
        'année', 'year', 'an',                     # Année (pas un prix)
        'hp', 'cv', 'puissance',                   # Puissance (pas un prix)
    ]

    text_lower = text_original.lower()
    if any(ind in text_lower for ind in non_price_indicators):
        # Mais permettre si $ ou € est présent (c'est quand même un prix)
        if '$' not in text_original and '€' not in text_original:
            return 0.0

    # Nettoyer pour le matching
    text_clean = text_original.replace(' ', '')

    # ============================================================
    # PATTERNS pour extraire le prix
    # Ordre: patterns plus spécifiques d'abord
    # ============================================================

    patterns = [
        # Prix avec symbole monétaire (PRIORITÉ HAUTE)
        r'\$[\s]*([\d,\s]+(?:\.\d{{1,2}})?)',          # $12,999 ou $12,999.00
        r'([\d,\s]+(?:\.\d{{1,2}})?)[\s]*\$',          # 12,999$ ou 12,999.00$
        r'([\d,\s]+(?:,\d{{1,2}})?)[\s]*(?:CAD|USD)',  # 12999 CAD
        r'€[\s]*([\d,\s]+(?:,\d{{1,2}})?)',            # €12.999,00 (format EU)
        r'([\d,\s]+(?:,\d{{1,2}})?)[\s]*€',            # 12.999,00€

        # Prix avec contexte (PRIORITÉ MOYENNE)
        r'(?:prix|price|à partir de|starting at|from)[\s:]*\$?([\d,\s]+(?:[\.,]\d{{1,2}})?)',
        r'(?:msrp|pdsf)[\s:]*\$?([\d,\s]+(?:[\.,]\d{{1,2}})?)',

        # Nombre seul (PRIORITÉ BASSE - utilisé seulement si contexte de prix clair)
        # Ne pas utiliser ce pattern car il peut matcher n'importe quoi
    ]

    for pattern in patterns:
        match = re.search(pattern, text_clean, re.I)
        if match:
            try:
                price_str = match.group(1).replace(',', '').replace(
                    ' ', '').replace('$', '').replace('€', '')

                # Gérer le format européen (virgule comme séparateur décimal)
                if ',' in match.group(1) and '.' not in match.group(1):
                    # Vérifier si c'est format européen 12.999,00 ou milliers 12,999
                    if re.search(r',\d{{2}}$', match.group(1)):
                        # C'est un format européen avec décimales
                        price_str = price_str.replace(',', '.')

                price_float = float(price_str)
                digits_only = re.sub(r'[^\d]', '', price_str)

                # ============================================================
                # VALIDATION STRICTE DU PRIX
                # ============================================================

                # 1. Timestamp Unix detection (10 chiffres commençant par 1)
                # Les timestamps Unix actuels sont autour de 1700000000 (2023)
                if price_float >= 1000000000:  # 1 milliard+ = timestamp
                    # Essayer de découper en deux prix
                    split_price = split_concatenated_price(digits_only)
                    if split_price > 0:
                        return split_price
                    continue

                # 2. Prix irréalistes pour véhicules (> 300k mais < 1 milliard)
                # Ce sont probablement deux prix concaténés
                if price_float > 300000:  # Plus de 300k$ = probablement deux prix collés
                    # Essayer de découper en deux prix
                    split_price = split_concatenated_price(digits_only)
                    if split_price > 0:
                        return split_price
                    # Si le découpage échoue et c'est > 500k, rejeter
                    if price_float > 500000:
                        continue

                # 3. Prix trop bas — ne rejeter que les prix < 1$ (arrondi / erreur)
                # Même les accessoires ou petits véhicules doivent être inclus
                if price_float < 1:
                    continue

                # 4. Détection de timestamps plus récents ou anciens
                # Timestamp 2020 = 1577836800, Timestamp 2030 = 1893456000
                if 1500000000 <= price_float <= 2000000000:
                    # Essayer de découper en deux prix
                    split_price = split_concatenated_price(digits_only)
                    if split_price > 0:
                        return split_price
                    continue  # C'est un timestamp Unix

                # 5. Nombre de chiffres trop élevé (8+ sans décimale = suspect)
                if len(digits_only) >= 8:  # 8 chiffres ou plus = probablement deux prix collés
                    # Essayer de découper
                    split_price = split_concatenated_price(digits_only)
                    if split_price > 0:
                        return split_price
                    if len(digits_only) >= 9:  # 9+ = timestamp, rejeter
                        continue

                # 6. Pattern timestamp: commence par 1 suivi de 9 chiffres
                if re.match(r'^1\d{{9}}', digits_only):
                    continue

                # 7. Pattern numéro de téléphone: 10 chiffres exactement
                if len(digits_only) == 10 and digits_only.startswith(('1', '2', '3', '4', '5', '6', '7', '8', '9')):
                    # Pourrait être un numéro de téléphone, vérifier le contexte
                    if '$' not in text_original and '€' not in text_original:
                        continue

                # Prix valide trouvé !
                return price_float

            except (ValueError, AttributeError):
                continue

    # ============================================================
    # FALLBACK: Chercher un nombre simple avec contexte monétaire
    # ============================================================

    # Seulement si $ ou € est présent dans le texte original
    if '$' in text_original or '€' in text_original:
        # Extraire le premier nombre raisonnable
        numbers = re.findall(r'[\d,]+(?:\.\d{{2}})?', text_clean)
        for num_str in numbers:
            try:
                num = float(num_str.replace(',', ''))
                if 50 <= num <= 1000000:
                    return num
            except ValueError:
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


def normalize_text_for_comparison(text: str) -> str:
    """Normalise un texte pour comparaison (supprime accents, espaces multiples)"""
    import unicodedata
    if not text:
        return ""
    # Normaliser les accents
    normalized = unicodedata.normalize('NFD', text)
    # Supprimer les caractères diacritiques (accents)
    ascii_text = ''.join(
        c for c in normalized if unicodedata.category(c) != 'Mn')
    # Minuscules et strip
    return ascii_text.lower().strip()


def is_generic_name(name: str) -> bool:
    """Vérifie si un nom est générique (nom de site, tabs, navigation, etc.)

    IMPORTANT: Cette fonction doit être TRÈS stricte pour éviter d'extraire
    des textes de navigation comme noms de produits.
    """
    if not name:
        return True

    name_stripped = name.strip()

    # Trop court = générique (noms de produits ont généralement > 10 caractères)
    if len(name_stripped) < 6:
        return True

    name_lower = name_stripped.lower()
    name_normalized = normalize_text_for_comparison(name_stripped)

    # ============================================================
    # LISTE EXHAUSTIVE DES NOMS GÉNÉRIQUES À EXCLURE
    # ============================================================

    # CORRESPONDANCE EXACTE (le nom complet doit correspondre)
    exact_generic_names = [
        # Navigation générale
        'accueil', 'home', 'contact', 'about', 'menu', 'navigation',
        'search', 'recherche', 'login', 'connexion', 'register', 'inscription',
        'cart', 'panier', 'checkout', 'paiement', 'compte', 'account',
        'nous joindre', 'a propos', 'à propos', 'qui sommes-nous',
        # Tabs de page produit (TRÈS IMPORTANT)
        'apercu', 'aperçu', 'overview', 'preview', 'résumé', 'resume', 'summary',
        'specifications', 'spécifications', 'spec', 'specs', 'fiche technique',
        'promotion', 'promotions', 'promo', 'promos', 'offre', 'offres', 'offer', 'offers',
        'description', 'descriptions', 'détails', 'details', 'detail', 'détail',
        'caracteristiques', 'caractéristiques', 'features', 'feature',
        'avis', 'avis clients', 'reviews', 'review', 'commentaires', 'comments', 'témoignages',
        'garantie', 'warranty', 'garanties', 'warranties',
        'livraison', 'shipping', 'delivery', 'expédition', 'expedition',
        'retours', 'returns', 'return', 'retour', 'remboursement',
        'faq', 'aide', 'help', 'support', 'assistance',
        # Boutons / Actions
        'voir plus', 'see more', 'read more', 'lire plus', 'en savoir plus', 'learn more',
        'ajouter au panier', 'add to cart', 'acheter', 'buy now', 'commander', 'order',
        'ajouter', 'add', 'supprimer', 'remove', 'modifier', 'edit', 'update',
        # Statuts stock
        'en stock', 'in stock', 'disponible', 'available', 'dispo',
        'épuisé', 'epuise', 'sold out', 'out of stock', 'indisponible', 'unavailable',
        'sur commande', 'on order', 'pre-order', 'précommande', 'precommande',
        # Labels génériques
        'nouveau', 'new', 'nouveauté', 'nouveaute', 'nouveautés',
        'sale', 'solde', 'soldes', 'rabais', 'discount', 'reduction', 'réduction',
        'populaire', 'popular', 'best seller', 'meilleure vente', 'top vente',
        'vedette', 'featured', 'recommandé', 'recommande', 'recommended',
        # Noms de sites (à compléter selon les sites scrapés)
        'mvm motosport', 'motosport', 'laval moto', 'rpm moto', 'grégoire sport',
        # Autres génériques
        'prix', 'price', 'tarif', 'cout', 'coût', 'cost',
        'image', 'photo', 'gallery', 'galerie', 'photos', 'images',
        'video', 'vidéo', 'videos', 'vidéos',
        'info', 'information', 'informations', 'infos',
        'options', 'option', 'accessoires', 'accessories', 'accessoire',
        'couleur', 'color', 'colour', 'couleurs', 'colors',
        'taille', 'size', 'sizes', 'tailles',
        'quantité', 'quantity', 'qty', 'qté',
        'total', 'sous-total', 'subtotal', 'montant',
        'filtre', 'filter', 'filtres', 'filters', 'trier', 'sort', 'tri',
        'catégorie', 'categorie', 'category', 'catégories', 'categories',
        'marque', 'brand', 'marques', 'brands', 'fabricant', 'manufacturer',
        'modèle', 'modele', 'model', 'modèles', 'models',
        'année', 'annee', 'year', 'années', 'years',
        'type', 'types', 'gamme', 'range', 'série', 'serie', 'series',
        'inventaire', 'inventory', 'catalogue', 'catalog',
        'financement', 'financing', 'finance', 'crédit', 'credit',
        'service', 'services', 'entretien', 'maintenance', 'réparation', 'repair',
        'pièces', 'pieces', 'parts', 'part', 'pièce',
        'vêtements', 'vetements', 'clothing', 'clothes', 'apparel',
        'équipement', 'equipement', 'equipment', 'gear',
    ]

    # Normaliser et vérifier correspondance exacte
    exact_generic_normalized = [
        normalize_text_for_comparison(n) for n in exact_generic_names]
    if name_normalized in exact_generic_normalized:
        return True

    # Vérifier aussi la version non-normalisée
    if name_lower in [n.lower() for n in exact_generic_names]:
        return True

    # ============================================================
    # CORRESPONDANCE PARTIELLE (le nom CONTIENT un terme générique)
    # Utilisé pour des mots qui ne devraient JAMAIS être dans un nom de produit
    # ============================================================

    partial_generic_keywords = [
        # Ces mots indiquent clairement que ce n'est PAS un nom de produit
        'cliquez', 'click', 'tapez', 'tap', 'appuyez', 'press',
        'sélectionnez', 'selectionner', 'select', 'choisir', 'choose',
        'télécharger', 'download', 'upload', 'imprimer', 'print',
        'partager', 'share', 'envoyer', 'send', 'email', 'courriel',
        'suivez-nous', 'follow us', 'abonnez', 'subscribe', 'newsletter',
        'cookie', 'cookies', 'confidentialité', 'privacy', 'politique',
        'conditions', 'terms', 'cgv', 'cgu', 'legal', 'légal',
        'copyright', 'droits', 'rights', 'réservés', 'reserved',
        '©', '®', '™',
        # Mots de navigation/UI
        'précédent', 'previous', 'suivant', 'next', 'retour', 'back',
        'fermer', 'close', 'ouvrir', 'open', 'voir tout', 'view all',
        'plus d\'infos', 'more info', 'détails complets', 'full details',
    ]

    for keyword in partial_generic_keywords:
        if keyword in name_lower or keyword in name_normalized:
            return True

    # ============================================================
    # PATTERNS REGEX POUR DÉTECTER LES NOMS GÉNÉRIQUES
    # ============================================================

    generic_patterns = [
        # Tout texte qui ressemble à une action/bouton
        r'^(voir|view|show|afficher|display|get|obtenir)\s+',
        r'\s+(maintenant|now|ici|here|today|aujourd)$',
        # Texte avec des caractères de formulaire
        r'[:*]\s*$',  # Se termine par : ou *
        r'^\s*[:*]',  # Commence par : ou *
        # Texte qui est juste un prix
        r'^\$?\d+[\s,.]?\d*\s*\$?$',
        # Texte qui est juste une date
        r'^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$',
        # Texte trop long (probablement une description, pas un nom)
        r'.{150,}',  # Plus de 150 caractères = probablement une description
    ]

    for pattern in generic_patterns:
        if re.search(pattern, name_lower, re.I):
            return True

    # ============================================================
    # VALIDATION POSITIVE: Un vrai nom de produit doit avoir certaines caractéristiques
    # ============================================================

    # Si le texte contient UNIQUEMENT des mots génériques communs, c'est suspect
    common_words_only = all(
        word in ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou',
                 'en', 'à', 'au', 'aux', 'ce', 'cette', 'ces', 'mon', 'ma', 'mes',
                 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre', 'votre', 'leur',
                 'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with']
        for word in name_lower.split() if len(word) > 1
    )
    if common_words_only and len(name_stripped.split()) <= 3:
        return True

    # Le nom semble valide
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


def is_tab_or_button_element(elem) -> bool:
    """Vérifie si un élément est un bouton, tab, ou élément de navigation

    TRÈS IMPORTANT pour éviter d'extraire des textes de tabs/navigation comme noms de produits.
    Cette fonction doit être STRICTE.
    """
    if not elem:
        return False

    # ============================================================
    # VÉRIFICATION DU TAG DE L'ÉLÉMENT LUI-MÊME
    # ============================================================

    tag_name = elem.name.lower() if elem.name else ''
    elem_classes = ' '.join(elem.get('class', [])).lower()
    elem_id = (elem.get('id') or '').lower()
    elem_role = (elem.get('role') or '').lower()
    elem_data_toggle = (elem.get('data-toggle') or '').lower()
    elem_data_bs_toggle = (elem.get('data-bs-toggle') or '').lower()
    elem_aria_selected = elem.get('aria-selected')
    elem_aria_controls = elem.get('aria-controls')
    elem_href = (elem.get('href') or '').lower()

    # Tags qui sont presque toujours des éléments UI
    ui_tags = ['button', 'label', 'summary']
    if tag_name in ui_tags:
        return True

    # Mots-clés indiquant un élément UI/navigation
    ui_keywords = [
        # Tabs
        'tab', 'tabs', 'tab-', '-tab', 'tablist', 'tab_', '_tab',
        'tabpanel', 'tab-pane', 'tabcontent', 'tab-content',
        # Navigation
        'nav', 'navbar', 'navigation', 'menu', 'menuitem', 'submenu',
        'breadcrumb', 'pagination', 'pager',
        # Boutons
        'btn', 'button', 'cta', 'action', 'submit', 'cancel',
        # Accordéon/Collapse
        'accordion', 'collapse', 'collapsible', 'expandable', 'toggle',
        'dropdown', 'drop-down', 'popover', 'tooltip', 'modal',
        # Liens de navigation
        'link', 'anchor', 'jump', 'skip', 'scroll-to',
        # Filtres/Tri
        'filter', 'sort', 'ordering', 'facet',
        # Slides/Carousel
        'slide', 'slider', 'carousel', 'swiper', 'slick',
        'prev', 'next', 'previous', 'forward', 'backward',
        # Autres UI
        'trigger', 'handle', 'control', 'switcher', 'selector',
    ]

    # Vérifier classes, id, role
    if any(kw in elem_classes for kw in ui_keywords):
        return True
    if any(kw in elem_id for kw in ui_keywords):
        return True
    if elem_role in ['tab', 'button', 'menuitem', 'link', 'navigation', 'menu',
                     'listbox', 'option', 'switch', 'slider', 'combobox']:
        return True

    # Data attributes Bootstrap/jQuery UI
    if elem_data_toggle in ['tab', 'pill', 'collapse', 'modal', 'dropdown', 'tooltip', 'popover']:
        return True
    if elem_data_bs_toggle in ['tab', 'pill', 'collapse', 'modal', 'dropdown', 'tooltip', 'popover']:
        return True

    # Aria attributes indiquant un tab/bouton
    if elem_aria_selected is not None:  # Présence de aria-selected = probablement un tab
        return True
    if elem_aria_controls:  # Contrôle un autre élément = probablement un tab/bouton
        return True

    # Liens avec href="#" ou href commençant par "#" (souvent des tabs/toggles)
    if tag_name == 'a' and (elem_href == '#' or elem_href.startswith('#') and len(elem_href) > 1):
        # C'est probablement un tab ou un toggle, pas un vrai lien
        return True

    # ============================================================
    # VÉRIFICATION DES ÉLÉMENTS PARENTS (contexte)
    # ============================================================

    parent = elem.parent
    max_depth = 8  # Augmenté pour mieux détecter
    depth = 0

    parent_container_keywords = [
        # Conteneurs de tabs
        'tabs', 'tab-list', 'tablist', 'nav-tabs', 'nav-pills', 'tab-header',
        'tab-navigation', 'tab-nav', 'tabs-container', 'tab-wrapper',
        # Navigation
        'navigation', 'navbar', 'nav-menu', 'menu-container', 'main-menu',
        'site-nav', 'primary-nav', 'secondary-nav', 'top-nav', 'bottom-nav',
        # Accordéon
        'accordion', 'accordion-container', 'collapse-container',
        'collapsible-container', 'expandable-container',
        # Dropdown
        'dropdown', 'dropdown-menu', 'drop-down', 'select-menu',
        # Breadcrumb
        'breadcrumb', 'breadcrumbs', 'crumbs',
        # Pagination
        'pagination', 'pager', 'page-numbers',
        # Filtres
        'filters', 'filter-bar', 'filter-container', 'facets', 'sorting',
        # UI généraux
        'toolbar', 'action-bar', 'button-group', 'btn-group',
        # Carousel/Slider
        'carousel', 'slider', 'swiper', 'slideshow',
    ]

    while parent and parent.name and depth < max_depth:
        parent_tag = parent.name.lower()
        parent_classes = ' '.join(parent.get('class', [])).lower()
        parent_id = (parent.get('id') or '').lower()
        parent_role = (parent.get('role') or '').lower()

        # Si le parent est un nav, ul dans un contexte nav, etc.
        if parent_tag in ['nav', 'menu']:
            return True

        # Vérifier les classes/id du parent
        if any(kw in parent_classes for kw in parent_container_keywords):
            return True
        if any(kw in parent_id for kw in parent_container_keywords):
            return True

        # Roles WAI-ARIA des parents
        if parent_role in ['tablist', 'navigation', 'menu', 'menubar', 'toolbar',
                           'tabpanel', 'dialog', 'alertdialog', 'listbox']:
            return True

        parent = parent.parent
        depth += 1

    # ============================================================
    # VÉRIFICATION DU TEXTE DE L'ÉLÉMENT
    # ============================================================

    # Si le texte de l'élément ressemble à un texte de tab/bouton
    elem_text = elem.get_text(strip=True).lower() if elem.get_text else ''

    button_text_keywords = [
        'voir plus', 'see more', 'read more', 'lire plus', 'en savoir plus',
        'afficher', 'masquer', 'show', 'hide', 'expand', 'collapse',
        'suivant', 'précédent', 'next', 'previous', 'prev',
        'fermer', 'close', 'ouvrir', 'open',
        'ajouter', 'supprimer', 'add', 'remove', 'delete',
        'annuler', 'cancel', 'confirmer', 'confirm', 'valider', 'submit',
    ]

    if elem_text and any(kw in elem_text for kw in button_text_keywords):
        return True

    return False


def looks_like_product_name(text: str) -> bool:
    """Vérifie si un texte ressemble à un nom de produit valide

    Un nom de produit valide pour véhicules devrait contenir:
    - Un nom de marque (Kawasaki, Honda, etc.)
    - OU un modèle reconnaissable (Ninja, CBR, etc.)
    - OU un type de véhicule (moto, quad, etc.) + un identifiant
    - ET généralement une année ou des chiffres

    Un nom INVALIDE serait:
    - Un seul mot générique (Aperçu, Spécifications, etc.)
    - Un texte de navigation
    - Un texte trop court ou trop long
    """
    if not text:
        return False

    text_stripped = text.strip()
    text_lower = text_stripped.lower()
    text_normalized = normalize_text_for_comparison(text_stripped)

    # ============================================================
    # REJETS RAPIDES - ces textes ne sont JAMAIS des noms de produits
    # ============================================================

    # Trop court (< 8 caractères = rarement un vrai nom de produit)
    if len(text_stripped) < 8:
        return False

    # Trop long (> 150 caractères = probablement une description)
    if len(text_stripped) > 150:
        return False

    # Si c'est déjà reconnu comme générique, rejeter
    if is_generic_name(text_stripped):
        return False

    # ============================================================
    # INDICATEURS POSITIFS FORTS (marques et modèles connus)
    # ============================================================

    # Marques de véhicules (TRÈS bon indicateur)
    vehicle_brands = [
        # Motos japonaises
        'kawasaki', 'honda', 'yamaha', 'suzuki',
        # Motos européennes
        'ktm', 'ducati', 'bmw', 'triumph', 'aprilia', 'moto guzzi',
        'husqvarna', 'beta', 'sherco', 'gas gas', 'gasgas', 'tm racing',
        # Motos américaines
        'harley', 'harley-davidson', 'indian', 'victory',
        # Véhicules récréatifs
        'polaris', 'can-am', 'canam', 'brp', 'sea-doo', 'seadoo',
        'ski-doo', 'skidoo', 'arctic cat', 'arcticcat',
        'cfmoto', 'cf moto', 'kymco', 'sym',
        # Autres
        'vespa', 'piaggio', 'royal enfield', 'benelli', 'mv agusta',
    ]

    has_brand = any(brand in text_lower for brand in vehicle_brands)

    # Modèles connus (bon indicateur)
    known_models = [
        # Kawasaki
        'ninja', 'z900', 'z650', 'z400', 'z125', 'versys', 'vulcan',
        'klx', 'kx', 'kfx', 'mule', 'teryx', 'brute force', 'concours',
        # Honda
        'cbr', 'cb', 'crf', 'xr', 'africa twin', 'goldwing', 'gold wing',
        'rebel', 'shadow', 'forza', 'pcx', 'nc750', 'ctx', 'fury',
        'pioneer', 'talon', 'fourtrax', 'foreman', 'rancher', 'rubicon',
        # Yamaha
        'mt-', 'yzf', 'r1', 'r6', 'r7', 'r3', 'fz', 'xsr', 'wr',
        'raptor', 'grizzly', 'kodiak', 'wolverine', 'viking', 'yxz',
        'tenere', 'tracer', 'bolt', 'vstar', 'v-star',
        # Suzuki
        'gsx', 'gsxr', 'gsx-r', 'sv', 'v-strom', 'vstrom', 'hayabusa',
        'busa', 'burgman', 'kingquad', 'king quad', 'dr', 'rm', 'rmz',
        # KTM
        'duke', 'adventure', 'adv', 'exc', 'sx', 'xc', 'freeride', 'smr', 'smc',
        # Polaris
        'sportsman', 'ranger', 'rzr', 'general', 'scrambler', 'ace',
        'indy', 'rush', 'switchback', 'rmk', 'pro-rmk', 'titan', 'voyageur',
        # Can-Am / BRP
        'outlander', 'renegade', 'maverick', 'defender', 'commander',
        'spyder', 'ryker', 'summit', 'mxz', 'backcountry', 'freeride',
        'spark', 'gti', 'gtx', 'rxt', 'rxp', 'fish pro',
        # CFMoto
        'cforce', 'zforce', 'uforce', 'nk', 'sr', 'papio',
        # Triumph
        'bonneville', 'street', 'tiger', 'speed triple', 'speed twin',
        'rocket', 'thruxton', 'scrambler', 'trident', 'daytona',
        # Ducati
        'panigale', 'monster', 'multistrada', 'scrambler', 'diavel',
        'hypermotard', 'streetfighter', 'supersport',
        # Harley
        'sportster', 'softail', 'touring', 'street glide', 'road glide',
        'fat boy', 'fatboy', 'breakout', 'iron', 'forty-eight', 'nightster',
    ]

    has_model = any(model in text_lower for model in known_models)

    # Types de véhicules (indicateur moyen - besoin d'autres éléments)
    vehicle_types = [
        'moto', 'motorcycle', 'motocyclette', 'bike', 'motorbike',
        'motoneige', 'snowmobile', 'snow mobile', 'motoski',
        'quad', 'atv', 'vtt', 'four wheeler',
        'utv', 'side-by-side', 'sxs', 'côte à côte', 'cote a cote',
        'scooter', 'vespa',
        'motocross', 'mx', 'dirt bike', 'dirtbike',
        'enduro', 'supermoto', 'supermotard',
        'cruiser', 'touring', 'sport bike', 'sportbike',
        'adventure', 'dual sport', 'dual-sport',
        'moto marine', 'sea-doo', 'jet ski', 'waverunner', 'pwc',
    ]

    has_vehicle_type = any(vtype in text_lower for vtype in vehicle_types)

    # ============================================================
    # INDICATEURS SECONDAIRES
    # ============================================================

    # Présence de chiffres (année, cylindrée, modèle)
    has_numbers = bool(re.search(r'\d', text))

    # Présence d'une année valide (1990-2030)
    has_year = bool(re.search(r'\b(199\d|20[0-3]\d)\b', text))

    # Présence d'une cylindrée (50, 125, 250, 300, 400, 450, 500, 600, 650, 750, 850, 900, 1000, 1200, 1800, etc.)
    has_cc = bool(re.search(
        r'\b(50|125|150|200|250|300|350|400|450|500|550|600|650|700|750|800|850|900|950|1000|1100|1200|1300|1400|1500|1600|1700|1800|1900|2000)\s*(cc|cm3)?\b', text_lower))

    # ============================================================
    # SCORING - Un bon nom de produit a plusieurs indicateurs
    # ============================================================

    score = 0

    # Indicateurs forts (chaque marque/modèle ajoute beaucoup)
    if has_brand:
        score += 30
    if has_model:
        score += 25
    if has_year:
        score += 20
    if has_cc:
        score += 15

    # Indicateurs moyens
    if has_vehicle_type:
        score += 10
    if has_numbers:
        score += 5

    # Bonus si plusieurs mots (noms de produits sont rarement un seul mot)
    word_count = len(text_stripped.split())
    if word_count >= 2:
        score += 5
    if word_count >= 3:
        score += 5

    # Pénalités
    # Un seul mot sans indicateur fort = probablement pas un produit
    if word_count == 1 and not has_brand and not has_model:
        score -= 20

    # Score minimum pour être considéré comme un nom de produit valide
    # Besoin d'au moins une marque/modèle OU un type de véhicule + année/chiffres
    return score >= 25


def extract_from_structured_data(soup, url: str) -> Dict[str, Any]:
    """
    EXTRACTION INTELLIGENTE DEPUIS LES DONNÉES STRUCTURÉES
    
    Cette fonction extrait les informations produit depuis:
    1. JSON-LD (@type: Product, Vehicle, Motorcycle, Car, etc.)
    2. Open Graph meta tags (og:title, og:image, etc.)
    3. Microdata (itemprop attributes)
    4. Twitter Card meta tags
    
    Ces sources sont STANDARDISÉES et fonctionnent sur presque tous les sites modernes.
    C'est la méthode la plus fiable car elle ne dépend pas des CSS selectors.
    """
    import json
    product = {{}}
    
    # ========================================================
    # STRATÉGIE 1: JSON-LD (la plus fiable pour les produits)
    # ========================================================
    json_ld_scripts = soup.find_all('script', type='application/ld+json')
    
    for script in json_ld_scripts:
        try:
            if not script.string:
                continue
            data = json.loads(script.string)
            
            # Gérer les tableaux JSON-LD
            items_to_check = []
            if isinstance(data, list):
                items_to_check.extend(data)
            elif isinstance(data, dict):
                items_to_check.append(data)
                # Vérifier @graph pour les structures imbriquées
                if '@graph' in data:
                    items_to_check.extend(data['@graph'])
            
            for item in items_to_check:
                if not isinstance(item, dict):
                    continue
                    
                item_type = item.get('@type', '')
                # Normaliser le type (peut être string ou liste)
                if isinstance(item_type, list):
                    item_types = [t.lower() for t in item_type]
                else:
                    item_types = [item_type.lower()]
                
                # Types de produits/véhicules supportés
                product_types = ['product', 'vehicle', 'motorcycle', 'car', 'motorizedvehicle', 
                                'offer', 'offercatalog', 'itempage']
                
                if any(ptype in ' '.join(item_types) for ptype in product_types):
                    # Extraire le nom
                    if item.get('name') and not product.get('name'):
                        name = str(item['name']).strip()
                        if len(name) >= 5 and not is_generic_name(name):
                            product['name'] = name
                    
                    # Extraire le prix depuis offers OU directement depuis l'item
                    if not product.get('prix'):
                        price = None
                        
                        # D'abord chercher directement dans l'item (certains sites comme MVM Motosport)
                        direct_price = item.get('price') or item.get('lowPrice') or item.get('highPrice')
                        if direct_price:
                            price = direct_price
                        
                        # Sinon chercher dans offers (standard schema.org)
                        if not price:
                            offers = item.get('offers', {{}})
                            if isinstance(offers, list) and offers:
                                offers = offers[0]
                            if isinstance(offers, dict):
                                price = offers.get('price') or offers.get('lowPrice') or offers.get('highPrice')
                        
                        if price:
                            try:
                                product['prix'] = float(str(price).replace(',', '.').replace(' ', ''))
                            except (ValueError, TypeError):
                                pass
                    
                    # Extraire l'image
                    if not product.get('image'):
                        img = item.get('image')
                        if img:
                            if isinstance(img, list):
                                img = img[0]
                            if isinstance(img, dict):
                                img = img.get('url') or img.get('@id')
                            if img and isinstance(img, str):
                                product['image'] = normalize_image_url(img, url)
                    
                    # Extraire la marque
                    if not product.get('marque'):
                        brand = item.get('brand')
                        if brand:
                            if isinstance(brand, dict):
                                brand = brand.get('name') or brand.get('@id')
                            if brand and isinstance(brand, str):
                                product['marque'] = brand
                    
                    # Extraire le modèle
                    if not product.get('modele'):
                        model = item.get('model') or item.get('vehicleModelDate')
                        if model and isinstance(model, str):
                            product['modele'] = model
                    
                    # Extraire la description
                    if not product.get('description'):
                        desc = item.get('description')
                        if desc and isinstance(desc, str):
                            product['description'] = desc[:500]
                    
                    # Extraire l'année (pour les véhicules)
                    if not product.get('annee'):
                        year = item.get('modelYear') or item.get('vehicleModelDate') or item.get('dateVehicleFirstRegistered')
                        if year:
                            try:
                                year_int = int(str(year)[:4])
                                if 1900 <= year_int <= 2100:
                                    product['annee'] = year_int
                            except (ValueError, TypeError):
                                pass
                    
                    # Si on a trouvé un nom, on a probablement trouvé le bon objet
                    if product.get('name'):
                        break
                        
        except (json.JSONDecodeError, AttributeError, TypeError, KeyError):
            continue
    
    # ========================================================
    # STRATÉGIE 2: Open Graph meta tags
    # ========================================================
    if not product.get('name'):
        og_title = soup.find('meta', property='og:title')
        if og_title and og_title.get('content'):
            title = og_title['content'].strip()
            if len(title) >= 5 and not is_generic_name(title):
                product['name'] = title
    
    if not product.get('image'):
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content'):
            product['image'] = normalize_image_url(og_image['content'], url)
    
    # Prix depuis Open Graph (og:price:amount, product:price:amount)
    if not product.get('prix'):
        for price_prop in ['og:price:amount', 'product:price:amount', 'og:price']:
            og_price = soup.find('meta', property=price_prop)
            if og_price and og_price.get('content'):
                try:
                    price_str = og_price['content'].replace(',', '.').replace(' ', '')
                    product['prix'] = float(price_str)
                    break
                except (ValueError, TypeError):
                    continue
    
    if not product.get('description'):
        og_desc = soup.find('meta', property='og:description')
        if og_desc and og_desc.get('content'):
            product['description'] = og_desc['content'][:500]
    
    # ========================================================
    # STRATÉGIE 3: Twitter Card meta tags
    # ========================================================
    if not product.get('name'):
        twitter_title = soup.find('meta', attrs={{'name': 'twitter:title'}})
        if twitter_title and twitter_title.get('content'):
            title = twitter_title['content'].strip()
            if len(title) >= 5 and not is_generic_name(title):
                product['name'] = title
    
    if not product.get('image'):
        twitter_image = soup.find('meta', attrs={{'name': 'twitter:image'}})
        if twitter_image and twitter_image.get('content'):
            product['image'] = normalize_image_url(twitter_image['content'], url)
    
    # ========================================================
    # STRATÉGIE 4: Microdata (itemprop attributes)
    # ========================================================
    if not product.get('name'):
        name_elem = soup.find(attrs={{'itemprop': 'name'}})
        if name_elem:
            name = clean_text(name_elem.get_text())
            if len(name) >= 5 and not is_generic_name(name):
                product['name'] = name
    
    if not product.get('prix'):
        price_elem = soup.find(attrs={{'itemprop': 'price'}})
        if price_elem:
            price_text = price_elem.get('content') or price_elem.get_text()
            if price_text:
                try:
                    product['prix'] = float(str(price_text).replace(',', '.').replace(' ', '').replace('$', '').replace('€', ''))
                except (ValueError, TypeError):
                    pass
    
    if not product.get('image'):
        img_elem = soup.find(attrs={{'itemprop': 'image'}})
        if img_elem:
            img_src = img_elem.get('src') or img_elem.get('content') or img_elem.get('href')
            if img_src:
                product['image'] = normalize_image_url(img_src, url)
    
    if not product.get('marque'):
        brand_elem = soup.find(attrs={{'itemprop': 'brand'}})
        if brand_elem:
            brand = clean_text(brand_elem.get_text())
            if brand:
                product['marque'] = brand
    
    # ========================================================
    # STRATÉGIE 5: Meta description et title (fallback ultime)
    # ========================================================
    if not product.get('name'):
        title_elem = soup.find('title')
        if title_elem:
            title = clean_text(title_elem.get_text())
            # Le titre contient souvent "Nom du produit | Nom du site"
            for sep in ['|', '-', '–', '—', '·', ':']:
                if sep in title:
                    parts = title.split(sep)
                    candidate = parts[0].strip()
                    if len(candidate) >= 8 and looks_like_product_name(candidate):
                        product['name'] = candidate
                        break
    
    if not product.get('description'):
        meta_desc = soup.find('meta', attrs={{'name': 'description'}})
        if meta_desc and meta_desc.get('content'):
            product['description'] = meta_desc['content'][:500]
    
    return product


def extract_product_from_html(html: str, url: str, base_url: str) -> Dict[str, Any]:
    """Extrait les informations d'un produit depuis le HTML - amélioré
    
    STRATÉGIE D'EXTRACTION (par ordre de priorité):
    1. Données structurées (JSON-LD, Open Graph, microdata) - la plus fiable
    2. Sélecteurs CSS détectés automatiquement
    3. Fallbacks intelligents (h1, .price, patterns communs)
    """
    soup = BeautifulSoup(html, 'html.parser')
    
    # ========================================================
    # PRIORITÉ 1: Extraction depuis les données structurées
    # C'est la méthode la plus fiable et adaptative
    # ========================================================
    product = extract_from_structured_data(soup, url)
    
    # Vérifier si l'extraction structurée a réussi
    structured_success = bool(product.get('name') and len(product.get('name', '')) >= 5)

    # ========================================================
    # PRIORITÉ 2: Sélecteurs CSS détectés (si données structurées insuffisantes)
    # ========================================================
    
    # Extraire le nom via sélecteurs si pas trouvé via données structurées
    name_from_selector_valid = structured_success
    if not product.get('name') and 'name' in SELECTORS:
        name_elem = soup.select_one(SELECTORS['name'])
        if name_elem:
            # Vérifier que l'élément n'est pas dans le header/nav/footer ou un tab/bouton
            if not is_in_header_nav_footer(name_elem) and not is_tab_or_button_element(name_elem):
                name_text = clean_text(name_elem.get_text())
                # Rejeter si c'est un label/placeholder
                if is_label_text(name_text):
                    name_text = ""
                # Valider que ce n'est pas un nom générique
                if name_text and not is_generic_name(name_text) and len(name_text) >= 5:
                    product['name'] = name_text
                    name_from_selector_valid = True

    # ========================================================
    # PRIORITÉ 3: Fallbacks intelligents (si sélecteurs échouent aussi)
    # ========================================================
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

        # Collecter tous les candidats potentiels avec leur score
        candidates = []

        for selector in product_selectors:
            elems = soup.select(selector)
            for elem in elems:
                # Exclure si dans header/nav/footer ou tab/bouton
                if is_in_header_nav_footer(elem):
                    continue
                if is_tab_or_button_element(elem):
                    continue

                name_text = clean_text(elem.get_text())
                # Rejeter si c'est un label/placeholder (même dans les fallbacks)
                if is_label_text(name_text):
                    continue
                # Valider que ce n'est pas un nom générique
                if name_text and not is_generic_name(name_text) and len(name_text) >= 5:
                    # Calculer un score pour ce candidat
                    score = 0
                    # Bonus si ça ressemble à un nom de produit
                    if looks_like_product_name(name_text):
                        score += 10
                    # Bonus pour les h1 (généralement le titre principal)
                    if elem.name == 'h1':
                        score += 5
                    # Bonus pour les sélecteurs spécifiques produit
                    if 'product' in selector or 'title' in selector:
                        score += 3
                    # Bonus pour la longueur (noms de produits sont souvent plus longs)
                    if len(name_text) > 15:
                        score += 2

                    candidates.append((name_text, score))

        # Choisir le meilleur candidat
        if candidates:
            candidates.sort(key=lambda x: x[1], reverse=True)
            product['name'] = candidates[0][0]

    # PRIORISER LE PRIX ACTUEL (current-price) ET EXCLURE L'ANCIEN PRIX (old-price)
    # Note: Si déjà extrait via données structurées, on a fini
    price_from_selector_valid = bool(product.get('prix') and product.get('prix', 0) > 0)

    # ÉTAPE 1: Chercher d'abord le PRIX ACTUEL (priorité haute) - SEULEMENT si pas déjà trouvé
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
                    price_text = price_elem.get_text() or price_elem.get(
                        'data-price', '') or price_elem.get('data-amount', '')
                else:
                    # C'est un conteneur, chercher .value ou .number dedans
                    value_elem = price_elem.select_one(
                        '.value, .number, [class*="number"]')
                    if value_elem:
                        price_text = value_elem.get_text()
                    else:
                        price_text = price_elem.get_text() or price_elem.get(
                            'data-price', '') or price_elem.get('data-amount', '')

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
                            price = None
                            # D'abord chercher directement dans l'objet
                            price = data.get('price') or data.get('lowPrice') or data.get('highPrice')
                            # Sinon chercher dans offers
                            if not price:
                                offers = data.get('offers', {{}})
                                if isinstance(offers, list) and len(offers) > 0:
                                    offers = offers[0]
                                if isinstance(offers, dict):
                                    price = offers.get('price') or offers.get('lowPrice') or offers.get('highPrice')
                            if price:
                                try:
                                    price_float = float(str(price).replace(',', '.').replace(' ', ''))
                                    if price_float > 0:
                                        product['prix'] = price_float
                                        break
                                except (ValueError, TypeError):
                                    pass
                    except (json.JSONDecodeError, AttributeError, TypeError):
                        continue
            except Exception:
                pass

    # Extraction de l'image - Priorité 1 : Déjà extrait via données structurées
    # Si le sélecteur principal trouve quelque chose mais que c'est invalide, forcer les fallbacks
    image_from_selector_valid = bool(product.get('image'))
    
    # Priorité 2 : Sélecteur spécifique (seulement si pas déjà trouvé)
    if not product.get('image') and 'image' in SELECTORS:
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
    
    # Détection de sourceCategorie basée sur l'URL
    url_lower = url.lower()
    if any(x in url_lower for x in ['occasion', 'used', 'usagé', 'usag', 'pre-owned', 'pre-possede', 'd-occasion', 'seconde-main']):
        product['sourceCategorie'] = 'vehicules_occasion'
    elif any(x in url_lower for x in ['catalogue', 'catalog', 'showroom', 'gamme', '/models/', '/modeles/']):
        product['sourceCategorie'] = 'catalogue'
    elif any(x in url_lower for x in ['inventaire', 'inventory', 'stock', 'en-stock', 'a-vendre', 'for-sale']):
        product['sourceCategorie'] = 'inventaire'
    else:
        product['sourceCategorie'] = 'inventaire'  # Par défaut
    
    # Détection de l'état du produit (neuf, occasion, demonstrateur)
    etat = None
    # Signal 1: URL patterns
    if any(x in url_lower for x in ['occasion', 'used', 'pre-owned', 'usag', 'd-occasion', 'pre-possede']):
        etat = 'occasion'
    elif any(x in url_lower for x in ['neuf', '/new/', '-new-', '/new-']):
        etat = 'neuf'
    elif any(x in url_lower for x in ['demo', 'demonstrat', 'demonstr']):
        etat = 'demonstrateur'
    # Signal 2: Déduire depuis sourceCategorie
    if not etat:
        if product['sourceCategorie'] == 'vehicules_occasion':
            etat = 'occasion'
        elif product['sourceCategorie'] == 'catalogue':
            etat = 'neuf'
        else:
            etat = 'neuf'  # Inventaire par défaut = neuf
    product['etat'] = etat

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

    # ============================================================
    # VALIDATION FINALE DU NOM DU PRODUIT
    # Cette étape est CRITIQUE pour éviter les noms génériques
    # ============================================================

    final_name = product.get('name', '')

    # Validation finale : le nom doit passer TOUTES les vérifications
    name_is_valid = (
        final_name and
        len(final_name) >= 6 and
        not is_generic_name(final_name) and
        not is_label_text(final_name)
    )

    if not name_is_valid:
        # FALLBACK ULTIME: Essayer d'extraire le nom depuis le <title> de la page
        title_elem = soup.find('title')
        if title_elem:
            title_text = clean_text(title_elem.get_text())
            # Le titre contient souvent "Nom du produit | Nom du site" ou "Nom du produit - Nom du site"
            for separator in ['|', '-', '–', '—', '·']:
                if separator in title_text:
                    parts = title_text.split(separator)
                    # Prendre la première partie (généralement le nom du produit)
                    candidate = parts[0].strip()
                    if candidate and len(candidate) >= 8 and not is_generic_name(candidate):
                        # Vérifier que ce n'est pas juste le nom du site
                        if looks_like_product_name(candidate):
                            product['name'] = candidate
                            name_is_valid = True
                            break

            # Si toujours pas valide, prendre le titre entier s'il ressemble à un produit
            if not name_is_valid:
                if title_text and len(title_text) >= 10 and len(title_text) <= 100:
                    if looks_like_product_name(title_text) and not is_generic_name(title_text):
                        product['name'] = title_text
                        name_is_valid = True

    # Si le nom est toujours invalide après toutes les tentatives,
    # essayer de construire un nom à partir de la marque et du modèle
    if not name_is_valid and (product.get('marque') or product.get('modele')):
        constructed_name_parts = []
        if product.get('marque'):
            constructed_name_parts.append(product['marque'])
        if product.get('modele'):
            constructed_name_parts.append(product['modele'])
        if product.get('annee'):
            constructed_name_parts.insert(0, str(product['annee']))

        if constructed_name_parts:
            constructed_name = ' '.join(constructed_name_parts)
            if len(constructed_name) >= 6:
                product['name'] = constructed_name
                name_is_valid = True

    # Dernière vérification: si le nom final est toujours générique, le marquer
    final_name_check = product.get('name', '')
    if final_name_check and is_generic_name(final_name_check):
        # Supprimer le nom invalide - il vaut mieux pas de nom qu'un nom générique
        product['name'] = ''

    # ============================================================
    # FALLBACKS ULTIMES POUR PRIX ET IMAGE (PRODUCTION CRITICAL)
    # Si après toutes les tentatives on n'a pas prix/image, essayer encore
    # ============================================================
    
    # FALLBACK PRIX: Chercher n'importe quel élément avec un montant monétaire
    if not product.get('prix') or product.get('prix', 0) == 0:
        import re
        # Patterns de prix courants
        price_patterns = [
            r'\$\s*([\d\s,]+(?:\.\d{{2}})?)',           # $12,345 ou $12 345
            r'([\d\s,]+(?:\.\d{{2}})?)\s*\$',           # 12,345$ ou 12 345$
            r'([\d\s,]+(?:\.\d{{2}})?)\s*(?:CAD|USD|EUR)',  # 12345 CAD
            r'prix[:\s]*([\d\s,]+(?:\.\d{{2}})?)',      # prix: 12345
            r'price[:\s]*([\d\s,]+(?:\.\d{{2}})?)',     # price: 12345
        ]
        
        # Chercher dans tout le contenu principal de la page
        main_content = soup.find('main') or soup.find('article') or soup.find(class_=re.compile(r'product|content|main', re.I))
        if main_content:
            content_text = main_content.get_text()
            for pattern in price_patterns:
                match = re.search(pattern, content_text, re.I)
                if match:
                    try:
                        price_str = match.group(1).replace(' ', '').replace(',', '')
                        price_val = float(price_str)
                        # Vérifier que c'est un prix raisonnable (entre 50 et 1000000)
                        if 50 < price_val < 1000000:
                            product['prix'] = price_val
                            break
                    except (ValueError, TypeError):
                        continue
    
    # FALLBACK IMAGE: Chercher la plus grande image de la page
    if not product.get('image'):
        # Chercher dans les conteneurs principaux de produit
        product_containers = soup.select('main img, article img, .product img, .content img, [class*="product"] img, [class*="gallery"] img')
        
        best_img = None
        best_score = 0
        
        for img in product_containers[:20]:
            img_src = (img.get('src') or img.get('data-src') or 
                      img.get('data-lazy-src') or img.get('data-original') or
                      img.get('data-image'))
            if not img_src:
                continue
            
            # Calculer un score basé sur la taille
            score = 0
            try:
                width = int(img.get('width', 0))
                height = int(img.get('height', 0))
                score = width * height
            except (ValueError, TypeError):
                # Si pas de dimensions, donner un score basé sur la position
                score = 100
            
            # Bonus si dans une galerie ou conteneur produit
            parent_classes = ' '.join(img.parent.get('class', []) if img.parent else []).lower()
            if 'gallery' in parent_classes or 'product' in parent_classes or 'main' in parent_classes:
                score += 1000
            
            # Exclure les logos et icônes
            img_src_lower = img_src.lower()
            if any(x in img_src_lower for x in ['logo', 'icon', 'badge', 'button', 'arrow', 'chevron']):
                continue
            
            if score > best_score:
                best_score = score
                best_img = img_src
        
        if best_img:
            product['image'] = normalize_image_url(best_img, url)

    return product


def filter_valid_products(products: List[Dict]) -> List[Dict]:
    """Filtre les produits pour ne garder que les véhicules réels

    Cette fonction est la DERNIÈRE ligne de défense contre les faux produits.
    Elle utilise toutes les fonctions de validation pour s'assurer que
    seuls les vrais produits sont retournés.
    """
    if not products:
        return []

    valid_products = []
    rejected_count = 0

    for product in products:
        name = str(product.get('name', '')).strip()
        name_lower = name.lower()
        marque = str(product.get('marque', '')).strip().lower()
        modele = str(product.get('modele', '')).strip().lower()
        prix = product.get('prix', 0)

        # ============================================================
        # RÈGLE 1: Le nom doit exister et être valide
        # ============================================================

        # Nom vide ou trop court
        if not name or len(name) < 6:
            rejected_count += 1
            continue

        # Nom générique (utilise notre fonction améliorée)
        if is_generic_name(name):
            rejected_count += 1
            continue

        # Nom qui ressemble à un label/placeholder
        if is_label_text(name):
            rejected_count += 1
            continue

        # ============================================================
        # RÈGLE 2: Le nom doit ressembler à un vrai produit
        # (pour les véhicules, on est plus strict)
        # ============================================================

        # Vérifier si le nom ressemble à un nom de produit
        name_looks_valid = looks_like_product_name(name)

        # Si le nom ne ressemble pas à un produit, mais on a marque/modèle valide, c'est OK
        has_valid_marque = marque and len(marque) >= 2 and marque not in [
            '-', 'marque', 'brand', 'modèle', 'model', 'n/a', 'na', 'none', 'null']
        has_valid_modele = modele and len(modele) >= 2 and modele not in [
            '-', 'marque', 'brand', 'modèle', 'model', 'n/a', 'na', 'none', 'null']

        # Si ni nom valide ni marque/modèle, rejeter
        if not name_looks_valid and not has_valid_marque and not has_valid_modele:
            # Exception: si le nom est long (> 20 chars) et a un prix valide,
            # c'est probablement un produit même sans marque connue
            if len(name) < 20 or prix <= 0:
                rejected_count += 1
                continue

        # ============================================================
        # RÈGLE 3: Validation du prix (si présent)
        # ============================================================

        if prix > 0:
            # Prix irréaliste pour un véhicule
            if prix > 1000000:  # Plus de 1M$ = impossible pour un véhicule récréatif
                product['prix'] = 0.0  # Réinitialiser le prix invalide
            elif prix < 50:  # Moins de 50$
                product['prix'] = 0.0  # Réinitialiser le prix invalide
            # Détection de timestamp (10 chiffres commençant par 1)
            elif 1000000000 <= prix <= 2000000000:
                product['prix'] = 0.0  # C'est un timestamp Unix

        # ============================================================
        # RÈGLE 4: Au moins un champ utile doit être présent
        # ============================================================

        has_useful_data = (
            product.get('image') or
            product.get('prix', 0) > 100 or
            has_valid_marque or
            has_valid_modele or
            product.get('annee')
        )

        # Si juste un nom sans aucune autre donnée utile, c'est suspect
        if not has_useful_data:
            # Être plus strict: le nom doit vraiment ressembler à un produit
            if not name_looks_valid:
                rejected_count += 1
                continue

        # ============================================================
        # Produit validé !
        # ============================================================

        valid_products.append(product)

    # Log pour débogage
    if rejected_count > 0:
        print(f"   ⚠️ Filtré {rejected_count} produit(s) invalide(s)")

    return valid_products


def scrape_single_url(product_url: str, base_url: str, index: int, total: int) -> Optional[Dict[str, Any]]:
    """Scrape une seule URL - fonction pour le threading"""
    # Créer une session par thread (thread-safe)
    session = requests.Session()
    session.headers.update({{
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }})

    try:
        print(f"   [{{index}}/{{total}}] Extraction: {{product_url[:80]}}...")

        # Récupérer le HTML (avec fallback Selenium automatique)
        html = get_html(product_url, session, base_url)

        if not html:
            print(f"      ❌ Impossible de récupérer le HTML")
            return None

        # Extraire le produit
        product = extract_product_from_html(html, product_url, base_url)

        # Valider que le produit a au moins un nom
        if product.get('name') and len(product['name']) >= 3:
            prix_str = f"{{product.get('prix', 0):.0f}}$" if product.get('prix') else "pas de prix"
            print(f"      ✅ {{product.get('name', 'Unknown')[:50]}} | {{prix_str}}")
            return product
        else:
            print(f"      ⚠️ Produit invalide (nom manquant ou trop court)")
            return None

    except Exception as e:
        print(f"      ❌ Erreur: {{e}}")
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
    print(f"\\n{{'='*60}}")
    print(f"🚀 EXÉCUTION DU SCRAPER AUTONOME")
    print(f"{{'='*60}}")
    print(f"🌐 Site: {{base_url}}")
    print(f"📋 URLs de produits: {{len(PRODUCT_URLS)}}")
    if SELENIUM_AVAILABLE:
        print(f"🤖 Selenium disponible (fallback automatique)")
    else:
        print(f"⚠️ Selenium non disponible (requests uniquement)")
    print()

    # Filtrer les URLs invalides (pages non-produits)
    def is_valid_product_url(url: str) -> bool:
        """Valide qu'une URL ressemble à une fiche produit.

        IMPORTANT (production):
        - On évite les exclusions trop rigides (chaque concessionnaire structure ses URLs différemment)
        - La séparation inventaire vs catalogue est gérée en amont par l'agent; ici on filtre surtout le "non-produit"
        """
        url_lower = url.lower()

        exclude_segments = [
            # URLs de catalogue (déjà vérifié ci-dessus mais ajout pour sécurité)
            '/catalogue', '/catalog',
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

        import re

        # Patterns d'identifiants de produit (très fiables)
        product_id_patterns = [
            r'ins\d{3,}',
            r'inv\d{3,}',
            r'[/-][tu]\d{4,}',
            r'vin[-_]?([a-hj-npr-z0-9]{8,})',
            r'\b[a-hj-npr-z0-9]{17}\b',
            r'stock[-_ ]?\d{3,}',
            r'sku[-_]?\d+',
            r'ref[-_]?\d+',
            r'p\d{4,}',
        ]
        has_product_id = any(re.search(pattern, url_lower) for pattern in product_id_patterns)

        # Pages de LISTING (à exclure)
        listing_only_patterns = [
            r'/inventaire/?$',
            r'/inventory/?$',
            r'/neuf/?$',
            r'/usage/?$',
            r'/used/?$',
            r'/new/?$',
            r'\?page=',
            r'\?make=',
            r'\?category=',
        ]
        is_listing_page = any(re.search(pattern, url_lower) for pattern in listing_only_patterns)
        if is_listing_page and not has_product_id:
            return False

        # Indicateurs inventaire / vente (forts)
        inventory_indicators = [
            'inventaire', 'inventory', 'vendre', 'a-vendre', 'for-sale',
            'stock', 'en-stock', 'disponible', 'in-stock', 'instock',
        ]
        has_inventory_indicator = any(indicator in url_lower for indicator in inventory_indicators)

        # Indicateurs généraux "produit"
        product_indicators = [
            'moto', 'motorcycle', 'motocyclette', 'vehicule', 'vehicle',
            'quad', 'atv', 'vtt', 'motoneige', 'snowmobile',
            'cote-a-cote', 'side-by-side', 'sxs', 'utv',
            'produit', 'product', 'detail', 'details', 'fiche'
        ]
        has_product_indicator = has_inventory_indicator or any(
            indicator in url_lower for indicator in product_indicators)

        # Format du dernier segment
        parts = url.strip('/').split('/')
        last_segment = parts[-1].lower() if parts else ''
        has_product_in_last_segment = (
            any(char.isdigit() for char in last_segment) and
            not re.match(r'^(page|p)?\d+$', last_segment) and
            len(last_segment) > 8
        )

        # Signal "catalogue-like" (soft)
        catalogue_keywords = ['catalogue', 'catalog', 'showroom', 'modele', 'model', 'gamme', 'range']
        has_catalogue_keyword = any(kw in url_lower for kw in catalogue_keywords)
        if has_catalogue_keyword and not (has_product_id or has_inventory_indicator):
            # Catalogue explicite et aucun signal inventaire/ID -> très probablement non-inventaire
            return False

        # Accepter si:
        # - ID produit (très fiable)
        # - ou URL ressemble à une fiche (dernier segment détaillé + indicateurs produit)
        return bool(has_product_id or (has_product_in_last_segment and has_product_indicator))

    # Filtrer les URLs valides
    valid_urls = []
    excluded_urls = []
    for url in PRODUCT_URLS:
        if is_valid_product_url(url):
            valid_urls.append(url)
        else:
            excluded_urls.append(url)

    if excluded_urls:
        print(f"🚫 {{len(excluded_urls)}} URL(s) exclue(s) (pages non-produits):")
        for excluded_url in excluded_urls[:5]:
            print(f"   - {{excluded_url[:80]}}...")
        if len(excluded_urls) > 5:
            print(f"   ... et {{len(excluded_urls) - 5}} autres")
        print()

    if not valid_urls:
        print(f"❌ Aucune URL de produit valide trouvée!")
        return {{'companyInfo': {{}}, 'products': []}}

    print(f"✅ {{len(valid_urls)}} URL(s) de produits valides à scraper\\n")

    # Extraire les produits depuis chaque URL (PARALLÈLE)
    products = []
    requests_count = 0
    selenium_count = 0
    errors_count = 0

    print(f"🚀 Démarrage du scraping parallèle ({{MAX_WORKERS}} threads)...\\n")

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
                print(f"      ❌ Erreur pour {{url[:80]}}: {{e}}")
                errors_count += 1

    # Filtrer les produits valides
    print(f"\\n🔍 Filtrage des produits valides...")
    valid_products = filter_valid_products(products)
    filtered_count = len(products) - len(valid_products)

    if filtered_count > 0:
        print(
            f"   🚫 {{filtered_count}} produit(s) exclu(s) (catégories génériques)")

    print(
        f"\\n✅ {{len(valid_products)}} produits valides extraits sur {{len(valid_urls)}} URLs")
    print(
        f"   📊 Stats: Requests: ~{{requests_count}}, Selenium: ~{{selenium_count}}, Erreurs: {{errors_count}}")

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
    print(f"   - Produits: {{len(result.get('products', []))}}")
    print(f"   - CompanyInfo: {{bool(result.get('companyInfo', {{}}))}}")
