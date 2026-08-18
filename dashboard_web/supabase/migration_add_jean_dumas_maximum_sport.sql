-- Migration : ajout du concessionnaire Jean Dumas Maximum Sport (Saguenay/Chicoutimi)
-- Plateforme PowerGO / Next.js (même moteur que smsport.ca) — sitemap
-- sitemaps/inventory-detail.xml (FR uniquement, 130 unités au 2026-08-18),
-- listings client-side (RSC).
-- Scraper dédié : scraper_ai/dedicated_scrapers/jean_dumas_maximum_sport.py
-- (écrit à la main le 2026-08-18, modèle smsport.py). Cadence : toutes les 2 h
-- via STALE_OVERRIDES_MINUTES (scripts/scraper_cron.py).
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
  'Jean Dumas Maximum Sport',
  'jean-dumas-maximum-sport',
  'https://www.jeandumasmaximumsport.ca/fr/',
  'jeandumasmaximumsport.ca',
  'jean-dumas-maximum-sport',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'cote-a-cote', 'vtt', 'motoneige', 'motomarine', 'equipement-mecanique'],
  ARRAY[
    'jean dumas', 'jean dumas maximum sport', 'maximum sport', 'saguenay',
    'chicoutimi', 'saguenay-lac-saint-jean', 'kawasaki', 'polaris'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Concessionnaire powersports à Saguenay (Chicoutimi). Kawasaki et Polaris : motos, côtes-à-côtes, VTT, motoneiges, motomarines. Plateforme PowerGO/Next.js.',
  '/dealers/jean-dumas-maximum-sport.png',
  '{
    "domains": ["jeandumasmaximumsport.ca"],
    "detail": {
      "json_ld": "Vehicle niché dans @graph (jamais au niveau racine)",
      "price_fallback": "[class*=pg-vehicle-price]",
      "old_price": "span.list-price.line-through dans le bloc pg-vehicle-price",
      "title": "meta[property=og:title]"
    },
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.jeandumasmaximumsport.ca/sitemaps/inventory-detail.xml",
      "marker": "a-vendre-",
      "note": "Sitemap FR uniquement (pas de doublons EN). Stock neuf alphanumérique (W-GET-1330), usagé numérique (2489) — la regex d''URL accepte les deux. État + catégorie dans l''URL (/fr/neuf|usage/<categorie>/inventaire/)."
    }
  }'::jsonb,
  '[
    {
      "url": "https://www.jeandumasmaximumsport.ca/sitemaps/inventory-detail.xml",
      "type": "sitemap"
    },
    {
      "url": "https://www.jeandumasmaximumsport.ca/fr/inventaire/",
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
    "sitemap_url": "https://www.jeandumasmaximumsport.ca/sitemaps/inventory-detail.xml",
    "note": "Découverte sitemap SANS plafond (130 unités = total affiché au 2026-08-18). Description JSON-LD terminée par le nom du véhicule répété en MAJUSCULES (écho retiré ; occasions souvent écho seul → champ omis). mileageFromOdometer null sur le neuf et certaines occasions → km omis honnêtement. ~2 % des unités sans prix (« Contactez-nous ») → prix absent honnête. Mojibake PowerGO possible (réparation latin-1→utf-8)."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'jean-dumas-maximum-sport'
);
