-- Migration: Table shared_scrapers (scrapers pré-configurés accessibles à tous)
-- Date: 2026-03-05
-- Description: Registre de scrapers dédiés avec sélecteurs hardcodés, 
--              sans expiration, accessibles à tous les utilisateurs via recherche.

-- =====================================================
-- 1. TABLE shared_scrapers
-- =====================================================

CREATE TABLE IF NOT EXISTS shared_scrapers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Identification
  site_name TEXT NOT NULL,                 -- ex: "MVM Moto Sport"
  site_slug TEXT NOT NULL UNIQUE,          -- ex: "mvm-motosport" (pour recherche)
  site_url TEXT NOT NULL,                  -- ex: "https://www.mvmmotosport.com/fr/"
  site_domain TEXT NOT NULL,               -- ex: "mvmmotosport.com"
  
  -- Recherche (mots-clés pour la barre de recherche)
  search_keywords TEXT[] DEFAULT '{}',     -- ex: {"mvm", "motosport", "moto", "sport"}
  
  -- Configuration du scraper
  scraper_module TEXT NOT NULL,            -- ex: "mvm_motosport" (nom du module Python)
  selectors JSONB DEFAULT '{}',            -- Sélecteurs CSS hardcodés
  listing_urls JSONB DEFAULT '[]',         -- URLs des pages listing (inventaire, occasion)
  pagination_config JSONB DEFAULT '{}',    -- Configuration de la pagination
  
  -- Métadonnées
  description TEXT,                        -- Description du site/scraper
  categories TEXT[] DEFAULT '{}',          -- ex: {"inventaire", "occasion"}
  vehicle_types TEXT[] DEFAULT '{}',       -- ex: {"moto", "quad", "motoneige"}
  logo_url TEXT,                           -- Logo du concessionnaire
  
  -- Champs extraits par ce scraper
  extracted_fields TEXT[] DEFAULT '{}',    -- ex: {"name", "prix", "modele", "couleur", ...}
  
  -- Statut
  is_active BOOLEAN DEFAULT TRUE,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  version TEXT DEFAULT '1.0',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 2. INDEX POUR RECHERCHE RAPIDE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_shared_scrapers_site_slug ON shared_scrapers(site_slug);
CREATE INDEX IF NOT EXISTS idx_shared_scrapers_site_domain ON shared_scrapers(site_domain);
CREATE INDEX IF NOT EXISTS idx_shared_scrapers_is_active ON shared_scrapers(is_active);
CREATE INDEX IF NOT EXISTS idx_shared_scrapers_search_keywords ON shared_scrapers USING GIN(search_keywords);

-- Index simple sur site_name pour recherche ILIKE
CREATE INDEX IF NOT EXISTS idx_shared_scrapers_site_name ON shared_scrapers(site_name);

-- =====================================================
-- 3. RLS POLICIES (lecture pour tous les utilisateurs authentifiés)
-- =====================================================

ALTER TABLE shared_scrapers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view shared scrapers"
  ON shared_scrapers FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Seul le service role peut insérer/modifier/supprimer
-- (pas de policy INSERT/UPDATE/DELETE pour les utilisateurs normaux)

-- =====================================================
-- 4. TRIGGER updated_at
-- =====================================================

CREATE TRIGGER update_shared_scrapers_updated_at 
  BEFORE UPDATE ON shared_scrapers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. INSERTION DU SCRAPER MVM MOTO SPORT
-- =====================================================

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
  'MVM Moto Sport',
  'mvm-motosport',
  'https://www.mvmmotosport.com/fr/',
  'mvmmotosport.com',
  ARRAY['mvm', 'motosport', 'moto', 'sport', 'mvm moto sport', 'mvmmotosport'],
  'mvm_motosport',
  '{
    "listing": {
      "product_card": ".product-list.listWImgs .item",
      "product_title": ".listWImgsContent h3 a",
      "product_link": ".listWImgsContent h3 a",
      "product_image": ".listWImgs .item img",
      "product_price": ".specs li.price > .value .number",
      "product_price_original": ".specs li.price del .value .number",
      "product_mileage": ".specs li.km .value .number",
      "product_stock": ".specs li.stock .value"
    },
    "detail": {
      "brand": "#product-specs-overview li.make .value",
      "model": "#product-specs-overview li.model .value",
      "year": "#product-specs-overview li.year .value",
      "mileage": "#product-specs-overview li.km .value .number",
      "vin": "#product-specs-overview li.vin .value",
      "color": "#product-specs-overview li.ext-color .value",
      "engine_capacity": "#product-specs-overview li.engine-capacity .value",
      "condition": "#product-specs-overview li.condition .value",
      "type": "#product-specs-overview li.type .value",
      "transmission": "#product-specs-overview li.transmission .value",
      "fuel_type": "#product-specs-overview li.fuel-type .value",
      "description": "#product-notes .text.reset-text",
      "price": ".specs li.price > .value .number",
      "price_original": ".specs li.price del .value .number",
      "stock_number": ".specs li.stock .value",
      "title": ".product-title h1, .product-header h1"
    }
  }'::JSONB,
  '[
    {"url": "https://www.mvmmotosport.com/fr/produits-occasion/", "category": "occasion", "etat": "occasion"},
    {"url": "https://www.mvmmotosport.com/fr/inventaire-neuf/", "category": "inventaire", "etat": "neuf"}
  ]'::JSONB,
  '{
    "type": "facetwp_ajax",
    "endpoint": "/wp-admin/admin-ajax.php",
    "action": "facetwp_refresh",
    "products_per_page": 10
  }'::JSONB,
  'Concessionnaire powersports à Laval, QC. Motos, VTT, motoneiges, motomarines. Plateforme PowerGO/WordPress avec FacetWP.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'quad', 'motoneige', 'scooter', 'side-by-side', 'motomarine'],
  ARRAY['name', 'prix', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vin', 'cylindree', 'transmission', 'type_carburant'],
  TRUE,
  NOW(),
  '1.0'
)
ON CONFLICT (site_slug) DO UPDATE SET
  selectors = EXCLUDED.selectors,
  listing_urls = EXCLUDED.listing_urls,
  pagination_config = EXCLUDED.pagination_config,
  extracted_fields = EXCLUDED.extracted_fields,
  last_verified_at = NOW(),
  updated_at = NOW();

-- =====================================================
-- 6. COMMENTAIRES
-- =====================================================

COMMENT ON TABLE shared_scrapers IS 'Scrapers pré-configurés accessibles à tous les utilisateurs. Pas d''expiration, sélecteurs hardcodés.';
COMMENT ON COLUMN shared_scrapers.site_slug IS 'Identifiant unique lisible (pour recherche et URL)';
COMMENT ON COLUMN shared_scrapers.scraper_module IS 'Nom du module Python dans scraper_ai/dedicated_scrapers/';
COMMENT ON COLUMN shared_scrapers.search_keywords IS 'Mots-clés pour la recherche (barre de recherche dashboard)';
COMMENT ON COLUMN shared_scrapers.pagination_config IS 'Configuration de pagination: type (facetwp_ajax, url_params, next_button), endpoint, etc.';
