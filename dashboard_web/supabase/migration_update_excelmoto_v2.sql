-- Migration : promotion du scraper Excel Moto (Montréal) de la version
-- scraper_usine (v1.0, 2026-05-17) vers le scraper dédié écrit à la main
-- (v2.0, 2026-08-19) — scraper_ai/dedicated_scrapers/excelmoto.py, modèle
-- smsport.py. La ligne shared_scrapers existe depuis le 2026-05-20 : cette
-- migration la MET À JOUR (pas d'INSERT).
-- Plateforme PowerGO / Next.js — sitemap sitemaps/inventory-detail.xml
-- (404 FR + 404 EN en miroir ; oracle : payload Next.js du listing = 404,
-- vérifié le 2026-08-19 : 351 motos neuves + 41 produits mécaniques
-- + 8 motos usagées + 4 VTT).
-- Cadence : toutes les 2 h via STALE_OVERRIDES_MINUTES (scripts/scraper_cron.py).
-- Idempotente : re-jouable sans effet de bord.

UPDATE shared_scrapers SET
  site_url = 'https://www.excelmoto.com/fr/',
  search_keywords = ARRAY[
    'excel', 'excel moto', 'excelmoto', 'montreal', 'montréal',
    'kawasaki', 'honda', 'yamaha', 'piaggio', 'aprilia', 'vespa', 'ktm',
    'bmw', 'harley-davidson', 'moto', 'scooter', 'vtt',
    'souffleuse', 'generatrice', 'génératrice', 'equipement-mecanique'
  ],
  vehicle_types = ARRAY['moto', 'scooter', 'vtt', 'equipement-mecanique'],
  extracted_fields = ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vehicule_type',
    'description'
  ],
  description = 'Concessionnaire powersports à Montréal : Kawasaki, Honda, Yamaha, Piaggio, Aprilia, Vespa, KTM — motos, scooters, VTT, plus équipement mécanique Honda (souffleuses, génératrices). Plateforme PowerGO/Next.js. Scraper dédié écrit à la main (v2.0).',
  logo_url = '/dealers/excelmoto.png',
  selectors = '{
    "domains": ["excelmoto.com"],
    "detail": {
      "json_ld": "Vehicle au niveau RACINE d''une liste (pas @graph) — sku, itemCondition, brand, model, vehicleModelDate, color, image[], mileageFromOdometer, offers.price",
      "price_fallback": "[class*=pg-vehicle-price]",
      "old_price": "élément line-through dans le bloc pg-vehicle-price (« 4 795 $ | Épargnez 200 $ | 4 595 $ ») — le JSON-LD ne donne que le prix courant ; garde-fou prix_original != prix",
      "title": "meta[property=og:title]"
    },
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.excelmoto.com/sitemaps/inventory-detail.xml",
      "marker": "a-vendre-",
      "note": "Sitemap FR+EN en miroir → filtrer /fr/. N° de stock ALPHANUMÉRIQUES (a-vendre-pk197, ins00581, rh033-1) — jamais purement numériques. État + catégorie dans l''URL (/fr/neuf|usage/<categorie>/inventaire/). Descriptions en entités HTML (&eacute;, cascades &nbsp;) + bannières ***…*** → unescape + retrait. VIN jamais publié."
    }
  }'::jsonb,
  pagination_config = '{
    "type": "sitemap",
    "method": "sitemap",
    "rendering": "requests",
    "extraction": "json_ld",
    "sitemap_url": "https://www.excelmoto.com/sitemaps/inventory-detail.xml",
    "note": "Découverte sitemap SANS plafond (404 unités = total du payload Next.js au 2026-08-19, 396 neuf / 8 usagé, dont 4 démonstrateurs détectés par le nom). Dédup par sourceUrl UNIQUEMENT (l''ancien scraper usine regroupait par marque/modèle/année → unités perdues). mileageFromOdometer null sur le neuf → km omis honnêtement, pas de placebo « 1 km »."
  }'::jsonb,
  version = '2.0',
  last_verified_at = NOW(),
  updated_at = NOW()
WHERE site_slug = 'excelmoto';
