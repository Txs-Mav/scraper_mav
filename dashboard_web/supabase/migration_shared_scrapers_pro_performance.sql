-- Migration: Ajout de Pro Performance dans shared_scrapers
-- Date: 2026-08-19
-- Description: Scraper dédié Pro Performance — Next.js + PowerGO CDN
--              (même moteur que saguenaymarine.com / morinsports.com).
--              Sitemap inventory-detail.xml (715 URLs FR = 687 neuf +
--              28 occasion au 2026-08-19, totaux confirmés par le site).
--              JSON-LD Vehicle dans @graph sur pages détail.
--              Concessionnaire Polaris, Indian Motorcycle, CFMOTO, Suzuki,
--              Kawasaki, Husqvarna, MV Agusta, Vespa/Piaggio, Slingshot +
--              marine (Godfrey, Smoker-Craft, Starcraft) — 2 succursales :
--              Boischatel et Portneuf (Saint-Raymond), QC.

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
  'Pro Performance',
  'pro-performance',
  'https://www.properformance.ca/fr/',
  'properformance.ca',
  ARRAY[
    'pro performance', 'pro-performance', 'properformance',
    'boischatel', 'portneuf', 'saint-raymond', 'st-raymond', 'quebec',
    'polaris', 'indian', 'indian motorcycle', 'cfmoto', 'suzuki',
    'kawasaki', 'husqvarna', 'mv agusta', 'vespa', 'piaggio',
    'slingshot', 'godfrey marine', 'smoker-craft', 'starcraft',
    'ant deck', 'remeq', 'super soco', 'suzumar'
  ],
  'pro_performance',
  '{
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.properformance.ca/sitemaps/inventory-detail.xml",
      "sitemap_index": "https://www.properformance.ca/sitemap-index.xml",
      "filter_lang": "/fr/",
      "filter_path": "/inventaire/",
      "filter_marker": "a-vendre-",
      "neuf_pattern": "/neuf/",
      "occasion_pattern": "/usage/",
      "stock_prefixes": "P- (Portneuf), B- (Boischatel), parfois alphanumérique (pro-lodge-160)"
    },
    "detail": {
      "json_ld": "Vehicle niché dans @graph — name, brand.name, model, vehicleModelDate, color, mileageFromOdometer.value (null sur le neuf), sku, itemCondition, offers.price, image[]",
      "price": "div[class*=pg-vehicle-price]",
      "strike_price": "[class*=line-through] dans le bloc prix → prix_original",
      "no_price_marker": "pg-vehicle-price-no-price (Prix sur demande)",
      "vin": "toujours null sur cette plateforme",
      "description_cleanup": "écho du nom en MAJUSCULES en tête + boilerplate marketing/légal (amateurs de sensations fortes, SUCCURSALES, réservons le droit) retirés"
    },
    "json_ld": {
      "accepted_types": ["Vehicle", "Car", "Product"],
      "nested_in_graph": true
    },
    "domains": ["properformance.ca"]
  }'::JSONB,
  '[
    {"url": "https://www.properformance.ca/sitemaps/inventory-detail.xml", "type": "sitemap"},
    {"url": "https://www.properformance.ca/fr/inventaire-neuf/", "type": "listing"},
    {"url": "https://www.properformance.ca/fr/usage/", "type": "listing"}
  ]'::JSONB,
  '{
    "type": "sitemap",
    "sitemap_url": "https://www.properformance.ca/sitemaps/inventory-detail.xml",
    "note": "Listings client-side (RSC Next.js) — le sitemap PowerGO fournit la liste complète (FR + EN en double, ne garder que /fr/). Totaux vérifiables dans le payload RSC des listings (\"total\":687 neuf, \"total\":28 usage au 2026-08-19)."
  }'::JSONB,
  'Concessionnaire Polaris, Indian Motorcycle, CFMOTO, Suzuki, Kawasaki, Husqvarna, MV Agusta, Vespa, Piaggio et Slingshot + marine (Godfrey, Smoker-Craft, Starcraft, moteurs Suzuki) — 2 succursales : Boischatel et Portneuf (Saint-Raymond), QC. Motos, VTT, côte-à-côte, motoneiges, motomarines, bateaux, pontons, moteurs hors-bord, remorques, vélos électriques. Plateforme Next.js / PowerGO. 35 ans d''expérience.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'motocyclette', 'motos-trois-roues', 'vtt', 'cote-a-cote', 'motoneige', 'motomarine', 'bateau', 'ponton', 'moteur-hors-bord', 'remorque', 'equipement-mecanique', 'velo-electrique'],
  ARRAY['name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vehicule_type', 'description', 'sourceCategorie'],
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
