-- Migration: Ajout de Nadon Sport dans shared_scrapers
-- Date: 2026-03-21
-- Description: Scraper dédié Nadon Sport — Magento 2
--              Concessionnaire moto, VTT, côtes-à-côtes et motoneiges
--              à Saint-Eustache, QC (Rive-Nord de Montréal).
--              ~1570 produits : inventaire physique + catalogue commandable.
--              14 sous-catégories par marque/type paginées + pages détail JSON-LD.

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
  'Nadon Sport',
  'nadon-sport',
  'https://www.nadonsport.com/fr/',
  'nadonsport.com',
  ARRAY['nadon', 'nadon sport', 'nadonsport', 'saint-eustache', 'st-eustache', 'rive-nord', 'bmw', 'ducati', 'yamaha', 'kawasaki', 'gasgas', 'husqvarna', 'polaris'],
  'nadon_sport',
  '{
    "discovery": {
      "method": "subcategory_pagination",
      "per_page": 36,
      "page_param": "p",
      "limit_param": "product_list_limit",
      "url_patterns": ["-cs-\\d+", "-cs-na-web-\\d+"]
    },
    "listing": {
      "product_link": "a.product-item-photo, a.product-item-link",
      "product_price": "[data-price-amount]",
      "product_image": "img.product-image-photo",
      "url_pattern_stock": "-cs-\\d+",
      "url_pattern_catalog": "-cs-na-web-\\d+"
    },
    "detail": {
      "json_ld_type": "Product",
      "specs_table": "table#product-attribute-specs-table, table.additional-attributes",
      "title": "h1.page-title span",
      "image": ".product.media img, img.product-image-photo",
      "price": "[data-price-amount]"
    },
    "json_ld": true,
    "domains": ["nadonsport.com"]
  }'::JSONB,
  '[
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/ducati/motocyclettes", "category": "inventaire", "etat": "neuf", "brand": "Ducati", "type": "moto"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/bmw/motocyclettes", "category": "inventaire", "etat": "neuf", "brand": "BMW", "type": "moto"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/yamaha/motocyclettes", "category": "inventaire", "etat": "neuf", "brand": "Yamaha", "type": "moto"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/yamaha/vtt", "category": "inventaire", "etat": "neuf", "brand": "Yamaha", "type": "vtt"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/yamaha/cotes-a-cotes", "category": "inventaire", "etat": "neuf", "brand": "Yamaha", "type": "cac"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/yamaha/produits-mecaniques", "category": "inventaire", "etat": "neuf", "brand": "Yamaha", "type": "mecanique"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/kawasaki/motocyclettes", "category": "inventaire", "etat": "neuf", "brand": "Kawasaki", "type": "moto"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/kawasaki/vtt", "category": "inventaire", "etat": "neuf", "brand": "Kawasaki", "type": "vtt"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/kawasaki/cotes-a-cotes", "category": "inventaire", "etat": "neuf", "brand": "Kawasaki", "type": "cac"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/gasgas/motocyclettes", "category": "inventaire", "etat": "neuf", "brand": "GasGas", "type": "moto"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/husqvarna/motocyclettes", "category": "inventaire", "etat": "neuf", "brand": "Husqvarna", "type": "moto"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/polaris/vtt", "category": "inventaire", "etat": "neuf", "brand": "Polaris", "type": "vtt"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/polaris/cotes-a-cotes", "category": "inventaire", "etat": "neuf", "brand": "Polaris", "type": "cac"},
    {"url": "https://www.nadonsport.com/fr/vehicules-neufs/polaris/motoneiges", "category": "inventaire", "etat": "neuf", "brand": "Polaris", "type": "motoneige"},
    {"url": "https://www.nadonsport.com/fr/vehicules-d-occasion", "category": "occasion", "etat": "occasion"}
  ]'::JSONB,
  '{
    "type": "magento_subcategory",
    "page_param": "p",
    "limit_param": "product_list_limit",
    "max_per_page": 36,
    "subcategories": 14,
    "note": "14 sous-catégories par marque/type + 1 page occasion. Pagination Magento standard ?p=N&product_list_limit=36. ~1570 produits (inventaire cs-XXXXX + catalogue cs-na-web-XXXX)"
  }'::JSONB,
  'Concessionnaire moto, VTT, côtes-à-côtes et motoneiges à Saint-Eustache, QC (Rive-Nord de Montréal). Spécialiste depuis 1961, 4 générations. Marques: BMW, Ducati, Yamaha, Kawasaki, GAS GAS, Husqvarna, Polaris. ~1570 produits (inventaire + catalogue). Plateforme Magento 2 avec 14 sous-catégories par marque/type. JSON-LD Product sur pages détail + specs table (kilométrage, couleur, moteur, poids, cylindrée, transmission).',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'scooter', 'vtt', 'cote-a-cote', 'motoneige', 'produit-mecanique'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vehicule_type', 'vehicule_categorie', 'description', 'moteur', 'cylindree', 'transmission', 'poids', 'reservoir'],
  TRUE,
  NOW(),
  '2.0'
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
