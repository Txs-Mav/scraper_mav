# 🎯 Stratégies de Découverte de Produits - Guide Complet

Ce document liste **TOUS** les outils et stratégies disponibles pour l'agent IA lorsqu'il a de la difficulté à trouver un chemin vers tous les produits d'un site.

## 📋 Table des Matières

1. [Stratégies Principales](#stratégies-principales)
2. [Outils de Découverte](#outils-de-découverte)
3. [Stratégies de Secours](#stratégies-de-secours)
4. [Techniques Avancées](#techniques-avancées)
5. [Exemples de Code](#exemples-de-code)

---

## 🚀 Stratégies Principales

### 1. **Sitemap (PRIORITÉ ABSOLUE)**

**Outil** : `get_sitemap_urls(base_url)`

**Pourquoi** : Le sitemap contient généralement **TOUTES** les URLs du site, c'est la méthode la plus complète.

**Utilisation** :
```python
sitemap_urls = get_sitemap_urls(base_url)
if sitemap_urls:
    all_product_urls.update(sitemap_urls)
    print(f"✅ {len(sitemap_urls)} URLs depuis sitemap (COMPLET)")
```

**Avantages** :
- ✅ Contient généralement tous les produits
- ✅ Rapide (un seul fichier XML)
- ✅ Pas besoin de pagination
- ✅ URLs déjà normalisées

**Limitations** :
- ⚠️ Pas tous les sites ont un sitemap
- ⚠️ Parfois incomplet ou obsolète

---

### 2. **Pagination EXHAUSTIVE**

**Outil** : `detect_pagination(html, url)` + boucles

**Pourquoi** : Beaucoup de sites utilisent la pagination pour afficher les produits.

**Utilisation** :
```python
# Détecter le pattern de pagination
pagination_info = detect_pagination(html, base_url)

if pagination_info:
    page = 1
    max_pages = 1000  # Limite de sécurité
    while page <= max_pages:
        # Construire URL selon pattern détecté
        if pagination_info['type'] == 'url_params':
            page_url = f"{base_url}?{pagination_info['pattern']}{page}"
        elif pagination_info['type'] == 'path':
            page_url = f"{base_url}{pagination_info['pattern']}{page}"
        else:
            # Pattern personnalisé
            page_url = f"{base_url}?page={page}"
        
        html = get(page_url)
        if not html or len(html) < 1000:
            break
        
        product_links = discover_product_urls(html, base_url)
        if not product_links:
            break
        
        all_product_urls.update(product_links)
        print(f"   Page {page}: {len(product_links)} produits trouvés")
        page += 1
```

**Patterns de pagination courants** :
- `?page=1`, `?page=2`, etc.
- `/page/1/`, `/page/2/`, etc.
- `?p=1`, `?p=2`, etc.
- Bouton "Suivant" avec URL dynamique

---

### 3. **Exploration de Catégories**

**Outil** : `get_all_links(html, base_url)` + filtrage

**Pourquoi** : Les sites organisent souvent les produits par catégories.

**Utilisation** :
```python
# 1. Trouver toutes les catégories
html = get(base_url)
all_links = get_all_links(html, base_url)

# Filtrer pour trouver les catégories
category_keywords = ['category', 'categorie', 'inventory', 'inventaire', 'catalog', 'catalogue']
category_urls = [
    link for link in all_links 
    if any(kw in link.lower() for kw in category_keywords)
    and 'product' not in link.lower()  # Exclure les pages produits individuelles
]

# 2. Pour chaque catégorie, trouver tous les produits
for category_url in category_urls:
    print(f"📁 Exploration catégorie: {category_url}")
    
    # Gérer pagination dans la catégorie
    page = 1
    while page <= 100:
        if '?' in category_url:
            cat_page_url = f"{category_url}&page={page}"
        else:
            cat_page_url = f"{category_url}?page={page}"
        
        html = get(cat_page_url)
        if not html or len(html) < 1000:
            break
        
        products = discover_product_urls(html, base_url)
        if not products:
            break
        
        all_product_urls.update(products)
        page += 1
```

---

### 4. **Découverte Heuristique de Produits**

**Outil** : `discover_product_urls(html, base_url)`

**Pourquoi** : Utilise des heuristiques pour identifier les pages de produits.

**Utilisation** :
```python
html = get(base_url)
product_urls = discover_product_urls(html, base_url)
all_product_urls.update(product_urls)
```

**Mots-clés recherchés** :
- `product`, `produit`, `item`, `article`
- `inventory`, `inventaire`, `stock`
- `detail`, `details`, `fiche`
- `moto`, `vehicle`, `vehicule`
- `quad`, `atv`, `snowmobile`, `motoneige`

**Mots-clés exclus** :
- `contact`, `about`, `policy`, `privacy`
- `blog`, `news`, `cart`, `checkout`
- `login`, `register`, `account`, `search`

---

## 🔍 Outils de Découverte

### 1. **Exploration de Tous les Liens**

**Outil** : `get_all_links(html, base_url)`

**Utilisation** :
```python
html = get(base_url)
all_links = get_all_links(html, base_url)

# Filtrer manuellement selon les besoins
product_candidates = [
    link for link in all_links
    if '/product/' in link or '/inventory/' in link or '/item/' in link
]
```

---

### 2. **Parsing HTML avec Sélecteurs CSS**

**Outil** : `parse_html(html, selector)`

**Utilisation** :
```python
# Trouver tous les liens de produits avec un sélecteur spécifique
product_links = parse_html(html, "a.product-link[href]")
product_links = parse_html(html, ".product-card a[href]")
product_links = parse_html(html, "[data-product-url]")

# Normaliser les URLs
for link in product_links:
    normalized = normalize_url(base_url, link)
    if normalized:
        all_product_urls.add(normalized)
```

**Sélecteurs CSS courants** :
- `a[href*="/product/"]` : Liens contenant "/product/"
- `.product-card a` : Liens dans les cartes produits
- `[data-product-id]` : Éléments avec attribut data-product-id
- `.inventory-item a` : Liens d'inventaire

---

### 3. **Extraction de Données Structurées**

**Outil** : `extract_json_ld(html)` et `extract_opengraph(html)`

**Utilisation** :
```python
html = get(base_url)

# JSON-LD peut contenir des listes de produits
json_ld_data = extract_json_ld(html)
for item in json_ld_data:
    if item.get('@type') == 'Product' and 'url' in item:
        all_product_urls.add(item['url'])

# Open Graph peut contenir des URLs de produits
og_data = extract_opengraph(html)
if 'url' in og_data:
    all_product_urls.add(og_data['url'])
```

---

## 🆘 Stratégies de Secours

### 1. **Exploration Récursive**

Si les méthodes standards échouent, explorer récursivement :

```python
def explore_recursive(url, max_depth=3, current_depth=0):
    if current_depth >= max_depth:
        return []
    
    html = get(url)
    if not html:
        return []
    
    # Trouver tous les liens
    links = get_all_links(html, base_url)
    
    # Filtrer les liens prometteurs
    promising_links = [
        link for link in links
        if any(kw in link.lower() for kw in ['product', 'inventory', 'item', 'detail'])
        and link not in visited_urls
    ]
    
    product_urls = []
    for link in promising_links:
        visited_urls.add(link)
        # Vérifier si c'est une page produit
        if is_product_page(link):
            product_urls.append(link)
        else:
            # Explorer récursivement
            product_urls.extend(explore_recursive(link, max_depth, current_depth + 1))
    
    return product_urls
```

---

### 2. **Analyse des Patterns d'URL**

Analyser les patterns d'URL pour découvrir des produits :

```python
# Récupérer quelques URLs de produits connues
known_product_urls = exploration_result.get('product_urls', [])[:5]

if known_product_urls:
    # Analyser le pattern
    patterns = []
    for url in known_product_urls:
        # Extraire le pattern (ex: /product/123, /inventory/item-456)
        pattern = extract_url_pattern(url)
        patterns.append(pattern)
    
    # Générer des URLs selon le pattern
    common_pattern = find_common_pattern(patterns)
    if common_pattern:
        # Essayer des IDs séquentiels
        for product_id in range(1, 10000):
            test_url = f"{base_url}{common_pattern.format(id=product_id)}"
            html = get(test_url)
            if html and len(html) > 1000:
                all_product_urls.add(test_url)
            else:
                # Arrêter si plusieurs URLs consécutives échouent
                break
```

---

### 3. **Utilisation de Selenium pour JavaScript**

Si le site charge les produits dynamiquement :

```python
# Utiliser Selenium pour le rendu JavaScript
html = browser_get(base_url)

# Les produits peuvent être chargés via AJAX
# Attendre que le contenu soit chargé, puis extraire
product_links = discover_product_urls(html, base_url)

# Ou utiliser des sélecteurs spécifiques
product_elements = parse_html(html, ".product-item[data-url]")
```

---

### 4. **Vérification robots.txt**

**Outil** : `check_robots_txt(url)`

Vérifier les restrictions avant d'explorer :

```python
robots_info = check_robots_txt(base_url)
if robots_info.get('exists'):
    # Analyser robots.txt pour voir ce qui est autorisé
    # Éviter les chemins interdits
    pass
```

---

## 🎨 Techniques Avancées

### 1. **Combinaison de Plusieurs Stratégies**

**IMPORTANT** : Utiliser plusieurs stratégies en parallèle et combiner les résultats :

```python
all_product_urls = set()

# Stratégie 1: Sitemap
sitemap_urls = get_sitemap_urls(base_url)
if sitemap_urls:
    all_product_urls.update(sitemap_urls)
    print(f"✅ {len(sitemap_urls)} URLs depuis sitemap")

# Stratégie 2: Pagination (même si sitemap existe, pour vérification)
page = 1
while page <= 100:
    page_url = f"{base_url}?page={page}"
    html = get(page_url)
    if not html:
        break
    products = discover_product_urls(html, base_url)
    all_product_urls.update(products)
    page += 1

# Stratégie 3: Catégories
categories = find_categories(html, base_url)
for cat_url in categories:
    cat_products = discover_product_urls(get(cat_url), base_url)
    all_product_urls.update(cat_products)

# Stratégie 4: URLs découvertes lors de l'exploration
explored_urls = exploration_result.get('product_urls', [])
all_product_urls.update(explored_urls)

# Dédupliquer
all_product_urls = list(set(all_product_urls))
print(f"✅ TOTAL: {len(all_product_urls)} URLs uniques trouvées")
```

---

### 2. **Validation et Vérification**

Vérifier que les URLs trouvées sont bien des pages de produits :

```python
def is_product_page(url, html):
    """Vérifier si une page est une page produit"""
    # Indicateurs d'une page produit
    indicators = [
        'price' in html.lower(),
        'prix' in html.lower(),
        'add to cart' in html.lower(),
        'ajouter au panier' in html.lower(),
        'product-detail' in html.lower(),
        'inventory-item' in html.lower(),
    ]
    return any(indicators)

# Filtrer les URLs
valid_product_urls = []
for url in all_product_urls:
    html = get(url)
    if is_product_page(url, html):
        valid_product_urls.append(url)
```

---

### 3. **Gestion des Sites avec Chargement Lazy**

Pour les sites qui chargent les produits progressivement :

```python
# Utiliser Selenium pour scroller et charger plus de produits
html = browser_get(base_url)

# Scroller plusieurs fois pour charger le contenu lazy
# (Cette logique devrait être dans le scraper généré)

# Puis extraire tous les liens
all_links = get_all_links(html, base_url)
product_links = [link for link in all_links if is_product_url(link)]
```

---

## 📝 Exemples de Code Complets

### Exemple 1 : Stratégie Multi-Couches

```python
def scrape(base_url):
    all_product_urls = set()
    
    # COUCHE 1: Sitemap (le plus fiable)
    sitemap_urls = get_sitemap_urls(base_url)
    if sitemap_urls:
        all_product_urls.update(sitemap_urls)
        print(f"✅ {len(sitemap_urls)} URLs depuis sitemap")
    else:
        print("⚠️ Pas de sitemap, utilisation de stratégies alternatives")
    
    # COUCHE 2: Pagination exhaustive
    html = get(base_url)
    pagination_info = detect_pagination(html, base_url)
    
    if pagination_info:
        page = 1
        while page <= 1000:
            page_url = build_pagination_url(base_url, pagination_info, page)
            page_html = get(page_url)
            if not page_html or len(page_html) < 1000:
                break
            products = discover_product_urls(page_html, base_url)
            if not products:
                break
            all_product_urls.update(products)
            print(f"   Page {page}: {len(products)} produits")
            page += 1
    
    # COUCHE 3: Exploration de catégories
    categories = find_all_categories(html, base_url)
    for cat_url in categories:
        cat_products = discover_product_urls(get(cat_url), base_url)
        all_product_urls.update(cat_products)
    
    # COUCHE 4: Liens découverts
    all_links = get_all_links(html, base_url)
    product_candidates = filter_product_links(all_links)
    all_product_urls.update(product_candidates)
    
    # Dédupliquer et retourner
    all_product_urls = list(set(all_product_urls))
    print(f"✅ TOTAL: {len(all_product_urls)} URLs uniques")
    
    return all_product_urls
```

---

### Exemple 2 : Exploration Récursive avec Limites

```python
def scrape_with_recursive_exploration(base_url, max_depth=2):
    visited = set()
    all_product_urls = set()
    
    def explore(url, depth=0):
        if depth > max_depth or url in visited:
            return
        
        visited.add(url)
        html = get(url)
        if not html:
            return
        
        # Chercher produits sur cette page
        products = discover_product_urls(html, base_url)
        all_product_urls.update(products)
        
        # Si pas assez de produits, explorer les liens
        if len(products) < 5 and depth < max_depth:
            links = get_all_links(html, base_url)
            promising_links = [
                link for link in links
                if is_promising_link(link) and link not in visited
            ]
            
            for link in promising_links[:10]:  # Limiter à 10 liens par page
                explore(link, depth + 1)
    
    explore(base_url)
    return list(set(all_product_urls))
```

---

## ✅ Checklist pour l'Agent IA

Quand l'agent a de la difficulté à trouver tous les produits, il devrait :

### Stratégies de Base
1. ✅ **Essayer le sitemap en premier** (`get_sitemap_urls`)
2. ✅ **Détecter et suivre la pagination** (`detect_pagination` + boucles)
3. ✅ **Explorer les catégories** (`get_all_links` + filtrage)
4. ✅ **Utiliser la découverte heuristique** (`discover_product_urls`)
5. ✅ **Parser avec sélecteurs CSS** (`parse_html` avec sélecteurs spécifiques)

### Données Structurées
6. ✅ **Extraire données structurées** (`extract_json_ld`, `extract_opengraph`, `extract_microdata`)
7. ✅ **Extraire données JavaScript** (`extract_script_data`) pour SPA

### Sites Complexes
8. ✅ **Détecter APIs** (`detect_api_endpoints`) et appeler les endpoints
9. ✅ **Trouver formulaires de recherche** (`find_search_form`) et les utiliser
10. ✅ **Explorer les filtres** (`find_filters`) et tester différentes combinaisons
11. ✅ **Gérer infinite scroll** (`detect_infinite_scroll`) avec Selenium

### Robustesse
12. ✅ **Utiliser retry** (`retry_get`) pour gérer les erreurs temporaires
13. ✅ **Détecter rate limiting** (`detect_rate_limit`) et attendre (`wait_between_requests`)
14. ✅ **Détecter CAPTCHA** (`detect_captcha`) et utiliser Selenium si nécessaire
15. ✅ **Explorer récursivement** (si nécessaire, avec limites)
16. ✅ **Utiliser Selenium** (`browser_get`) pour JavaScript
17. ✅ **Combiner plusieurs stratégies** (ne pas s'arrêter à la première)
18. ✅ **Valider les URLs trouvées** (`validate_url` + vérifier que ce sont bien des produits)

---

## 🎯 Résumé des Outils Disponibles

### Outils de Base

| Outil | Description | Quand l'utiliser |
|-------|-------------|------------------|
| `get_sitemap_urls(url)` | Récupère toutes les URLs du sitemap | **TOUJOURS en premier** |
| `detect_pagination(html, url)` | Détecte le pattern de pagination | Sites avec pagination |
| `discover_product_urls(html, base_url)` | Découvre URLs produits via heuristiques | Exploration générale |
| `get_all_links(html, base_url)` | Tous les liens normalisés | Exploration complète |
| `parse_html(html, selector)` | Parse avec sélecteurs CSS | Structure HTML connue |
| `browser_get(url)` | HTML rendu avec Selenium | Sites JavaScript |
| `check_robots_txt(url)` | Vérifie robots.txt | Respect des restrictions |

### Données Structurées

| Outil | Description | Quand l'utiliser |
|-------|-------------|------------------|
| `extract_json_ld(html)` | Données structurées JSON-LD | Sites modernes |
| `extract_opengraph(html)` | Métadonnées Open Graph | Sites avec OG tags |
| `extract_microdata(html)` | Microdata schema.org | Sites avec microdata |
| `extract_script_data(html)` | Données depuis JavaScript | SPA (Single Page Apps) |

### Sites Complexes

| Outil | Description | Quand l'utiliser |
|-------|-------------|------------------|
| `detect_api_endpoints(html)` | Détecte endpoints API | Sites avec API REST/GraphQL |
| `find_search_form(html)` | Trouve formulaires de recherche | Sites nécessitant recherche |
| `find_filters(html)` | Trouve filtres avec options | Sites avec filtres complexes |
| `detect_infinite_scroll(html)` | Détecte infinite scroll | Sites modernes avec lazy loading |
| `find_iframes(html)` | Trouve iframes | Sites avec contenu dans iframes |
| `detect_captcha(html)` | Détecte CAPTCHA | Sites protégés |

### Gestion d'Erreurs & Performance

| Outil | Description | Quand l'utiliser |
|-------|-------------|------------------|
| `retry_get(url, max_retries, backoff, use_selenium)` | Retry avec backoff | Erreurs temporaires |
| `detect_rate_limit(response_text, status_code)` | Détecte rate limiting | Sites avec restrictions |
| `wait_between_requests(seconds)` | Attendre entre requêtes | Éviter rate limiting |
| `validate_url(url)` | Valide URL | Avant de faire requête |

---

## 🆕 Utilisation des Nouveaux Outils pour Sites Complexes

### Sites SPA (Single Page Apps)

```python
# Beaucoup de sites modernes chargent les données dans JavaScript
html = browser_get(base_url)  # Utiliser Selenium pour le rendu complet

# Extraire données depuis window.__INITIAL_STATE__ ou similaire
script_data = extract_script_data(html)
if script_data:
    # Les produits peuvent être dans script_data['products'] ou similaire
    products = script_data.get('products', [])
    for product in products:
        if 'url' in product:
            all_product_urls.add(product['url'])
```

### Sites avec API REST/GraphQL

```python
# Détecter les endpoints API
api_endpoints = detect_api_endpoints(html)

if api_endpoints:
    for endpoint in api_endpoints:
        # Construire l'URL complète
        if endpoint.startswith('/'):
            api_url = f"{base_url}{endpoint}"
        elif not endpoint.startswith('http'):
            api_url = urljoin(base_url, endpoint)
        else:
            api_url = endpoint
        
        # Appeler l'API avec retry
        response_text = retry_get(api_url, max_retries=3)
        if response_text:
            try:
                api_data = json.loads(response_text)
                # Extraire URLs produits depuis la réponse API
                if isinstance(api_data, dict) and 'products' in api_data:
                    for product in api_data['products']:
                        if 'url' in product:
                            all_product_urls.add(product['url'])
            except json.JSONDecodeError:
                pass
```

### Sites avec Formulaires de Recherche

```python
# Trouver le formulaire de recherche
search_form = find_search_form(html)

if search_form:
    # Essayer différentes requêtes de recherche
    search_queries = ['*', '', 'moto', 'quad', 'snowmobile']
    
    for query in search_queries:
        # Construire l'URL de recherche
        if search_form['method'] == 'get':
            search_url = f"{base_url}{search_form['action']}?{search_form['inputs'][0]['name']}={query}"
        else:
            # POST - nécessiterait requests.post()
            continue
        
        search_html = get(search_url)
        products = discover_product_urls(search_html, base_url)
        all_product_urls.update(products)
```

### Sites avec Filtres

```python
# Trouver les filtres disponibles
filters = find_filters(html)

if filters:
    # Explorer différentes combinaisons de filtres
    # Exemple: pour chaque catégorie, trouver tous les produits
    for filter_item in filters:
        if filter_item['type'] == 'select':
            for option in filter_item['options']:
                filter_url = f"{base_url}?{filter_item['name']}={option['value']}"
                filter_html = get(filter_url)
                products = discover_product_urls(filter_html, base_url)
                all_product_urls.update(products)
```

### Sites avec Infinite Scroll

```python
# Détecter infinite scroll
has_infinite_scroll = detect_infinite_scroll(html)

if has_infinite_scroll:
    # Utiliser Selenium pour scroller et charger plus de contenu
    html = browser_get(base_url)
    
    # Scroller plusieurs fois (cette logique devrait être dans le scraper généré)
    # Puis extraire tous les liens
    all_links = get_all_links(html, base_url)
    product_links = [link for link in all_links if is_product_url(link)]
    all_product_urls.update(product_links)
```

### Gestion du Rate Limiting

```python
# Toujours utiliser wait_between_requests pour éviter rate limiting
for url in urls_to_fetch:
    html = get(url)
    
    # Vérifier si on est rate limité
    if detect_rate_limit(html, 200):  # status_code devrait être passé
        print("⚠️ Rate limit détecté, attente de 60 secondes...")
        wait_between_requests(60)
        continue
    
    # Attendre entre chaque requête
    wait_between_requests(1.0)  # 1 seconde entre chaque requête
```

### Gestion des Erreurs avec Retry

```python
# Utiliser retry_get pour gérer les erreurs temporaires
urls = ['url1', 'url2', 'url3']

for url in urls:
    # Retry jusqu'à 3 fois avec backoff exponentiel
    html = retry_get(url, max_retries=3, backoff=1.0)
    
    if html:
        products = discover_product_urls(html, base_url)
        all_product_urls.update(products)
    else:
        print(f"❌ Impossible de récupérer {url} après plusieurs tentatives")
```

## 💡 Conseils Finaux

1. **Ne jamais s'arrêter à une seule stratégie** : Combiner plusieurs approches
2. **Toujours dédupliquer** : Utiliser `set()` pour éviter les doublons
3. **Logger les étapes** : Utiliser `print()` pour déboguer
4. **Gérer les erreurs** : Utiliser `try/except` et `retry_get()` pour robustesse
5. **Mettre des limites** : Éviter les boucles infinies (max_pages, max_depth)
6. **Valider les résultats** : Utiliser `validate_url()` et vérifier que ce sont bien des produits
7. **Respecter les sites** : Utiliser `wait_between_requests()` pour éviter rate limiting
8. **Détecter les obstacles** : Utiliser `detect_captcha()` et `detect_rate_limit()` pour adapter la stratégie

---

**Note** : Si aucune de ces stratégies ne fonctionne, le site peut avoir une structure très unique. Dans ce cas, l'agent devrait utiliser Gemini pour analyser le HTML et générer une stratégie personnalisée basée sur la structure réelle du site.

