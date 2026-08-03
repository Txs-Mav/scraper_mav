# Conclusions de l'audit de complétude — 2026-08-03

Diagnostic de gap (`../../scripts/completeness_gap.py`) : set-difference exact entre les URLs
produit du sitemap déclaré et les `sourceUrl` réellement extraits (`scraped_site_data.products`),
puis classement des manquants par motif. Lecture seule.

## Résultats par scraper (sous-ensemble incomplet)

| Scraper | Extrait | Sitemap | Manquant | Extra | Motif dominant du manquant |
|---|---:|---:|---:|---:|---|
| picotte-motosport | 237 | 434 | **197** | 0 | neuf motocyclette (180) |
| motos-illimitees | 1283 | 1882 | 626 | 27 | neuf motocyclette (393), côte-à-côte (142) |
| motoplex | 404 | 529 | 125 | 0 | neuf motocyclette (76), vtt (25) |
| gregoire-sport | 380 | 488 | 108 | 0 | neuf : motocyclette (50), vtt (26), **bateau (24)** |
| motosport4saisons | 117 | 159 | 42 | 0 | neuf : motoneige (16), motocyclette (14), vtt (12) |
| morin-sports | 80 | 104 | 24 | 0 | neuf : motocyclette (10), motoneige (7), bateau (4) |
| motoplex-mirabel | 527 | 1402 | 875 | 0 | **surtout /en/ (EN)** → cible gonflée |
| motopro-granby | 580 | 1020 | 759 | **319** | **/en/ + mismatch de forme d'URL** |
| joliette-recreatif | 242 | 312 | 70 | 0 | catégories `power-equipment`, `produits-*` |

## Causes racines (confirmées vs à épingler)

### 1. CONFIRMÉ — perte silencieuse à l'extraction détail
`dedicated_scrapers/motoplex.py:305-310` et `:332-333` : tout fetch détail qui renvoie un
status ≠ 200 ou lève une exception est compté dans `errors` **et jeté silencieusement** — les
URLs échouées ne sont **jamais journalisées**, il n'y a **ni retry, ni seuil d'échec**. Le
`scrape()` renvoie alors « 404 produits » sans jamais signaler qu'il en manque 125. **C'est le
mécanisme précis par lequel l'incomplétude devient invisible** — l'incarnation code de la thèse.
Le timeout global (`as_completed(timeout=900)`, `:317-322`) abandonne aussi la queue en fin de
run, également en silence côté données.

### 2. À ÉPINGLER — gap systématique « véhicules neufs » sur le socle PowerGO
6 sites (picotte, motos-illimitees, motoplex, gregoire, morin, motosport4saisons) : manquant
**quasi 100 % du NEUF**, `extra=0` (donc l'extrait est un sous-ensemble strict du sitemap →
inventaire réellement non-scrapé, pas un artefact d'URL). Motif partagé = **un seul bug de socle**,
pas six. Les URLs manquantes passent pourtant le filtre de découverte (`:200-209`, elles ont bien
`/fr/ /inventaire/ a-vendre- /neuf/`). Donc la perte est en Phase 2. **Cause exacte non encore
prouvée** — hypothèses à départager par un re-run instrumenté d'**un** scraper :
(a) pages détail neuves rejetées au parsing (JSON-LD `_ACCEPTED_LD_TYPES`, specs absentes) ;
(b) échecs de fetch concentrés (cf. cause 1) ; (c) budget temps.

### 3. À CORRIGER — cible bilingue + config incohérente
motoplex-mirabel & motopro-granby : le manquant est surtout des URLs `/en/`. Leur config
`shared_scrapers.selectors.discovery` **n'a pas de `filter_lang`** (contrairement à motoplex qui a
`/fr/`). La cible compte donc FR+EN → gap gonflé. Le gap FR réel existe mais est plus petit.
→ L'oracle v1 doit dédupliquer FR/EN ; la config de ces scrapers doit fixer `filter_lang`.

### 4. À CORRIGER — mismatch de forme d'URL (canonicalisation)
motopro-granby : `extra=319` avec des URLs `/fr/neuf/<type>/<marque>/<modele>` (sans
`/inventaire/`, sans stock-id) ≠ sitemap `/inventaire/...-INS…`. Le scraper extrait sous une forme
d'URL canonique différente → le même véhicule apparaît à la fois « manquant » (forme sitemap) et
« extra » (forme marque/modèle). → besoin d'une clé de comparaison canonique (par stock-id / VIN).

## Scrapers MORTS (à traiter tout de suite, hors débat d'archi)

- **rock-moto-sport** : `status=error`, `"Scraper 'rock-moto-sport' introuvable dans le registre"`,
  dernière tentative **2026-04-07**. La ligne existe dans `shared_scrapers` mais le module Python
  n'existe pas (`rock_moto_sport.py` absent du registre) → **orphelin inversé** (DB sans code).
  Action : générer le scraper via l'usine, ou désactiver la ligne.
- **motorcycledealers-ca** : `status=error`, `"0 produits extraits"`, dernière tentative
  **2026-05-15**. Le code tourne mais les sélecteurs ne ramènent rien (site changé). Action :
  régénérer / réparer, ou désactiver.

Les deux alimentent les alertes clients avec du vide depuis ~3-4 mois.

## Correctifs recommandés (mappés au plan)

1. **Immédiat, sûr** : réparer ou désactiver les 2 scrapers morts.
2. **Barrière au niveau scraper** (composant 3, décliné dans le scraper) : `scrape()` doit
   renvoyer `discovered` vs `extracted`, **journaliser les URLs échouées**, **retry** les détails
   en erreur, et **échouer bruyamment** si `extracted/discovered < seuil`. Supprime la cause 1.
3. **Oracle v1** : `filter_lang`, dédup FR/EN, clé canonique stock-id/VIN (causes 3-4).
4. **Épingler la cause 2** par un re-run instrumenté d'un scraper PowerGO, puis corriger le socle
   `MotoplexScraper` une fois pour les 8 sites.

⚠️ Le socle `MotoplexScraper` est hérité par 8+ scrapers en prod alimentant des alertes clients.
Tout patch doit être fait **avec le harnais de vérification** (composant 3) pour prouver le gain
avant déploiement — pas à l'aveugle.
