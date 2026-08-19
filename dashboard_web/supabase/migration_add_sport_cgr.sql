-- Migration : ajout du concessionnaire Les sports CGR Gaudreault
-- (Dolbeau-Mistassini, Lac-Saint-Jean). Plateforme PowerGO / Next.js (même
-- moteur que jeandumasmaximumsport.ca et gobeilequipement.ca) — sitemap
-- sitemaps/inventory-detail.xml (FR uniquement, 6 unités toutes usagées au
-- 2026-08-19 = total affiché ; l'inventaire neuf est vide, le neuf est en
-- vitrine catalogue sans unités), listings client-side (RSC).
-- ⚠️ Ce concessionnaire ne publie AUCUN prix ni km (null aussi dans le JSON
-- du listing) — champs absents honnêtes.
-- Scraper dédié : scraper_ai/dedicated_scrapers/sport_cgr.py
-- (écrit à la main le 2026-08-19, modèle gobeil_equipement.py).
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
  'Les sports CGR Gaudreault',
  'sport-cgr',
  'https://sportcgr.com/fr/',
  'sportcgr.com',
  'sport-cgr',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'vtt', 'motoneige'],
  ARRAY[
    'cgr', 'sport cgr', 'sports cgr', 'cgr gaudreault', 'gaudreault',
    'dolbeau', 'dolbeau-mistassini', 'lac-saint-jean',
    'saguenay-lac-saint-jean', 'yamaha', 'kawasaki', 'arctic cat', 'stacyc'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Concessionnaire Yamaha, Kawasaki, Arctic Cat et Stacyc à Dolbeau-Mistassini (Lac-Saint-Jean). Motos, VTT, motoneiges ; occasions multimarques. Plateforme PowerGO/Next.js. Ne publie ni prix ni kilométrage sur son site.',
  '/dealers/sport-cgr.png',
  '{
    "domains": ["sportcgr.com"],
    "detail": {
      "json_ld": "Vehicle niché dans @graph (jamais au niveau racine)",
      "price_fallback": "[class*=pg-vehicle-price] — bloc VIDE sur ce site (aucun prix publié)",
      "old_price": "del/s/line-through dans le bloc pg-vehicle-price",
      "title": "meta[property=og:title]"
    },
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://sportcgr.com/sitemaps/inventory-detail.xml",
      "marker": "a-vendre-",
      "note": "Sitemap FR uniquement. État + catégorie dans l''URL (/fr/neuf|usage/<categorie>/inventaire/). Inventaire neuf vide sur le site (vitrine catalogue seulement). Aucun prix ni km publié (offers.price et salePriceValue null partout)."
    }
  }'::jsonb,
  '[
    {
      "url": "https://sportcgr.com/sitemaps/inventory-detail.xml",
      "type": "sitemap"
    },
    {
      "url": "https://sportcgr.com/fr/inventaire/",
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
    "sitemap_url": "https://sportcgr.com/sitemaps/inventory-detail.xml",
    "note": "Découverte sitemap SANS plafond (6 unités toutes usagées = total affiché au 2026-08-19). Prix et km absents partout sur le site (vérifié dans le JSON du listing : salePriceValue null sur 6/6) — omission honnête. Mojibake PowerGO possible (réparation latin-1→utf-8)."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'sport-cgr'
);
