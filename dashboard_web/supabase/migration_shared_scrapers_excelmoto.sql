-- Migration: Ajout d'Excel Moto dans shared_scrapers
-- Date: 2026-05-18
-- Description: Rattrapage manuel — la Phase 5 de scraper_usine (publisher.py)
--              n'a pas inséré la ligne lors de la génération initiale du scraper
--              (score < 95 au 1er run, --no-publish actif, ou vars d'env
--              Supabase manquantes au moment de l'exécution).
--
--              Le scraper Python `excelmoto.py` existe déjà sur disque et est
--              référencé dans `_generated_registry.py`. Cette migration crée
--              uniquement la ligne dans `shared_scrapers` pour que
--              `scripts/scrape_single_site.py --slug excelmoto` fonctionne.
--
-- Site: Excel Moto | Your Dealership in Montréal
-- Plateforme: PowerGO / Next.js (similaire à Morin Sports)
-- Inventaire: ~735 produits (motos, VTT, motoneiges, souffleuses, génératrices Honda)

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
  'Excel Moto',
  'excelmoto',
  'https://www.excelmoto.com/en/',
  'excelmoto.com',
  ARRAY[
    'excel', 'excel moto', 'excelmoto', 'montreal', 'montréal',
    'honda', 'powersports', 'souffleuse', 'generatrice', 'génératrice',
    'moto', 'vtt', 'motoneige', 'equipement-mecanique'
  ],
  'excelmoto',
  '{
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.excelmoto.com/sitemaps/inventory-detail.xml",
      "filter_lang": "/fr/",
      "filter_path": "/inventaire/",
      "filter_marker": "a-vendre-",
      "neuf_pattern": "/neuf/",
      "occasion_pattern": "/usage/"
    },
    "detail": {
      "title": "h1.flex.flex-col.text-4xl.font-extrabold.uppercase.leading-none.text-main-color",
      "price": "div.pg-vehicle-price.flex.items-center.font-bold.text-main-color",
      "description": "div.pg-vehicle-description div.prose, div.pg-vehicle-description .prose, div.pg-vehicle-description",
      "image": "img.product-image, .main-image img, img[src*=\"powergo\"]"
    },
    "json_ld": {
      "available": true,
      "accepted_types": ["Vehicle", "Car", "AutomotiveVehicle", "MotorVehicle", "Motorcycle", "MotorizedBicycle", "Product", "IndividualProduct"],
      "year_keys": ["vehicleModelDate", "modelDate", "productionDate"],
      "offers_can_be_list": true
    },
    "domains": ["excelmoto.com"]
  }'::JSONB,
  '[
    {"url": "https://www.excelmoto.com/sitemaps/inventory-detail.xml", "type": "sitemap"},
    {"url": "https://www.excelmoto.com/fr/neuf/produits-mecaniques/inventaire/", "type": "listing", "category": "inventaire", "etat": "neuf"},
    {"url": "https://www.excelmoto.com/fr/usage/", "type": "listing", "category": "occasion", "etat": "occasion"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "method": "sitemap",
    "rendering": "requests",
    "discovery": "sitemap",
    "extraction": "hybrid",
    "sitemap_url": "https://www.excelmoto.com/sitemaps/inventory-detail.xml",
    "note": "Découverte via sitemap XML PowerGO (inventory-detail.xml). Extraction hybride JSON-LD (Vehicle/Product) + sélecteurs CSS PowerGO. productionDate accepté pour les équipements mécaniques (souffleuses, génératrices)."
  }'::JSONB,
  'Concessionnaire Honda powersports à Montréal, QC. Motos, VTT, motoneiges, plus équipement mécanique Honda (souffleuses, génératrices). Plateforme Next.js / PowerGO. Scraper généré par scraper_usine (sitemap + hybrid).',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'vtt', 'motoneige', 'equipement-mecanique'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'image', 'description', 'vin'],
  TRUE,
  NOW(),
  '1.0'
)
ON CONFLICT (site_slug) DO UPDATE SET
  site_name = EXCLUDED.site_name,
  site_url = EXCLUDED.site_url,
  site_domain = EXCLUDED.site_domain,
  scraper_module = EXCLUDED.scraper_module,
  selectors = EXCLUDED.selectors,
  listing_urls = EXCLUDED.listing_urls,
  pagination_config = EXCLUDED.pagination_config,
  search_keywords = EXCLUDED.search_keywords,
  extracted_fields = EXCLUDED.extracted_fields,
  description = EXCLUDED.description,
  vehicle_types = EXCLUDED.vehicle_types,
  is_active = TRUE,
  version = EXCLUDED.version,
  last_verified_at = NOW(),
  updated_at = NOW();
