-- Migration: Amélioration de scraper_cache pour le système intelligent
-- Date: 2026-01-18
-- Description: Ajoute les colonnes pour les sélecteurs CSS dynamiques et les URLs produits

-- =====================================================
-- 1. AJOUT DES NOUVELLES COLONNES À scraper_cache
-- =====================================================

-- Sélecteurs CSS spécifiques au site (détectés par Gemini)
ALTER TABLE scraper_cache 
ADD COLUMN IF NOT EXISTS selectors JSONB DEFAULT '{}';

-- URLs des produits découvertes
ALTER TABLE scraper_cache 
ADD COLUMN IF NOT EXISTS product_urls JSONB DEFAULT '[]';

-- Expiration du cache (7 jours par défaut)
ALTER TABLE scraper_cache 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days');

-- Version du template utilisé
ALTER TABLE scraper_cache 
ADD COLUMN IF NOT EXISTS template_version TEXT DEFAULT '1.0';

-- Nombre de produits extraits lors de la dernière exécution
ALTER TABLE scraper_cache 
ADD COLUMN IF NOT EXISTS last_product_count INTEGER DEFAULT 0;

-- Date de la dernière exécution réussie
ALTER TABLE scraper_cache 
ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP WITH TIME ZONE;

-- Statut du scraper (active, expired, error)
ALTER TABLE scraper_cache 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' 
CHECK (status IN ('active', 'expired', 'error', 'pending'));

-- =====================================================
-- 2. TABLE scraper_shares (PARTAGE DE SCRAPERS)
-- =====================================================
-- Permet aux membres d'une organisation de partager leurs scrapers

CREATE TABLE IF NOT EXISTS scraper_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scraper_cache_id UUID NOT NULL REFERENCES scraper_cache(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'write', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(scraper_cache_id, target_user_id)
);

-- =====================================================
-- 3. NOUVELLE TABLE: scraping_results
-- =====================================================
-- Stocke les résultats de chaque exécution de scraping

CREATE TABLE IF NOT EXISTS scraping_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scraper_cache_id UUID REFERENCES scraper_cache(id) ON DELETE SET NULL,
  site_url TEXT NOT NULL,
  products JSONB DEFAULT '[]',
  product_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  execution_time_seconds FLOAT,
  status TEXT DEFAULT 'success' CHECK (status IN ('success', 'partial', 'error')),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour scraping_results
CREATE INDEX IF NOT EXISTS idx_scraping_results_user_id ON scraping_results(user_id);
CREATE INDEX IF NOT EXISTS idx_scraping_results_scraper_cache_id ON scraping_results(scraper_cache_id);
CREATE INDEX IF NOT EXISTS idx_scraping_results_site_url ON scraping_results(site_url);
CREATE INDEX IF NOT EXISTS idx_scraping_results_created_at ON scraping_results(created_at DESC);

-- Trigger pour updated_at
CREATE TRIGGER update_scraping_results_updated_at 
BEFORE UPDATE ON scraping_results
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 3. RLS POLICIES POUR scraping_results
-- =====================================================

ALTER TABLE scraping_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scraping results"
  ON scraping_results FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scraping results"
  ON scraping_results FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scraping results"
  ON scraping_results FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 4. INDEX SUPPLÉMENTAIRES POUR scraper_cache
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_scraper_cache_expires_at ON scraper_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_scraper_cache_status ON scraper_cache(status);
CREATE INDEX IF NOT EXISTS idx_scraper_cache_last_run_at ON scraper_cache(last_run_at DESC);

-- =====================================================
-- 5. FONCTION POUR VÉRIFIER L'EXPIRATION DU CACHE
-- =====================================================

CREATE OR REPLACE FUNCTION check_scraper_cache_expiry()
RETURNS TRIGGER AS $$
BEGIN
  -- Si le cache est expiré, mettre le statut à 'expired'
  IF NEW.expires_at < NOW() AND NEW.status = 'active' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour vérifier l'expiration automatiquement
DROP TRIGGER IF EXISTS check_scraper_cache_expiry_trigger ON scraper_cache;
CREATE TRIGGER check_scraper_cache_expiry_trigger
BEFORE UPDATE ON scraper_cache
FOR EACH ROW EXECUTE FUNCTION check_scraper_cache_expiry();

-- =====================================================
-- 6. FONCTION POUR RAFRAÎCHIR LE CACHE
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_scraper_cache_expiry(cache_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE scraper_cache
  SET 
    expires_at = NOW() + INTERVAL '7 days',
    status = 'active',
    updated_at = NOW()
  WHERE id = cache_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. VUE POUR LES SCRAPERS AVEC STATISTIQUES
-- =====================================================

CREATE OR REPLACE VIEW scraper_cache_with_stats AS
SELECT 
  sc.*,
  COUNT(sr.id) as total_runs,
  MAX(sr.created_at) as last_successful_run,
  AVG(sr.product_count) as avg_products_per_run,
  SUM(sr.product_count) as total_products_extracted
FROM scraper_cache sc
LEFT JOIN scraping_results sr ON sc.id = sr.scraper_cache_id AND sr.status = 'success'
GROUP BY sc.id;

-- =====================================================
-- COMMENTAIRES
-- =====================================================

COMMENT ON COLUMN scraper_cache.selectors IS 'Sélecteurs CSS spécifiques au site, détectés par Gemini lors de l''analyse HTML';
COMMENT ON COLUMN scraper_cache.product_urls IS 'Liste des URLs de produits découvertes lors de l''exploration';
COMMENT ON COLUMN scraper_cache.expires_at IS 'Date d''expiration du cache (7 jours par défaut)';
COMMENT ON COLUMN scraper_cache.template_version IS 'Version du template Python utilisé pour générer le scraper';
COMMENT ON COLUMN scraper_cache.last_product_count IS 'Nombre de produits extraits lors de la dernière exécution';
COMMENT ON COLUMN scraper_cache.last_run_at IS 'Date de la dernière exécution réussie du scraper';
COMMENT ON COLUMN scraper_cache.status IS 'Statut du scraper: active, expired, error, pending';

COMMENT ON TABLE scraping_results IS 'Historique des résultats d''exécution des scrapers';
