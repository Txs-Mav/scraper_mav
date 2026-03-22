-- Migration: Ajout de Grégoire Sport dans shared_scrapers
-- Date: 2026-03-21
-- Description: Scraper dédié Grégoire Sport — Next.js + PowerGO CDN
--              Concessionnaire Yamaha, KTM, Suzuki, Arctic Cat, GAS GAS, etc.
--              à Lourdes-de-Joliette, QC (Lanaudière).
--              Sitemap XML pour découverte complète + JSON-LD Vehicle sur pages détail.
--              Pagination client-side JS uniquement, sitemap contourne ce problème.

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
  'Grégoire Sport',
  'gregoire-sport',
  'https://www.gregoiresport.com/fr/',
  'gregoiresport.com',
  ARRAY['gregoire', 'grégoire', 'gregoire sport', 'gregoiresport', 'joliette', 'lourdes-de-joliette', 'lanaudiere', 'lanaudière', 'yamaha', 'ktm', 'suzuki', 'arctic cat', 'gasgas', 'surron', 'stark future', 'bennington', 'sylvan', 'smokercraft', 'devinci', 'scott', 'armada'],
  'gregoire_sport',
  '{
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.gregoiresport.com/sitemaps/inventory-detail.xml",
      "filter_lang": "/fr/",
      "filter_path": "/inventaire/",
      "neuf_pattern": "/neuf/",
      "occasion_pattern": "/usage/",
      "bilingual": true,
      "en_filter_path": "/inventory/",
      "en_neuf_pattern": "/new/",
      "en_occasion_pattern": "/used/"
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
      "image": "img.pg-vehicle-image, .pg-vehicle-gallery img, img[src*=cdn.powergo.ca]",
      "price": "div.pg-vehicle-price, div.pg-vehicle-mobile-price"
    },
    "json_ld": true,
    "json_ld_type": "Vehicle",
    "domains": ["gregoiresport.com"]
  }'::JSONB,
  '[
    {"url": "https://www.gregoiresport.com/sitemaps/inventory-detail.xml", "type": "sitemap"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "sitemap_url": "https://www.gregoiresport.com/sitemaps/inventory-detail.xml",
    "note": "Pagination client-side JS impossible via HTTP — sitemap fournit la liste complète (497 URLs, ~435 neuf + ~62 occasion)"
  }'::JSONB,
  'Concessionnaire powersports et marine à Lourdes-de-Joliette, QC (Lanaudière), à 45 min de Montréal. Motos, VTT, côte-à-côte, bateaux, pontons, motomarines, motoneiges, vélos électriques, remorques. Marques: Yamaha, KTM, Suzuki, Arctic Cat, GAS GAS, Sur-Ron, Stark Future, Bennington, Sylvan, Smoker-Craft, Devinci, Scott, Armada. Plateforme Next.js/PowerGO. Sitemap XML pour découverte complète (pagination JS-only). Concessionnaire Yamaha 5 étoiles.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'quad', 'vtt', 'cote-a-cote', 'motomarine', 'motoneige', 'bateau', 'ponton', 'moteur-hors-bord', 'remorque', 'velo-electrique', 'equipement-mecanique', 'voiturette-de-golf'],
  ARRAY['name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vin', 'vehicule_type', 'vehicule_categorie', 'description'],
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
