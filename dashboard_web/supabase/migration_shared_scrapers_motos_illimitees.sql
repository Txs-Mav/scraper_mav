-- Migration: Ajout de Motos Illimitées dans shared_scrapers
-- Date: 2026-03-08
-- Description: Scraper dédié Motos Illimitées — Next.js + PowerGO CDN
--              Sitemap XML pour découverte complète + JSON-LD sur pages détail.
--              Plus grand concessionnaire multi-marques du Québec (102 000 pi²).
--              ~1900+ véhicules en inventaire (neufs + usagés).

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
  'Motos Illimitées',
  'motos-illimitees',
  'https://www.motosillimitees.com/fr/',
  'motosillimitees.com',
  ARRAY['motos illimitées', 'motos illimitees', 'motosillimitees', 'illimitées', 'terrebonne', 'lanaudière', 'lanaudiere', 'montreal', 'laval', 'triumph', 'suzuki', 'honda', 'kawasaki', 'ktm', 'yamaha', 'polaris', 'aprilia', 'vespa', 'piaggio', 'indian', 'cfmoto', 'gasgas', 'husqvarna', 'royal enfield', 'mv agusta', 'arctic cat', 'slingshot', 'timbersled', 'moto guzzi'],
  'motos-illimitees',
  '{
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.motosillimitees.com/sitemaps/inventory-detail.xml",
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
    "domains": ["motosillimitees.com"]
  }'::JSONB,
  '[
    {"url": "https://www.motosillimitees.com/sitemaps/inventory-detail.xml", "type": "sitemap"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "sitemap_url": "https://www.motosillimitees.com/sitemaps/inventory-detail.xml",
    "note": "Pagination client-side JS — sitemap fournit la liste complète (~1900+ URLs)"
  }'::JSONB,
  'Plus grand concessionnaire multi-marques de sports motorisés au Québec, situé à Terrebonne (Lanaudière). 102 000 pi², salle d''exposition de 35 000 pi². Triumph, Suzuki, Honda, Kawasaki, KTM, Yamaha, Polaris, Aprilia, Vespa, Piaggio, Indian, CFMoto, GasGas, Husqvarna, Royal Enfield, MV Agusta, Arctic Cat, Slingshot, Timbersled, Moto Guzzi. Plateforme Next.js/PowerGO.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'motocyclette', 'vtt', 'cote-a-cote', 'motoneige', 'motomarine', 'velo-electrique', 'remorque', 'scooter', 'equipement-mecanique', 'timbersled', 'moteur-hors-bord'],
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
