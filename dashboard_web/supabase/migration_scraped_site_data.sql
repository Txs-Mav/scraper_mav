-- Migration: Table scraped_site_data (produits pré-scrapés par site, centralisé)
-- Date: 2026-04-06
-- Description: Stocke les produits scrapés par site de manière centralisée.
--              Le cron horaire remplit cette table, et quand un utilisateur
--              clique "Analyser maintenant", on lit directement depuis cette table.

CREATE TABLE IF NOT EXISTS scraped_site_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identification du site
  site_url TEXT NOT NULL,
  site_domain TEXT NOT NULL UNIQUE,
  shared_scraper_id UUID REFERENCES shared_scrapers(id) ON DELETE SET NULL,

  -- Données scrapées
  products JSONB DEFAULT '[]'::JSONB,
  product_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::JSONB,

  -- Statut du dernier scraping
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  scrape_duration_seconds NUMERIC,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'error')),
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_scraped_site_data_domain ON scraped_site_data(site_domain);
CREATE INDEX IF NOT EXISTS idx_scraped_site_data_status ON scraped_site_data(status);
CREATE INDEX IF NOT EXISTS idx_scraped_site_data_scraped_at ON scraped_site_data(scraped_at);

-- RLS : lecture pour tous les utilisateurs authentifiés
ALTER TABLE scraped_site_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read scraped site data"
  ON scraped_site_data FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Trigger updated_at
CREATE TRIGGER update_scraped_site_data_updated_at
  BEFORE UPDATE ON scraped_site_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE scraped_site_data IS 'Produits pré-scrapés par site (rempli par le cron horaire). Les utilisateurs lisent depuis cette table pour un affichage instantané.';
COMMENT ON COLUMN scraped_site_data.site_domain IS 'Domaine normalisé (unique) — clé de lookup';
COMMENT ON COLUMN scraped_site_data.products IS 'Tableau JSON de produits (même format que scrapings.products)';
