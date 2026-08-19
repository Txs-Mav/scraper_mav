-- Migration : ajout du concessionnaire Gobeil Équipement (Dolbeau-Mistassini,
-- Lac-Saint-Jean). Plateforme PowerGO / Next.js (même moteur que
-- jeandumasmaximumsport.ca) — sitemap sitemaps/inventory-detail.xml
-- (FR uniquement, 36 unités au 2026-08-19 = total affiché), listings
-- client-side (RSC).
-- Scraper dédié : scraper_ai/dedicated_scrapers/gobeil_equipement.py
-- (écrit à la main le 2026-08-19, modèle jean_dumas_maximum_sport.py).
-- Cadence : toutes les 2 h via STALE_OVERRIDES_MINUTES (scripts/scraper_cron.py).
-- Idempotente : ne fait rien si le slug existe déjà.

INSERT INTO shared_scrapers (
  site_name,
  site_slug,
  site_url,
  site_domain,
  scraper_module,
  categories,
  vehicle_types,
  search_keywords,
  extracted_fields,
  description,
  logo_url,
  selectors,
  listing_urls,
  pagination_config,
  is_active,
  validation_status,
  version
)
SELECT
  'Gobeil Équipement',
  'gobeil-equipement',
  'https://www.gobeilequipement.ca/fr/',
  'gobeilequipement.ca',
  'gobeil-equipement',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'cote-a-cote', 'vtt', 'motoneige', 'equipement-mecanique'],
  ARRAY[
    'gobeil', 'gobeil equipement', 'gobeil équipement', 'dolbeau',
    'dolbeau-mistassini', 'lac-saint-jean', 'saguenay-lac-saint-jean',
    'honda', 'polaris', 'suzuki', 'yamaha', 'adly'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Concessionnaire powersports à Dolbeau-Mistassini (Lac-Saint-Jean). Honda et Polaris : motos, côtes-à-côtes, VTT, motoneiges, équipements motorisés ; occasions multimarques. Plateforme PowerGO/Next.js.',
  '/dealers/gobeil-equipement.png',
  '{
    "domains": ["gobeilequipement.ca"],
    "detail": {
      "json_ld": "Vehicle niché dans @graph (jamais au niveau racine)",
      "price_fallback": "[class*=pg-vehicle-price]",
      "old_price": "span.list-price.line-through dans le bloc pg-vehicle-price — présent même sans rabais (égal au sale-price) : n''émettre prix_original que s''il diffère",
      "title": "meta[property=og:title]"
    },
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.gobeilequipement.ca/sitemaps/inventory-detail.xml",
      "marker": "a-vendre-",
      "note": "Sitemap FR uniquement. N° de stock avec underscores possibles (NA_STOCK_893B4A01) en plus des numériques — regex [a-z0-9_-]. État + catégorie dans l''URL (/fr/neuf|usage/<categorie>/inventaire/). Écho de marque non adjacent dans les noms (« Adly Moto ADLY BULLSEYE ») → dédup tokens alphabétiques sur fenêtre de 2."
    }
  }'::jsonb,
  '[
    {
      "url": "https://www.gobeilequipement.ca/sitemaps/inventory-detail.xml",
      "type": "sitemap"
    },
    {
      "url": "https://www.gobeilequipement.ca/fr/inventaire/",
      "type": "listing",
      "category": "inventaire",
      "note": "client-side (RSC), non scrapable en requests"
    }
  ]'::jsonb,
  '{
    "type": "sitemap",
    "method": "sitemap",
    "rendering": "requests",
    "extraction": "json_ld_graph",
    "sitemap_url": "https://www.gobeilequipement.ca/sitemaps/inventory-detail.xml",
    "note": "Découverte sitemap SANS plafond (36 unités = total affiché au 2026-08-19, 25 neuf / 11 usagé). Écho du nom en fin de description retiré (nom brut ET nettoyé). mileageFromOdometer null sur le neuf → km omis honnêtement. Mojibake PowerGO possible (réparation latin-1→utf-8)."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'gobeil-equipement'
);
