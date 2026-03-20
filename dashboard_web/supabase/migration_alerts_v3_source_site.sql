-- Migration v3: Ajouter source_site aux changements d'alertes
-- Permet d'identifier quel concessionnaire a changé ses prix

ALTER TABLE alert_changes
  ADD COLUMN IF NOT EXISTS source_site TEXT;

CREATE INDEX IF NOT EXISTS idx_alert_changes_source_site
  ON alert_changes(source_site) WHERE source_site IS NOT NULL;
