"""
Utilitaires Selenium pour gérer les popups et extraire les liens
"""
import os
import sys
import time
import subprocess
from typing import Optional, Tuple, List, Any
from bs4 import BeautifulSoup

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    from webdriver_manager.chrome import ChromeDriverManager
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False


def get_chromedriver_path():
    """Trouve le chemin correct vers chromedriver"""
    try:
        # Méthode 1: Essayer ChromeDriverManager
        driver_path = ChromeDriverManager().install()
        
        # Vérifier que c'est bien un exécutable (pas THIRD_PARTY_NOTICES)
        if os.path.isfile(driver_path) and os.access(driver_path, os.X_OK):
            # Vérifier que ce n'est pas le fichier THIRD_PARTY_NOTICES
            if 'THIRD_PARTY_NOTICES' not in driver_path:
                return driver_path
            else:
                # Chercher le vrai chromedriver dans le même dossier
                driver_dir = os.path.dirname(driver_path)
                for file in os.listdir(driver_dir):
                    if file == 'chromedriver' or (file.startswith('chromedriver') and not file.endswith('.txt')):
                        real_path = os.path.join(driver_dir, file)
                        if os.path.isfile(real_path) and os.access(real_path, os.X_OK):
                            print(f"   🔧 Chromedriver trouvé: {real_path}")
                            return real_path
        
        # Méthode 2: Chercher dans le dossier parent
        driver_dir = os.path.dirname(driver_path)
        parent_dir = os.path.dirname(driver_dir)
        for root, dirs, files in os.walk(parent_dir):
            for file in files:
                if file == 'chromedriver' or (file.startswith('chromedriver') and not file.endswith('.txt')):
                    real_path = os.path.join(root, file)
                    if os.path.isfile(real_path) and os.access(real_path, os.X_OK):
                        print(f"   🔧 Chromedriver trouvé dans: {real_path}")
                        return real_path
        
        # Méthode 3: Utiliser which chromedriver (si installé globalement)
        import shutil
        which_path = shutil.which('chromedriver')
        if which_path:
            print(f"   🔧 Chromedriver trouvé via which: {which_path}")
            return which_path
        
        # Fallback: retourner le chemin original même s'il est suspect
        print(f"   ⚠️ Utilisation du chemin suspect: {driver_path}")
        return driver_path
        
    except Exception as e:
        print(f"   ⚠️ Erreur lors de la recherche de chromedriver: {e}")
        # Dernier recours: essayer de trouver chromedriver dans le PATH
        import shutil
        which_path = shutil.which('chromedriver')
        if which_path:
            return which_path
        raise Exception("Impossible de trouver chromedriver. Installez-le avec: brew install chromedriver")


def handle_gatekeeper(driver_path: str):
    """Résout le problème Gatekeeper sur macOS"""
    if sys.platform != 'darwin':
        return
    
    try:
        # Si c'est un lien symbolique, suivre le lien pour trouver le vrai fichier
        real_path = driver_path
        if os.path.islink(driver_path):
            real_path = os.readlink(driver_path)
            if not os.path.isabs(real_path):
                # Lien relatif, résoudre depuis le dossier du lien
                real_path = os.path.join(os.path.dirname(driver_path), real_path)
            real_path = os.path.abspath(real_path)
            print(f"   🔗 Lien symbolique détecté, fichier réel: {real_path}")
        
        # Vérifier si chromedriver a l'attribut quarantine
        result = subprocess.run(['xattr', real_path], capture_output=True, text=True)
        if 'com.apple.quarantine' in result.stdout:
            print(f"   🔓 Résolution du problème Gatekeeper (macOS bloque chromedriver)...")
            # Supprimer l'attribut quarantine sur le vrai fichier
            subprocess.run(['xattr', '-d', 'com.apple.quarantine', real_path], 
                         capture_output=True, check=False)
            # Aussi supprimer sur le lien symbolique si différent
            if real_path != driver_path:
                subprocess.run(['xattr', '-d', 'com.apple.quarantine', driver_path], 
                             capture_output=True, check=False)
            print(f"   ✅ Attribut quarantine supprimé")
    except Exception as gatekeeper_error:
        print(f"   ⚠️ Impossible de résoudre Gatekeeper automatiquement: {gatekeeper_error}")
        print(f"   💡 Exécutez manuellement: xattr -d com.apple.quarantine {driver_path}")


def handle_popups(driver):
    """Gère les popups courants (sélection de langue, cookies, etc.)"""
    try:
        # Attendre que la page se charge complètement
        print(f"   ⏳ Attente du chargement de la page...")
        time.sleep(6)
        
        # Chercher le popup de sélection de langue (plus spécifique)
        popup_selectors = [
            "//div[@id='my-welcome-message']",
            "//div[contains(@id, 'welcome')]",
            "//div[contains(@class, 'language')]",
            "//div[contains(@class, 'popup')]",
            "//div[contains(@class, 'modal')]",
            "//*[contains(text(), 'CHOISISSEZ LA LANGUE') or contains(text(), 'CHOOSE YOUR LANGUAGE')]"
        ]
        
        popup_found = False
        for selector in popup_selectors:
            try:
                elements = driver.find_elements(By.XPATH, selector)
                for element in elements:
                    if element.is_displayed():
                        popup_found = True
                        print(f"   🔍 Popup trouvé: {selector}")
                        break
                if popup_found:
                    break
            except:
                continue
        
        if not popup_found:
            print(f"   ℹ️ Aucun popup visible détecté")
            return False
        
        # Chercher les boutons de langue dans le popup
        language_button_selectors = [
            "//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'français') or contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'francais')]",
            "//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'french')]",
            "//a[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'français')]",
            "//a[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'francais')]",
            "//button[contains(text(), 'Français')]",
            "//button[contains(text(), 'FRANCAIS')]",
            "//a[contains(text(), 'Français')]",
            "//a[contains(text(), 'FRANCAIS')]",
            "//button[contains(text(), 'English')]",
            "//a[contains(text(), 'English')]"
        ]
        
        # Essayer de cliquer sur un bouton de langue (préférer Français)
        for selector in language_button_selectors:
            try:
                elements = driver.find_elements(By.XPATH, selector)
                for element in elements:
                    try:
                        if element.is_displayed() and element.is_enabled():
                            text = element.text.strip()
                            # Préférer Français
                            if any(lang in text.lower() for lang in ['français', 'french', 'francais']):
                                print(f"   🌐 Clic sur sélecteur de langue (Français): {text[:50]}")
                                driver.execute_script("arguments[0].scrollIntoView(true);", element)
                                time.sleep(3)
                                element.click()
                                time.sleep(4)
                                print(f"   ✅ Langue sélectionnée, attente du chargement...")
                                return True
                    except Exception as e:
                        print(f"   ⚠️ Erreur lors du clic: {e}")
                        continue
            except:
                continue
        
        # Si pas de bouton Français trouvé, essayer English
        for selector in language_button_selectors:
            try:
                elements = driver.find_elements(By.XPATH, selector)
                for element in elements:
                    try:
                        if element.is_displayed() and element.is_enabled():
                            text = element.text.strip()
                            if any(lang in text.lower() for lang in ['english', 'anglais']):
                                print(f"   🌐 Clic sur sélecteur de langue (English): {text[:50]}")
                                driver.execute_script("arguments[0].scrollIntoView(true);", element)
                                time.sleep(3)
                                element.click()
                                time.sleep(5)
                                print(f"   ✅ Langue sélectionnée, attente du chargement...")
                                return True
                    except:
                        continue
            except:
                continue
        
        # Chercher des boutons de fermeture génériques
        close_selectors = [
            "//button[contains(@class, 'close')]",
            "//button[contains(@aria-label, 'close')]",
            "//*[@class='close' or @class='modal-close']",
            "//span[contains(@class, 'close')]"
        ]
        
        for selector in close_selectors:
            try:
                elements = driver.find_elements(By.XPATH, selector)
                for element in elements:
                    if element.is_displayed():
                        print(f"   ❌ Fermeture d'un popup")
                        element.click()
                        time.sleep(5)
                        return True
            except:
                continue
        
        return False
    except Exception as e:
        print(f"   ⚠️ Erreur lors de la gestion des popups: {e}")
        import traceback
        print(f"   Traceback: {traceback.format_exc()}")
        return False


def create_chrome_driver():
    """Crée et configure un driver Chrome"""
    if not SELENIUM_AVAILABLE:
        raise Exception("Selenium n'est pas disponible")
    
    print(f"   🤖 Démarrage de Selenium...")
    chrome_options = Options()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('--window-size=1920,1080')
    chrome_options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    
    # Obtenir le chemin correct vers chromedriver
    driver_path = get_chromedriver_path()
    
    # Résoudre Gatekeeper sur macOS
    handle_gatekeeper(driver_path)
    
    try:
        service = Service(driver_path)
        driver = webdriver.Chrome(service=service, options=chrome_options)
        return driver
    except Exception as driver_error:
        error_msg = str(driver_error)
        print(f"   ⚠️ Erreur lors de l'initialisation de chromedriver: {error_msg}")
        
        # Détecter le problème Gatekeeper spécifiquement
        if 'Status code was: -9' in error_msg or 'unexpectedly exited' in error_msg:
            print(f"   🚨 macOS Gatekeeper bloque chromedriver!")
            print(f"   💡 Solution 1 (recommandé): Exécutez:")
            print(f"      xattr -d com.apple.quarantine {driver_path}")
            print(f"   💡 Solution 2: Ou exécutez le script de correction:")
            print(f"      ./scripts/fix-chromedriver.sh")
            print(f"   💡 Solution 3: Autoriser dans Préférences Système > Sécurité")
        else:
            print(f"   💡 Solution: Installez chromedriver avec: brew install chromedriver")
            print(f"   💡 Ou: brew install --cask chromedriver")
        
        raise Exception(f"Chromedriver non disponible: {driver_error}")


def fetch_page_with_selenium(url: str, return_driver: bool = False, normalize_url_func=None, is_same_domain_func=None) -> Tuple[Optional[BeautifulSoup], Optional[Any]]:
    """Récupère une page avec Selenium pour gérer JavaScript"""
    driver = None
    try:
        driver = create_chrome_driver()
        driver.get(url)
        
        # Gérer les popups
        popup_handled = handle_popups(driver)
        
        # Attendre que la page se charge complètement après interaction
        if popup_handled:
            print(f"   ⏳ Attente du rechargement de la page après interaction...")
            time.sleep(3)
            # Attendre que les liens soient chargés
            try:
                WebDriverWait(driver, 10).until(
                    lambda d: len(d.find_elements(By.TAG_NAME, "a")) > 0
                )
                print(f"   ✅ Liens détectés sur la page")
            except:
                print(f"   ⚠️ Timeout en attendant les liens")
        else:
            time.sleep(2)
        
        # Récupérer le HTML après interaction
        html = driver.page_source
        soup = BeautifulSoup(html, 'html.parser')
        
        if return_driver:
            return soup, driver
        return soup
    except Exception as e:
        print(f"   ❌ Erreur Selenium: {e}")
        if return_driver and driver:
            driver.quit()
        return None
    finally:
        if not return_driver and driver:
            driver.quit()


def extract_navigation_links_selenium(driver, current_url: str, normalize_url_func, is_same_domain_func) -> List[str]:
    """Extrait les liens de navigation avec Selenium (après gestion des popups)"""
    try:
        links = set()
        
        # Attendre un peu pour s'assurer que tous les liens sont chargés
        time.sleep(5)
        
        # Trouver tous les liens <a>
        elements = driver.find_elements(By.TAG_NAME, "a")
        print(f"   🔍 {len(elements)} éléments <a> trouvés")
        
        for i, element in enumerate(elements):
            try:
                href = element.get_attribute('href')
                if href:
                    normalized = normalize_url_func(href)
                    if normalized and is_same_domain_func(normalized):
                        links.add(normalized)
                        if len(links) <= 5:  # Afficher les 5 premiers
                            text = element.text.strip()[:30]
                            print(f"      [{len(links)}] {normalized[:60]}... ({text})")
            except Exception as e:
                if i < 5:  # Log seulement les premières erreurs
                    print(f"      ⚠️ Erreur élément {i}: {e}")
                continue
        
        links_list = list(links)
        print(f"   ✅ {len(links_list)} liens uniques extraits (Selenium)")
        
        # Si aucun lien trouvé, essayer de scroller pour charger du contenu dynamique
        if len(links_list) == 0:
            print(f"   🔄 Aucun lien trouvé, tentative de scroll pour charger du contenu...")
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(4)
            driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(2)
            
            # Réessayer
            elements = driver.find_elements(By.TAG_NAME, "a")
            for element in elements:
                try:
                    href = element.get_attribute('href')
                    if href:
                        normalized = normalize_url_func(href)
                        if normalized and is_same_domain_func(normalized):
                            links.add(normalized)
                except:
                    continue
            links_list = list(links)
            print(f"   ✅ Après scroll: {len(links_list)} liens trouvés")
        
        return links_list
    except Exception as e:
        print(f"   ⚠️ Erreur extraction liens Selenium: {e}")
        import traceback
        print(f"   Traceback: {traceback.format_exc()}")
        return []

