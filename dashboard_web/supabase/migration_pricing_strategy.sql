-- Migration pour la stratégie de pricing et les recommandations appliquées
-- À exécuter dans l'éditeur SQL de Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TABLE IF NOT EXISTS pricing_strategy_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  apply_enabled BOOLEAN NOT NULL DEFAULT false,
  default_strategy JSONB NOT NULL DEFAULT '{"key": "lowest_minus_amount", "amount": 1}',
  vehicle_type_strategies JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pricing_price_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scraping_id UUID REFERENCES scrapings(id) ON DELETE SET NULL,
  product_key TEXT NOT NULL,
  product_name TEXT NOT NULL,
  reference_url TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'autre',
  old_price NUMERIC(12, 2),
  recommended_price NUMERIC(12, 2) NOT NULL,
  strategy_key TEXT NOT NULL,
  basis JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('pending', 'applied', 'rejected')),
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, scraping_id, product_key)
);

CREATE INDEX IF NOT EXISTS idx_pricing_strategy_settings_user_id
  ON pricing_strategy_settings(user_id);

CREATE INDEX IF NOT EXISTS idx_pricing_price_updates_user_id
  ON pricing_price_updates(user_id);

CREATE INDEX IF NOT EXISTS idx_pricing_price_updates_scraping_id
  ON pricing_price_updates(scraping_id);

CREATE INDEX IF NOT EXISTS idx_pricing_price_updates_status
  ON pricing_price_updates(status);

DROP TRIGGER IF EXISTS update_pricing_strategy_settings_updated_at ON pricing_strategy_settings;
CREATE TRIGGER update_pricing_strategy_settings_updated_at BEFORE UPDATE ON pricing_strategy_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pricing_price_updates_updated_at ON pricing_price_updates;
CREATE TRIGGER update_pricing_price_updates_updated_at BEFORE UPDATE ON pricing_price_updates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE pricing_strategy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_price_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own pricing strategy" ON pricing_strategy_settings;
CREATE POLICY "Users can view their own pricing strategy"
  ON pricing_strategy_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own pricing strategy" ON pricing_strategy_settings;
CREATE POLICY "Users can insert their own pricing strategy"
  ON pricing_strategy_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own pricing strategy" ON pricing_strategy_settings;
CREATE POLICY "Users can update their own pricing strategy"
  ON pricing_strategy_settings FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own pricing strategy" ON pricing_strategy_settings;
CREATE POLICY "Users can delete their own pricing strategy"
  ON pricing_strategy_settings FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own pricing updates" ON pricing_price_updates;
CREATE POLICY "Users can view their own pricing updates"
  ON pricing_price_updates FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own pricing updates" ON pricing_price_updates;
CREATE POLICY "Users can insert their own pricing updates"
  ON pricing_price_updates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own pricing updates" ON pricing_price_updates;
CREATE POLICY "Users can update their own pricing updates"
  ON pricing_price_updates FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own pricing updates" ON pricing_price_updates;
CREATE POLICY "Users can delete their own pricing updates"
  ON pricing_price_updates FOR DELETE
  USING (auth.uid() = user_id);
