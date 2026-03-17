-- Migration: Ajout de Joliette Recreatif dans shared_scrapers
-- Date: 2026-03-17
-- Description: Scraper dedie Joliette Recreatif - WordPress + PowerGO + FacetWP
--              Extraction exhaustive via inventaire-neuf + produits-occasion,
--              avec enrichissement detail produit.

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
  'Joliette Récréatif',
  'joliette-recreatif',
  'https://www.jolietterecreatif.ca/fr/',
  'jolietterecreatif.ca',
  ARRAY[
    'joliette',
    'joliette recreatif',
    'joliette récréatif',
    'jolietterecreatif',
    'zone recreatif',
    'zone récréatif',
    'lourdes-de-joliette',
    'cfmoto',
    'argo',
    'gio',
    'tohatsu',
    'camso'
  ],
  'joliette-recreatif',
  '{
    "discovery": {
      "method": "facetwp_listing",
      "inventory_url": "https://www.jolietterecreatif.ca/fr/inventaire-neuf/",
      "used_url": "https://www.jolietterecreatif.ca/fr/produits-occasion/",
      "per_page": 500,
      "page_param": "fwp_paged",
      "per_page_param": "fwp_per_page"
    },
    "listing": {
      "product_card": ".product-list .item",
      "title": ".listWImgsContent h3 a",
      "image": ".img img",
      "price": ".specs li.price",
      "current_price": ".current-price .number",
      "old_price": ".old-price .number",
      "stock": ".specs li.stock .value",
      "km": ".specs li.km .value"
    },
    "detail": {
      "overview": "#product-specs-overview",
      "brand": "li.make .value",
      "model": "li.model .value",
      "year": "li.year .value",
      "stock": "li.stock .value",
      "type": "li.type .value",
      "category": "li.category .value",
      "condition": "li.condition .value",
      "km": "li.km .value",
      "color": "li.ext-color .value",
      "price": ".price",
      "notes": "#product-notes",
      "title": "h1"
    },
    "domains": ["jolietterecreatif.ca"]
  }'::JSONB,
  '[
    {"url": "https://www.jolietterecreatif.ca/fr/inventaire-neuf/", "type": "listing", "category": "inventaire"},
    {"url": "https://www.jolietterecreatif.ca/fr/produits-occasion/", "type": "listing", "category": "occasion"}
  ]'::JSONB,
  '{
    "type": "facetwp",
    "per_page": 500,
    "page_param": "fwp_paged",
    "per_page_param": "fwp_per_page",
    "note": "FacetWP permet un listing complet en un seul chargement avec fwp_per_page=500"
  }'::JSONB,
  'Concessionnaire powersports a Lourdes-de-Joliette, QC. Inventaire neuf et vehicules d''occasion: motos, VTT, cotes-a-cotes, motoneiges, remorques, bateaux et produits mecaniques. Plateforme WordPress/PowerGO avec FacetWP.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'motocyclette', 'vtt', 'cote-a-cote', 'motoneige', 'remorque', 'bateau', 'produit-mecanique'],
  ARRAY['name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vehicule_type', 'vehicule_categorie', 'description'],
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
