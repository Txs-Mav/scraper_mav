-- =====================================================
-- Réactivation MVM Moto Sport + DB Moto dans le cron 2h
-- =====================================================
-- Date: 2026-05-07
-- Contexte: Les deux sites ont migré vers PowerGO/Next.js.
--   Les scrapers dédiés (scraper_ai/dedicated_scrapers/{mvm_motosport,db_moto}.py)
--   ont été réécrits pour parser le sitemap inventory-detail.xml.
--   Cette migration s'assure qu'ils sont marqués actifs dans
--   shared_scrapers et qu'ils ne sont plus cachés dans scraped_site_data
--   (flag temporarily_hidden posé par d'éventuels échecs précédents).
--
-- Effet: à partir du prochain run de scraper-cron.yml (toutes les 2h),
--   ces deux scrapers sont à nouveau pris en charge par scripts/scraper_cron.py.

-- 1. Réactivation dans shared_scrapers
UPDATE shared_scrapers
SET
  is_active = TRUE,
  last_verified_at = NOW(),
  updated_at = NOW()
WHERE site_slug IN ('mvm-motosport', 'db-moto');

-- 2. Retirer temporarily_hidden de scraped_site_data si présent
UPDATE scraped_site_data
SET
  metadata = COALESCE(metadata, '{}'::jsonb)
            || jsonb_build_object('temporarily_hidden', false),
  updated_at = NOW()
WHERE site_domain IN ('mvmmotosport.com', 'dbmoto.ca')
  AND COALESCE((metadata ->> 'temporarily_hidden')::boolean, false) = true;
