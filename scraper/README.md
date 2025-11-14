# Scraper Modulaire

Le scraper a été refactorisé en plusieurs modules pour améliorer la maintenabilité.

## Structure

```
scripts/scraper/
├── __init__.py          # Package Python
├── config.py            # Configuration et schémas JSON
├── selenium_utils.py    # Gestion Selenium (chromedriver, popups)
├── extractors.py        # Extraction de données (texte, images, liens)
├── gemini_client.py     # Client pour les appels Gemini API
├── scraper.py           # Classe principale SupplierScraper
├── main.py              # Point d'entrée
└── README.md            # Ce fichier
```

## Modules

### `config.py`
- Constantes (GEMINI_API_KEY, MODEL, limites)
- Schémas JSON (EXTRACTION_SCHEMA, PAGE_SELECTION_SCHEMA)
- Formats d'images supportés

### `selenium_utils.py`
- Gestion de chromedriver (installation, Gatekeeper)
- Gestion des popups (langue, cookies)
- Extraction de liens avec Selenium
- Fonction `fetch_page_with_selenium()`

### `extractors.py`
- `extract_contact_info_from_links()` - Extraction email, téléphone, adresse
- `extract_visible_text()` - Extraction du texte visible
- `extract_images()` - Extraction des images de la page
- `download_image()` - Téléchargement d'images
- `extract_navigation_links()` - Extraction des liens de navigation

### `gemini_client.py`
- Classe `GeminiClient` pour les appels API
- Gestion des erreurs et validation des réponses
- Support des prompts multimodaux (texte + images)

### `scraper.py`
- Classe principale `SupplierScraper`
- Méthode `scrape()` - Flow principal optimisé (2 appels Gemini)
- Méthode `select_pages_and_extract_contact_info()` - Premier appel Gemini
- Méthode `extract_all_data_mega_call()` - Deuxième appel Gemini (mega call)

### `main.py`
- Point d'entrée principal
- Gestion des arguments en ligne de commande
- Affichage des résultats

## Utilisation

### Depuis le répertoire scripts/
```bash
python -m scraper.main <url>
```

### Depuis le répertoire racine
```bash
cd scripts
python -m scraper.main <url>
```

### Script de compatibilité
Un script de compatibilité `supplier-scraper-gemini-refactored.py` est disponible pour maintenir la compatibilité avec l'ancien script.

## Avantages de la refactorisation

1. **Maintenabilité**: Code organisé en modules logiques
2. **Réutilisabilité**: Modules peuvent être utilisés indépendamment
3. **Testabilité**: Plus facile de tester chaque module séparément
4. **Lisibilité**: Fichiers plus courts et plus faciles à comprendre
5. **Évolutivité**: Plus facile d'ajouter de nouvelles fonctionnalités

## Migration depuis l'ancien script

L'ancien script `supplier-scraper-gemini.py` (2492 lignes) a été divisé en plusieurs modules. La fonctionnalité reste identique, mais le code est maintenant mieux organisé.

Pour utiliser le nouveau scraper:
```bash
python -m scraper.main <url>
```

Ou utilisez le script de compatibilité:
```bash
python supplier-scraper-gemini-refactored.py <url>
```

