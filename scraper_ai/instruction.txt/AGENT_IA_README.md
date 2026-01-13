# Agent IA - Documentation Complète

## 🎯 Vue d'ensemble

L'agent IA analyse automatiquement les sites web et génère des scrapers spécifiques pour chaque site. Il utilise Gemini pour comprendre la structure HTML et mapper chaque champ du schéma aux éléments du site.

## 🛠️ Outils Disponibles

L'agent IA a accès à un ensemble complet d'outils pour explorer les sites :

### 1. Browser / Website Exploration
- `get(url, use_selenium=False)` : Récupérer le HTML brut (requests)
- `browser_get(url)` : Récupérer le HTML complètement rendu (Selenium)

### 2. HTML Parsing
- `parse_html(html, selector)` : Extraire des éléments avec sélecteurs CSS
- `get_all_links(html, base_url)` : Extraire tous les liens normalisés
- `discover_product_urls(html, base_url)` : Découvrir les URLs de produits

### 3. Link Normalization
- `normalize_url(base, link)` : Convertir les liens relatifs en URLs complètes

### 4. File / Storage
- `save_json(name, data)` : Sauvegarder des données JSON
- `load_json(name)` : Charger des données JSON

### 5. Sitemap Tool
- `get_sitemap_urls(url)` : Récupérer toutes les URLs depuis sitemap.xml

### 6. Pagination Detection
- `detect_pagination(html, url)` : Détecter le pattern de pagination

### 7. Données Structurées
- `extract_json_ld(html)` : Extraire données JSON-LD
- `extract_opengraph(html)` : Extraire métadonnées Open Graph
- `extract_microdata(html)` : Extraire microdata (schema.org)
- `extract_script_data(html)` : Extraire données depuis variables JavaScript (window.__INITIAL_STATE__, etc.)

### 8. Formulaires & Recherche
- `find_search_form(html)` : Trouver formulaires de recherche
- `find_filters(html)` : Trouver filtres (selects, checkboxes) avec options

### 9. APIs & Endpoints
- `detect_api_endpoints(html)` : Détecter endpoints API depuis JavaScript

### 10. Gestion Avancée
- `retry_get(url, max_retries=3, backoff=1.0, use_selenium=False)` : Retry avec backoff exponentiel
- `detect_rate_limit(response_text, status_code)` : Détecter rate limiting
- `wait_between_requests(seconds=1.0)` : Attendre entre requêtes
- `validate_url(url)` : Valider qu'une URL est bien formée

### 11. Détection Avancée
- `detect_infinite_scroll(html)` : Détecter infinite scroll / lazy loading
- `detect_captcha(html)` : Détecter présence de CAPTCHA
- `find_iframes(html)` : Trouver toutes les iframes

### 12. Utilitaires
- `clean_text(text)` : Nettoyer texte (espaces, caractères spéciaux)
- `extract_price(text)` : Extraire prix depuis texte
- `extract_number(text)` : Extraire n'importe quel nombre depuis texte
- `get_text_content(html, selector=None)` : Extraire texte brut depuis HTML
- `check_robots_txt(url)` : Vérifier robots.txt

### 13. Python Code Writer
- `write_file(path, content)` : Écrire le code du scraper

## 🔄 Workflow de l'Agent

1. **Exploration Automatique**
   - Extraction de tous les liens
   - Détection des URLs de produits
   - Détection de la pagination
   - Recherche du sitemap
   - Analyse de pages clés

2. **Analyse avec Gemini**
   - Gemini reçoit tout le contexte d'exploration
   - Analyse la structure HTML
   - Identifie les patterns de pagination
   - Mappe chaque champ du schéma au HTML

3. **Génération du Scraper**
   - Code Python généré avec stratégies flexibles
   - Gestion de plusieurs approches (sitemap, navigation, pagination)
   - Mapping complet des champs
   - Code prêt à exécuter

4. **Cache**
   - Scraper sauvegardé dans `scraper_cache/`
   - Réutilisation pour les prochaines fois

## 🎨 Flexibilité Maximale

L'agent peut utiliser **n'importe quelle combinaison** de stratégies :

- ✅ Sitemap (si disponible)
- ✅ Navigation + Pagination
- ✅ Exploration de catégories
- ✅ URLs de produits détectées
- ✅ APIs REST/GraphQL (si détectées)
- ✅ Données dans JavaScript (SPA)
- ✅ Formulaires de recherche
- ✅ Filtres et combinaisons
- ✅ Combinaison de plusieurs approches

## 🌐 Types de Sites Supportés

L'agent peut maintenant gérer :

- ✅ Sites statiques classiques
- ✅ Sites avec pagination
- ✅ Sites SPA (Single Page Apps) avec données dans JavaScript
- ✅ Sites avec APIs REST/GraphQL
- ✅ Sites avec infinite scroll / lazy loading
- ✅ Sites avec formulaires de recherche
- ✅ Sites avec filtres complexes
- ✅ Sites avec CAPTCHA (détection)
- ✅ Sites avec rate limiting (gestion automatique)

## 📋 Mapping des Champs

Chaque champ du schéma est mappé aux éléments HTML :

- `name` : Titre du produit
- `marque` : Marque du véhicule
- `modele` : Modèle du véhicule
- `prix` : Prix (OBLIGATOIRE)
- `image` : Image du produit
- `disponibilite` : Disponibilité
- `annee` : Année
- `kilometrage` : Kilométrage
- `category` : Catégorie
- `sourceUrl` : URL de la page
- `sourceSite` : Site source
- `sourceCategorie` : Catégorie source

## 🚀 Utilisation

### Depuis le Dashboard
1. Aller dans l'onglet "Agent IA"
2. Entrer une URL
3. Cliquer sur "Analyser"
4. L'agent explore et génère le scraper
5. Exécuter le scraper depuis l'interface

### Automatique
Quand une nouvelle URL est scrapée, l'agent vérifie automatiquement le cache et génère un scraper si nécessaire.

## 📁 Structure des Fichiers

```
scraper_ai/
├── ai_tools.py          # Outils pour l'exploration
├── html_analyzer.py     # Analyse et génération de scrapers
├── scraper_executor.py  # Exécution des scrapers générés
├── gemini_client.py     # Client Gemini
├── config.py            # Configuration
└── AGENT_IA_README.md   # Ce fichier

scraper_cache/           # Cache des scrapers générés
└── {hash}.json         # Scrapers par site
```

## ✅ Vérifications

- ✅ Tous les outils sont disponibles dans le namespace d'exécution
- ✅ Exploration flexible et exhaustive
- ✅ Prompt optimisé pour la flexibilité
- ✅ Gestion des cas limites
- ✅ Cache pour performance
- ✅ Interface utilisateur dans le dashboard

