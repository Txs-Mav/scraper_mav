-- Migration: Ajout de Motoplex St-Eustache dans shared_scrapers
-- Date: 2026-03-08
-- Description: Scraper dédié Motoplex — Next.js + PowerGO CDN
--              Sitemap XML pour découverte complète + JSON-LD sur pages détail.
--              La pagination du site est 100% client-side JS, le sitemap contourne ce problème.

INSERT INTO shared_scrapers (
  site_name,
  site_slug,
  site_url,
  site_domain,
  search_keywords,
  scraper_module,
  selectors,
  listing_urls,
  pagination_config,
  description,
  categories,
  vehicle_types,
  extracted_fields,
  is_active,
  last_verified_at,
  version
) VALUES (
  'Motoplex St-Eustache',
  'motoplex',
  'https://www.motoplex.ca/fr/',
  'motoplex.ca',
  ARRAY['motoplex', 'st-eustache', 'saint-eustache', 'cfmoto', 'arctic cat', 'suzuki', 'starcraft', 'royal enfield', 'campagna', 'trex', 't-rex', 'laurentides', 'motoplexsteustache'],
  'motoplex',
  '{
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.motoplexsteustache.ca/sitemaps/inventory-detail.xml",
      "filter_lang": "/fr/",
      "filter_path": "/inventaire/",
      "neuf_pattern": "/neuf/",
      "occasion_pattern": "/usage/"
    },
    "detail": {
      "brand": "li.spec-make span.font-bold",
      "model": "li.spec-model span.font-bold",
      "year": "li.spec-year span.font-bold",
      "mileage": "li.spec-usage span.font-bold",
      "vin": "li.spec-vin span.font-bold",
      "color": "li.spec-color span.font-bold",
      "condition": "li.spec-condition span.font-bold",
      "type": "li.spec-type span.font-bold",
      "category": "li.spec-category span.font-bold",
      "stock_number": "li.spec-stock-number span.font-bold",
      "description": "div.pg-vehicle-description .prose",
      "title": "h1",
      "image": "img.pg-vehicle-image, .pg-vehicle-gallery img"
    },
    "json_ld": true,
    "domains": ["motoplex.ca", "motoplexsteustache.ca"]
  }'::JSONB,
  '[
    {"url": "https://www.motoplexsteustache.ca/sitemaps/inventory-detail.xml", "type": "sitemap"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "sitemap_url": "https://www.motoplexsteustache.ca/sitemaps/inventory-detail.xml",
    "note": "Pagination client-side JS impossible via HTTP — sitemap fournit la liste complète"
  }'::JSONB,
  'Concessionnaire powersports et marine à Saint-Eustache, QC (Laurentides). Motos, VTT, côte-à-côte, motomarines, pontons, motoneiges. Plateforme Next.js/PowerGO. Sitemap utilisé pour découverte complète (pagination JS-only).',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'quad', 'vtt', 'cote-a-cote', 'motomarine', 'ponton', 'bateau', 'moteur-hors-bord', 'motoneige', 't-rex', 'equipement-mecanique'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vin', 'vehicule_type', 'vehicule_categorie', 'description'],
  TRUE,
  NOW(),
  '2.0'
)
ON CONFLICT (site_slug) DO UPDATE SET
  selectors = EXCLUDED.selectors,
  listing_urls = EXCLUDED.listing_urls,
  pagination_config = EXCLUDED.pagination_config,
  search_keywords = EXCLUDED.search_keywords,
  extracted_fields = EXCLUDED.extracted_fields,
  description = EXCLUDED.description,
  vehicle_types = EXCLUDED.vehicle_types,
  version = EXCLUDED.version,
  last_verified_at = NOW(),
  updated_at = NOW();
