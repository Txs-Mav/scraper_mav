-- Migration : ajout du concessionnaire Saguenay Marine (Jonquière, Saguenay)
-- Plateforme PowerGO / Next.js (même moteur que jeandumasmaximumsport.ca) —
-- sitemap sitemaps/inventory-detail.xml (FR+EN en double, on ne garde que
-- /fr/ : 1750 unités au 2026-08-19 = total affiché), listings client-side.
-- Scraper dédié : scraper_ai/dedicated_scrapers/saguenay_marine.py
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
  'Saguenay Marine',
  'saguenay-marine',
  'https://www.saguenaymarine.com/fr/',
  'saguenaymarine.com',
  'saguenay-marine',
  ARRAY['inventaire', 'occasion'],
  ARRAY['bateau', 'moto', 'vtt', 'motoneige', 'equipement-mecanique', 'remorque'],
  ARRAY[
    'saguenay marine', 'jonquière', 'jonquiere', 'saguenay',
    'saguenay-lac-saint-jean', 'cfmoto', 'arctic cat', 'princecraft',
    'lund', 'mercury', 'sportspal', 'bateau', 'marine'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Gros concessionnaire marine et powersports à Jonquière (Saguenay). Bateaux (Princecraft, Lund…), motos et VTT CFMOTO, motoneiges Arctic Cat, moteurs Mercury, remorques. Plateforme PowerGO/Next.js.',
  '/dealers/saguenay-marine.webp',
  '{
    "domains": ["saguenaymarine.com"],
    "detail": {
      "json_ld": "Vehicle niché dans @graph (jamais au niveau racine)",
      "price_fallback": "[class*=pg-vehicle-price]",
      "old_price": "del/s/line-through dans le bloc pg-vehicle-price",
      "title": "meta[property=og:title]"
    },
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.saguenaymarine.com/sitemaps/inventory-detail.xml",
      "marker": "a-vendre-",
      "note": "Le sitemap liste chaque unité en FR et en EN (3500 locs pour 1750 unités) — filtrer /fr/. État + catégorie dans l''URL (/fr/neuf|usage/<categorie>/inventaire/). Stocks W-GET-### et numériques."
    }
  }'::jsonb,
  '[
    {
      "url": "https://www.saguenaymarine.com/sitemaps/inventory-detail.xml",
      "type": "sitemap"
    },
    {
      "url": "https://www.saguenaymarine.com/fr/inventaire/",
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
    "sitemap_url": "https://www.saguenaymarine.com/sitemaps/inventory-detail.xml",
    "note": "Découverte sitemap SANS plafond (1750 unités = total affiché au 2026-08-19, 1690 neuf / 60 usagé — gros inventaire, ~40 s de scrape). Écho du nom en fin de description retiré. mileageFromOdometer null sur le neuf → km omis honnêtement. Mojibake PowerGO possible (réparation latin-1→utf-8)."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'saguenay-marine'
);
