-- Migration: Ajout de Picotte Motosport dans shared_scrapers
-- Date: 2026-04-03
-- Description: Scraper dédié Picotte Motosport — Next.js + PowerGO CDN
--              Sitemap XML + fallback listing pages pour découverte complète.
--              JSON-LD Vehicle + specs HTML sur pages détail.
--              Concessionnaire Polaris, KTM, GASGAS, Suzuki, Husqvarna, Scootterre à Granby.

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
  'Picotte Motosport',
  'picotte-motosport',
  'https://www.picottemotosport.com/fr/',
  'picottemotosport.com',
  ARRAY['picotte', 'picotte motosport', 'picottemotosport', 'granby', 'estrie', 'polaris', 'ktm', 'gasgas', 'suzuki', 'husqvarna', 'scootterre'],
  'picotte_motosport',
  '{
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.picottemotosport.com/sitemaps/inventory-detail.xml",
      "fallback": "listing_pages",
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
      "image": "img.pg-vehicle-image, .pg-vehicle-gallery img",
      "price": "div.pg-vehicle-price, div.pg-vehicle-desktop-price"
    },
    "json_ld": true,
    "domains": ["picottemotosport.com"]
  }'::JSONB,
  '[
    {"url": "https://www.picottemotosport.com/sitemaps/inventory-detail.xml", "type": "sitemap"},
    {"url": "https://www.picottemotosport.com/fr/neuf/motocyclette/inventaire/", "type": "listing"},
    {"url": "https://www.picottemotosport.com/fr/neuf/vtt/inventaire/", "type": "listing"},
    {"url": "https://www.picottemotosport.com/fr/neuf/cote-a-cote/inventaire/", "type": "listing"},
    {"url": "https://www.picottemotosport.com/fr/neuf/motoneige/inventaire/", "type": "listing"},
    {"url": "https://www.picottemotosport.com/fr/neuf/velo-electrique/inventaire/", "type": "listing"},
    {"url": "https://www.picottemotosport.com/fr/usage/motocyclette/", "type": "listing"},
    {"url": "https://www.picottemotosport.com/fr/usage/motoneige/", "type": "listing"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "sitemap_url": "https://www.picottemotosport.com/sitemaps/inventory-detail.xml",
    "fallback": "listing_pages_multi_sort",
    "note": "Pagination client-side JS — sitemap fournit la liste complète, fallback listing si sitemap indisponible"
  }'::JSONB,
  'Concessionnaire powersports à Granby, QC (Estrie). Polaris, KTM, GASGAS, Suzuki, Husqvarna, Scootterre. Motos, VTT, côte-à-côte, motoneiges, vélos électriques. Plateforme Next.js/PowerGO.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'motocyclette', 'vtt', 'cote-a-cote', 'motoneige', 'velo-electrique'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vin', 'vehicule_type', 'vehicule_categorie', 'description'],
  TRUE,
  NOW(),
  '1.0'
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
