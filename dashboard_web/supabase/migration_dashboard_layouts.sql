-- Migration: Table dashboard_layouts pour stocker les layouts configurables
-- Date: 2026-03-17
-- Description: Persistance par utilisateur et par page des widgets et de leur disposition

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_key TEXT NOT NULL,
  layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled_widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, page_key),
  CONSTRAINT dashboard_layouts_page_key_check CHECK (page_key IN ('main', 'analytics'))
);

CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_user_page
  ON dashboard_layouts(user_id, page_key);

ALTER TABLE dashboard_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dashboard layouts" ON dashboard_layouts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own dashboard layouts" ON dashboard_layouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own dashboard layouts" ON dashboard_layouts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own dashboard layouts" ON dashboard_layouts
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_dashboard_layouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_dashboard_layouts_updated_at ON dashboard_layouts;
CREATE TRIGGER trigger_dashboard_layouts_updated_at
  BEFORE UPDATE ON dashboard_layouts
  FOR EACH ROW
  EXECUTE FUNCTION update_dashboard_layouts_updated_at();

COMMENT ON TABLE dashboard_layouts IS 'Layouts configurables du dashboard par utilisateur et par page';
COMMENT ON COLUMN dashboard_layouts.page_key IS 'Page ciblée: main ou analytics';
COMMENT ON COLUMN dashboard_layouts.layout IS 'Disposition de la grille des widgets';
COMMENT ON COLUMN dashboard_layouts.enabled_widgets IS 'Liste des widgets visibles pour la page';
