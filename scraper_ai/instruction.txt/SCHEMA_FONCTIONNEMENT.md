# 🎯 Schéma Détaillé du Fonctionnement du Scraper AI

## 📊 Vue d'Ensemble Simplifiée

```
┌──────────────────────────────────────────────────────────────┐
│                    FLUX PRINCIPAL                            │
└──────────────────────────────────────────────────────────────┘

1. ENTRÉE
   ├─> main.py (CLI)
   └─> Dashboard Web (Next.js)

2. CACHE ?
   ├─> OUI → Vérifie scraper Python (.py)
   │   ├─> Scraper existe → Utilise cache → ÉTAPE 5
   │   └─> Scraper manquant mais données existent → Régénère scraper → ÉTAPE 4
   │
   └─> NON → Continue

3. EXPLORATION (ExplorationAgent)
       └─> Gemini + AITools explorent le site
       ├─> Découvre URLs de produits (sitemap, pagination, navigation)
       ├─> Récupère HTML de 20 pages échantillons
       ├─> Extrait infos produits via Gemini
       ├─> Détecte sélecteurs CSS automatiquement
       └─> Retourne: product_urls, html_samples, extracted_products, detected_selectors

4. STOCKAGE (SiteDataStorage)
   └─> Sauvegarde données structurées dans {cache_key}_data.json
       └─> Contient: URLs, HTML échantillons, sélecteurs, structure du site

5. GÉNÉRATION (ScraperGenerator avec Gemini)
   └─> Gemini génère un scraper Python personnalisé
       ├─> Utilise le template comme référence structurelle
       ├─> Hardcode TOUTES les URLs de produits dans PRODUCT_URLS
       ├─> Hardcode TOUS les sélecteurs CSS dans SELECTORS
       ├─> Adapte le code au site spécifique
       └─> Sauvegarde dans {cache_key}_scraper.py

6. EXÉCUTION (ScraperExecutor)
   └─> Exécute le code Python généré
           │
       ├─> Scraping parallèle (20 threads)
       ├─> Utilise les sélecteurs hardcodés
       ├─> Fallbacks robustes si sélecteurs échouent
       └─> Retourne résultats

7. SORTIE
   └─> {companyInfo: {...}, products: [...]}
```

## 📊 Vue d'Ensemble du Système

```
┌──────────────┐
│   main.py    │  ← Point d'entrée (CLI)
└──────┬───────┘
       │
       ▼
┌─────────────────────┐
│ ScraperExecutor     │  ← Orchestrateur principal
│ - scrape_site()     │
└──────┬──────────────┘
       │
       ├─────────────────────────────────────┐
       │                                     │
       ▼                                     ▼
┌──────────────────┐              ┌──────────────────┐
│ HTMLAnalyzer     │              │ execute_scraper() │
│ - Analyse site   │              │ - Exécute code   │
│ - Génère scraper │              │ - Scraping local │
└──────┬───────────┘              └──────────────────┘
       │
       ├─────────────────────────────────────┐
       │                                     │
       ▼                                     ▼
┌──────────────────┐              ┌──────────────────┐
│ ExplorationAgent │              │ ScraperGenerator  │
│ - Découvre URLs  │              │ - Génère avec     │
│ - Extrait infos  │              │   Gemini         │
└──────┬───────────┘              └──────────────────┘
       │
       ├─────────────────────────────────────┐
       │                                     │
       ▼                                     ▼
┌──────────────────┐              ┌──────────────────┐
│ AITools          │              │ GeminiClient      │
│ - Outils web     │              │ - Appels API     │
│ - Exploration    │              │ - Génération     │
└──────────────────┘              └──────────────────┘
       │
       ▼
┌──────────────────┐
│ SiteDataStorage  │
│ - Cache JSON     │
│ - {key}_data.json│
└──────────────────┘
```

---

## 🔄 Flux Principal de Scraping

### Étape 1 : Initialisation

```
┌─────────────────────────────────────────────────────────────┐
│ ÉTAPE 1: DÉMARRAGE                                          │
└─────────────────────────────────────────────────────────────┘

main.py (CLI) OU Dashboard Web
  │
  ├─> Parse arguments (--force-refresh, --invalidate-cache)
  │
  └─> Crée ScraperExecutor()
      │
      └─> ScraperExecutor.__init__()
          ├─> Crée session requests
          └─> Crée HTMLAnalyzer()
              ├─> Crée GeminiClient()
              └─> Initialise cache_dir
```

### Étape 2 : Vérification du Cache

```
┌─────────────────────────────────────────────────────────────┐
│ ÉTAPE 2: VÉRIFICATION CACHE                                 │
└─────────────────────────────────────────────────────────────┘

ScraperExecutor.scrape_site(url, force_refresh=False)
  │
  ├─> Si force_refresh == True
  │   └─> Skip cache, va directement à ÉTAPE 3
  │
  └─> Sinon
      │
      └─> HTMLAnalyzer.analyze_and_generate_scraper()
          │
          ├─> Vérifie scraper Python (.py)
          │   └─> _load_cached_scraper()
          │       ├─> Lit cache/{cache_key}_scraper.py
          │       │
          │       ├─> Si scraper existe
          │       │   └─> Retourne scraper_data → Skip à ÉTAPE 6
          │       │
          │       └─> Si scraper n'existe pas
          │           │
          │           └─> Vérifie données d'exploration
          │               └─> SiteDataStorage.load_site_data()
          │                   ├─> Lit cache/{cache_key}_data.json
          │                   │
          │                   ├─> Si données existent
          │                   │   └─> Réutilise données → Va à ÉTAPE 5
          │                   │
          │                   └─> Si pas de données
          │                       └─> Continue à ÉTAPE 3
```

### Étape 3 : Exploration du Site (ExplorationAgent)

```
┌─────────────────────────────────────────────────────────────┐
│ ÉTAPE 3: EXPLORATION AVEC EXPLORATIONAGENT                  │
└─────────────────────────────────────────────────────────────┘

ExplorationAgent.explore_and_extract(url, initial_html)
  │
  ├─> 1. DÉCOUVRIR TOUTES LES URLs DE PRODUITS
  │   └─> _discover_product_urls()
  │       │
  │       ├─> Sitemap (priorité absolue)
  │       │   └─> get_sitemap_urls() → Filtre URLs non-produits
  │       │
  │       ├─> Pagination
  │       │   └─> detect_pagination() → Boucle pagination
  │       │
  │       ├─> Navigation / Catégories
  │       │   └─> discover_product_urls() → Filtre URLs non-produits
  │       │
  │       └─> Validation stricte
  │           └─> _is_valid_product_url() → Exclut service, article, blog, etc.
  │
  ├─> 2. RÉCUPÉRER LE HTML DE CHAQUE URL PRODUIT
  │   └─> _fetch_product_html()
  │       │
  │       └─> Limite à 20 pages échantillons (pour éviter rate limiting)
  │           └─> Chaque HTML limité à 50 000 caractères
  │
  ├─> 3. UTILISER GEMINI POUR EXTRAIRE LES INFOS PRODUITS
  │   └─> _extract_with_gemini()
  │       │
  │       ├─> Limite à 10 pages pour l'extraction Gemini
  │       ├─> Prompt Gemini avec HTML échantillons
  │       └─> Retourne: extracted_products, detected_selectors
  │
  ├─> 4. DÉTECTER LES SÉLECTEURS CSS AUTOMATIQUEMENT
  │   └─> _detect_selectors()
  │       │
  │       └─> Analyse HTML + produits extraits
  │           └─> Identifie sélecteurs CSS pour chaque champ
  │
  └─> 5. ANALYSER LA STRUCTURE DU SITE
      └─> _analyze_site_structure()
          │
          └─> Retourne: structure_type, domain, etc.

Retourne:
  - product_urls: Liste complète des URLs de produits
  - html_samples: Dictionnaire {url: html} (max 20 pages)
  - extracted_products: Liste des produits extraits
  - detected_selectors: Dictionnaire des sélecteurs CSS
  - site_structure: Informations sur la structure
```

### Étape 4 : Stockage Structuré (SiteDataStorage)

```
┌─────────────────────────────────────────────────────────────┐
│ ÉTAPE 4: STOCKAGE STRUCTURÉ                                  │
└─────────────────────────────────────────────────────────────┘

SiteDataStorage.save_site_data()
  │
  └─> Écrit cache/{cache_key}_data.json
      │
      └─> Contient:
          ├─> site_url
          ├─> exploration_date
          ├─> product_urls: [toutes les URLs découvertes]
          ├─> html_samples: {url: html_content} (max 20 pages)
          ├─> extracted_products: [produits extraits par Gemini]
          ├─> detected_selectors: {champ: sélecteur_css}
          ├─> site_structure: {structure_type, domain, ...}
          └─> metadata: {data_version: "1.0", ...}
```

### Étape 5 : Génération du Scraper (ScraperGenerator avec Gemini)

```
┌─────────────────────────────────────────────────────────────┐
│ ÉTAPE 5: GÉNÉRATION DU SCRAPER PAR GEMINI                   │
└─────────────────────────────────────────────────────────────┘

ScraperGenerator.generate_scraper(site_data)
  │
  ├─> Charge le template (scraper_template.py)
  │   └─> Template sert de RÉFÉRENCE structurelle uniquement
  │
  ├─> Prépare les données pour Gemini:
  │   ├─> product_urls: Liste complète (limité à 500 pour le prompt)
  │   ├─> detected_selectors: Tous les sélecteurs CSS
  │   ├─> html_samples: Échantillons HTML (max 20 pages, 30k chars chacune)
  │   └─> extracted_products: Produits extraits (max 10 pour référence)
  │
  └─> Appelle Gemini avec prompt complet
      │
      ├─> Prompt contient:
      │   ├─> Template de référence (structure de base)
      │   ├─> URLs de produits à hardcoder
      │   ├─> Sélecteurs CSS à hardcoder
      │   ├─> Échantillons HTML (pour comprendre la structure)
      │   └─> Produits extraits (pour référence)
      │
      ├─> Instructions à Gemini:
      │   ├─> Génère un scraper Python complet et autonome
      │   ├─> Hardcode TOUTES les URLs dans PRODUCT_URLS
      │   ├─> Hardcode TOUS les sélecteurs dans SELECTORS
      │   ├─> Utilise le template comme référence mais adapte au site
      │   ├─> Support Selenium pour JavaScript
      │   ├─> Scraping parallèle (20 threads)
      │   ├─> Fallbacks robustes pour nom, prix, image
      │   └─> Valide que les produits ont un nom valide (pas de labels)
      │
      └─> Gemini génère le code Python
          │
          ├─> Code généré contient:
          │   ├─> PRODUCT_URLS = [url1, url2, ...]  # Hardcodé
          │   ├─> SELECTORS = {"name": "...", ...}   # Hardcodé
          │   ├─> def scrape(base_url): ...
          │   ├─> Scraping parallèle avec ThreadPoolExecutor
          │   ├─> Extraction avec sélecteurs hardcodés
          │   ├─> Fallbacks robustes
          │   └─> Support Selenium si nécessaire
          │
          └─> Sauvegarde dans cache/{cache_key}_scraper.py
              │
              └─> Métadonnées en commentaires:
                  ├─> Version prompt
                  ├─> Cache key
                  ├─> Site URL
                  ├─> Date génération
                  └─> URLs et sélecteurs count
```

### Étape 6 : Exécution du Scraper

```
┌─────────────────────────────────────────────────────────────┐
│ ÉTAPE 6: EXÉCUTION DU SCRAPER GÉNÉRÉ                        │
└─────────────────────────────────────────────────────────────┘

ScraperExecutor.execute_scraper(url, scraper_data)
  │
  ├─> Charge le code Python depuis scraper_data
  │
  ├─> Crée un namespace d'exécution
  │   ├─> requests, BeautifulSoup, re, etc.
  │   ├─> ThreadPoolExecutor (pour parallélisme)
  │   └─> Selenium (si nécessaire)
  │
  └─> Exécute le code généré
      │
      └─> exec(scraper_code, namespace)
          │
          └─> Appelle scrape(base_url)
              │
              ├─> Utilise PRODUCT_URLS hardcodé
              │
              ├─> Scraping parallèle (20 threads)
              │   └─> ThreadPoolExecutor(max_workers=20)
              │
              ├─> Pour chaque URL:
              │   ├─> Récupère HTML (requests ou Selenium)
              │   ├─> Utilise SELECTORS hardcodé
              │   ├─> Fallbacks si sélecteur échoue
              │   └─> Valide nom (rejette labels comme "Nom complet : *")
              │
              └─> Retourne résultats
                  │
                  └─> {companyInfo: {...}, products: [...]}
```

---

## 🌐 Flux depuis le Dashboard Web

### Lancement du Scraping depuis le Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ LANCEMENT DEPUIS LE DASHBOARD                               │
└─────────────────────────────────────────────────────────────┘

1. Interface Utilisateur (React)
   └─> scraper-config.tsx
       │
       └─> Utilisateur clique sur "Lancer le scraping"
           │
           └─> Appelle /api/scraper-ai/run

2. API Route Next.js
   └─> dashboard_web/src/app/api/scraper-ai/run/route.ts
       │
       ├─> Reçoit: {urls: [...], referenceUrl: "..."}
       │
       ├─> Lance processus Python en arrière-plan
       │   └─> nohup python -m scraper_ai.main ...
       │
       ├─> Détache le processus (nohup)
       │   └─> Le serveur Next.js ne bloque pas
       │
       ├─> Sauvegarde PID dans scraper_logs/{timestamp}.lock
       │
       └─> Retourne: {pid: ..., message: "Scraping démarré"}

3. Processus Python (en arrière-plan)
   └─> scraper_ai/main.py
       │
       ├─> Pour chaque URL:
       │   └─> ScraperExecutor.scrape_site(url)
       │       │
       │       ├─> Vérifie cache (ÉTAPE 2)
       │       ├─> Exploration si nécessaire (ÉTAPE 3)
       │       ├─> Génération scraper (ÉTAPE 5)
       │       └─> Exécution scraper (ÉTAPE 6)
       │
       └─> Sauvegarde résultats dans scraped_data.json

4. Polling du Statut (Dashboard)
   └─> scraper-config.tsx (useEffect)
          │
       ├─> Poll /api/scraper/status?pid={pid} toutes les 5 secondes
       │
       ├─> Vérifie si processus est encore en cours
       │   └─> isProcessRunning(pid)
          │
       ├─> Lit scraped_data.json pour compter produits
       │
       └─> Affiche statut en temps réel:
           ├─> "⏳ Scraping en cours... X produits extraits"
           └─> "✅ Scraping terminé! X produits extraits"
```

### Suppression d'un Scraper depuis le Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ SUPPRESSION D'UN SCRAPER                                    │
└─────────────────────────────────────────────────────────────┘

1. Interface Utilisateur (React)
   └─> Utilisateur clique sur "Supprimer" pour un scraper
       │
       └─> Appelle DELETE /api/scraper-ai/cache?key={cacheKey}

2. API Route Next.js
   └─> dashboard_web/src/app/api/scraper-ai/cache/route.ts
  │
       ├─> Reçoit: cacheKey ou url
       │
       ├─> Cherche fichier dans scraper_cache/
       │   ├─> Si cacheKey fourni:
       │   │   └─> Supprime {cacheKey}.json
       │   │
       │   └─> Si url fourni:
       │       └─> Parcourt tous les fichiers .json
       │           └─> Trouve celui avec metadata.url === url
       │               └─> Supprime le fichier
       │
       └─> Retourne: {success: true, deleted: true}

3. Fichiers Supprimés
   └─> scraper_cache/{cache_key}.json
       │
       └─> NOTE: Le fichier {cache_key}_scraper.py n'est PAS supprimé
           └─> Il reste dans le cache mais ne sera plus utilisé
               (car _load_cached_scraper cherche d'abord le .py)

4. Impact sur le Prochain Scrape
   └─> Lors du prochain scrape du même site:
       │
       ├─> HTMLAnalyzer.analyze_and_generate_scraper()
       │   │
       │   ├─> _load_cached_scraper()
       │   │   └─> Cherche {cache_key}_scraper.py
       │   │       │
       │   │       ├─> Si .py existe (pas supprimé)
       │   │       │   └─> Utilise le scraper en cache → ÉTAPE 6
       │   │       │
       │   │       └─> Si .py n'existe pas
       │   │           │
       │   │           └─> SiteDataStorage.load_site_data()
       │   │               └─> Cherche {cache_key}_data.json
       │   │                   │
       │   │                   ├─> Si _data.json existe
       │   │                   │   └─> Réutilise données → ÉTAPE 5
       │   │                   │       (Régénère scraper sans re-exploration)
       │   │                   │
       │   │                   └─> Si _data.json n'existe pas
       │   │                       └─> Exploration complète → ÉTAPE 3
       │   │
       │   └─> Si force_refresh == True
       │       └─> Skip cache → Exploration complète → ÉTAPE 3
```

### Analyse d'un Site depuis le Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ ANALYSE D'UN SITE                                           │
└─────────────────────────────────────────────────────────────┘

1. Interface Utilisateur (React)
   └─> ai-agent.tsx
       │
       └─> Utilisateur entre une URL et clique sur "Analyser"
           │
           └─> Appelle POST /api/scraper-ai/analyze

2. API Route Next.js
   └─> dashboard_web/src/app/api/scraper-ai/analyze/route.ts
       │
       ├─> Reçoit: {url: "https://example.com"}
       │
       ├─> Lance HTMLAnalyzer.analyze_and_generate_scraper()
       │   │
       │   ├─> Vérifie cache (ÉTAPE 2)
       │   ├─> Exploration si nécessaire (ÉTAPE 3)
       │   ├─> Stockage données (ÉTAPE 4)
       │   └─> Génération scraper (ÉTAPE 5)
       │
       └─> Retourne: {scraperCode, siteAnalysis, fieldMappings}

3. Affichage dans le Dashboard
   └─> Affiche les résultats de l'analyse:
       ├─> Nom du site
       ├─> Type de structure
       ├─> Sélecteurs détectés
       └─> Code du scraper généré
```

---

## 📦 Système de Cache et Fichiers

```
┌─────────────────────────────────────────────────────────────┐
│ SYSTÈME DE CACHE                                            │
└─────────────────────────────────────────────────────────────┘

STRUCTURE DES FICHIERS:

scraper_cache/
├── {cache_key}_data.json          ← Données d'exploration
│   ├─> product_urls: [...]
│   ├─> html_samples: {...}
│   ├─> extracted_products: [...]
│   ├─> detected_selectors: {...}
│   ├─> site_structure: {...}
│   └─> metadata: {data_version: "1.0", ...}
│
└── {cache_key}_scraper.py         ← Scraper Python généré
    ├─> Métadonnées en commentaires
    ├─> PRODUCT_URLS = [...]       (hardcodé)
    ├─> SELECTORS = {...}          (hardcodé)
    └─> def scrape(base_url): ...  (code personnalisé)

scraper_logs/
└── {timestamp}.lock               ← Lock file pour processus en cours
    ├─> pid: 12345
    ├─> startTime: 1234567890
    ├─> urls: [...]
    └─> referenceUrl: "..."

scraped_data.json                  ← Résultats finaux
└── {
      "https://site1.com": {
        "companyInfo": {...},
        "products": [...]
      },
      ...
    }
```

### Logique de Cache

```
CHARGEMENT DU CACHE:

1. Cherche {cache_key}_scraper.py
   ├─> Si existe → Utilise scraper en cache → ÉTAPE 6
   └─> Si n'existe pas → Continue

2. Cherche {cache_key}_data.json
   ├─> Si existe → Réutilise données → ÉTAPE 5 (régénère scraper)
   └─> Si n'existe pas → Exploration complète → ÉTAPE 3

INVALIDATION DU CACHE:

1. Suppression manuelle (Dashboard)
   └─> Supprime {cache_key}.json (ancien format)
       └─> Le .py reste mais n'est plus utilisé si .json manquant

2. Force refresh (--force-refresh)
   └─> Skip cache → Exploration complète

3. Version différente (PROMPT_VERSION)
   └─> Invalide automatiquement → Régénère
```

---

## 🔍 Détail : ExplorationAgent

```
┌─────────────────────────────────────────────────────────────┐
│ EXPLORATIONAGENT - DÉCOUVERTE DES URLs                      │
└─────────────────────────────────────────────────────────────┘

ExplorationAgent._discover_product_urls()
  │
  ├─> 1. SITEMAP (Priorité absolue)
  │   └─> get_sitemap_urls(url)
  │       │
  │       ├─> Cherche sitemap.xml
  │       ├─> Parse sitemap
  │       └─> Filtre URLs non-produits
  │           └─> _is_valid_product_url()
  │               ├─> Exclut: /service, /article, /blog, /contact, etc.
  │               └─> Inclut seulement: URLs avec indicateurs produits
  │
  ├─> 2. PAGINATION
  │   └─> detect_pagination()
  │       │
  │       ├─> Détecte pattern de pagination
  │       ├─> Boucle pagination (max 200 pages)
  │       └─> discover_product_urls() sur chaque page
  │
  ├─> 3. NAVIGATION / CATÉGORIES
  │   └─> discover_product_urls()
  │       │
  │       ├─> Parse HTML
  │       ├─> Extrait liens
  │       └─> Filtre URLs non-produits
  │
  └─> 4. VALIDATION STRICTE
      └─> _is_valid_product_url()
  │
          ├─> Exclut segments:
          │   ├─> /service, /services, /sav
          │   ├─> /article, /articles, /blog
          │   ├─> /contact, /about, /a-propos
          │   └─> /politique, /cgv, /mentions-legales
  │
          └─> Inclut seulement si:
              ├─> Contient indicateurs produits (moto, inventaire, etc.)
              └─> Format structuré (chiffres, segments multiples)
```

---

## 🛠️ Détail : Génération avec Gemini

```
┌─────────────────────────────────────────────────────────────┐
│ SCRAPERGENERATOR - GÉNÉRATION AVEC GEMINI                   │
└─────────────────────────────────────────────────────────────┘

ScraperGenerator._generate_with_gemini()
  │
  ├─> Prépare le prompt:
  │   ├─> Template de référence (structure de base)
  │   ├─> URLs de produits (JSON, max 500)
  │   ├─> Sélecteurs CSS (JSON)
  │   ├─> Échantillons HTML (max 10 pages, 5k chars chacune)
  │   └─> Produits extraits (max 10, pour référence)
  │
  ├─> Instructions à Gemini:
  │   ├─> Génère scraper Python complet et autonome
  │   ├─> Hardcode TOUTES les URLs dans PRODUCT_URLS
  │   ├─> Hardcode TOUS les sélecteurs dans SELECTORS
  │   ├─> Utilise template comme référence mais adapte
  │   ├─> Support Selenium pour JavaScript
  │   ├─> Scraping parallèle (20 threads)
  │   ├─> Fallbacks robustes (nom, prix, image)
  │   └─> Valide nom (rejette labels)
  │
  ├─> Appelle Gemini:
  │   └─> gemini_client.call(prompt, response_mime_type="text/plain")
  │       │
  │       └─> Retourne code Python brut
  │
  ├─> Nettoie le code:
  │   ├─> Enlève markdown code blocks si présents
  │   └─> Valide syntaxe Python
  │
  └─> Fallback si Gemini échoue:
      └─> _generate_fallback()
          │
          └─> Utilise template.format() avec échappement correct
```

---

## 🎯 Cas d'Usage Typiques

### Cas 1 : Premier Scrape (Pas de Cache)

```
1. Exploration complète (ExplorationAgent)
   ├─> Découverte URLs (sitemap, pagination, navigation)
   ├─> Récupération HTML (20 pages échantillons)
   ├─> Extraction Gemini (10 pages)
   └─> Détection sélecteurs CSS

2. Stockage données (SiteDataStorage)
   └─> Sauvegarde {cache_key}_data.json

3. Génération scraper (ScraperGenerator avec Gemini)
   └─> Gemini génère scraper personnalisé
       └─> Sauvegarde {cache_key}_scraper.py

4. Exécution scraper
   └─> Scraping parallèle (20 threads)
       └─> Utilise URLs et sélecteurs hardcodés
```

### Cas 2 : Scrape Suivant (Cache Existant)

```
1. Vérification cache
   ├─> {cache_key}_scraper.py existe
   └─> Utilise scraper en cache → ÉTAPE 6

2. Exécution scraper
   └─> Scraping parallèle (rapide, pas de re-exploration)
```

### Cas 3 : Scraper Supprimé mais Données Existantes

```
1. Vérification cache
   ├─> {cache_key}_scraper.py n'existe pas
   └─> {cache_key}_data.json existe

2. Réutilisation données
   └─> Charge données d'exploration depuis _data.json

3. Régénération scraper (ScraperGenerator avec Gemini)
   └─> Gemini régénère scraper depuis données existantes
       └─> Pas de re-exploration Gemini (économise API calls)

4. Exécution scraper
   └─> Scraping parallèle
```

### Cas 4 : Suppression Complète (Dashboard)

```
1. Utilisateur supprime scraper depuis dashboard
   └─> DELETE /api/scraper-ai/cache?key={cacheKey}
       └─> Supprime {cache_key}.json (ancien format)

2. Prochain scrape
   ├─> {cache_key}_scraper.py existe toujours
   │   └─> Utilise scraper en cache → ÉTAPE 6
   │
   └─> Si .py supprimé manuellement:
       ├─> {cache_key}_data.json existe
       │   └─> Réutilise données → ÉTAPE 5
       └─> Si _data.json aussi supprimé
           └─> Exploration complète → ÉTAPE 3
```

---

## 🚨 Gestion des Erreurs

```
ERREURS POSSIBLES:

1. IndexError lors de la génération
   └─> Cause: Accolades non échappées dans template
   └─> Solution: Template utilise {{ }} pour échapper

2. ModuleNotFoundError
   └─> Cause: Import circulaire
   └─> Solution: PROMPT_VERSION déplacé dans config.py

3. Scraper génère "MVM Motosport" au lieu de noms produits
   └─> Cause: Sélecteur pointe vers header/nav
   └─> Solution: is_in_header_nav_footer() + is_generic_name()

4. ERR_CONNECTION_REFUSED depuis dashboard
   └─> Cause: Serveur Next.js non démarré
   └─> Solution: npm run dev dans dashboard_web/

5. Serveur crash lors du lancement scraper
   └─> Cause: Processus Python non détaché
   └─> Solution: nohup + shell script + unref()
```

---

## 📝 Résumé des Fichiers Clés

```
scraper_ai/
├── main.py                    ← Point d'entrée CLI
├── scraper_executor.py        ← Orchestrateur + exécution
├── html_analyzer.py           ← Analyse + génération scraper
├── exploration_agent.py       ← Exploration + extraction Gemini
├── scraper_generator.py       ← Génération scraper avec Gemini
├── site_data_storage.py       ← Stockage données structurées
├── ai_tools.py                ← Outils disponibles pour scraper
├── gemini_client.py           ← Client API Gemini
├── config.py                  ← Configuration + schémas
│   └── PROMPT_VERSION = "3.3" ← Version du prompt
├── templates/
│   └── scraper_template.py    ← Template de référence
└── scraper_cache/             ← Cache des scrapers générés
    ├── {cache_key}_data.json  ← Données d'exploration
    └── {cache_key}_scraper.py ← Scraper Python généré

dashboard_web/
├── src/app/api/
│   ├── scraper-ai/
│   │   ├── analyze/route.ts    ← Analyse site
│   │   ├── run/route.ts        ← Lance scraping
│   │   └── cache/route.ts     ← Gestion cache (GET/DELETE)
│   └── scraper/
│       ├── run/route.ts        ← Lance scraping (ancien)
│       └── status/route.ts     ← Statut scraping
└── src/components/
    ├── ai-agent.tsx            ← Interface analyse
    ├── scraper-config.tsx      ← Interface scraping
    └── scraper-dashboard.tsx   ← Affichage produits
```

---

## 🎓 Points Clés à Retenir

1. **Nouveau flux en 3 étapes** :
   - ExplorationAgent découvre URLs et extrait infos
   - SiteDataStorage sauvegarde données structurées
   - ScraperGenerator génère scraper personnalisé avec Gemini

2. **Template comme référence** :
   - Le template sert de structure de base
   - Gemini adapte le code au site spécifique
   - URLs et sélecteurs sont hardcodés dans le scraper généré

3. **Cache en 2 fichiers** :
   - `{cache_key}_data.json` : Données d'exploration
   - `{cache_key}_scraper.py` : Scraper Python généré

4. **Réutilisation intelligente** :
   - Si scraper existe → Utilise directement
   - Si scraper manque mais données existent → Régénère sans re-exploration
   - Si tout manque → Exploration complète

5. **Suppression depuis dashboard** :
   - Supprime seulement les fichiers `.json` (ancien format)
   - Les fichiers `.py` restent mais peuvent être ignorés
   - Prochain scrape réutilise `.py` si existe, sinon régénère depuis `.json` si existe

6. **Scraping parallèle** :
   - 20 threads simultanés
   - Utilise ThreadPoolExecutor
   - URLs et sélecteurs hardcodés pour performance

---

**Date de mise à jour :** 2025-01-27
**Version du prompt :** 3.3
**Architecture :** ExplorationAgent → SiteDataStorage → ScraperGenerator (Gemini)
