-- Migration: Ajout de Maximum Aventure dans shared_scrapers
-- Date: 2026-03-22
-- Description: Scraper dédié Maximum Aventure — WordPress + PowerGO CDN
--              Concessionnaire bateaux, pontons et moteurs hors-bord
--              à Shawinigan, QC (Mauricie).
--              ~450+ produits : catalogue neuf (boats, pontoons, outboard motors) + inventaire physique.
--              4 sitemaps Yoast (boat, pontoon, outboard-motor, inventory) + pages détail HTML specs.

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
  'Maximum Aventure',
  'maximum-aventure',
  'https://www.maximumaventure.com/en/',
  'maximumaventure.com',
  ARRAY[
    'maximum', 'maximum aventure', 'maximumaventure',
    'shawinigan', 'mauricie',
    'starcraft', 'montego bay', 'mirrocraft', 'smoker craft', 'armada',
    'suzuki', 'mercury', 'land n sea',
    'bateau', 'ponton', 'moteur hors-bord',
    'boat', 'pontoon', 'outboard motor',
    'quai', 'dock', 'location', 'rental'
  ],
  'maximum_aventure',
  '{
    "discovery": {
      "method": "multi_sitemap",
      "sitemaps": {
        "boat": "https://www.maximumaventure.com/boat-sitemap.xml",
        "pontoon": "https://www.maximumaventure.com/pontoon-sitemap.xml",
        "outboard-motor": "https://www.maximumaventure.com/outboard-motor-sitemap.xml",
        "inventory": "https://www.maximumaventure.com/inventory-sitemap.xml"
      },
      "sitemap_format": "yoast_xml",
      "bilingual": true,
      "preferred_language": "fr",
      "url_patterns": {
        "boat_fr": "/fr/bateau/{slug}/",
        "boat_en": "/en/boat/{slug}/",
        "pontoon_fr": "/fr/ponton/{slug}/",
        "pontoon_en": "/en/pontoon/{slug}/",
        "outboard_fr": "/fr/moteur-hors-bord/{slug}/",
        "outboard_en": "/en/outboard-motor/{slug}/",
        "inventory_fr": "/fr/inventaire/{type}-{brand}-{model}-{year}-a-vendre-{stock}/",
        "inventory_en": "/en/inventory/{type}-{brand}-{model}-{year}-to-sell-{stock}/"
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
        "hp": "li.hp .value",
        "fuel": "li.fuel .value",
        "weight": "li.weight .value",
        "mileage": "li.mileage .value",
        "hours": "li.hours .value",
        "vin": "li.vin .value",
        "transmission": "li.transmission .value",
        "custom_fields": "li.custom_fields (label + value)"
      },
      "price": {
        "container": "#product-price",
        "old_price": ".old-price .number",
        "current_price": ".current-price .number"
      },
      "images": "#product-photos .gallery .slider img[src], img[data-lazy]",
      "description": "#product-notes .text, #product-description .text",
      "og_image": "meta[property=og:image]"
    },
    "json_ld": false,
    "json_ld_note": "Only LocalBusiness JSON-LD, no Product/Vehicle schema",
    "domains": ["maximumaventure.com", "cdn.powergo.ca"],
    "platform": "wordpress_powergo",
    "wordpress_version": "5.9.4",
    "theme": "PowerGO custom (site)"
  }'::JSONB,
  '[
    {"url": "https://www.maximumaventure.com/boat-sitemap.xml", "type": "sitemap", "category": "catalogue", "product_type": "boat"},
    {"url": "https://www.maximumaventure.com/pontoon-sitemap.xml", "type": "sitemap", "category": "catalogue", "product_type": "pontoon"},
    {"url": "https://www.maximumaventure.com/outboard-motor-sitemap.xml", "type": "sitemap", "category": "catalogue", "product_type": "outboard-motor"},
    {"url": "https://www.maximumaventure.com/inventory-sitemap.xml", "type": "sitemap", "category": "inventaire", "product_type": "mixed"},
    {"url": "https://www.maximumaventure.com/en/new-inventory/", "category": "inventaire", "etat": "neuf"},
    {"url": "https://www.maximumaventure.com/en/used-products/", "category": "inventaire", "etat": "occasion"},
    {"url": "https://www.maximumaventure.com/en/boats/", "category": "catalogue", "product_type": "boat"},
    {"url": "https://www.maximumaventure.com/en/pontoons/", "category": "catalogue", "product_type": "pontoon"},
    {"url": "https://www.maximumaventure.com/en/outboard-motors/", "category": "catalogue", "product_type": "outboard-motor"}
  ]'::JSONB,
  '{
    "type": "multi_sitemap",
    "sitemap_count": 4,
    "bilingual": true,
    "dedup_strategy": "slug_based_fr_priority",
    "note": "4 sitemaps Yoast XML (boat, pontoon, outboard-motor, inventory). FR/EN URLs dédupliquées par slug, priorité FR."
  }'::JSONB,
  'Concessionnaire bateaux, pontons et moteurs hors-bord à Shawinigan (Mauricie, QC). Marques: Starcraft, Montego Bay, Armada, Smoker Craft, MirroCraft, Suzuki, Mercury, Land N Sea. Catalogue complet de bateaux/pontons neufs + inventaire physique (neufs et occasion). Location de motoneiges, VTT, côtes-à-côtes et embarcations. Plateforme WordPress + PowerGO CDN.',
  ARRAY['inventaire', 'catalogue'],
  ARRAY['bateau', 'ponton', 'moteur-hors-bord', 'quai', 'accessoire'],
  ARRAY['name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat', 'inventaire', 'vehicule_type', 'couleur', 'moteur', 'puissance', 'carburant', 'poids', 'kilometrage', 'heures', 'vin', 'transmission', 'image', 'description', 'longueur', 'largeur', 'capacite_personnes', 'capacite_max', 'capacite_carburant', 'puissance_max'],
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
