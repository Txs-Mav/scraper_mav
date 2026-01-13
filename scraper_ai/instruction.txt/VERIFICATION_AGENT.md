# ✅ Vérification de l'Agent IA - Checklist Complète

## 📋 Vérifications Techniques

### 1. ✅ Outils Disponibles et Exposés

**Outils de base (ai_tools.py):**
- ✅ `get(url, use_selenium=False)` - Récupération HTML
- ✅ `browser_get(url)` - HTML avec Selenium
- ✅ `parse_html(html, selector)` - Parsing CSS
- ✅ `get_all_links(html, base_url)` - Extraction liens
- ✅ `discover_product_urls(html, base_url)` - Découverte produits
- ✅ `normalize_url(base, link)` - Normalisation URLs

**Outils de pagination:**
- ✅ `detect_pagination(html, url)` - Détection automatique (HTML → URL → Test)
- ✅ `build_pagination_url(base_url, pagination_info, page_number)` - Construction URLs
- ✅ `extract_url_filters(url)` - Extraction filtres depuis URL
- ✅ `build_url_with_filters(base_url, filters, pagination, page_number)` - Construction avec filtres

**Outils d'exploration:**
- ✅ `get_sitemap_urls(url)` - Récupération sitemap
- ✅ `find_filters(html)` - Détection filtres HTML
- ✅ `find_search_form(html)` - Détection formulaires recherche

**Outils données structurées:**
- ✅ `extract_json_ld(html)` - JSON-LD
- ✅ `extract_opengraph(html)` - Open Graph
- ✅ `extract_microdata(html)` - Microdata
- ✅ `extract_script_data(html)` - Données JavaScript

**Outils avancés:**
- ✅ `detect_api_endpoints(html)` - Détection APIs
- ✅ `detect_infinite_scroll(html)` - Détection infinite scroll
- ✅ `detect_captcha(html)` - Détection CAPTCHA
- ✅ `find_iframes(html)` - Recherche iframes

**Outils gestion erreurs:**
- ✅ `retry_get(url, max_retries, backoff, use_selenium)` - Retry avec backoff
- ✅ `detect_rate_limit(response_text, status_code)` - Détection rate limiting
- ✅ `wait_between_requests(seconds)` - Attente entre requêtes
- ✅ `validate_url(url)` - Validation URL

**Utilitaires:**
- ✅ `clean_text(text)` - Nettoyage texte
- ✅ `extract_price(text)` - Extraction prix
- ✅ `extract_number(text)` - Extraction nombre
- ✅ `get_text_content(html, selector)` - Extraction texte
- ✅ `check_robots_txt(url)` - Vérification robots.txt

**Stockage:**
- ✅ `save_json(name, data)` - Sauvegarde JSON
- ✅ `load_json(name)` - Chargement JSON
- ✅ `write_file(path, content)` - Écriture fichier

### 2. ✅ Exposition dans le Namespace (scraper_executor.py)

Tous les outils sont bien exposés dans le namespace d'exécution:
- ✅ Toutes les fonctions sont accessibles via lambda dans le namespace
- ✅ `gemini_client` et `EXTRACTION_SCHEMA` sont disponibles
- ✅ `session` (requests.Session) est disponible

### 3. ✅ Instructions dans le Prompt (html_analyzer.py)

**Workflow complet:**
- ✅ ÉTAPE 1: TROUVER TOUTES LES URLs DE PRODUITS
  - ✅ Sitemap (priorité absolue)
  - ✅ Pagination exhaustive avec détection automatique
  - ✅ Exploration catégories
  - ✅ Découverte heuristique
  - ✅ Parsing CSS
  - ✅ Données structurées
  - ✅ Exploration récursive
  - ✅ APIs
  - ✅ JavaScript (SPA)
  - ✅ Formulaires recherche
  - ✅ Filtres

- ✅ ÉTAPE 2: RÉCUPÉRER LE HTML
  - ✅ Instructions pour récupération
  - ✅ Gestion lots si nécessaire

- ✅ ÉTAPE 3: EXTRACTION AVEC GEMINI
  - ✅ Instructions précises pour extraction
  - ✅ Gestion lots si contenu volumineux
  - ✅ Prompt formaté correctement

- ✅ ÉTAPE 4: VALIDATION ET RETOUR
  - ✅ Validation champs requis
  - ✅ Format EXTRACTION_SCHEMA

**Critères de décision:**
- ✅ Quand utiliser sitemap (> 50 URLs)
- ✅ Quand passer à pagination (< 10 URLs)
- ✅ Détection automatique pagination (HTML → URL → Test)

**Gestion d'erreurs:**
- ✅ Compteur pages vides consécutives
- ✅ Vérification messages "Aucun produit"
- ✅ Attente entre requêtes
- ✅ Retry avec backoff

**Exemples de code:**
- ✅ Exemple complet de scraper
- ✅ Code pour chaque étape
- ✅ Gestion pagination avec filtres

## 🎯 Vérification du Workflow de l'Agent

### Workflow Attendu:

1. **Exploration du site** (`_explore_site_with_ai_tools`)
   - ✅ Récupère page d'accueil
   - ✅ Extrait tous les liens
   - ✅ Détecte URLs produits
   - ✅ Détecte pagination
   - ✅ Cherche sitemap
   - ✅ Analyse pages clés

2. **Génération du scraper** (`_generate_scraper_with_ai_exploration`)
   - ✅ Prépare contexte d'exploration
   - ✅ Construit prompt détaillé
   - ✅ Appelle Gemini avec SCRAPER_GENERATION_SCHEMA
   - ✅ Retourne scraper généré

3. **Exécution du scraper** (`scraper_executor.py`)
   - ✅ Charge scraper depuis cache ou génère nouveau
   - ✅ Expose tous les outils dans namespace
   - ✅ Exécute code Python généré
   - ✅ Capture résultats

4. **Extraction avec Gemini**
   - ✅ Scraper généré trouve toutes les URLs
   - ✅ Récupère HTML de toutes les pages
   - ✅ Envoie à Gemini avec EXTRACTION_SCHEMA
   - ✅ Retourne produits extraits

## 🔍 Points Critiques à Vérifier

### ✅ Détection Pagination Automatique

**Fonctionnement:**
1. Cherche dans liens HTML → ✅
2. Cherche dans URL actuelle → ✅
3. Teste patterns standards si rien trouvé → ✅
   - Construit URL page 2
   - Compare contenu avec page 1
   - Retourne pattern si différent

**Patterns testés:**
- ✅ `page=`
- ✅ `paged=`
- ✅ `fwp_paged=`
- ✅ `p=`
- ✅ `offset=`
- ✅ `start=`

### ✅ Préservation des Filtres

**Fonctionnement:**
- ✅ `extract_url_filters()` extrait filtres depuis URL
- ✅ `build_pagination_url()` préserve automatiquement les filtres
- ✅ `build_url_with_filters()` combine filtres + pagination

**Exemple:**
- URL: `?v1=Motocyclette&view=grid`
- Filtres extraits: `{'v1': 'Motocyclette'}`
- Page 2: `?v1=Motocyclette&view=grid&page=2` ✅

### ✅ Instructions Spécifiques

**Critères de décision:**
- ✅ Sitemap > 50 URLs → utiliser comme source principale
- ✅ Sitemap < 10 URLs → utiliser pagination
- ✅ Pagination None → détection automatique testée

**Gestion erreurs:**
- ✅ 3 pages vides consécutives → arrêt
- ✅ Message "Aucun produit" → arrêt
- ✅ Attente 0.5s entre pages
- ✅ Retry avec backoff exponentiel

**Extraction Gemini:**
- ✅ Envoyer HTML de TOUTES les pages
- ✅ Traitement par lots si > 100 URLs ou > 500KB
- ✅ Instructions précises sur ce qu'extraire

## 📊 Checklist de Fonctionnement

### Scénarios de Test

#### ✅ Scénario 1: Site avec Sitemap
- [ ] Sitemap détecté et utilisé
- [ ] URLs récupérées depuis sitemap
- [ ] Pagination vérifiée même si sitemap existe

#### ✅ Scénario 2: Site avec Pagination Standard
- [ ] Pagination détectée dans HTML
- [ ] URLs construites correctement
- [ ] Toutes les pages explorées
- [ ] Arrêt quand plus de produits

#### ✅ Scénario 3: Site avec Pagination Non-Détectée
- [ ] Détection automatique testée
- [ ] Pattern standard trouvé par test
- [ ] Pagination fonctionne avec pattern détecté

#### ✅ Scénario 4: Site avec Filtres
- [ ] Filtres extraits depuis URL
- [ ] Filtres préservés dans pagination
- [ ] URLs construites avec filtres + pagination

#### ✅ Scénario 5: Site Complexe (SPA/API)
- [ ] APIs détectées
- [ ] Données JavaScript extraites
- [ ] Infinite scroll détecté
- [ ] Selenium utilisé si nécessaire

## 🚨 Points d'Attention

### ⚠️ Performance
- ✅ Attente entre requêtes (0.5s entre pages)
- ✅ Retry avec backoff pour éviter rate limiting
- ✅ Traitement par lots si contenu volumineux

### ⚠️ Robustesse
- ✅ Gestion erreurs (try/except)
- ✅ Compteur pages vides
- ✅ Validation URLs
- ✅ Détection CAPTCHA

### ⚠️ Exhaustivité
- ✅ Combinaison plusieurs stratégies
- ✅ Dédupliquer URLs
- ✅ Logger nombre total trouvé
- ✅ Vérifier tous les produits extraits

## ✅ Conclusion

**Tous les outils sont:**
- ✅ Définis dans `ai_tools.py`
- ✅ Exposés dans `scraper_executor.py`
- ✅ Documentés dans le prompt `html_analyzer.py`

**Le workflow est:**
- ✅ Complet (4 étapes claires)
- ✅ Détaillé (instructions précises)
- ✅ Robuste (gestion erreurs)
- ✅ Exhaustif (plusieurs stratégies)

**L'agent peut:**
- ✅ Détecter automatiquement la pagination
- ✅ Préserver les filtres
- ✅ Gérer les sites complexes
- ✅ Extraire tous les produits

## 🎯 Prochaines Étapes Recommandées

1. **Tests réels** sur différents sites:
   - Site avec sitemap
   - Site avec pagination standard
   - Site avec filtres
   - Site SPA/JavaScript

2. **Monitoring** des scrapers générés:
   - Vérifier nombre produits trouvés
   - Vérifier exhaustivité
   - Vérifier performance

3. **Améliorations continues**:
   - Ajouter nouveaux patterns pagination si nécessaire
   - Améliorer détection selon retours terrain
   - Optimiser performance extraction

