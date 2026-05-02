-- Migration: Ajout de Morin Sports & Marine dans shared_scrapers
-- Date: 2026-05-02
-- Description: Scraper dédié Morin Sports & Marine — Next.js + PowerGO CDN.
--              Sitemap inventory-detail.xml (inventaire neuf + occasion) +
--              showroom-detail.xml (catalogue 397 modèles, optionnel).
--              JSON-LD Vehicle/Product + specs HTML sur pages détail.
--              Concessionnaire Arctic Cat, Kawasaki, Suzuki Marine, Widescape,
--              Remeq à Trois-Rivières (Mauricie), QC.

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
  'Morin Sports & Marine',
  'morin-sports',
  'https://www.morinsports.com/fr/',
  'morinsports.com',
  ARRAY[
    'morin', 'morin sports', 'morin sports marine', 'morinsports',
    'trois-rivieres', 'trois rivieres', 'mauricie',
    'arctic cat', 'kawasaki', 'suzuki', 'widescape', 'remeq'
  ],
  'morin_sports',
  '{
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.morinsports.com/sitemaps/inventory-detail.xml",
      "showroom_sitemap_url": "https://www.morinsports.com/sitemaps/showroom-detail.xml",
      "sitemap_index": "https://www.morinsports.com/sitemap-index.xml",
      "filter_lang": "/fr/",
      "filter_path": "/inventaire/",
      "filter_marker": "a-vendre-",
      "neuf_pattern": "/neuf/",
      "occasion_pattern": "/usage/",
      "showroom_pattern": "/fr/neuf/<type>/<marque>/<modele>/"
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
      "image": "img.pg-vehicle-image, .pg-vehicle-gallery img, img[src*=\"cdn.powergo.ca\"]",
      "price": "div.pg-vehicle-price, div.pg-vehicle-mobile-price",
      "spec_label_value_fallback": "li[class*=\"spec-\"]"
    },
    "json_ld": {
      "accepted_types": ["Vehicle", "Product"],
      "offers_can_be_list": true,
      "item_condition_lowercase_supported": true
    },
    "domains": ["morinsports.com"]
  }'::JSONB,
  '[
    {"url": "https://www.morinsports.com/sitemaps/inventory-detail.xml", "type": "sitemap"},
    {"url": "https://www.morinsports.com/sitemaps/showroom-detail.xml", "type": "sitemap_showroom"},
    {"url": "https://www.morinsports.com/fr/neuf/motocyclette/inventaire/", "type": "listing"},
    {"url": "https://www.morinsports.com/fr/neuf/vtt/inventaire/", "type": "listing"},
    {"url": "https://www.morinsports.com/fr/neuf/motoneige/inventaire/", "type": "listing"},
    {"url": "https://www.morinsports.com/fr/neuf/bateau/inventaire/", "type": "listing"},
    {"url": "https://www.morinsports.com/fr/neuf/motomarine/inventaire/", "type": "listing"},
    {"url": "https://www.morinsports.com/fr/usage/motocyclette/", "type": "listing"},
    {"url": "https://www.morinsports.com/fr/usage/motoneige/", "type": "listing"},
    {"url": "https://www.morinsports.com/fr/usage/vtt/", "type": "listing"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "sitemap_url": "https://www.morinsports.com/sitemaps/inventory-detail.xml",
    "showroom_sitemap_url": "https://www.morinsports.com/sitemaps/showroom-detail.xml",
    "note": "Pagination client-side JS Next.js — les sitemaps PowerGO fournissent la liste complète. Showroom catalogue inclus uniquement si la catégorie ''catalogue'' est demandée."
  }'::JSONB,
  'Concessionnaire Arctic Cat, Kawasaki, Suzuki Marine, Widescape et Remeq à Trois-Rivières (Mauricie), QC. Motos, VTT, côte-à-côte, motoneiges, motomarines, bateaux, moteurs hors-bord, remorques. Plateforme Next.js / PowerGO. Près de 35 ans d''expérience.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'motocyclette', 'vtt', 'cote-a-cote', 'motoneige', 'motomarine', 'bateau', 'moteur-hors-bord', 'remorque'],
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
