# 📊 Schéma du Flux Utilisateur - Connexion et Analytics

## 🎯 Vue d'Ensemble du Parcours Utilisateur

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FLUX COMPLET : DE LA CONNEXION AUX DONNÉES           │
└─────────────────────────────────────────────────────────────────────────┘

1. ACCÈS AU SITE
   ↓
2. CONNEXION / AUTHENTIFICATION
   ↓
3. NAVIGATION VERS ANALYTICS
   ↓
4. AFFICHAGE DES DONNÉES
```

---

## 📱 ÉTAPE 1 : Accès au Site

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 1: L'UTILISATEUR ACCÈDE AU DASHBOARD WEB                         │
└─────────────────────────────────────────────────────────────────────────┘

UTILISATEUR
    │
    │ 1. Ouvre le navigateur
    │ 2. Va sur http://localhost:3000 (ou URL de production)
    │
    ▼
┌─────────────────────┐
│  Dashboard Web      │  ← Next.js Application
│  (Next.js)          │
│  Port 3000          │
└──────────┬──────────┘
           │
           │ 3. Requête HTTP GET /
           │
           ▼
┌─────────────────────┐
│  Page d'accueil     │  ← Page de login ou dashboard
│  /                  │     (selon état d'auth)
└─────────────────────┘
```

**Composants impliqués :**
- Dashboard Web Next.js (`dashboard_web/`)
- Page d'accueil ou de login
- Middleware d'authentification Supabase

---

## 🔐 ÉTAPE 2 : Connexion / Authentification

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 2: L'UTILISATEUR SE CONNECTE                                     │
└─────────────────────────────────────────────────────────────────────────┘

UTILISATEUR
    │
    │ 1. Saisit email + mot de passe
    │ 2. Clique sur "Se connecter"
    │
    ▼
┌─────────────────────┐
│  Formulaire Login   │  ← Interface React
│  (React Component)  │
└──────────┬──────────┘
           │
           │ 3. POST /api/auth/login
           │    { email, password }
           │
           ▼
┌─────────────────────┐
│  API Route Next.js  │  ← /api/auth/login (ou Supabase Auth)
│  /api/auth/login    │
└──────────┬──────────┘
           │
           │ 4. Vérifie credentials
           │
           ▼
┌─────────────────────┐
│  Supabase Auth      │  ← Service d'authentification
│  (Backend)          │
└──────────┬──────────┘
           │
           │ 5. Valide utilisateur
           │    - Vérifie email/password
           │    - Génère session token
           │
           ▼
┌─────────────────────┐
│  Session créée      │
│  - JWT Token        │
│  - User ID          │
│  - Cookie HTTP      │
└──────────┬──────────┘
           │
           │ 6. Retourne token + user info
           │
           ▼
┌─────────────────────┐
│  Dashboard          │  ← Redirection automatique
│  (Page principale)  │     après connexion réussie
└─────────────────────┘
```

**Composants impliqués :**
- Composant React de login
- API Route Next.js `/api/auth/login`
- Supabase Auth (service d'authentification)
- Gestion de session (cookies, JWT)

**Résultat :**
- ✅ Utilisateur authentifié
- ✅ Session active
- ✅ Token stocké (cookie/localStorage)
- ✅ Redirection vers le dashboard

---

## 📊 ÉTAPE 3 : Navigation vers la Page Analytics

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 3: L'UTILISATEUR VA SUR LA PAGE ANALYTICS                       │
└─────────────────────────────────────────────────────────────────────────┘

UTILISATEUR (Connecté)
    │
    │ 1. Clique sur "Analytics" dans le menu
    │    (ou accède directement à /analytics)
    │
    ▼
┌─────────────────────┐
│  Navigation Menu    │  ← Composant React
│  - Dashboard         │
│  - Analytics  ←───   │
│  - Scraper Config    │
└──────────┬──────────┘
           │
           │ 2. Navigation Next.js
           │    router.push('/analytics')
           │
           ▼
┌─────────────────────┐
│  Page Analytics     │  ← /analytics (Next.js Page)
│  (React Component)  │
└──────────┬──────────┘
           │
           │ 3. useEffect() déclenché
           │    - Vérifie authentification
           │    - Charge les données
           │
           │ 4. Appel API pour récupérer données
           │    GET /api/analytics/data
           │    Headers: { Authorization: Bearer <token> }
           │
           ▼
┌─────────────────────┐
│  API Route Next.js  │  ← /api/analytics/data
│  /api/analytics/    │     (ou /api/scrapings)
│  data/route.ts      │
└──────────┬──────────┘
           │
           │ 5. Vérifie token d'authentification
           │    - Valide JWT avec Supabase
           │    - Extrait user_id
           │
           ▼
┌─────────────────────┐
│  Supabase Client    │  ← Client Supabase
│  (Database)         │
└──────────┬──────────┘
           │
           │ 6. Requête SQL
           │    SELECT * FROM scrapings
           │    WHERE user_id = <user_id>
           │    ORDER BY created_at DESC
           │
           ▼
┌─────────────────────┐
│  Base de données    │  ← Supabase PostgreSQL
│  Supabase           │
│  Table: scrapings   │
│  Table: products    │
└──────────┬──────────┘
           │
           │ 7. Retourne données JSON
           │    {
           │      scrapings: [...],
           │      products: [...],
           │      stats: {...}
           │    }
           │
           ▼
┌─────────────────────┐
│  API Route          │  ← Retourne réponse
│  Retourne JSON      │
└──────────┬──────────┘
           │
           │ 8. Response JSON
           │
           ▼
┌─────────────────────┐
│  Page Analytics     │  ← Reçoit les données
│  (React Component)  │
└─────────────────────┘
```

**Composants impliqués :**
- Page Next.js `/analytics`
- Composant React Analytics
- API Route `/api/analytics/data` (ou `/api/scrapings`)
- Supabase Client (connexion DB)
- Table Supabase `scrapings` et `products`

**Données récupérées :**
- Liste des scrapings effectués
- Produits extraits
- Statistiques (nombre de produits, sites scrapés, etc.)
- Métadonnées (dates, URLs, temps de scraping)

---

## 📈 ÉTAPE 4 : Affichage des Données Analytics

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 4: L'UTILISATEUR VOIT LES DONNÉES                                │
└─────────────────────────────────────────────────────────────────────────┘

PAGE ANALYTICS (React Component)
    │
    │ 1. Reçoit les données JSON de l'API
    │    {
    │      scrapings: [
    │        {
    │          id: 1,
    │          reference_url: "https://mvmmotosport.com",
    │          competitor_urls: [...],
    │          products_count: 150,
    │          created_at: "2025-01-27T10:30:00Z",
    │          scraping_time_seconds: 45.2
    │        },
    │        ...
    │      ],
    │      products: [
    │        {
    │          name: "Yamaha YZ450F 2024",
    │          marque: "Yamaha",
    │          modele: "YZ450F",
    │          annee: 2024,
    │          prix: 8999,
    │          prixReference: 8500,
    │          differencePrix: 499,
    │          sourceSite: "https://concurrent.com",
    │          ...
    │        },
    │        ...
    │      ],
    │      stats: {
    │        total_products: 150,
    │        total_scrapings: 5,
    │        avg_price_diff: 250,
    │        ...
    │      }
    │    }
    │
    ▼
┌─────────────────────┐
│  État React         │  ← useState() / useQuery()
│  - scrapings        │
│  - products         │
│  - stats            │
│  - loading          │
│  - error            │
└──────────┬──────────┘
           │
           │ 2. Rend les composants UI
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  INTERFACE UTILISATEUR (Rendu)                               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  📊 ANALYTICS                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Statistiques Globales                                │   │
│  │ • Total produits: 150                                 │   │
│  │ • Scrapings effectués: 5                            │   │
│  │ • Différence prix moyenne: +250$                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Historique des Scrapings                            │   │
│  │ ┌───────────────────────────────────────────────┐   │   │
│  │ │ Site: mvmmotosport.com                        │   │   │
│  │ │ Date: 27/01/2025 10:30                        │   │   │
│  │ │ Produits: 150 | Temps: 45.2s                 │   │   │
│  │ └───────────────────────────────────────────────┘   │   │
│  │ ...                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Liste des Produits                                  │   │
│  │ ┌───────────────────────────────────────────────┐   │   │
│  │ │ Yamaha YZ450F 2024                            │   │   │
│  │ │ Prix: 8999$ | Référence: 8500$ | Diff: +499$ │   │   │
│  │ │ Site: concurrent.com                          │   │   │
│  │ └───────────────────────────────────────────────┘   │   │
│  │ ...                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Composants UI impliqués :**
- Composant `AnalyticsDashboard`
- Composant `ScrapingsList`
- Composant `ProductsTable`
- Composant `StatsCards`
- Graphiques (si implémentés)

**Fonctionnalités affichées :**
- ✅ Statistiques globales (total produits, scrapings, etc.)
- ✅ Historique des scrapings avec dates et métadonnées
- ✅ Liste des produits avec comparaison de prix
- ✅ Filtres et recherche (si implémentés)
- ✅ Graphiques et visualisations (si implémentés)

---

## 🔄 Flux Complet en Diagramme

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DIAGRAMME DE SÉQUENCE COMPLET                       │
└─────────────────────────────────────────────────────────────────────────┘

UTILISATEUR    NAVIGATEUR    DASHBOARD     API NEXT.JS    SUPABASE
    │              │             │              │             │
    │───GET /──────>│             │              │             │
    │              │───GET /────>│              │             │
    │              │<───HTML─────│              │             │
    │<───HTML──────│             │              │             │
    │              │             │              │             │
    │  [Saisit credentials]      │              │             │
    │              │             │              │             │
    │───POST /api/auth/login────>│              │             │
    │              │             │───POST──────>│             │
    │              │             │              │───Auth─────>│
    │              │             │              │<───Token────│
    │              │             │<───Token─────│             │
    │<───Token─────│             │              │             │
    │              │             │              │             │
    │  [Clique sur Analytics]     │              │             │
    │              │             │              │             │
    │───GET /analytics───────────>│              │             │
    │              │             │              │             │
    │              │             │───GET /api/analytics/data─>│
    │              │             │              │             │
    │              │             │              │───SELECT───>│
    │              │             │              │             │
    │              │             │              │<───Data────│
    │              │             │<───JSON──────│             │
    │<───HTML+Data──│             │              │             │
    │              │             │              │             │
    │  [Voit les données]         │              │             │
    │              │             │              │             │
```

---

## 💾 D'où viennent les données ?

### Scénario 1 : Données sauvegardées via le scraper Python

```
SCRAPER PYTHON (main.py)
    │
    │ 1. Exécute le scraping
    │    - Scrape les sites
    │    - Extrait les produits
    │    - Compare les prix
    │
    │ 2. Sauvegarde locale
    │    └─> scraped_data.json
    │
    │ 3. Sauvegarde dans Supabase
    │    POST http://localhost:3000/api/scrapings/save
    │    {
    │      reference_url: "...",
    │      competitor_urls: [...],
    │      products: [...],
    │      metadata: {...}
    │    }
    │
    ▼
┌─────────────────────┐
│  API Route Next.js  │  ← /api/scrapings/save
│  /api/scrapings/    │
│  save/route.ts      │
└──────────┬──────────┘
           │
           │ 4. Vérifie authentification
           │    (si utilisateur connecté)
           │
           │ 5. Insère dans Supabase
           │    INSERT INTO scrapings (...)
           │    INSERT INTO products (...)
           │
           ▼
┌─────────────────────┐
│  Supabase Database  │  ← Tables: scrapings, products
│  PostgreSQL         │
└─────────────────────┘
```

### Scénario 2 : Données sauvegardées depuis le dashboard

```
DASHBOARD WEB
    │
    │ 1. Utilisateur lance un scraping
    │    - Configure les URLs
    │    - Clique sur "Lancer"
    │
    │ 2. Appel API
    │    POST /api/scraper-ai/run
    │
    ▼
┌─────────────────────┐
│  API Route Next.js  │  ← /api/scraper-ai/run
│  /api/scraper-ai/   │
│  run/route.ts       │
└──────────┬──────────┘
           │
           │ 3. Lance processus Python
           │    nohup python -m scraper_ai.main ...
           │
           │ 4. Processus Python sauvegarde
           │    └─> Même flux que Scénario 1
           │
           ▼
┌─────────────────────┐
│  Supabase Database  │
│  PostgreSQL         │
└─────────────────────┘
```

---

## 🔑 Points Clés

### Authentification
- ✅ Utilise Supabase Auth
- ✅ JWT Token stocké dans cookie/localStorage
- ✅ Vérification du token à chaque requête API
- ✅ Redirection automatique si non authentifié

### Stockage des Données
- ✅ Sauvegarde locale : `scraped_data.json`
- ✅ Sauvegarde cloud : Supabase PostgreSQL
- ✅ Tables : `scrapings`, `products`
- ✅ Association par `user_id` pour isolation des données

### Récupération des Données
- ✅ API Route Next.js : `/api/analytics/data` ou `/api/scrapings`
- ✅ Filtrage par `user_id` (sécurité)
- ✅ Tri par date (plus récent en premier)
- ✅ Pagination (si beaucoup de données)

### Affichage
- ✅ Composants React pour l'UI
- ✅ État géré avec React hooks (useState, useEffect)
- ✅ Affichage en temps réel (après chargement)
- ✅ Gestion des états de chargement et d'erreur

---

## 📝 Résumé du Flux

1. **Accès** : Utilisateur ouvre le dashboard web (Next.js)
2. **Connexion** : Authentification via Supabase Auth → Token JWT
3. **Navigation** : Clic sur "Analytics" → Page `/analytics`
4. **Requête** : Appel API `/api/analytics/data` avec token
5. **Vérification** : API valide le token et extrait `user_id`
6. **Récupération** : Requête SQL Supabase filtrée par `user_id`
7. **Retour** : Données JSON (scrapings, products, stats)
8. **Affichage** : Composants React rendent les données dans l'UI

---

**Date de création :** 2025-01-27
**Version :** 1.0

