# Guide : Démarrer le scraping via le terminal

## Commandes de base

### 1. Scraper un seul site (site de référence uniquement)

```bash
cd /Users/maverickmenard/project/projet_mvm/scraper_mav
python3 -m scraper_ai.main https://www.mvmmotosport.com/fr/
```

### 2. Scraper plusieurs sites avec comparaison de prix

```bash
# Le premier URL sera automatiquement le site de référence
python3 -m scraper_ai.main https://www.mvmmotosport.com/fr/ https://concurrent1.com https://concurrent2.com
```

### 3. Spécifier explicitement le site de référence

```bash
python3 -m scraper_ai.main --reference https://www.mvmmotosport.com/fr/ https://concurrent1.com https://concurrent2.com
```

### 4. Forcer la régénération des scrapers (ignorer le cache)

```bash
python3 -m scraper_ai.main --force-refresh https://www.mvmmotosport.com/fr/
```

### 5. Invalider le cache pour un site

```bash
python3 -m scraper_ai.main --invalidate-cache https://www.mvmmotosport.com/fr/
```

## Exemples pratiques

### Scraper votre site de référence uniquement
```bash
cd /Users/maverickmenard/project/projet_mvm/scraper_mav
python3 -m scraper_ai.main https://www.mvmmotosport.com/fr/
```

### Comparer avec un concurrent
```bash
python3 -m scraper_ai.main \
  --reference https://www.mvmmotosport.com/fr/ \
  https://concurrent.com
```

### Scraper plusieurs concurrents en parallèle
```bash
python3 -m scraper_ai.main \
  --reference https://www.mvmmotosport.com/fr/ \
  https://concurrent1.com \
  https://concurrent2.com \
  https://concurrent3.com
```

## Options disponibles

- `--reference` ou `-r` : Spécifier l'URL du site de référence pour la comparaison des prix
- `--force-refresh` ou `-f` : Forcer la régénération des scrapers (ignorer le cache)
- `--invalidate-cache` ou `-i` : Invalider le cache pour les URLs spécifiées
- `--help` ou `-h` : Afficher l'aide

## Où sont les résultats ?

Les données scrapées sont sauvegardées dans :
- `scraped_data.json` : Fichier JSON avec tous les produits
- `scraper_cache/` : Cache des scrapers générés par l'IA

## Vérifier que tout fonctionne

```bash
# Vérifier que Python peut importer le module
python3 -c "import scraper_ai.main; print('✅ Module OK')"

# Vérifier que GEMINI_API_KEY est configurée
python3 -c "import os; from dotenv import load_dotenv; load_dotenv(); print('✅ GEMINI_API_KEY:', 'Présente' if os.getenv('GEMINI_API_KEY') else '❌ Absente')"
```

