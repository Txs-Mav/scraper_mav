-- Migration: Ajout de filter_catalogue_reference sur scraper_config et scraper_alerts
-- Date: 2026-03-19
-- Description: Permet de filtrer les produits catalogue du site de reference
--              lors de la comparaison d'alertes. Les concurrents gardent TOUS
--              leurs produits (catalogue + inventaire).

-- 1. Colonne sur scraper_config (setting utilisateur)
ALTER TABLE scraper_config
  ADD COLUMN IF NOT EXISTS filter_catalogue_reference BOOLEAN DEFAULT TRUE;

-- 2. Colonne sur scraper_alerts (synchronisee depuis scraper_config)
ALTER TABLE scraper_alerts
  ADD COLUMN IF NOT EXISTS filter_catalogue_reference BOOLEAN DEFAULT TRUE;

-- Mettre a jour les alertes existantes (activer par defaut)
UPDATE scraper_alerts
  SET filter_catalogue_reference = TRUE
  WHERE filter_catalogue_reference IS NULL;
