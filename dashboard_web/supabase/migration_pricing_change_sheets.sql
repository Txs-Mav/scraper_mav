-- Migration pour les fiches de changements de prix
-- À exécuter dans l'éditeur SQL de Supabase APRÈS migration_pricing_strategy.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Fiche de changements de prix : un regroupement de produits dont le prix doit
-- être mis à jour manuellement (ex. dans le DMS, le site web, etc.).
CREATE TABLE IF NOT EXISTS pricing_change_sheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scraping_id UUID REFERENCES scrapings(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'Fiche de changements',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'archived')),
  notes TEXT,
  items_count INT NOT NULL DEFAULT 0,
  applied_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Lignes d'une fiche : un produit + l'ancien prix + le prix recommandé +
-- des métadonnées sur la stratégie utilisée pour le calcul.
CREATE TABLE IF NOT EXISTS pricing_change_sheet_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sheet_id UUID NOT NULL REFERENCES pricing_change_sheets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  product_name TEXT NOT NULL,
  reference_url TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'autre',
  old_price NUMERIC(12, 2),
  new_price NUMERIC(12, 2) NOT NULL,
  strategy_key TEXT,
  strategy_label TEXT,
  basis JSONB NOT NULL DEFAULT '{}',
  applied BOOLEAN NOT NULL DEFAULT false,
  applied_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sheet_id, product_key)
);

CREATE INDEX IF NOT EXISTS idx_pricing_change_sheets_user_id
  ON pricing_change_sheets(user_id);

CREATE INDEX IF NOT EXISTS idx_pricing_change_sheets_status
  ON pricing_change_sheets(status);

CREATE INDEX IF NOT EXISTS idx_pricing_change_sheet_items_sheet_id
  ON pricing_change_sheet_items(sheet_id);

CREATE INDEX IF NOT EXISTS idx_pricing_change_sheet_items_user_id
  ON pricing_change_sheet_items(user_id);

DROP TRIGGER IF EXISTS update_pricing_change_sheets_updated_at ON pricing_change_sheets;
CREATE TRIGGER update_pricing_change_sheets_updated_at BEFORE UPDATE ON pricing_change_sheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pricing_change_sheet_items_updated_at ON pricing_change_sheet_items;
CREATE TRIGGER update_pricing_change_sheet_items_updated_at BEFORE UPDATE ON pricing_change_sheet_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Fonction pour synchroniser les compteurs sur la fiche parente quand un item
-- change (création, suppression, bascule du flag `applied`).
CREATE OR REPLACE FUNCTION sync_pricing_change_sheet_counts()
RETURNS TRIGGER AS $$
DECLARE
  target_sheet UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_sheet := OLD.sheet_id;
  ELSE
    target_sheet := NEW.sheet_id;
  END IF;

  UPDATE pricing_change_sheets
  SET
    items_count = COALESCE((SELECT COUNT(*) FROM pricing_change_sheet_items WHERE sheet_id = target_sheet), 0),
    applied_count = COALESCE((SELECT COUNT(*) FROM pricing_change_sheet_items WHERE sheet_id = target_sheet AND applied = true), 0),
    updated_at = NOW()
  WHERE id = target_sheet;

  RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS sync_change_sheet_counts ON pricing_change_sheet_items;
CREATE TRIGGER sync_change_sheet_counts
  AFTER INSERT OR UPDATE OR DELETE ON pricing_change_sheet_items
  FOR EACH ROW EXECUTE FUNCTION sync_pricing_change_sheet_counts();

ALTER TABLE pricing_change_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_change_sheet_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own change sheets" ON pricing_change_sheets;
CREATE POLICY "Users can view their own change sheets"
  ON pricing_change_sheets FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own change sheets" ON pricing_change_sheets;
CREATE POLICY "Users can insert their own change sheets"
  ON pricing_change_sheets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own change sheets" ON pricing_change_sheets;
CREATE POLICY "Users can update their own change sheets"
  ON pricing_change_sheets FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own change sheets" ON pricing_change_sheets;
CREATE POLICY "Users can delete their own change sheets"
  ON pricing_change_sheets FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own change sheet items" ON pricing_change_sheet_items;
CREATE POLICY "Users can view their own change sheet items"
  ON pricing_change_sheet_items FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own change sheet items" ON pricing_change_sheet_items;
CREATE POLICY "Users can insert their own change sheet items"
  ON pricing_change_sheet_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own change sheet items" ON pricing_change_sheet_items;
CREATE POLICY "Users can update their own change sheet items"
  ON pricing_change_sheet_items FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own change sheet items" ON pricing_change_sheet_items;
CREATE POLICY "Users can delete their own change sheet items"
  ON pricing_change_sheet_items FOR DELETE
  USING (auth.uid() = user_id);
