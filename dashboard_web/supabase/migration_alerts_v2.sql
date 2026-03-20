-- Migration v2: Alertes = scraping configurable autonome
-- Chaque alerte configure un scraping complet (référence + concurrents)
-- avec fréquence, types de changements, et seuils personnalisés.

-- 1. Nouveaux champs de configuration scraping
ALTER TABLE scraper_alerts
  ADD COLUMN IF NOT EXISTS reference_url TEXT,
  ADD COLUMN IF NOT EXISTS competitor_urls JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '["inventaire","occasion","catalogue"]',
  ADD COLUMN IF NOT EXISTS schedule_type TEXT DEFAULT 'daily'
    CHECK (schedule_type IN ('daily', 'interval')),
  ADD COLUMN IF NOT EXISTS schedule_interval_hours INTEGER
    CHECK (schedule_interval_hours IS NULL OR schedule_interval_hours IN (1, 2, 4, 6, 12, 24)),
  ADD COLUMN IF NOT EXISTS watch_price_increase BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS watch_price_decrease BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS watch_new_products BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS watch_removed_products BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS watch_stock_changes BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS min_price_change_pct FLOAT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_price_change_abs FLOAT DEFAULT 2;

-- 2. Rendre scraper_cache_id nullable (auto-peuplé après premier scraping)
ALTER TABLE scraper_alerts ALTER COLUMN scraper_cache_id DROP NOT NULL;

-- 3. Remplacer la contrainte UNIQUE par (user_id, reference_url)
ALTER TABLE scraper_alerts DROP CONSTRAINT IF EXISTS scraper_alerts_user_id_scraper_cache_id_key;
DROP INDEX IF EXISTS idx_scraper_alerts_user_target_url;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scraper_alerts_user_reference_url
  ON scraper_alerts(user_id, reference_url) WHERE reference_url IS NOT NULL;

-- 4. Migrer les alertes existantes : remplir reference_url depuis scraper_cache.site_url
UPDATE scraper_alerts sa
SET reference_url = sc.site_url
FROM scraper_cache sc
WHERE sa.scraper_cache_id = sc.id
  AND sa.reference_url IS NULL;

-- 5. Supprimer l'ancien champ target_url s'il existe (de la migration précédente)
ALTER TABLE scraper_alerts DROP COLUMN IF EXISTS target_url;

-- 6. Index pour le filtrage par schedule
CREATE INDEX IF NOT EXISTS idx_scraper_alerts_schedule_type
  ON scraper_alerts(schedule_type);
CREATE INDEX IF NOT EXISTS idx_scraper_alerts_interval
  ON scraper_alerts(schedule_interval_hours) WHERE schedule_type = 'interval';
