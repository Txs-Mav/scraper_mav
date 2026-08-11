-- Migration : ajout du concessionnaire SM Sport (Québec / Valcartier)
-- Plateforme PowerGO / Next.js — sitemap inventory-detail.xml, listings client-side.
-- Scraper dédié : scraper_ai/dedicated_scrapers/smsport.py (réécrit à la main
-- le 2026-08-11 — remplace la version scraper_usine qui plafonnait à 400 URLs).
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
  selectors,
  listing_urls,
  pagination_config,
  is_active,
  validation_status,
  version
)
SELECT
  'SM Sport',
  'smsport',
  'https://smsport.ca/fr/',
  'smsport.ca',
  'smsport',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'vtt', 'cote-a-cote', 'motoneige', 'motomarine', 'moteur-hors-bord', 'remorque', 'souffleuse', 'equipement-mecanique'],
  ARRAY[
    'sm sport', 'smsport', 'quebec', 'québec', 'valcartier',
    'aprilia', 'arctic cat', 'niu', 'cfmoto', 'gasgas', 'husqvarna',
    'ktm', 'piaggio', 'polaris', 'surron', 'suzuki', 'timbersled',
    'vespa', 'yamaha', 'zero motorcycles'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Concessionnaire powersports à Québec (Valcartier). Aprilia, Arctic Cat, CFMOTO, GASGAS, Husqvarna, KTM, Piaggio, Polaris, Surron, Suzuki, Vespa, Yamaha : motos, VTT, côtes-à-côtes, motoneiges, motomarines, moteurs hors-bord, souffleuses. Plateforme PowerGO/Next.js.',
  '{
    "domains": ["smsport.ca"],
    "detail": {
      "json_ld": "Vehicle (TOUJOURS niché dans @graph)",
      "price_fallback": "[class*=pg-vehicle-price]",
      "old_price": "del/s dans le bloc pg-vehicle-price",
      "title": "meta[property=og:title]"
    },
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://smsport.ca/sitemaps/inventory-detail.xml",
      "filter_lang": "/fr/",
      "neuf_pattern": "/neuf/",
      "occasion_pattern": "/usage/",
      "marker": "a-vendre-",
      "note": "Listings 100% client-side (RSC Next.js) — inutilisables en requests, le sitemap est la seule source."
    }
  }'::jsonb,
  '[
    {
      "url": "https://smsport.ca/sitemaps/inventory-detail.xml",
      "type": "sitemap"
    },
    {
      "url": "https://smsport.ca/fr/neuf/",
      "type": "listing",
      "etat": "neuf",
      "category": "inventaire",
      "note": "client-side, non scrapable en requests"
    },
    {
      "url": "https://smsport.ca/fr/usage/",
      "type": "listing",
      "etat": "occasion",
      "category": "occasion",
      "note": "client-side, non scrapable en requests"
    }
  ]'::jsonb,
  '{
    "type": "sitemap",
    "method": "sitemap",
    "rendering": "requests",
    "extraction": "json_ld_graph",
    "sitemap_url": "https://smsport.ca/sitemaps/inventory-detail.xml",
    "note": "Découverte sitemap SANS plafond (l''ancien scraper généré coupait à 400 URLs sur ~634). JSON-LD Vehicle dans @graph ; descriptions et bloc prix CSS en mojibake UTF-8 double-encodé (réparation latin-1→utf-8) ; mileageFromOdometer.value=None sur le neuf ; prix barré via del/s dans pg-vehicle-price."
  }'::jsonb,
  true,
  'approved',
  '2.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'smsport'
);
