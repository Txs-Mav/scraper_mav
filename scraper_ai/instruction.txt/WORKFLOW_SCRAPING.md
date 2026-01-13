# Schéma de Workflow : Scraping avec Selenium

## Vue d'ensemble du processus

```
┌─────────────────────────────────────────────────────────────────┐
│                    DÉMARRAGE DU SCRAPING                        │
│              python3 -m scraper_ai.main <URL>                   │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ÉTAPE 1 : EXPLORATION ET DÉCOUVERTE DES URLs                   │
│  (ExplorationAgent)                                             │
└────────────────────────────┬────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                             │
        ▼                                             ▼
┌──────────────────┐                        ┌──────────────────┐
│ Recherche        │                        │ Détection        │
│ Sitemap          │                        │ Pagination       │
│ (robots.txt)     │                        │ (patterns)       │
└────────┬─────────┘                        └────────┬─────────┘
         │                                            │
         └────────────────┬───────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ 469 URLs découvertes   │
              │ (exemple)              │
              └───────────┬────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  ÉCHANTILLONNAGE : Récupération de 20 pages HTML                │
│  (pour analyse Gemini - détection des patterns)                  │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ÉTAPE 2 : ANALYSE AVEC GEMINI                                   │
│  (HTMLAnalyzer)                                                 │
└────────────────────────────┬────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                             │
        ▼                                             ▼
┌──────────────────┐                        ┌──────────────────┐
│ Extraction       │                        │ Détection        │
│ produits via     │                        │ sélecteurs CSS   │
│ Gemini           │                        │ automatique      │
│ (10 produits)    │                        │ (4 sélecteurs)   │
└────────┬─────────┘                        └────────┬─────────┘
         │                                            │
         └────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  ÉTAPE 3 : GÉNÉRATION DU SCRAPER                                │
│  (ScraperGenerator)                                              │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────┐
              │ Template rempli avec:  │
              │ - 469 URLs hardcodées │
              │ - 4 sélecteurs CSS    │
              └───────────┬────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  ÉTAPE 4 : EXÉCUTION DU SCRAPER GÉNÉRÉ                           │
│  (ScraperExecutor)                                               │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────┐
        │  Pour chaque URL de produit (469 URLs)  │
        └──────────────────┬──────────────────────┘
                           │
                           ▼
        ┌─────────────────────────────────────────┐
        │  DÉCISION : Requests ou Selenium ?      │
        └──────────────────┬──────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
┌──────────────────┐              ┌──────────────────┐
│ ESSAI REQUESTS   │              │ FALLBACK          │
│ (rapide)         │              │ SELENIUM          │
│                  │              │ (si nécessaire)   │
└────────┬─────────┘              └────────┬─────────┘
         │                                  │
         │                                  │
         ▼                                  ▼
┌─────────────────────────────────────────────────────┐
│  RÉCUPÉRATION HTML                                  │
│  - Vérifier si page vide                            │
│  - Détecter popups/modals                           │
│  - Si popup détectée → Selenium                     │
│  - Si erreur requests → Selenium                    │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  EXTRACTION DES DONNÉES PRODUIT                     │
│  (extract_product_from_html)                        │
│  - Utilise les sélecteurs CSS hardcodés             │
│  - Fallback sur patterns génériques                 │
│  - Extraction: nom, prix, image, description, etc.  │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  VALIDATION ET FILTRAGE                            │
│  - Vérifier nom valide (min 3 caractères)          │
│  - Filtrer catégories génériques                    │
│  - Valider marque/modèle                           │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
              ┌─────────┐
              │ Produit │
              │ validé  │
              └────┬────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  Répéter pour les    │
        │  469 URLs            │
        └──────┬───────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  RÉSULTAT FINAL                                      │
│  - Tous les produits extraits                       │
│  - Sauvegardé dans scraped_data.json                │
└─────────────────────────────────────────────────────┘
```

## Détails du workflow avec Selenium

### Phase 1 : Découverte (ExplorationAgent)
```
URL de base
    │
    ├─> Recherche sitemap (robots.txt)
    │   └─> Parse sitemap_index.xml
    │       └─> 1618 URLs trouvées
    │
    ├─> Détection pagination
    │   └─> Test patterns standards (?page=, paged=, etc.)
    │       └─> 469 URLs uniques après déduplication
    │
    └─> Échantillonnage : 20 pages HTML
        └─> Pour analyse Gemini (détection patterns)
```

### Phase 2 : Analyse (HTMLAnalyzer)
```
20 pages HTML échantillonnées
    │
    ├─> Extraction produits via Gemini
    │   └─> 10 produits extraits (exemple)
    │
    └─> Détection sélecteurs CSS automatique
        └─> 4 sélecteurs détectés (name, prix, image, description)
```

### Phase 3 : Génération (ScraperGenerator)
```
Données d'exploration
    │
    ├─> 469 URLs de produits
    ├─> 4 sélecteurs CSS
    └─> Template rempli
        └─> Code Python autonome généré
```

### Phase 4 : Exécution (ScraperExecutor) - AVEC SELENIUM

```
Pour chaque URL de produit (1 à 469):
    │
    ├─> ESSAI 1 : Requests (rapide)
    │   │
    │   ├─> ✅ Succès + HTML complet
    │   │   └─> Continuer avec extraction
    │   │
    │   ├─> ⚠️ HTML vide ou trop court (< 1000 chars)
    │   │   └─> FALLBACK → Selenium
    │   │
    │   └─> ❌ Erreur (timeout, 404, etc.)
    │       └─> FALLBACK → Selenium
    │
    └─> FALLBACK : Selenium (si nécessaire)
        │
        ├─> Détection popup/modal
        │   └─> Si popup détectée → Selenium
        │
        ├─> Chargement page avec Chrome
        │   ├─> Attendre chargement JS (1-2s)
        │   ├─> Scroll pour charger contenu dynamique
        │   └─> Récupérer HTML complet
        │
        └─> Extraction avec BeautifulSoup
            └─> Utiliser sélecteurs CSS hardcodés
```

## Logique de décision Requests vs Selenium

```
┌─────────────────────────────────────────┐
│  DÉBUT : Récupération URL produit        │
└──────────────────┬──────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Essayer REQUESTS      │
        │ (timeout: 10s)        │
        └──────────┬────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
   ✅ Succès            ❌ Erreur
        │                     │
        ▼                     │
┌───────────────┐             │
│ Vérifier HTML │             │
└───────┬───────┘             │
        │                     │
   ┌────┴────┐                │
   │         │                │
   ▼         ▼                │
HTML OK  HTML vide            │
   │      (<1000)             │
   │         │                │
   │         └────────┬───────┘
   │                  │
   │                  ▼
   │         ┌─────────────────┐
   │         │ Détecter popups  │
   │         │ (modals, etc.)  │
   │         └────────┬────────┘
   │                  │
   │         ┌────────┴────────┐
   │         │                 │
   │         ▼                 ▼
   │    Popup OK        Pas de popup
   │         │                 │
   │         └────────┬────────┘
   │                  │
   └──────────────────┘
                      │
                      ▼
            ┌─────────────────┐
            │ Utiliser HTML    │
            │ (Requests ou     │
            │  Selenium)       │
            └────────┬─────────┘
                     │
                     ▼
            ┌─────────────────┐
            │ Extraction       │
            │ produit          │
            └─────────────────┘
```

## Avantages de cette approche hybride

### Requests (priorité)
- ✅ **Rapide** : ~0.5s par page
- ✅ **Léger** : Pas de navigateur à lancer
- ✅ **Efficace** : 90% des pages fonctionnent avec requests

### Selenium (fallback)
- ✅ **JavaScript** : Charge le contenu dynamique
- ✅ **Popups** : Gère les modals/langue automatiquement
- ✅ **Robuste** : Fonctionne même si requests échoue

### Détection automatique
- ✅ **Intelligent** : Détecte automatiquement quand Selenium est nécessaire
- ✅ **Optimisé** : Utilise Selenium seulement si vraiment nécessaire
- ✅ **Résilient** : Fallback automatique en cas d'erreur

## Exemple concret : Scraping de 469 URLs

```
469 URLs à scraper
    │
    ├─> 400 URLs (85%) : Requests ✅
    │   └─> Temps: 400 × 0.5s = 200s (~3.3 min)
    │
    └─> 69 URLs (15%) : Selenium ⚙️
        └─> Temps: 69 × 3s = 207s (~3.5 min)
            │
            └─> Total: ~7 minutes pour 469 produits
```

## Résultat final

```
┌─────────────────────────────────────────┐
│  PRODUITS EXTRAITS                      │
│  - Nom, prix, image, description         │
│  - Marque, modèle, année                │
│  - Catégorie, disponibilité             │
│  - sourceUrl, sourceSite                 │
└─────────────────────────────────────────┘
                │
                ▼
    ┌───────────────────────┐
    │ scraped_data.json      │
    │ (tous les produits)    │
    └───────────────────────┘
```

