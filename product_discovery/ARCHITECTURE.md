# Product Discovery System — Architecture

## Vue d'ensemble

Le système de découverte de produits remplace le scraping individuel de sites web
par une approche centrée sur le **produit canonique** : un graphe de produits où
chaque produit réel existe une seule fois, avec des listings de multiples sources
qui y sont rattachés.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SOURCES DE DONNÉES                          │
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ Manufacturer │ │   Google     │ │  Marketplaces│ │  Existing  │ │
│  │    Feeds     │ │  Shopping    │ │  (eBay,      │ │  Scrapers  │ │
│  │ (Yamaha,BRP, │ │  (SerpAPI)   │ │   Amazon)    │ │  (Bridge)  │ │
│  │  Honda...)   │ │              │ │              │ │            │ │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └─────┬──────┘ │
└─────────┼────────────────┼────────────────┼───────────────┼────────┘
          │                │                │               │
          ▼                ▼                ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PIPELINE D'INGESTION                           │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    1. FETCH & PARSE                          │   │
│  │  Chaque connecteur extrait les listings bruts de sa source   │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    2. NORMALISATION                           │   │
│  │  • Marques → alias canoniques (Can-Am, Ski-Doo, etc.)       │   │
│  │  • Catégories → taxonomie standard                           │   │
│  │  • Identifiants → nettoyage & formatage                      │   │
│  │  • Prix → float normalisé                                    │   │
│  │  • Extraction année/marque du titre si absent                │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    3. MATCHING                                │   │
│  │  Cascade de stratégies (du plus fiable au plus flou) :       │   │
│  │                                                               │   │
│  │  ① Identifiant exact (GTIN/UPC/EAN/MPN) → 0.99             │   │
│  │  ② VIN prefix (11 chars) → 0.99                              │   │
│  │  ③ Marque + Modèle + Année exact → 0.92                     │   │
│  │  ④ Similarité de titre (SequenceMatcher + Jaccard) → var    │   │
│  │  ⑤ Score composite pondéré → var                             │   │
│  │                                                               │   │
│  │  Si confidence ≥ 0.85 → match automatique                   │   │
│  │  Si 0.50 ≤ confidence < 0.85 → file de révision humaine    │   │
│  │  Si confidence < 0.50 → nouveau produit canonique           │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    4. UPSERT CATALOG                          │   │
│  │  • Créer/mettre à jour le produit canonique                  │   │
│  │  • Créer/mettre à jour le listing                            │   │
│  │  • Enregistrer l'historique des prix                         │   │
│  │  • Mettre à jour les agrégats (avg/min/max)                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     PRODUCT GRAPH (Supabase)                        │
│                                                                     │
│  canonical_products ──1:N──▶ product_listings                       │
│         │                          │                                │
│         │──1:N──▶ product_identifiers                               │
│         │                          │                                │
│         │──1:N──▶ price_history    │──N:1──▶ data_sources           │
│                                                                     │
│  matching_candidates (file de révision humaine)                     │
│  ingestion_runs (audit trail)                                       │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        DASHBOARD (Next.js)                          │
│                                                                     │
│  • Vue comparaison prix par produit canonique                       │
│  • File de révision des matchs incertains                           │
│  • Alertes prix/stock (existant, étendu)                            │
│  • Analytics marché                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Identifiants Produit

### Hiérarchie d'identifiants (du plus universel au plus spécifique)

| Identifiant | Portée | Exemple | Usage |
|-------------|--------|---------|-------|
| **GTIN** | Mondial | 00012345678905 | Identifiant GS1 universel (englobant UPC/EAN) |
| **UPC** | Amérique du Nord | 012345678905 | 12 chiffres, sous-ensemble de GTIN |
| **EAN** | International | 4006381333931 | 13 chiffres, sous-ensemble de GTIN |
| **MPN** | Par fabricant | MT-07-2024 | Part number fabricant |
| **SKU fabricant** | Par fabricant | YAM-MT07-24-BLU | SKU interne fabricant |
| **VIN** | Véhicules | JYARM33... | 17 chars, encode make/model/year |

### Stratégie de résolution

```
Listing entrant → Extraire identifiants → Lookup dans product_identifiers
                                        → Si trouvé: match direct (0.99)
                                        → Sinon: cascade de matching
```

---

## 2. Sources de Données Externes

### Sources recommandées pour le powersports

#### Tier 1 — Feeds fabricants (données les plus fiables)

| Fabricant | Type de feed | Données disponibles |
|-----------|-------------|---------------------|
| **BRP** (Can-Am, Ski-Doo, Sea-Doo) | Dealer Portal API | Catalogue complet, MSRP, specs |
| **Yamaha** | YMUS Dealer Portal / XML | Catalogue, MSRP, specs, images |
| **Honda** | PowerSports Dealer Extranet | Catalogue, prix dealer, disponibilité |
| **Kawasaki** | K-Dealer Portal | Catalogue, MSRP, promotions |
| **Polaris** | Dealer Portal API | Catalogue, disponibilité, specs |
| **Harley-Davidson** | H-D Dealer Portal | Catalogue, prix, configuration |
| **KTM/Husqvarna** | myKTM Dealer API | Catalogue, specs |

#### Tier 2 — Agrégateurs & marketplaces

| Source | API | Coût | Données |
|--------|-----|------|---------|
| **Google Shopping** (SerpAPI) | REST | ~$50/mois | Prix marché, retailers, disponibilité |
| **eBay Browse API** | REST | Gratuit (5000/jour) | Prix usagé, identifiants, condition |
| **Amazon PA-API** | REST | Commission affiliate | Prix, UPC/GTIN, avis |
| **Kijiji/Marketplace** | Scraping | N/A | Prix occasion, VIN, localisation |

#### Tier 3 — Bases de données industrie

| Source | Type | Données |
|--------|------|---------|
| **NADA Guides** | API payante | Valeurs marché véhicules, specs |
| **J.D. Power** | API payante | Évaluations, prix marché |
| **Cycle Trader** | Scraping/API | Listings occasion, prix |
| **GS1 GTIN Registry** | API | Validation identifiants produits |

---

## 3. Schéma de Base de Données

### Tables principales

```sql
canonical_products        -- Le produit unique (ex: "Yamaha MT-07 2024")
product_listings          -- Chaque listing dealer/source mappé au canonical
product_identifiers       -- Table de cross-référence d'identifiants
data_sources              -- Sources de données configurées
price_history             -- Historique complet des prix
ingestion_runs            -- Audit trail des ingestions
matching_candidates       -- File d'attente pour révision humaine
```

### Le Product Graph

```
        ┌─────────────────────────────────────┐
        │      CANONICAL PRODUCT               │
        │  Yamaha MT-07 2024                   │
        │  Brand: Yamaha                        │
        │  MSRP: $8,999                        │
        │  GTIN: 00012345678905                │
        │  Avg price: $9,245                    │
        │  5 listings actifs                    │
        └─────┬────────────┬──────────┬────────┘
              │            │          │
    ┌─────────▼──┐  ┌──────▼────┐  ┌──▼──────────┐
    │  Dealer A   │  │ Dealer B  │  │  Dealer C   │
    │  $9,499     │  │ $8,999    │  │  $9,199     │
    │  Neuf       │  │ Neuf      │  │  Neuf       │
    │  En stock   │  │ En stock  │  │  Commandé   │
    │  Montréal   │  │ Québec    │  │  Sherbrooke │
    └─────────────┘  └───────────┘  └─────────────┘
              │
    ┌─────────▼──┐  ┌─────────────┐
    │  eBay       │  │  Amazon     │
    │  $7,500     │  │  N/A        │
    │  Occasion   │  │  Accessoires│
    │  2000 km    │  │             │
    └─────────────┘  └─────────────┘
```

---

## 4. Système de Matching

### Cascade de stratégies

Le matcher essaie chaque stratégie dans l'ordre. La première qui dépasse
le seuil d'auto-match (0.85) court-circuite la cascade.

```python
strategies = [
    match_by_identifier,        # GTIN/UPC/EAN/MPN exact → 0.99
    match_by_vin,               # VIN prefix (11 chars) → 0.99
    match_by_brand_model_year,  # Marque+Modèle+Année → 0.90-0.92
    match_by_title_similarity,  # SequenceMatcher + Jaccard → variable
    match_composite,            # Score pondéré multi-signal → variable
]
```

### Score composite (stratégie de fallback)

| Signal | Poids | Calcul |
|--------|-------|--------|
| Brand | 0.25 | Exact match après normalisation |
| Model | 0.25 | SequenceMatcher ratio |
| Year | 0.15 | 1.0 si exact, -0.5 par année d'écart |
| Title | 0.15 | SequenceMatcher sur titres normalisés |
| Specs | 0.10 | % de specs communes identiques |
| Category | 0.10 | Exact match après normalisation |

### Seuils de décision

| Confidence | Action |
|------------|--------|
| ≥ 0.85 | Match automatique, liaison directe |
| 0.50 - 0.84 | Ajouté à la file de révision humaine |
| < 0.50 | Nouveau produit canonique créé |

---

## 5. Pipeline de Données

### Flux complet

```
Sources → Fetch → Parse → Normalize → Deduplicate → Match → Upsert → Aggregate
   ↑                                                           │
   │                                                           ▼
   │                                                    Price History
   │                                                    Alerts Check
   └──────── Schedule (cron / interval) ──────────────────────┘
```

### Composants

| Composant | Fichier | Responsabilité |
|-----------|---------|----------------|
| `BaseSource` | `sources/base.py` | Interface abstraite pour les connecteurs |
| `ManufacturerFeedSource` | `sources/manufacturer_feed.py` | Ingestion feeds XML/JSON/CSV |
| `GoogleShoppingSource` | `sources/google_shopping.py` | Recherche prix via SerpAPI |
| `MarketplaceSource` | `sources/marketplace.py` | Amazon PA-API, eBay Browse API |
| `ScraperBridgeSource` | `sources/scraper_bridge.py` | Pont vers les scrapers existants |
| `ProductNormalizer` | `matching/normalizer.py` | Normalisation marques/catégories/titres |
| `ProductMatcher` | `matching/matcher.py` | Cascade de matching multi-stratégie |
| `IngestionPipeline` | `pipeline/ingestion.py` | Pipeline central de traitement |
| `PipelineOrchestrator` | `pipeline/orchestrator.py` | Coordination multi-sources |
| `SupabaseCatalogStore` | `pipeline/supabase_store.py` | Persistance Supabase |

---

## 6. Scalabilité

### Architecture pour millions de produits

```
                    ┌─────────────┐
                    │   API/Cron   │
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │   Message Queue (Redis)  │
              │   ou SQS / Cloud Tasks   │
              └────┬────────────┬───────┘
                   │            │
          ┌────────▼──┐  ┌─────▼───────┐
          │  Worker 1  │  │  Worker N   │
          │ (Source A)  │  │ (Source Z)  │
          └────────┬──┘  └─────┬───────┘
                   │            │
              ┌────▼────────────▼───────┐
              │      PostgreSQL          │
              │   (Supabase / RDS)       │
              │                          │
              │  Partitioning par:       │
              │  - category              │
              │  - created_at (range)    │
              │                          │
              │  Indexes:                │
              │  - B-tree: identifiers   │
              │  - GIN: pg_trgm (fuzzy)  │
              │  - GIN: JSONB specs      │
              └──────────────────────────┘
```

### Stratégies de scalabilité

| Dimension | < 100K produits | 100K - 1M | 1M+ |
|-----------|----------------|-----------|-----|
| **Storage** | Supabase (free/pro) | Supabase Pro + partitioning | Dedicated Postgres + read replicas |
| **Ingestion** | Sequential, asyncio | Concurrent workers (5-10) | Message queue + worker pool |
| **Matching** | In-memory candidates | Pre-filtered by brand+year | Elasticsearch / pgvector embeddings |
| **Deduplication** | Exact identifiers | Identifiers + trigram index | LSH (Locality-Sensitive Hashing) |
| **Caching** | Supabase cache | Redis | Redis Cluster |

### Optimisations clés

1. **Partitionnement PostgreSQL** par catégorie pour isoler les requêtes
2. **Index pg_trgm** pour la recherche floue sans scan complet
3. **Bloom filters** pour le test d'existence rapide d'identifiants
4. **Batch upserts** via `INSERT ... ON CONFLICT` pour réduire les round-trips
5. **Materialized views** pour les agrégats de prix (rafraîchies périodiquement)

---

## 7. Migration depuis le Système Actuel

### Étape 1 : Mode hybride (recommandé pour démarrer)

Les scrapers existants continuent de fonctionner. Leur output est aussi
redirigé dans le pipeline de découverte via `ScraperBridgeSource`.

```python
# Dans scraper_ai/main.py, après le scraping existant :
from product_discovery.pipeline.orchestrator import PipelineOrchestrator
from product_discovery.pipeline.supabase_store import SupabaseCatalogStore

store = SupabaseCatalogStore(supabase_client)
orchestrator = PipelineOrchestrator(store)

# Alimenter le product graph avec les résultats scrapés
for site_name, products in scraped_results.items():
    await orchestrator.run_scraper_bridge(
        products=products,
        site_name=site_name,
        site_url=site_url,
    )
```

### Étape 2 : Ajout de sources externes

Configurer les feeds fabricants et APIs marketplace en parallèle
des scrapers. Le matching enrichit progressivement le catalogue canonique.

### Étape 3 : Remplacement progressif des scrapers

À mesure que les sources externes couvrent plus de produits,
les scrapers deviennent moins nécessaires. Les désactiver un par un.

---

## 8. Prochaines Étapes

- [ ] Exécuter la migration SQL sur Supabase
- [ ] Connecter le `ScraperBridgeSource` au `main.py` existant
- [ ] Configurer SerpAPI pour Google Shopping
- [ ] Contacter les portails dealer BRP/Yamaha pour accès API
- [ ] Ajouter la vue de révision des matchs dans le dashboard
- [ ] Implémenter les embeddings (pgvector) pour le matching sémantique à grande échelle
