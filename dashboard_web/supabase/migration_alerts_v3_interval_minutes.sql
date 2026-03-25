-- Migration v3: Support des intervalles en minutes (ex: 40 min)
-- Permet des fréquences de scraping sub-horaires.
-- Rétrocompatible : schedule_interval_minutes a priorité sur schedule_interval_hours.

-- 1. Ajouter la colonne schedule_interval_minutes
ALTER TABLE scraper_alerts
  ADD COLUMN IF NOT EXISTS schedule_interval_minutes INTEGER;

-- 2. Migrer les données existantes : convertir hours → minutes
UPDATE scraper_alerts
SET schedule_interval_minutes = schedule_interval_hours * 60
WHERE schedule_type = 'interval'
  AND schedule_interval_hours IS NOT NULL
  AND schedule_interval_minutes IS NULL;

-- 3. Mettre le défaut à 40 minutes pour les alertes interval sans valeur
UPDATE scraper_alerts
SET schedule_interval_minutes = 40
WHERE schedule_type = 'interval'
  AND schedule_interval_minutes IS NULL;

-- 4. Ajouter une contrainte CHECK sur les valeurs acceptées
ALTER TABLE scraper_alerts
  ADD CONSTRAINT check_schedule_interval_minutes
  CHECK (
    schedule_interval_minutes IS NULL
    OR schedule_interval_minutes IN (20, 30, 40, 60, 120, 240, 360, 720, 1440)
  );

-- 5. Index pour le filtrage par interval minutes
CREATE INDEX IF NOT EXISTS idx_scraper_alerts_interval_minutes
  ON scraper_alerts(schedule_interval_minutes) WHERE schedule_type = 'interval';
