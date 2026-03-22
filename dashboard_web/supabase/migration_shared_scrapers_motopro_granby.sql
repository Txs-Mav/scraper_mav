-- Migration: Ajout de MotoPro Granby dans shared_scrapers
-- Date: 2026-03-22
-- Description: Scraper dédié MotoPro Granby — Next.js + PowerGO CDN
--              Concessionnaire motos, VTT, côtes-à-côtes, motoneiges,
--              motomarines, Argo et produits mécaniques
--              à Granby, QC (Estrie).
--              ~895 produits (550 inventaire + 345 showroom) via JSON-LD Vehicle.
--              2 sitemaps (inventory-detail.xml + showroom-detail.xml).

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
  'MotoPro Granby',
  'motopro-granby',
  'https://www.motoprogranby.com/fr/',
  'motoprogranby.com',
  ARRAY[
    'motopro', 'motopro granby', 'motoprogranby',
    'granby', 'estrie', 'cantons-de-l''est', 'eastern townships',
    'kawasaki', 'cfmoto', 'argo', 'adly',
    'moto', 'motocyclette', 'motorcycle', 'vtt', 'atv',
    'cote-a-cote', 'side-by-side', 'motoneige', 'snowmobile',
    'motomarine', 'watercraft', 'produit mecanique', 'power equipment',
    'scooter'
  ],
  'motopro_granby',
  '{
    "discovery": {
      "method": "dual_sitemap",
      "sitemaps": {
        "inventory": "https://www.motoprogranby.com/sitemaps/inventory-detail.xml",
        "showroom": "https://www.motoprogranby.com/sitemaps/showroom-detail.xml"
      },
      "sitemap_format": "nextjs_xml",
      "bilingual": true,
      "preferred_language": "fr",
      "url_patterns": {
        "inventory_new_fr": "/fr/neuf/{type}/inventaire/{slug}-a-vendre-{stock}/",
        "inventory_used_fr": "/fr/usage/{type}/inventaire/{slug}-a-vendre-{stock}/",
        "inventory_new_en": "/en/new/{type}/inventory/{slug}-for-sale-{stock}/",
        "inventory_used_en": "/en/used/{type}/inventory/{slug}-for-sale-{stock}/",
        "showroom_fr": "/fr/neuf/{type}/{brand}/{model}/",
        "showroom_en": "/en/new/{type}/{brand}/{model}/"
      }
    },
    "detail": {
      "title": "h1",
      "json_ld": true,
      "json_ld_type": "Vehicle",
      "spec_items": {
        "make": "li.spec-make span.font-bold",
        "model": "li.spec-model span.font-bold",
        "year": "li.spec-year span.font-bold",
        "condition": "li.spec-condition span.font-bold",
        "stock_number": "li.spec-stock-number span.font-bold",
        "type": "li.spec-type span.font-bold",
        "category": "li.spec-category span.font-bold",
        "vin": "li.spec-vin span.font-bold",
        "color": "li.spec-color span.font-bold",
        "submodel": "li.spec-submodel span.font-bold",
        "trim": "li.spec-trim span.font-bold"
      },
      "price": "JSON-LD offers.price + fallback pg-vehicle-price",
      "images": "JSON-LD image[] + fallback img[src*=cdn.powergo.ca]",
      "description": "JSON-LD description + fallback div.pg-vehicle-description .prose"
    },
    "domains": ["motoprogranby.com", "cdn.powergo.ca"],
    "platform": "nextjs_powergo"
  }'::JSONB,
  '[
    {"url": "https://www.motoprogranby.com/sitemaps/inventory-detail.xml", "type": "sitemap", "category": "inventaire", "count": 1100},
    {"url": "https://www.motoprogranby.com/sitemaps/showroom-detail.xml", "type": "sitemap", "category": "catalogue", "count": 690}
  ]'::JSONB,
  '{
    "type": "dual_sitemap",
    "sitemap_count": 2,
    "bilingual": true,
    "dedup_strategy": "stock_or_slug_fr_priority",
    "note": "2 sitemaps Next.js (inventory-detail + showroom-detail). FR/EN URLs dédupliquées, priorité FR. Condition (neuf/usage) dans le path URL."
  }'::JSONB,
  'Concessionnaire motos, VTT, côtes-à-côtes, motoneiges, motomarines, Argo et produits mécaniques à Granby (Estrie, QC). Fondé en 1993. Marques: Kawasaki, CFMOTO, Argo, Adly. Membre du réseau Shop A Ride. Inventaire neuf et occasion + catalogue showroom complet. Plateforme Next.js + PowerGO CDN avec JSON-LD Vehicle.',
  ARRAY['inventaire', 'occasion', 'catalogue'],
  ARRAY['moto', 'vtt', 'cote-a-cote', 'motoneige', 'motomarine', 'argo', 'produit-mecanique', 'scooter'],
  ARRAY['name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat', 'inventaire', 'vehicule_type', 'vehicule_categorie', 'couleur', 'kilometrage', 'vin', 'image', 'description', 'finition', 'vehicule_sous_modele'],
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
