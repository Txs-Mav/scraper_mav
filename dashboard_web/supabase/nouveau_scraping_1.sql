-- ============================================================================
-- PRODUCT DISCOVERY SYSTEM - Database Schema
-- Migration: Product Graph + Canonical Products + Multi-source Ingestion
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CANONICAL PRODUCTS (the single source of truth for each unique product)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Core identity
    name            TEXT NOT NULL,
    brand           TEXT NOT NULL,
    model           TEXT,
    year            INT,
    category        TEXT,           -- moto, motoneige, vtt, cote-a-cote, scooter, 3-roues
    subcategory     TEXT,           -- sport, touring, adventure, utilitaire
    
    -- Standardized identifiers (nullable, filled as discovered)
    upc             TEXT,
    ean             TEXT,
    gtin            TEXT,
    mpn             TEXT,           -- Manufacturer Part Number
    manufacturer_sku TEXT,
    
    -- Specs (structured JSONB for flexible schema)
    specs           JSONB DEFAULT '{}',
    -- Expected keys: cylindree, puissance, poids, transmission, couleurs_disponibles, etc.
    
    -- Media
    primary_image   TEXT,
    images          TEXT[] DEFAULT '{}',
    
    -- Metadata
    confidence      FLOAT DEFAULT 0.0,   -- 0.0-1.0, how confident we are this is a real distinct product
    verified        BOOLEAN DEFAULT FALSE,
    listing_count   INT DEFAULT 0,        -- denormalized count of active listings
    
    -- Price intelligence (aggregated from listings)
    avg_price       NUMERIC(12,2),
    min_price       NUMERIC(12,2),
    max_price       NUMERIC(12,2),
    msrp            NUMERIC(12,2),        -- manufacturer suggested retail price
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_canonical_gtin UNIQUE NULLS NOT DISTINCT (gtin),
    CONSTRAINT uq_canonical_upc UNIQUE NULLS NOT DISTINCT (upc),
    CONSTRAINT uq_canonical_ean UNIQUE NULLS NOT DISTINCT (ean)
);

CREATE INDEX idx_canonical_brand_model ON canonical_products (brand, model);
CREATE INDEX idx_canonical_category ON canonical_products (category);
CREATE INDEX idx_canonical_year ON canonical_products (year);
CREATE INDEX idx_canonical_gtin ON canonical_products (gtin) WHERE gtin IS NOT NULL;
CREATE INDEX idx_canonical_upc ON canonical_products (upc) WHERE upc IS NOT NULL;
CREATE INDEX idx_canonical_mpn ON canonical_products (mpn) WHERE mpn IS NOT NULL;
CREATE INDEX idx_canonical_name_trgm ON canonical_products USING gin (name gin_trgm_ops);
CREATE INDEX idx_canonical_specs ON canonical_products USING gin (specs);

-- ---------------------------------------------------------------------------
-- 2. DATA SOURCES (where products come from)
-- ---------------------------------------------------------------------------
CREATE TYPE source_type AS ENUM (
    'manufacturer_feed',
    'distributor_api',
    'marketplace',
    'google_shopping',
    'scraper',
    'manual',
    'industry_database'
);

CREATE TABLE IF NOT EXISTS data_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    name            TEXT NOT NULL UNIQUE,
    source_type     source_type NOT NULL,
    base_url        TEXT,
    
    -- Connection config (encrypted at rest via Supabase Vault)
    config          JSONB DEFAULT '{}',
    -- api_key, auth_method, rate_limit, endpoints, feed_urls, etc.
    
    -- Ingestion schedule
    sync_frequency  INTERVAL DEFAULT '24 hours',
    last_sync_at    TIMESTAMPTZ,
    next_sync_at    TIMESTAMPTZ,
    
    -- Health
    is_active       BOOLEAN DEFAULT TRUE,
    error_count     INT DEFAULT 0,
    last_error      TEXT,
    
    -- Stats
    total_products  INT DEFAULT 0,
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. PRODUCT LISTINGS (individual store/source listings mapped to canonical)
-- ---------------------------------------------------------------------------
CREATE TYPE listing_condition AS ENUM ('neuf', 'occasion', 'demonstrateur', 'certifie', 'inconnu');
CREATE TYPE listing_status AS ENUM ('active', 'sold', 'expired', 'removed', 'draft');

CREATE TABLE IF NOT EXISTS product_listings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Link to canonical product (nullable during initial ingestion)
    canonical_product_id UUID REFERENCES canonical_products(id) ON DELETE SET NULL,
    
    -- Source info
    data_source_id      UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    source_product_id   TEXT,              -- the product ID as it exists in the source system
    source_url          TEXT,
    
    -- Retailer/dealer info
    retailer_name       TEXT NOT NULL,
    retailer_url        TEXT,
    retailer_location   TEXT,              -- city/region
    
    -- Product info (as listed by the source)
    raw_title           TEXT NOT NULL,
    raw_brand           TEXT,
    raw_model           TEXT,
    raw_year            INT,
    raw_category        TEXT,
    
    -- Identifiers found in this listing
    upc                 TEXT,
    ean                 TEXT,
    gtin                TEXT,
    mpn                 TEXT,
    stock_number        TEXT,
    vin                 TEXT,
    
    -- Pricing
    price               NUMERIC(12,2),
    currency            TEXT DEFAULT 'CAD',
    original_price      NUMERIC(12,2),     -- before discount
    
    -- Condition & availability
    condition           listing_condition DEFAULT 'inconnu',
    status              listing_status DEFAULT 'active',
    in_stock            BOOLEAN DEFAULT TRUE,
    quantity            INT DEFAULT 1,
    
    -- Additional data
    description         TEXT,
    specs               JSONB DEFAULT '{}',
    images              TEXT[] DEFAULT '{}',
    raw_data            JSONB DEFAULT '{}', -- full raw payload from source
    
    -- Matching metadata
    match_method        TEXT,              -- 'identifier', 'fuzzy_title', 'specs', 'manual'
    match_confidence    FLOAT DEFAULT 0.0, -- 0.0-1.0
    
    -- Timestamps
    first_seen_at       TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ DEFAULT NOW(),
    price_changed_at    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_listings_canonical ON product_listings (canonical_product_id);
CREATE INDEX idx_listings_source ON product_listings (data_source_id);
CREATE INDEX idx_listings_retailer ON product_listings (retailer_name);
CREATE INDEX idx_listings_gtin ON product_listings (gtin) WHERE gtin IS NOT NULL;
CREATE INDEX idx_listings_upc ON product_listings (upc) WHERE upc IS NOT NULL;
CREATE INDEX idx_listings_mpn ON product_listings (mpn) WHERE mpn IS NOT NULL;
CREATE INDEX idx_listings_vin ON product_listings (vin) WHERE vin IS NOT NULL;
CREATE INDEX idx_listings_status ON product_listings (status);
CREATE INDEX idx_listings_title_trgm ON product_listings USING gin (raw_title gin_trgm_ops);
CREATE INDEX idx_listings_unmatched ON product_listings (canonical_product_id) WHERE canonical_product_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. PRICE HISTORY (track every price change)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES product_listings(id) ON DELETE CASCADE,
    canonical_product_id UUID REFERENCES canonical_products(id) ON DELETE SET NULL,
    
    price               NUMERIC(12,2) NOT NULL,
    previous_price      NUMERIC(12,2),
    currency            TEXT DEFAULT 'CAD',
    
    recorded_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_history_listing ON price_history (listing_id, recorded_at DESC);
CREATE INDEX idx_price_history_canonical ON price_history (canonical_product_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- 5. PRODUCT IDENTIFIERS (cross-reference table for all known identifiers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_identifiers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_product_id UUID NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
    
    identifier_type     TEXT NOT NULL,     -- 'upc', 'ean', 'gtin', 'mpn', 'sku', 'vin', 'internal'
    identifier_value    TEXT NOT NULL,
    source              TEXT,              -- where this identifier was found
    
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_identifier UNIQUE (identifier_type, identifier_value)
);

CREATE INDEX idx_identifiers_canonical ON product_identifiers (canonical_product_id);
CREATE INDEX idx_identifiers_lookup ON product_identifiers (identifier_type, identifier_value);

-- ---------------------------------------------------------------------------
-- 6. INGESTION LOG (audit trail for all data ingestion runs)
-- ---------------------------------------------------------------------------
CREATE TYPE ingestion_status AS ENUM ('running', 'completed', 'failed', 'partial');

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    
    status          ingestion_status DEFAULT 'running',
    
    -- Counters
    products_fetched    INT DEFAULT 0,
    products_new        INT DEFAULT 0,
    products_updated    INT DEFAULT 0,
    products_matched    INT DEFAULT 0,    -- successfully matched to canonical
    products_unmatched  INT DEFAULT 0,
    
    -- Timing
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    duration_seconds FLOAT,
    
    -- Error tracking
    errors          JSONB DEFAULT '[]',
    
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_ingestion_source ON ingestion_runs (data_source_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- 7. MATCHING CANDIDATES (queue for human review of uncertain matches)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matching_candidates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES product_listings(id) ON DELETE CASCADE,
    canonical_product_id UUID NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
    
    confidence          FLOAT NOT NULL,    -- matching algorithm confidence
    match_method        TEXT NOT NULL,     -- which algorithm suggested this
    match_details       JSONB DEFAULT '{}', -- similarity scores breakdown
    
    -- Review
    reviewed            BOOLEAN DEFAULT FALSE,
    approved            BOOLEAN,
    reviewed_by         UUID,
    reviewed_at         TIMESTAMPTZ,
    
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_matching_candidate UNIQUE (listing_id, canonical_product_id)
);

CREATE INDEX idx_matching_unreviewed ON matching_candidates (reviewed, confidence DESC)
    WHERE reviewed = FALSE;

-- ---------------------------------------------------------------------------
-- 8. FUNCTIONS & TRIGGERS
-- ---------------------------------------------------------------------------

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_canonical_updated
    BEFORE UPDATE ON canonical_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_listings_updated
    BEFORE UPDATE ON product_listings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sources_updated
    BEFORE UPDATE ON data_sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Record price changes automatically
CREATE OR REPLACE FUNCTION record_price_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.price IS DISTINCT FROM NEW.price AND NEW.price IS NOT NULL THEN
        INSERT INTO price_history (listing_id, canonical_product_id, price, previous_price)
        VALUES (NEW.id, NEW.canonical_product_id, NEW.price, OLD.price);
        NEW.price_changed_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_change
    BEFORE UPDATE ON product_listings
    FOR EACH ROW EXECUTE FUNCTION record_price_change();

-- Update canonical product aggregate pricing when listings change
CREATE OR REPLACE FUNCTION update_canonical_pricing()
RETURNS TRIGGER AS $$
DECLARE
    target_id UUID;
BEGIN
    target_id := COALESCE(NEW.canonical_product_id, OLD.canonical_product_id);
    
    IF target_id IS NOT NULL THEN
        UPDATE canonical_products
        SET 
            avg_price = sub.avg_price,
            min_price = sub.min_price,
            max_price = sub.max_price,
            listing_count = sub.cnt
        FROM (
            SELECT 
                AVG(price) as avg_price,
                MIN(price) as min_price,
                MAX(price) as max_price,
                COUNT(*) as cnt
            FROM product_listings
            WHERE canonical_product_id = target_id
              AND status = 'active'
              AND price IS NOT NULL
        ) sub
        WHERE id = target_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_canonical_pricing
    AFTER INSERT OR UPDATE OR DELETE ON product_listings
    FOR EACH ROW EXECUTE FUNCTION update_canonical_pricing();

-- ---------------------------------------------------------------------------
-- 9. VIEWS
-- ---------------------------------------------------------------------------

-- Product comparison view: canonical product with all its listings
CREATE OR REPLACE VIEW product_comparison AS
SELECT 
    cp.id AS canonical_id,
    cp.name AS canonical_name,
    cp.brand,
    cp.model,
    cp.year,
    cp.category,
    cp.msrp,
    cp.avg_price,
    cp.min_price,
    cp.max_price,
    cp.listing_count,
    pl.id AS listing_id,
    pl.retailer_name,
    pl.retailer_url,
    pl.retailer_location,
    pl.price AS listing_price,
    pl.condition,
    pl.status,
    pl.in_stock,
    pl.match_confidence,
    pl.source_url,
    pl.last_seen_at,
    CASE 
        WHEN cp.msrp > 0 THEN ROUND(((pl.price - cp.msrp) / cp.msrp * 100)::numeric, 1)
        ELSE NULL 
    END AS price_vs_msrp_pct
FROM canonical_products cp
LEFT JOIN product_listings pl ON pl.canonical_product_id = cp.id
WHERE pl.status = 'active';

-- Unmatched listings view (for review queue)
CREATE OR REPLACE VIEW unmatched_listings AS
SELECT 
    pl.*,
    ds.name AS source_name,
    ds.source_type
FROM product_listings pl
JOIN data_sources ds ON ds.id = pl.data_source_id
WHERE pl.canonical_product_id IS NULL
ORDER BY pl.created_at DESC;

-- ---------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE matching_candidates ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by ingestion pipeline)
CREATE POLICY "Service role full access" ON canonical_products
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON product_listings
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON data_sources
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON price_history
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON product_identifiers
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON ingestion_runs
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON matching_candidates
    FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can read products and listings
CREATE POLICY "Authenticated read products" ON canonical_products
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read listings" ON product_listings
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read history" ON price_history
    FOR SELECT USING (auth.role() = 'authenticated');

-- Enable pg_trgm extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;
