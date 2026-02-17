-- Migration: Ajouter la colonne ignore_colors à scraper_config
-- Cette colonne permet d'ignorer les couleurs lors du matching des produits
-- Date: 2026-01-31

-- Ajouter la colonne ignore_colors si elle n'existe pas
ALTER TABLE scraper_config 
ADD COLUMN IF NOT EXISTS ignore_colors BOOLEAN DEFAULT false;

-- Commentaire explicatif
COMMENT ON COLUMN scraper_config.ignore_colors IS 'Si true, ignore les couleurs lors du matching des produits (permet plus de correspondances)';
