-- Migration: Tables pour les alertes de scraping automatisées

-- Table scraper_alerts : configuration des alertes (1 par scraper en cache)
CREATE TABLE IF NOT EXISTS scraper_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scraper_cache_id UUID NOT NULL REFERENCES scraper_cache(id) ON DELETE CASCADE,
  schedule_hour INTEGER NOT NULL CHECK (schedule_hour >= 0 AND schedule_hour <= 23),
  schedule_minute INTEGER NOT NULL DEFAULT 0 CHECK (schedule_minute >= 0 AND schedule_minute <= 59),
  is_active BOOLEAN DEFAULT true,
  email_notification BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  last_change_detected_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, scraper_cache_id)
);

-- Table alert_changes : historique des changements détectés
CREATE TABLE IF NOT EXISTS alert_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES scraper_alerts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('price_increase', 'price_decrease', 'new_product', 'removed_product', 'stock_change')),
  product_name TEXT,
  old_value TEXT,
  new_value TEXT,
  percentage_change FLOAT,
  details JSONB DEFAULT '{}',
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_scraper_alerts_user_id ON scraper_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_scraper_alerts_active ON scraper_alerts(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_scraper_alerts_schedule ON scraper_alerts(schedule_hour, schedule_minute);
CREATE INDEX IF NOT EXISTS idx_alert_changes_alert_id ON alert_changes(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_changes_user_id ON alert_changes(user_id);
CREATE INDEX IF NOT EXISTS idx_alert_changes_detected_at ON alert_changes(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_changes_unread ON alert_changes(user_id, is_read) WHERE is_read = false;

-- RLS
ALTER TABLE scraper_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_changes ENABLE ROW LEVEL SECURITY;

-- Policies scraper_alerts
CREATE POLICY "Users can view their own alerts"
  ON scraper_alerts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own alerts"
  ON scraper_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own alerts"
  ON scraper_alerts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own alerts"
  ON scraper_alerts FOR DELETE USING (auth.uid() = user_id);

-- Policies alert_changes
CREATE POLICY "Users can view their own changes"
  ON alert_changes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own changes"
  ON alert_changes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own changes"
  ON alert_changes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own changes"
  ON alert_changes FOR DELETE USING (auth.uid() = user_id);

-- Triggers updated_at
CREATE TRIGGER update_scraper_alerts_updated_at BEFORE UPDATE ON scraper_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
