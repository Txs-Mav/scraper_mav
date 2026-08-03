# Plan — Socle « complétude + justesse vérifiées » pour scraper_usine

> Statut : **plan validé, implémentation non commencée** (sauf l'audit v0 lecture seule, ci-dessous).
> Décision d'archi prise le 2026-08-02. Ce document est la source de vérité du chantier.

## 1. Le problème (pas celui qu'on croyait)

L'usine optimise aujourd'hui un mauvais critère de succès : **« le code s'exécute + les champs sont bien
formés sur un échantillon »** (score 0-100 dans `validator.py`). Elle ne se demande jamais :

> Ce site a *N* produits. En ai-je extrait *N*, ou 40 % de *N*, avec les *bonnes* valeurs ?

Conséquence : un scraper qui ne ramène que la page 1, rate une catégorie, ou casse après une refonte
du site **passe la validation et est publié** — puis alimente le cron d'alerte avec un catalogue
incomplet, en silence. Pour un comparateur de prix, incomplet = faux.

### Reformulation retenue
- Le compte cible (*N*) est un **thermomètre**, pas un remède. Sa seule utilité : fermer la boucle
  d'extraction et la rendre *dirigée*.
- La vraie unité de valeur n'est pas « un bon scraper » mais **« des données justes qui coulent en
  continu dans le cron d'alerte »**. Donc le contrat complétude+justesse est le **portail d'entrée dans
  le cron** ET un **contrôle re-joué à l'intérieur du cron** (préfigure la détection de drift).
- Principe directeur : **universaliser le *critère de justesse*** (gratuit, ne coûte aucune perf) et
  **spécialiser le *mécanisme d'extraction*** (recettes par plateforme = perf + précision). Réponse à
  « les sites sont tous différents » : ce n'est pas universel-vs-spécifique, c'est *capitaliser la
  spécificité* (voir chantier C).

## 2. Preuve empirique — Audit v0 (lecture seule) du 2026-08-02

Script : [`../scripts/completeness_audit.py`](../scripts/completeness_audit.py). Compare le
`product_count` du dernier `scraped_site_data` à la **cible = nb d'URLs produit du sitemap que le
scraper déclare lui-même** (`shared_scrapers.selectors.discovery.sitemap_url`). Aucune écriture.

Sur **24 scrapers approuvés en prod** :

| Verdict | Nombre | Détail |
|---|---|---|
| **OK (≥90 %)** | 3 | excelmoto 101 %, laval-moto 180 %, maximum-aventure 415 % — *les >100 % trahissent une sur-extraction / doublons FR-EN, à traiter côté justesse (D)* |
| **INCOMPLET (<90 %)** | 10 | cible sitemap **déclarée** (fiable) : gregoire −22 %, morin −23 %, motoplex −24 %, motosport4saisons −26 %, motos-illimitees −37 % (−699), motopro-granby −43 % (−440), picotte −45 %, **motoplex-mirabel −63 % (−869)**. ≈ **2 500+ véhicules absents** du comparateur rien que sur ces sites |
| **MORT (0 produit, error)** | 2 | motorcycledealers-ca (périmé 79 j), rock-moto-sport (117 j) — alimentent les alertes avec du vide depuis des mois |
| **SANS CIBLE** | 5 | db-moto, mathias-sports, motovanier, mvm-motosport, nadon-sport — pas de sitemap trouvé → **oracle v0 aveugle, PAS une preuve de complétude** |
| **MARKETPLACE** | 4 | autotrader/cycletrader/kijiji/lespac — cible sitemap non pertinente (résultats paginés d'une requête) |
| **STALE (>3 j)** | 6 | dont 46 / 73 / 79 / 117 j — le cron ne rafraîchit pas vraiment |

**Conclusion : 3 scrapers sur 24 sont démontrablement complets**, et la thèse est confirmée — la
majorité livre un catalogue tronqué ou nul sans que rien ne le signale.

### Limites honnêtes de l'oracle v0 (ce que v1 doit corriger)
- **>100 %** = la cible sitemap sous-compte (FR+EN dédupliqués côté sitemap mais pas côté extraction,
  ou plusieurs conditions) → l'oracle doit **dédupliquer FR/EN** et **compter aussi la sur-extraction
  comme une anomalie**.
- **moto-ducharme 6 %** : cible 4090 issue d'un `sitemap_fr.xml` Magento global (pages incluses) →
  cible probablement gonflée ; le vrai chiffre reste à confirmer, mais 247 + périmé 30 j = suspect.
- **SANS CIBLE** : l'absence de sitemap n'implique rien sur la complétude — il faut les **autres
  sources de comptage** (texte « X résultats », `total` API, pagination).

## 3. Le socle A+D — les invariants (universels, indépendants du site)

- **I1** — Tout scraper publié porte un `CountTarget` enregistré avec sa **provenance**.
- **I2** — `extrait / cible ≥ seuil_complétude` au moment de publier (défaut **0,90**, ajustable par profil).
- **I3** — Chaque champ critique (prix d'abord) passe son **validateur sémantique** sur **≥ 0,95** des enregistrements.
- **I4** — Si les sources de comptage se **contredisent** au-delà de la tolérance → site **flaggé pour
  revue**, jamais publié en silence.
- **I5** — `CountTarget` + specs de champs sont **persistés comme fixture de non-régression**
  (prise où se branchent le drift et les recettes réutilisables).

Seuils de départ discutés : complétude 0,90 / justesse 0,95 — à rendre **ajustables par profil**
(certains sitemaps incluent du stock vendu).

## 4. Les 4 composants

| # | Composant | Rôle | Couche | Ancre |
|---|---|---|---|---|
| 1 | **Oracle de comptage** | Estime *N* en **triangulant** plusieurs sources indépendantes (URLs sitemap, `total`/`totalCount` API, texte « X résultats », n° dernière page × items/page, somme catégories) → `(N, confiance, provenance)`. **C'est une mesure, PAS un sélecteur de chemin.** | Universelle | nouveau module + `analyzer.py` |
| 2 | **Validateurs sémantiques** | Par profil de domaine : « la valeur a-t-elle le bon *sens* ? » — surtout le prix (piège paiement/semaine vs prix total, devise, bornes plausibles, cohérence inter-champs). | **Spécifique** (règles par profil/plateforme) | étend `domain_profiles.py` |
| 3 | **Harnais de vérification** | Remplace le score-sur-échantillon : lance le scraper, calcule **couverture** (`extrait/N`) + **justesse** (% valeurs valides) ; ne passe que si les deux ≥ seuil. **Tue le bug pagination** (page-1-seulement → couverture ~0,08 → échec franc). | Universelle | refonte `validator.py` |
| 4 | **Boucle d'escalade dirigée** | S'arrête sur « couverture ET justesse OK » (au lieu de « score ≥ 80 »). Le déficit devient un **diagnostic actionnable** pour Claude (« 340/1200 → pagination ou catégorie manquante »). | Universelle | `main.py` + `claude_supervisor.py` |

## 5. Ordre de construction

1. **Oracle de comptage — mode lecture seule** (FAIT, v0 sitemap) : prouve la thèse sur les scrapers
   déjà en prod. → voir §2.
2. **Oracle v1** : ajouter les sources manquantes (texte « X résultats », `total` API, pagination),
   dédup FR/EN, cible marketplace (compter les résultats d'une requête, pas le sitemap), traiter les
   5 SANS-CIBLE et moto-ducharme.
3. **Validateurs sémantiques du prix** (composant 2) — le ROI justesse le plus fort.
4. **Harnais de vérification** (composant 3) : câbler oracle + validateurs dans la validation, basculer
   le critère de « passe ».
5. **Boucle d'escalade** (composant 4) : renvoyer les déficits à Claude comme diagnostic.
6. **Persistance du contrat en fixture** (I5) → ouvre les chantiers B et C.

## 6. Ce que ça débloque (chantiers suivants, presque gratuits)

- **B — Drift / auto-guérison** : rejouer l'oracle sur cron ; si la couverture chute sous le
  `CountTarget` stocké → alarme + escalade de régénération. **La fixture EST le détecteur.** L'audit v0
  a déjà trouvé 2 scrapers morts (79/117 j) et 6 stale — c'est exactement ce que B doit attraper en continu.
- **C — Recettes réutilisables** : une recette n'est « de confiance » que si elle atteint
  couverture+justesse sur sa fixture. Le `CountTarget` par (plateforme × profil × cluster de template)
  devient le test d'acceptation d'une recette héritée → résoudre le site N+1 devient moins cher.

## 7. Actions immédiates hors-socle (détectées par l'audit)

- **motorcycledealers-ca** et **rock-moto-sport** : 0 produit, `status=error`, périmés 79/117 j →
  à réparer ou désactiver (ils polluent les alertes avec du vide).
- Investiguer les **>100 %** (laval-moto, maximum-aventure) : doublons FR/EN ou sur-extraction.
