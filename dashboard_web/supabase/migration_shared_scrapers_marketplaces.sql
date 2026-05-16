-- Migration: Ajout des sources de marché (marketplaces multi-vendeurs) dans shared_scrapers
-- Date: 2026-05-15
-- Description: Enregistre AutoTrader.ca, Kijiji, LesPAC, CycleTrader.com et
--              MotorcycleDealers.ca comme sources scrapables par le cron horaire.
--              Ces entrées permettent à scraper_cron.py de remplir
--              `scraped_site_data` pour ces domaines, et à `analyzeFromCache`
--              de proposer des produits comparés aux utilisateurs qui ajoutent
--              ces marketplaces comme concurrents.
--
--              Les scrapers correspondants sont enregistrés dans
--              scraper_ai/dedicated_scrapers/registry.py via les modules
--              marketplace_kijiji, marketplace_lespac, marketplace_autotrader,
--              marketplace_cycletrader et motorcycledealers.

-- =====================================================
-- 1. AutoTrader.ca
-- =====================================================
INSERT INTO shared_scrapers (
  site_name, site_slug, site_url, site_domain, search_keywords,
  scraper_module, selectors, listing_urls, pagination_config,
  description, categories, vehicle_types, extracted_fields,
  is_active, last_verified_at, version
) VALUES (
  'AutoTrader.ca',
  'marketplace-autotrader-ca',
  'https://www.autotrader.ca',
  'autotrader.ca',
  ARRAY['autotrader', 'auto trader', 'autotrader.ca', 'marketplace', 'vehicule', 'auto'],
  'marketplace_autotrader',
  '{"type": "marketplace_snapshot", "adapter": "AutoTraderAdapter"}'::JSONB,
  '[]'::JSONB,
  '{"type": "marketplace_snapshot", "note": "Snapshot via scraper_search AutoTraderAdapter (seeds par marque)."}'::JSONB,
  'Annonces véhicules motorisés au Canada (auto, moto, VR). Marketplace multi-vendeurs. Snapshot construit via une série de recherches par marque populaire pour fournir une base de comparaison aux utilisateurs.',
  ARRAY['marketplace'],
  ARRAY['auto', 'moto', 'vtt'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'kilometrage', 'image'],
  TRUE,
  NOW(),
  '1.0'
)
ON CONFLICT (site_slug) DO UPDATE SET
  site_name = EXCLUDED.site_name,
  site_url = EXCLUDED.site_url,
  site_domain = EXCLUDED.site_domain,
  search_keywords = EXCLUDED.search_keywords,
  scraper_module = EXCLUDED.scraper_module,
  selectors = EXCLUDED.selectors,
  description = EXCLUDED.description,
  vehicle_types = EXCLUDED.vehicle_types,
  extracted_fields = EXCLUDED.extracted_fields,
  last_verified_at = NOW(),
  updated_at = NOW();

-- =====================================================
-- 2. Kijiji
-- =====================================================
INSERT INTO shared_scrapers (
  site_name, site_slug, site_url, site_domain, search_keywords,
  scraper_module, selectors, listing_urls, pagination_config,
  description, categories, vehicle_types, extracted_fields,
  is_active, last_verified_at, version
) VALUES (
  'Kijiji',
  'marketplace-kijiji-ca',
  'https://www.kijiji.ca',
  'kijiji.ca',
  ARRAY['kijiji', 'kijiji.ca', 'marketplace', 'petites annonces', 'classifieds'],
  'marketplace_kijiji',
  '{"type": "marketplace_snapshot", "adapter": "KijijiAdapter"}'::JSONB,
  '[]'::JSONB,
  '{"type": "marketplace_snapshot", "note": "Snapshot via scraper_search KijijiAdapter (seeds par marque)."}'::JSONB,
  'Petites annonces locales au Canada. Marketplace multi-vendeurs (particuliers et concessionnaires). Snapshot construit via plusieurs recherches par marque populaire.',
  ARRAY['marketplace'],
  ARRAY['auto', 'moto', 'vtt', 'motoneige', 'sxs'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'kilometrage', 'image'],
  TRUE,
  NOW(),
  '1.0'
)
ON CONFLICT (site_slug) DO UPDATE SET
  site_name = EXCLUDED.site_name,
  site_url = EXCLUDED.site_url,
  site_domain = EXCLUDED.site_domain,
  search_keywords = EXCLUDED.search_keywords,
  scraper_module = EXCLUDED.scraper_module,
  selectors = EXCLUDED.selectors,
  description = EXCLUDED.description,
  vehicle_types = EXCLUDED.vehicle_types,
  extracted_fields = EXCLUDED.extracted_fields,
  last_verified_at = NOW(),
  updated_at = NOW();

-- =====================================================
-- 3. LesPAC
-- =====================================================
INSERT INTO shared_scrapers (
  site_name, site_slug, site_url, site_domain, search_keywords,
  scraper_module, selectors, listing_urls, pagination_config,
  description, categories, vehicle_types, extracted_fields,
  is_active, last_verified_at, version
) VALUES (
  'LesPAC',
  'marketplace-lespac',
  'https://www.lespac.com',
  'lespac.com',
  ARRAY['lespac', 'les pac', 'les pacs', 'lespac.com', 'marketplace', 'quebec', 'annonces'],
  'marketplace_lespac',
  '{"type": "marketplace_snapshot", "adapter": "LesPacAdapter"}'::JSONB,
  '[]'::JSONB,
  '{"type": "marketplace_snapshot", "note": "Snapshot via scraper_search LesPacAdapter (seeds par marque)."}'::JSONB,
  'Petites annonces québécoises (auto, moto, motoneige, VTT). Marketplace francophone multi-vendeurs. Snapshot construit via plusieurs recherches par marque populaire.',
  ARRAY['marketplace'],
  ARRAY['auto', 'moto', 'vtt', 'motoneige'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'image'],
  TRUE,
  NOW(),
  '1.0'
)
ON CONFLICT (site_slug) DO UPDATE SET
  site_name = EXCLUDED.site_name,
  site_url = EXCLUDED.site_url,
  site_domain = EXCLUDED.site_domain,
  search_keywords = EXCLUDED.search_keywords,
  scraper_module = EXCLUDED.scraper_module,
  selectors = EXCLUDED.selectors,
  description = EXCLUDED.description,
  vehicle_types = EXCLUDED.vehicle_types,
  extracted_fields = EXCLUDED.extracted_fields,
  last_verified_at = NOW(),
  updated_at = NOW();

-- =====================================================
-- 4. CycleTrader.com
-- =====================================================
INSERT INTO shared_scrapers (
  site_name, site_slug, site_url, site_domain, search_keywords,
  scraper_module, selectors, listing_urls, pagination_config,
  description, categories, vehicle_types, extracted_fields,
  is_active, last_verified_at, version
) VALUES (
  'CycleTrader.com',
  'marketplace-cycletrader',
  'https://www.cycletrader.com',
  'cycletrader.com',
  ARRAY['cycletrader', 'cycle trader', 'cycletrader.com', 'marketplace', 'powersport', 'moto'],
  'marketplace_cycletrader',
  '{"type": "marketplace_snapshot", "adapter": "CycleTraderAdapter"}'::JSONB,
  '[]'::JSONB,
  '{"type": "marketplace_snapshot", "note": "Snapshot via scraper_search CycleTraderAdapter (seeds par marque)."}'::JSONB,
  'Marketplace powersports (moto, VTT, motoneige, SXS) basé aux États-Unis. Snapshot construit via plusieurs recherches par marque populaire pour fournir une référence de prix marché.',
  ARRAY['marketplace'],
  ARRAY['moto', 'vtt', 'motoneige', 'sxs'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'image'],
  TRUE,
  NOW(),
  '1.0'
)
ON CONFLICT (site_slug) DO UPDATE SET
  site_name = EXCLUDED.site_name,
  site_url = EXCLUDED.site_url,
  site_domain = EXCLUDED.site_domain,
  search_keywords = EXCLUDED.search_keywords,
  scraper_module = EXCLUDED.scraper_module,
  selectors = EXCLUDED.selectors,
  description = EXCLUDED.description,
  vehicle_types = EXCLUDED.vehicle_types,
  extracted_fields = EXCLUDED.extracted_fields,
  last_verified_at = NOW(),
  updated_at = NOW();

-- =====================================================
-- 5. MotorcycleDealers.ca
-- =====================================================
INSERT INTO shared_scrapers (
  site_name, site_slug, site_url, site_domain, search_keywords,
  scraper_module, selectors, listing_urls, pagination_config,
  description, categories, vehicle_types, extracted_fields,
  is_active, last_verified_at, version
) VALUES (
  'MotorcycleDealers.ca',
  'motorcycledealers-ca',
  'https://www.motorcycledealers.ca',
  'motorcycledealers.ca',
  ARRAY['motorcycledealers', 'motorcycle dealers', 'motocycle dealers', 'motorcycledealers.ca', 'canada', 'moto', 'concessionnaires'],
  'motorcycledealers',
  '{
    "discovery": {
      "method": "listing_pagination",
      "listing_url": "https://www.motorcycledealers.ca/motorcycles-for-sale",
      "pagination_param": "page",
      "max_pages": 5
    },
    "detail": {
      "title": "h1, h2",
      "image": "meta[property=\"og:image\"]",
      "price_selectors": [".price", ".listing-price", "[data-price]", "[itemprop=\"price\"]"],
      "price_regex": "\\$\\s*([\\d][\\d,\\.\\s]{2,12})\\b",
      "mileage_regex": "([\\d,\\s]+)\\s*km\\b"
    }
  }'::JSONB,
  '[
    {"url": "https://www.motorcycledealers.ca/motorcycles-for-sale", "type": "listing"}
  ]'::JSONB,
  '{
    "type": "listing_pagination",
    "param": "page",
    "max_pages": 5,
    "note": "Annuaire agrégateur ; on parcourt les pages /motorcycles-for-sale?page=N et on suit les URLs détaillées /motorcycles-for-sale/<id>/<slug>."
  }'::JSONB,
  'Agrégateur d''annonces moto au Canada (réseau MyDealers.ca). Les listings agrègent les inventaires de concessionnaires canadiens. Bilingue FR/EN.',
  ARRAY['marketplace', 'inventaire'],
  ARRAY['moto'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'kilometrage', 'image'],
  TRUE,
  NOW(),
  '1.0'
)
ON CONFLICT (site_slug) DO UPDATE SET
  site_name = EXCLUDED.site_name,
  site_url = EXCLUDED.site_url,
  site_domain = EXCLUDED.site_domain,
  search_keywords = EXCLUDED.search_keywords,
  scraper_module = EXCLUDED.scraper_module,
  selectors = EXCLUDED.selectors,
  listing_urls = EXCLUDED.listing_urls,
  pagination_config = EXCLUDED.pagination_config,
  description = EXCLUDED.description,
  vehicle_types = EXCLUDED.vehicle_types,
  extracted_fields = EXCLUDED.extracted_fields,
  last_verified_at = NOW(),
  updated_at = NOW();
