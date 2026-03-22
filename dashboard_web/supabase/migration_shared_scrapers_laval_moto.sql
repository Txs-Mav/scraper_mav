-- Migration: Ajout de Laval Moto dans shared_scrapers
-- Date: 2026-03-22
-- Description: Scraper dédié Laval Moto — WordPress + PowerGO CDN
--              Concessionnaire motos, scooters, VTT et produits mécaniques
--              à Laval, QC (Rive-Nord de Montréal).
--              ~2470+ produits : catalogue neuf (motos, VTT, power equipment) + inventaire physique.
--              6 sitemaps Yoast paginés (motorcycle×2, atv, power-equipment, inventory×2).

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
  'Laval Moto',
  'laval-moto',
  'https://www.lavalmoto.com/fr/',
  'lavalmoto.com',
  ARRAY[
    'laval', 'laval moto', 'lavalmoto',
    'rive-nord', 'montréal', 'montreal',
    'suzuki', 'kawasaki', 'yamaha', 'vespa', 'honda', 'piaggio',
    'moto', 'motocyclette', 'motorcycle', 'scooter',
    'vtt', 'atv', 'produit mécanique', 'power equipment',
    'sport', 'custom', 'cruiser', 'touring', 'adventure'
  ],
  'laval_moto',
  '{
    "discovery": {
      "method": "multi_sitemap_paginated",
      "sitemaps": {
        "motorcycle-1": "https://www.lavalmoto.com/fr/motorcycle-sitemap1.xml",
        "motorcycle-2": "https://www.lavalmoto.com/fr/motorcycle-sitemap2.xml",
        "atv": "https://www.lavalmoto.com/fr/atv-sitemap.xml",
        "power-equipment": "https://www.lavalmoto.com/fr/power-equipment-sitemap.xml",
        "inventory-1": "https://www.lavalmoto.com/fr/inventory-sitemap1.xml",
        "inventory-2": "https://www.lavalmoto.com/fr/inventory-sitemap2.xml"
      },
      "sitemap_format": "yoast_xml",
      "bilingual": false,
      "language": "fr",
      "url_patterns": {
        "motorcycle": "/fr/motocyclette/{slug}/",
        "atv": "/fr/vtt/{slug}/",
        "power_equipment": "/fr/power-equipment/{slug}/",
        "inventory": "/fr/inventaire/{type}-{brand}-{model}-{year}-a-vendre-{stock}/"
      }
    },
    "detail": {
      "title": "h1",
      "breadcrumbs": ".page-header .sub ul li",
      "specs_container": "#product-specs-overview .content ul, #product-specs .content ul",
      "spec_items": {
        "make": "li.make .value",
        "model": "li.model .value",
        "year": "li.year .value",
        "condition": "li.condition .value",
        "stock": "li.stock .value",
        "type": "li.type .value",
        "ext_color": "li.ext-color .value",
        "engine": "li.engine .value",
        "engine_capacity": "li.engine-capacity .value",
        "hp": "li.hp .value",
        "fuel": "li.fuel .value",
        "weight": "li.weight .value",
        "mileage": "li.mileage .value",
        "hours": "li.hours .value",
        "vin": "li.vin .value",
        "transmission": "li.transmission .value",
        "transmission_speed": "li.transmission_speed .value",
        "cylinders": "li.cylinders .value",
        "cooling": "li.cooling .value"
      },
      "price": {
        "container": "#product-price",
        "old_price": ".old-price .number",
        "current_price": ".current-price .number"
      },
      "images": "#product-photos .gallery .slider img, #product-photos .img img",
      "description": "#product-notes .text, #product-description .text",
      "og_image": "meta[property=og:image]"
    },
    "json_ld": false,
    "domains": ["lavalmoto.com", "cdn.powergo.ca"],
    "platform": "wordpress_powergo"
  }'::JSONB,
  '[
    {"url": "https://www.lavalmoto.com/fr/motorcycle-sitemap1.xml", "type": "sitemap", "category": "catalogue", "product_type": "motorcycle", "count": 1000},
    {"url": "https://www.lavalmoto.com/fr/motorcycle-sitemap2.xml", "type": "sitemap", "category": "catalogue", "product_type": "motorcycle", "count": 140},
    {"url": "https://www.lavalmoto.com/fr/atv-sitemap.xml", "type": "sitemap", "category": "catalogue", "product_type": "atv", "count": 96},
    {"url": "https://www.lavalmoto.com/fr/power-equipment-sitemap.xml", "type": "sitemap", "category": "catalogue", "product_type": "power-equipment", "count": 114},
    {"url": "https://www.lavalmoto.com/fr/inventory-sitemap1.xml", "type": "sitemap", "category": "inventaire", "product_type": "mixed", "count": 1000},
    {"url": "https://www.lavalmoto.com/fr/inventory-sitemap2.xml", "type": "sitemap", "category": "inventaire", "product_type": "mixed", "count": 124}
  ]'::JSONB,
  '{
    "type": "multi_sitemap_paginated",
    "sitemap_count": 6,
    "bilingual": false,
    "language": "fr",
    "dedup_strategy": "slug_based",
    "note": "6 sitemaps Yoast XML paginés (motorcycle×2, atv, power-equipment, inventory×2). Toutes les URLs en FR uniquement."
  }'::JSONB,
  'Concessionnaire motos, scooters, VTT et produits mécaniques à Laval (Rive-Nord de Montréal, QC). Spécialiste depuis 30 ans. Marques: Suzuki, Kawasaki, Yamaha, Vespa, Honda, Piaggio. Catalogue complet de motos/scooters/VTT neufs + inventaire physique (neufs et occasion) + produits mécaniques Honda. Plateforme WordPress + PowerGO CDN.',
  ARRAY['inventaire', 'catalogue'],
  ARRAY['moto', 'scooter', 'vtt', 'produit-mecanique'],
  ARRAY['name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat', 'inventaire', 'vehicule_type', 'couleur', 'moteur', 'cylindree', 'puissance', 'carburant', 'poids', 'kilometrage', 'heures', 'vin', 'transmission', 'vitesses', 'cylindres', 'refroidissement', 'image', 'description'],
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
