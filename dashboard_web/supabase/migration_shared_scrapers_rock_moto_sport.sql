-- Migration: Ajout de Rock Moto Sport dans shared_scrapers
-- Date: 2026-03-21
-- Description: Scraper dédié Rock Moto Sport — WordPress + Convertus/AutoTrader
--              Concessionnaire moto, motoneige, VTT et motomarines
--              à Sherbrooke, QC (Estrie).
--              ~535 véhicules : inventaire neuf + occasion.
--              Sitemap XML (occasion) + listing HTML (neuf) + pages détail meta OG.

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
  'Rock Moto Sport',
  'rock-moto-sport',
  'https://www.rockmotosport.com/',
  'rockmotosport.com',
  ARRAY['rock', 'rock moto sport', 'rockmotosport', 'sherbrooke', 'estrie', 'kawasaki', 'arctic cat', 'aprilia', 'moto guzzi', 'piaggio', 'ktm', 'ducati', 'bmw', 'suzuki', 'harley-davidson', 'yamaha', 'ski-doo'],
  'rock_moto_sport',
  '{
    "discovery": {
      "method": "sitemap_plus_listing",
      "sitemap_used": "https://www.rockmotosport.com/used-vehicle-1-sitemap.xml",
      "sitemap_index": "https://www.rockmotosport.com/sitemap_index.xml",
      "listing_new": "https://www.rockmotosport.com/vehicles/new/",
      "listing_used": "https://www.rockmotosport.com/vehicles/used/",
      "url_pattern": "/vehicles/{year}/{make}/{model}/sherbrooke/qc/{id}/"
    },
    "detail": {
      "title": "meta[property=og:title]",
      "image": "meta[property=og:image]",
      "description": "meta[property=og:description]",
      "price_source": "og:description (regex \\$[\\d,]+)",
      "stock": "li (contains # de stock)",
      "odometer": "li (contains Odomètre)",
      "body_style": "li (contains Style de carrosserie)",
      "transmission": "li (contains Transmission)",
      "color": "li (contains Couleur)",
      "engine": "li (contains Moteur)"
    },
    "json_ld": true,
    "json_ld_type": "WebPage",
    "cloudflare": true,
    "http_client": "cloudscraper",
    "domains": ["rockmotosport.com"]
  }'::JSONB,
  '[
    {"url": "https://www.rockmotosport.com/vehicles/new/", "category": "inventaire", "etat": "neuf"},
    {"url": "https://www.rockmotosport.com/vehicles/used/", "category": "occasion", "etat": "occasion"}
  ]'::JSONB,
  '{
    "type": "sitemap_plus_listing",
    "sitemap_urls": ["https://www.rockmotosport.com/used-vehicle-1-sitemap.xml"],
    "listing_urls": ["https://www.rockmotosport.com/vehicles/new/", "https://www.rockmotosport.com/vehicles/used/"],
    "note": "Convertus/AutoTrader platform. Sitemap fiable pour occasion (~18 véhicules). Listing HTML pour neufs (~500+ véhicules). Pages détail: meta OG + HTML specs. Cloudflare protection — nécessite cloudscraper avec retry."
  }'::JSONB,
  'Concessionnaire moto, motoneige, VTT et motomarines à Sherbrooke, QC (Estrie). Marques: Kawasaki, Arctic Cat, Aprilia, Moto Guzzi, Piaggio, KTM, Ducati, BMW, Suzuki, Harley-Davidson, Yamaha, Ski-Doo. ~535 véhicules (neufs + occasion). Plateforme WordPress + Convertus/AutoTrader avec protection Cloudflare. Sitemap XML pour les véhicules d''occasion, listing HTML pour les véhicules neufs. Pages détail riches en méta OG (titre, prix dans description, image CDN autotradercdn.ca) + specs HTML (stock, odomètre, carrosserie, transmission, couleur, moteur).',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'vtt', 'motomarine', 'motoneige', 'remorque', 'velo-electrique'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vehicule_type', 'description', 'transmission', 'moteur'],
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
