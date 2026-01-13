# 📋 Schéma du Scraping

## Vue d'ensemble

Le système de scraping extrait les produits de plusieurs sites web en parallèle, compare les prix avec un site de référence, et organise les résultats dans des onglets séparés.

## 🔄 Flux de Scraping

### 1. **Initialisation** (`main.py`)
```
Input: 
  - referenceUrl: URL du site de référence (ex: https://www.mvmmotosport.com/fr/)
  - urls: Liste des URLs concurrents à scraper

Actions:
  - Valide les URLs
  - Prépare la liste de tous les URLs à scraper (référence + concurrents)
  - Lance le scraping parallèle
```

### 2. **Scraping Parallèle** (`main.py` → `scraper.py`)
```
Pour chaque URL (en parallèle avec ThreadPoolExecutor):
  ├─ SupplierScraper(url).scrape()
  │
  ├─ ÉTAPE 1: Récupération page d'accueil + Extraction liens
  │   └─ Récupère le HTML de la page d'accueil
  │   └─ Extrait tous les liens de navigation
  │
  ├─ ÉTAPE 2: Filtrage des URLs
  │   └─ Identifie les pages de produits (inventory, inventaire, products, etc.)
  │   └─ Exclut les pages non-produits (contact, about, blog, etc.)
  │
  ├─ ÉTAPE 3: Pagination intelligente
  │   └─ Détecte le pattern de pagination (?page=2, /page/2/, etc.)
  │   └─ Itère jusqu'à MAX_PAGES_TO_VISIT (50 pages max)
  │   └─ Collecte toutes les URLs de pages de produits
  │
  ├─ ÉTAPE 4: Téléchargement parallèle des pages
  │   └─ Télécharge toutes les pages en parallèle (10 workers)
  │   └─ Utilise Requests (rapide) ou Selenium (si JavaScript requis)
  │   └─ Récupère le HTML complet de chaque page
  │
  └─ ÉTAPE 5: Extraction Gemini
      └─ Envoie le HTML complet à Gemini (flash-lite pour rapidité)
      └─ Gemini extrait les produits selon EXTRACTION_SCHEMA
      └─ Filtre les produits valides (marque + modèle + prix requis)
      └─ Retourne la liste des produits
```

### 3. **Comparaison des Prix** (`main.py`)
```
Pour chaque site concurrent:
  ├─ compare_prices(reference_products, competitor_products, reference_url)
  │
  ├─ Normalise les clés produits (marque + modèle + année)
  │
  ├─ Pour chaque produit concurrent:
  │   ├─ Cherche correspondance dans les produits de référence
  │   ├─ Si correspondance trouvée:
  │   │   ├─ Ajoute prixReference (prix du site de référence)
  │   │   ├─ Calcule differencePrix (prix - prixReference)
  │   │   └─ Ajoute siteReference (URL du site de référence)
  │   └─ Si pas de correspondance:
  │       └─ Produit gardé mais sans prixReference (pour l'onglet du site)
  │
  └─ Retourne uniquement les produits avec correspondance
```

### 4. **Organisation des Produits** (`main.py`)
```
Produits sauvegardés dans scraped_data.json:

1. TOUS les produits du site de référence
   - sourceSite: URL du site de référence
   - siteReference: URL du site de référence
   - prixReference: prix du produit (pour cohérence)
   - differencePrix: 0 (c'est la référence)

2. TOUS les produits des sites concurrents
   - sourceSite: URL du site concurrent
   - Si correspondance trouvée:
     - prixReference: prix du produit sur le site de référence
     - differencePrix: différence de prix
     - siteReference: URL du site de référence
   - Si pas de correspondance:
     - prixReference: null
     - differencePrix: null
```

### 5. **Affichage dans le Dashboard** (`scraper-dashboard.tsx`)
```
Onglets créés automatiquement:

1. Onglet "Comparés"
   - Affiche uniquement les produits avec prixReference !== null
   - Montre la différence de prix avec le site de référence
   - Statistiques: plus cher, moins cher, prix moyen

2. Onglet "Référence" (⭐)
   - Affiche TOUS les produits du site de référence
   - sourceSite === referenceSite

3. Onglet pour chaque site concurrent
   - Affiche TOUS les produits de ce site
   - sourceSite === URL du site concurrent
```

## 📊 Structure des Données

### Format JSON (`scraped_data.json`)
```json
{
  "products": [
    {
      "name": "Yamaha YZ450F 2024",
      "marque": "Yamaha",
      "modele": "YZ450F",
      "annee": 2024,
      "prix": 12999,
      "disponibilite": "en_stock",
      "category": "motocross",
      "sourceSite": "https://www.mvmmotosport.com/fr/",
      "sourceUrl": "https://www.mvmmotosport.com/fr/inventaire/...",
      "sourceCategorie": "inventaire",
      "image": "https://...",
      "siteReference": "https://www.mvmmotosport.com/fr/",
      "prixReference": 12999,  // Si correspondance trouvée
      "differencePrix": 0       // Si correspondance trouvée
    }
  ]
}
```

## ⚡ Optimisations pour Rapidité

1. **Scraping Parallèle**
   - Sites scrapés en parallèle (ThreadPoolExecutor, 5 workers)
   - Pages scrapées en parallèle (10 workers)

2. **Modèle Gemini Flash-Lite**
   - Utilise `gemini-flash-lite-latest` (plus rapide que pro)
   - Extraction en lots de 1M caractères max

3. **Limites de Pagination**
   - MAX_PAGES_TO_VISIT: 50 pages max par site
   - Évite les boucles infinies

4. **Priorité Requests**
   - Utilise Requests (rapide) en priorité
   - Selenium seulement si JavaScript requis
   - Timeouts réduits (1s au lieu de 2s)

## 🔑 Clés de Correspondance

Les produits sont comparés selon:
- **marque** (normalisée: minuscules, espaces unifiés)
- **modèle** (normalisée: minuscules, espaces unifiés)
- **année** (exacte)

Exemple:
- "Yamaha YZ450F 2024" = "yamaha yz450f 2024"
- Correspondance trouvée si les 3 critères correspondent

## 📁 Fichiers Clés

- `scraper/main.py`: Point d'entrée, orchestration, comparaison
- `scraper/scraper.py`: Logique de scraping (pagination, extraction)
- `scraper/gemini_client.py`: Client Gemini pour extraction
- `scraper/config.py`: Configuration (schémas, limites)
- `scraped_data.json`: Résultats sauvegardés
- `dashboard_web/src/components/scraper-dashboard.tsx`: Interface avec onglets

## 🎯 Résultat Final

- **Onglet Comparés**: Produits présents sur les 2 sites avec différence de prix
- **Onglet Référence**: Tous les produits du site de référence
- **Onglets Concurrents**: Tous les produits de chaque site concurrent

Temps estimé: **1-2 minutes** pour 2 sites (scraping parallèle)

