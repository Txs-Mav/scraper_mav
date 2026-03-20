-- Migration: Ajout de Moto Vanier dans shared_scrapers
-- Date: 2026-03-08
-- Description: Scraper dédié Moto Vanier — PrestaShop avec prix/km dans HTML stylé.
--              Pages listing paginées (/15-neufs, /14-occasions) + pages détail.
--              Concessionnaire BMW, Ducati, Kawasaki, Triumph à Québec.

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
  'Moto Vanier',
  'motovanier',
  'https://motovanier.ca/',
  'motovanier.ca',
  ARRAY['moto vanier', 'motovanier', 'vanier', 'bibeau', 'quebec', 'québec', 'hamel', 'boulevard hamel', 'bmw', 'ducati', 'kawasaki', 'triumph'],
  'motovanier',
  '{
    "discovery": {
      "method": "listing_pagination",
      "neufs_url": "https://motovanier.ca/15-neufs",
      "occasions_url": "https://motovanier.ca/14-occasions",
      "products_per_page": 12,
      "pagination_param": "page"
    },
    "listing": {
      "product_card": "article.product-miniature",
      "title": "h3.product-title a",
      "image": "article.product-miniature img",
      "price": ".product-desc h1",
      "km": ".product-desc h2",
      "product_id": "data-id-product"
    },
    "detail": {
      "brand": ".product-manufacturer span a",
      "reference": ".product-reference span",
      "condition": ".product-condition span",
      "stock": ".product-quantities span",
      "specs": "section.product-features dl.data-sheet",
      "specs_name": "dt.name",
      "specs_value": "dd.value",
      "price_detail": ".product-information h1",
      "km_detail": ".product-information h2",
      "title": "h1.h1"
    },
    "json_ld": true,
    "domains": ["motovanier.ca"]
  }'::JSONB,
  '[
    {"url": "https://motovanier.ca/15-neufs", "type": "listing", "category": "inventaire"},
    {"url": "https://motovanier.ca/14-occasions", "type": "listing", "category": "occasion"}
  ]'::JSONB,
  '{
    "type": "prestashop_pagination",
    "param": "page",
    "per_page": 12,
    "total_selector": ".total-products",
    "note": "Pagination PrestaShop standard avec ?page=N, 12 produits par page"
  }'::JSONB,
  'Concessionnaire motos à Québec (boulevard Wilfrid-Hamel). BMW, Ducati, Kawasaki, Triumph. Famille Bibeau depuis 1973. Motos neuves, occasions, VTT. Plateforme PrestaShop.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'motocyclette', 'vtt', 'scooter'],
  ARRAY['name', 'prix', 'marque', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'cylindree', 'type_moteur', 'transmission', 'puissance', 'poids', 'freinage', 'garantie'],
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
