# Scraper AI - Approche basée sur l'analyse HTML par Gemini

Cette nouvelle approche utilise Gemini pour analyser le HTML d'un site web et générer automatiquement un scraper Python spécifique pour chaque site. Les scrapers générés sont mis en cache pour une réutilisation future.

## Fonctionnalités principales

### 🔍 Analyse intelligente multi-pages
Gemini analyse d'abord la page d'accueil et décide intelligemment si d'autres pages sont nécessaires pour comprendre la structure complète du site:
- Pages de listing de produits (inventaire, catalogue)
- Pages de détail d'un produit
- Pages de contact pour les informations entreprise
- Pages de catégories si structures différentes

### 🤖 Génération automatique de scraper
- Crée un code Python complet et fonctionnel pour chaque site
- Sélecteurs CSS/XPath précis basés sur l'analyse du HTML
- Gestion automatique de tous les champs du schéma

### 💾 Cache intelligent
- Les scrapers générés sont sauvegardés et réutilisés automatiquement
- Option pour forcer la régénération si nécessaire
- Option pour invalider le cache d'un site

### 📑 Gestion de pagination
Détecte et gère automatiquement tous les types de pagination:
- Pagination par URL (?page=2)
- Bouton "Suivant"
- Scroll infini (détection)
- Limite de sécurité automatique

### ⚡ Scraping parallèle
- Tous les sites sont scrapés simultanément
- Max 4 sites en parallèle pour éviter la surcharge

### 💰 Comparaison de prix intelligente
- Seuls les produits présents chez le concurrent ET le site de référence sont affichés
- Matching par : marque + modèle + année
- Différence de prix calculée automatiquement

## Structure

```
scraper_ai/
├── __init__.py              # Package Python
├── config.py                # Configuration et schémas
├── gemini_client.py         # Client pour les appels Gemini API
├── html_analyzer.py         # Analyse HTML et génération de scraper (multi-pages)
├── scraper_executor.py      # Exécution des scrapers générés
├── main.py                  # Point d'entrée principal
└── README.md                # Ce fichier
```

## Utilisation

### Scraper un seul site

Pour scraper un seul site sans comparaison de prix :

**Depuis le répertoire parent du projet** (`/scraper_mav/`) :
```bash
python -m scraper_ai.main https://www.mvmmotosport.com/fr/
```

**Depuis le répertoire `scraper_ai/`** :
```bash
python main.py https://www.mvmmotosport.com/fr/
```

Le scraper va :
1. Analyser le site et générer un scraper Python spécifique
2. Sauvegarder le scraper dans le cache (`scraper_cache/`)
3. Exécuter le scraper pour extraire tous les produits
4. Sauvegarder les résultats dans `scraped_data.json`

### Scraper avec comparaison de prix

Pour comparer les prix avec un site de référence :

**Depuis le répertoire parent** :
```bash
python -m scraper_ai.main --reference https://mvmmotosport.com/fr/ https://concurrent1.com https://concurrent2.com
```

**Depuis le répertoire `scraper_ai/`** :
```bash
python main.py --reference https://mvmmotosport.com/fr/ https://concurrent1.com https://concurrent2.com
```

### Forcer la régénération des scrapers

Pour régénérer un scraper même s'il existe déjà dans le cache :

**Depuis le répertoire parent** :
```bash
python -m scraper_ai.main --force-refresh https://site1.com https://site2.com
```

**Depuis le répertoire `scraper_ai/`** :
```bash
python main.py --force-refresh https://site1.com https://site2.com
```

### Invalider le cache

Pour supprimer le cache d'un site spécifique :

**Depuis le répertoire parent** :
```bash
python -m scraper_ai.main --invalidate-cache https://site.com
```

**Depuis le répertoire `scraper_ai/`** :
```bash
python main.py --invalidate-cache https://site.com
```

## Comment ça fonctionne

### Étape 1: Récupération de la page d'accueil
Le système récupère le contenu HTML de la page d'accueil du site.

### Étape 2: Analyse et sélection de pages
Gemini analyse la page d'accueil et décide intelligemment si d'autres pages sont nécessaires.

### Étape 3: Génération du scraper
Avec tout le contexte des pages analysées, Gemini génère un code Python complet.

### Étape 4: Mise en cache
Le scraper généré est sauvegardé dans `scraper_cache/` pour réutilisation.

### Étape 5: Exécution parallèle
Tous les sites sont scrapés en parallèle.

### Étape 6: Comparaison
Seuls les produits avec correspondance dans le site de référence sont conservés.

## Cache

Les scrapers générés sont mis en cache dans le dossier `scraper_cache/` à la racine du projet.

- Chaque site a un fichier de cache unique basé sur son domaine
- Utilisez `--force-refresh` pour régénérer un scraper
- Utilisez `--invalidate-cache` pour supprimer le cache

## Estimation du temps

- ~30s par site en cache
- ~90s par nouveau site (analyse + génération)

