# Créer un scraper dédié — guide complet

Processus éprouvé sur `centre_du_sport_lac_st_jean.py` (SM360, 2026-08-11) et
`smsport.py` (PowerGO, 2026-08-11). Suivre ces étapes dans l'ordre ; les pièges
listés ont TOUS été rencontrés pour vrai.

## 1. Analyse du site (avant d'écrire une ligne)

- `curl` la home + une page listing + une page détail (UA desktop réaliste).
  Si le HTML brut contient les produits → requests suffit. Si le listing est
  vide (SPA/RSC Next.js) → chercher sitemap (`/sitemaps/inventory-detail.xml`,
  `/sitemap.xml`) ou API JSON.
- Identifier la plateforme (indices dans le HTML) :
  - **SM360 / Shift Digital** : images `img.sm360.ca`, classes
    `inventory-list-layout*`, `shiftdigital-event`, JSON-LD `Car` plat,
    blob JS `stockNumber:'…'`, `vin:'…'`. Pagination `?page=N`.
  - **PowerGO / Next.js** : images `cdn.powergo.ca`, URLs
    `/fr/neuf|usage/<cat>/inventaire/<slug>-a-vendre-<id>/`, JSON-LD
    `Vehicle` **niché dans `@graph`**, classes `pg-vehicle-*`.
    Listings client-side → sitemap obligatoire.
  - **WordPress + FacetWP** (Joliette) : `FWP_JSON`, `?fwp_per_page=500`.
  - **Magento** (Nadon) : listing catalogue paginé.
- Chercher le JSON-LD en PREMIER (`application/ld+json`) : c'est la source la
  plus fiable (marque, modèle, année, prix, état, couleur, km, sku).
  Attention aux structures `@graph` et aux listes.
- Repérer un identifiant unique par unité dans l'URL (`-id########` SM360,
  `a-vendre-#####` PowerGO) → ce sera la clé de dédup.

## 2. ⚠️ Vérifier la COMPLÉTUDE de la pagination (piège majeur)

**Le tri par défaut de SM360 répète des produits d'une page à l'autre** : sur
centredusportlacstjean.com, 30 pages × 24 cartes ne montraient que 574 unités
uniques sur ~720 — **146 unités (20 %) n'apparaissaient sur AUCUNE page**.
Rien ne le signale ; le scrape « réussit » avec un compte faux.

Protocole de vérification obligatoire :

```python
# Crawler toutes les pages, compter (page, cartes, NOUVEAUX ids)
seen = set()
for p in range(1, max_page + 1):
    ids = set(re.findall(r'-id(\d+)"', fetch(page=p)))
    print(p, len(ids), len(ids - seen)); seen |= ids
# Si "nouveaux" chute avant la dernière page (ex. page 25 → 0 nouveau),
# la pagination est INSTABLE → imposer un tri déterministe.
```

- SM360 : `?namedSorting=priceASC` rend la pagination stable et complète
  (`dateDESC` est PIRE que le tri par défaut : 504 uniques vs 574).
  Tester aussi `limit=` : plafonné serveur à 100 → 8 requêtes au lieu de 30.
- Sitemap : croiser le compte sitemap avec le total affiché sur le site.
- Comparer les ids uniques entre deux stratégies (tri A vs tri B vs défaut)
  et viser l'union ≈ max.

## 3. Écrire le scraper (patron maison)

Modèles : `centre_du_sport_lac_st_jean.py` (hybride listing + détail) et
`smsport.py` (sitemap + détail via pipeline de base).

- Hériter de `DedicatedScraper` (base.py). Deux architectures :
  - **Hybride** (listing riche) : `scrape()` custom = phase listing →
    `_enrich_from_detail_pages()` parallèle. Les produits survivent même si
    leur page détail échoue.
  - **Pipeline de base** (découverte seule, ex. sitemap) : implémenter
    `discover_product_urls()` + `extract_from_detail_page()` ; `base.scrape()`
    gère workers adaptatifs, retries, batches.
- **JAMAIS de plafond silencieux** : l'ancien smsport généré par scraper_usine
  avait `MAX_PRODUCT_URLS = 400` → 234 produits perdus sans aucun log.
  Si une limite de sûreté existe, logger ce qui est coupé.
- **Dédup par `sourceUrl` UNIQUEMENT** (surcharger `_deduplicate`). Jamais
  nom+prix : plusieurs unités identiques du même modèle coexistent (cf.
  mémoire « alertes prix faux positifs » : le regroupement par nom crée des
  ping-pongs de prix dans les alertes).
- Champs à émettre (schéma maison — voir `extracted_fields` en base) :
  `name, prix, prix_original, marque, modele, annee, etat, kilometrage,
  couleur, image (STRING, pas une liste), inventaire (n° stock), vin,
  vehicule_type, description, sourceCategorie`.
  - `etat` ∈ `neuf | occasion | demonstrateur` (détecter « démo » dans le nom)
  - `sourceCategorie` ∈ `inventaire | vehicules_occasion | catalogue`
  - `vehicule_type` : mapper le segment d'URL avec accents
    (`vcc → Côte-à-côte`, `equipement-motorise → Équipement motorisé`…)
    + fallback `segment.replace('-', ' ').capitalize()`.
- **km = 0 ou None → ne PAS émettre le champ** (SM360 et PowerGO mettent 0/None
  quand l'odomètre n'est pas renseigné ; un « 0 km » sur une occasion 2005 est
  un mensonge).
- Nettoyage des noms (`_clean_name`) — défauts réellement rencontrés :
  - suffixes localité/marketing : « à Alma », « à vendre… », « | SM Sport »
  - **ellipse de troncature** des cartes listing (`Compact...`) → retirer, et
    faire gagner le nom complet du JSON-LD détail dans le merge d'enrichissement
  - **tokens adjacents dupliqués** : « Polaris POLARIS RANGER 500 »,
    « … 2020 2020 » → dédup case-insensitive token par token
  - espaces multiples → collapse
- **Mojibake PowerGO** : descriptions/CSS en UTF-8 double-encodé
  (« hÃ©roÃ¯ne ») → `text.encode('latin-1', 'ignore').decode('utf-8', 'ignore')`.
- Prix : `meta[itemprop=price]` ou `offers.price` pour le courant ; prix barré
  (`del`/`s`/`strike` dans le bloc prix) → `prix_original`. Toujours passer par
  `clean_price` (bornes de sanité).

## 4. Enregistrer dans la registry

`registry.py` : import + `_SCRAPERS['<slug>']` + `_DOMAIN_MAP['<domaine>']`.

⚠️ `_generated_registry.py` (scrapers usine) est mergé **APRÈS** via
`_SCRAPERS.update(GENERATED_SCRAPERS)` → il ÉCRASE la registry principale à
slug égal. Pour promouvoir un scraper généré en version main : retirer son
bloc de `_generated_registry.py` (sinon l'ancienne classe gagne
silencieusement).

## 5. Tester (obligatoire avant push)

1. Fumée : registry (`get_by_slug`, `get_by_url`), 1 page listing parsée,
   2 fiches détail (une neuve, une occasion).
2. Run complet + audit automatique :
   - couverture par champ (%) — viser name/prix 100 %, marque/année ≥ 99 %
   - compteurs `etat`, `vehicule_type`, `sourceCategorie`
   - unicité des `sourceUrl` (doit être 100 %)
   - noms : regex doubles espaces, ellipses, `[àa] (vendre|alma|québec)`,
     mojibake (`Ã|Â|â€`), tokens doublés `\b(\S{2,})\s+\1\b`, année absente
   - km renseigné sur les occasions
3. **Croiser le total avec le site** (compte affiché, sitemap ou calcul
   pages × cartes). Un scrape « réussi » peut être incomplet (cf. §2 :
   651 vs 798 réels sur CSL).

## 6. SQL — table `shared_scrapers` (Supabase)

- Fichier de migration idempotent dans `dashboard_web/supabase/`
  (`INSERT … SELECT … WHERE NOT EXISTS`), pour la trace.
- **Application** : le MCP godata est en LECTURE SEULE. Le DML passe par
  PostgREST avec la clé service de `dashboard_web/.env.local`
  (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) :
  `POST {url}/rest/v1/shared_scrapers` (vérifier l'existence avant).
  DDL (ALTER/CREATE) = SQL Editor Supabase uniquement.
- Copier la forme d'une ligne récente (joliette-recreatif, smsport) :
  `scraper_module` = slug registry, `categories = ['inventaire','occasion']`,
  `search_keywords` (ville, variantes du nom, TOUTES les marques vendues),
  `selectors`/`pagination_config` = documentation des pièges du site.

## 7. Cron

- Le cron principal est **GitHub Actions** (`.github/workflows/scraper-cron.yml`),
  grille `0 10-22/2 * * *` UTC (≈ 6 h–18 h Montréal, toutes les 2 h). Chaque
  run checkout `main` → le code poussé est actif au run suivant, rien à
  déployer. (Le backend Railway expose aussi `/cron/scrape` mais le scheduling
  réel est GitHub Actions.)
- Il lit les `shared_scrapers` actifs et scrape ceux dont le cache
  `scraped_site_data` est plus vieux que leur seuil : 55 min par défaut,
  ou `STALE_OVERRIDES_MINUTES[domaine]` (scripts/scraper_cron.py) pour une
  cadence personnalisée (100 min ≈ un passage / 2 h si le cron était horaire).
- Des workflows par site existent aussi (`scraper-morin-sports.yml`) via
  `scripts/scrape_single_site.py --slug <slug>` — utile pour une cadence
  vraiment indépendante.
- ⚠️ Séquencement : si la ligne `shared_scrapers` est insérée APRÈS le début
  d'un run (le run lit la liste dans sa première minute), le site attendra le
  run suivant. Pour une dispo immédiate :
  `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python scripts/scrape_single_site.py --slug <slug> --force`
  (mêmes chemins de code que le cron, upsert `scraped_site_data` inclus).

## 8. Git

- Remote qui compte : `origin` = **Txs-Mav/scraper_mav** (les workflows cron y
  tournent). `upstream` (luthor007) n'a PAS les workflows — `gh` sans
  `-R Txs-Mav/scraper_mav` peut résoudre sur le mauvais repo (404 trompeur).
- Ne commiter QUE les fichiers du scraper (le working tree contient souvent
  d'autres chantiers) : `git add <fichiers explicites>`.
- Vérifier le run suivant : `gh run list -R Txs-Mav/scraper_mav
  --workflow=scraper-cron.yml` puis la ligne `scraped_site_data` du domaine.

## Historique des erreurs (pour ne pas les refaire)

| Erreur | Symptôme | Correctif |
|---|---|---|
| Pagination SM360 tri défaut | 651 produits au lieu de 798, silencieux | `namedSorting=priceASC` + protocole §2 |
| `break` sur page listing en erreur | une page qui timeout sacrifie toute la suite | `continue` + plafond d'échecs consécutifs |
| Noms tronqués des cartes (`…`) | 71 noms incomplets sans année | nom JSON-LD détail prioritaire dans le merge |
| Marque doublée SM360 (`Polaris POLARIS …`) | 13 noms sales | dédup tokens adjacents |
| km=0 émis sur occasions | « 0 km » sur une moto 2005 | n'émettre km que si > 0 |
| Plafond 400 URLs (smsport généré) | 234 produits perdus sans log | jamais de cap silencieux |
| Mojibake PowerGO | « hÃ©roÃ¯ne discrÃ¨te » en prod | réparation latin-1→utf-8 |
| smsport en double registry | l'ancienne classe générée écrasait la nouvelle | retirer de `_generated_registry.py` |
| INSERT pendant un run de cron | site pas scrapé au passage attendu | `scrape_single_site.py --force` pour la dispo immédiate |
| Run cron parti AVANT le push (checkout figé) | l'ancien code écrase une sauvegarde fraîche (634 → 400) | vérifier `gh run list` (run in_progress ?) ; re-`scrape_single_site --force` après la fin du run, le run suivant a le bon code |
| Scraper créé mais JAMAIS poussé (moto-falardeau, 2026-08-17) | cron : « Scraper introuvable dans le registre » à chaque passage → le site finit `temporarily_hidden` (invisible dans la recherche) | le push fait PARTIE de la livraison — vérifier `git log origin/main` ; réparer : push + `scrape_single_site --force` (le succès remet `temporarily_hidden=false`) |
| `gh` sur le mauvais remote | 404 « workflow not found » | toujours `-R Txs-Mav/scraper_mav` |
