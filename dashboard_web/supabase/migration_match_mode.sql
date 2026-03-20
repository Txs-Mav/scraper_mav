-- Migration: Ajouter la colonne match_mode à scraper_config
-- Modes: exact, base, no_year, flexible
-- Date: 2026-03-20

ALTER TABLE scraper_config
ADD COLUMN IF NOT EXISTS match_mode TEXT DEFAULT 'exact';

COMMENT ON COLUMN scraper_config.match_mode IS 'Mode de matching: exact (défaut), base (sans suffixes), no_year (toutes années), flexible (sans suffixes ni année)';
