-- Migration: Ajout de Motosport 4 Saisons dans shared_scrapers
-- Date: 2026-03-08
-- Description: Scraper dédié Motosport 4 Saisons — Next.js + PowerGO CDN
--              Sitemap XML pour découverte complète + JSON-LD sur pages détail.
--              Concessionnaire Polaris, KTM, GASGAS, Slingshot, Timbersled à Trois-Rivières.

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
  'Motosport 4 Saisons',
  'motosport4saisons',
  'https://www.motosport4saisons.com/fr/',
  'motosport4saisons.com',
  ARRAY['motosport', '4 saisons', 'motosport 4 saisons', 'motosport4saisons', 'sicard', 'sicard motosport', 'trois-rivières', 'trois-rivieres', 'mauricie', 'polaris', 'ktm', 'gasgas', 'slingshot', 'timbersled'],
  'motosport4saisons',
  '{
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.motosport4saisons.com/sitemaps/inventory-detail.xml",
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
      "weight": "li.spec-weight span.font-bold",
      "description": "div.pg-vehicle-description .prose",
      "title": "h1",
      "image": "img.pg-vehicle-image, .pg-vehicle-gallery img",
      "price": "div.pg-vehicle-price, div.pg-vehicle-desktop-price"
    },
    "json_ld": true,
    "domains": ["motosport4saisons.com"]
  }'::JSONB,
  '[
    {"url": "https://www.motosport4saisons.com/sitemaps/inventory-detail.xml", "type": "sitemap"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "sitemap_url": "https://www.motosport4saisons.com/sitemaps/inventory-detail.xml",
    "note": "Pagination client-side JS — sitemap fournit la liste complète"
  }'::JSONB,
  'Concessionnaire powersports à Trois-Rivières, QC (Mauricie). Polaris, KTM, GASGAS, Slingshot, Timbersled. Motos, VTT, côte-à-côte, motoneiges, vélos électriques. Plateforme Next.js/PowerGO.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'motocyclette', 'vtt', 'cote-a-cote', 'motoneige', 'velo-electrique', 'slingshot', 'timbersled'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vin', 'vehicule_type', 'vehicule_categorie', 'poids', 'description'],
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
