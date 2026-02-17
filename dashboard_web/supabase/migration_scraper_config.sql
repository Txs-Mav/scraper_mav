-- Migration: Table scraper_config pour stocker la configuration du scraper par utilisateur
-- Date: 2026-01-21
-- Description: Remplace le fichier scraper_config.json local par stockage Supabase

-- =====================================================
-- TABLE scraper_config
-- =====================================================
-- Stocke la configuration du scraper pour chaque utilisateur

CREATE TABLE IF NOT EXISTS scraper_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Configuration du scraper
  reference_url TEXT,                    -- URL du site de référence
  competitor_urls JSONB DEFAULT '[]',    -- URLs des sites concurrents
  price_difference_filter NUMERIC,       -- Filtre de différence de prix (optionnel)
  categories JSONB DEFAULT '[]',         -- Catégories à scraper
  
  -- Métadonnées
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Un seul config par utilisateur
  UNIQUE(user_id)
);

-- =====================================================
-- INDEX
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_scraper_config_user_id ON scraper_config(user_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE scraper_config ENABLE ROW LEVEL SECURITY;

-- Politique: Les utilisateurs ne voient que leur propre config
CREATE POLICY "Users can view own config" ON scraper_config
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own config" ON scraper_config
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own config" ON scraper_config
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own config" ON scraper_config
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================
-- TRIGGER: updated_at automatique
-- =====================================================

CREATE OR REPLACE FUNCTION update_scraper_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_scraper_config_updated_at ON scraper_config;
CREATE TRIGGER trigger_scraper_config_updated_at
  BEFORE UPDATE ON scraper_config
  FOR EACH ROW
  EXECUTE FUNCTION update_scraper_config_updated_at();

-- =====================================================
-- COMMENTAIRES
-- =====================================================

COMMENT ON TABLE scraper_config IS 'Configuration du scraper par utilisateur (remplace scraper_config.json)';
COMMENT ON COLUMN scraper_config.reference_url IS 'URL du site de référence pour les comparaisons';
COMMENT ON COLUMN scraper_config.competitor_urls IS 'Liste JSON des URLs des sites concurrents';
COMMENT ON COLUMN scraper_config.price_difference_filter IS 'Filtre optionnel de différence de prix';
COMMENT ON COLUMN scraper_config.categories IS 'Catégories à scraper (inventaire, occasion, catalogue)';
