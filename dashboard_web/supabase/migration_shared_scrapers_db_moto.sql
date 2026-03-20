-- Migration: Ajout de DB Moto dans shared_scrapers
-- Date: 2026-03-19
-- Description: Scraper dedie DB Moto - WordPress + Yoast SEO + PowerGO CDN
--              Concessionnaire Kawasaki, CFMOTO, Arctic Cat, Textron
--              a Ste-Julienne et Chateauguay.
--              Extraction via multi-sitemap (7 catalogues + 1 inventaire)
--              + JSON-LD Vehicle + specs HTML.

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
  'DB Moto',
  'db-moto',
  'https://www.dbmoto.ca/fr/',
  'dbmoto.ca',
  ARRAY[
    'db moto',
    'dbmoto',
    'db-moto',
    'ste-julienne',
    'sainte-julienne',
    'chateauguay',
    'châteauguay',
    'kawasaki',
    'cfmoto',
    'arctic cat',
    'textron',
    'surron',
    'niu',
    'rfn',
    'pitsterpro'
  ],
  'db-moto',
  '{
    "discovery": {
      "method": "multi_sitemap",
      "sitemap_index": "https://www.dbmoto.ca/sitemap.xml",
      "catalogue_sitemaps": {
        "motorcycle": "https://www.dbmoto.ca/fr/motorcycle-sitemap.xml",
        "atv": "https://www.dbmoto.ca/fr/atv-sitemap.xml",
        "side-by-side": "https://www.dbmoto.ca/fr/side-by-side-sitemap.xml",
        "snowmobile": "https://www.dbmoto.ca/fr/snowmobile-sitemap.xml",
        "watercraft": "https://www.dbmoto.ca/fr/watercraft-sitemap.xml",
        "electric-bike": "https://www.dbmoto.ca/fr/electric-bike-sitemap.xml",
        "boat": "https://www.dbmoto.ca/fr/boat-sitemap.xml"
      },
      "inventory_sitemap": "https://www.dbmoto.ca/fr/inventory-sitemap.xml"
    },
    "catalogue_detail": {
      "json_ld": "Vehicle",
      "title": "h1",
      "price": "section#product-price div.price",
      "image": "section.photos img[src*=powergo], meta[property=og:image]",
      "gallery": ".gallery img, .slider img",
      "description": "meta[property=og:description]"
    },
    "inventory_detail": {
      "json_ld": "Vehicle (broken, needs control char cleanup)",
      "title": "h1",
      "brand": "li.make",
      "model": "li.model",
      "year": "li.year",
      "color": "li.color",
      "stock": "li.stock",
      "type": "li.type",
      "category": "li.category",
      "km": "li.km",
      "condition": "li.condition",
      "vin": "li.vin",
      "price": "section#product-price div.price",
      "image": "section.photos img[src*=powergo], meta[property=og:image]",
      "description": "section#product-description .text",
      "spec_label": "span.label",
      "etat_body_class": "is-new / is-used"
    },
    "domains": ["dbmoto.ca"]
  }'::JSONB,
  '[
    {"url": "https://www.dbmoto.ca/fr/motorcycle-sitemap.xml", "type": "sitemap", "category": "catalogue", "vehicle_type": "motocyclette"},
    {"url": "https://www.dbmoto.ca/fr/atv-sitemap.xml", "type": "sitemap", "category": "catalogue", "vehicle_type": "vtt"},
    {"url": "https://www.dbmoto.ca/fr/side-by-side-sitemap.xml", "type": "sitemap", "category": "catalogue", "vehicle_type": "cote-a-cote"},
    {"url": "https://www.dbmoto.ca/fr/snowmobile-sitemap.xml", "type": "sitemap", "category": "catalogue", "vehicle_type": "motoneige"},
    {"url": "https://www.dbmoto.ca/fr/watercraft-sitemap.xml", "type": "sitemap", "category": "catalogue", "vehicle_type": "motomarine"},
    {"url": "https://www.dbmoto.ca/fr/electric-bike-sitemap.xml", "type": "sitemap", "category": "catalogue", "vehicle_type": "velo-electrique"},
    {"url": "https://www.dbmoto.ca/fr/boat-sitemap.xml", "type": "sitemap", "category": "catalogue", "vehicle_type": "bateau"},
    {"url": "https://www.dbmoto.ca/fr/inventory-sitemap.xml", "type": "sitemap", "category": "inventaire"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "note": "Pas de pagination - decouverte via sitemaps XML Yoast SEO. 7 sitemaps catalogue (neuf) + 1 sitemap inventaire (stock neuf/occasion/demo). ~450 URLs au total."
  }'::JSONB,
  'Concessionnaire Kawasaki, CFMOTO, Arctic Cat, Textron a Ste-Julienne (Lanaudiere) et Chateauguay (Monteregie). Site WordPress avec Yoast SEO et images PowerGO CDN. Catalogue neuf complet via sitemaps par categorie + inventaire en stock (neuf, occasion, demo). JSON-LD Vehicle sur pages catalogue, specs HTML (li.make, li.model, etc.) sur pages inventaire.',
  ARRAY['catalogue', 'inventaire'],
  ARRAY['motocyclette', 'vtt', 'cote-a-cote', 'motoneige', 'motomarine', 'velo-electrique', 'bateau'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'etat', 'couleur', 'image', 'inventaire', 'vehicule_type', 'kilometrage', 'description'],
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
