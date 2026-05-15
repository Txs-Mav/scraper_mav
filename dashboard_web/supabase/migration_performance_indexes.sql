-- Migration : index composites pour accélérer les requêtes fréquentes du dashboard
-- À exécuter dans l'éditeur SQL de Supabase.
--
-- Objectif : éliminer les scans de table sur les requêtes les plus fréquentes
-- (liste des scrapings, fiches de changement de prix par statut). Tous les index
-- ci-dessous sont additifs et non destructifs : aucune donnée ni colonne n'est
-- modifiée. Suppression / rollback : DROP INDEX <nom>; (voir bas du fichier).
--
-- Note : on n'utilise pas CONCURRENTLY car l'éditeur SQL Supabase exécute en
-- transaction. Sur des tables petites/moyennes, le verrou est négligeable. Si
-- les tables sont volumineuses (>100k lignes), exécutez chaque CREATE INDEX
-- ligne par ligne via une connexion psql avec autocommit.

-- ============================================================================
-- 1) Table `scrapings`
-- ============================================================================
-- Pattern principal : WHERE user_id = ? ORDER BY created_at DESC LIMIT N
-- Pattern secondaire : WHERE user_id = ? AND reference_url = ? ORDER BY created_at DESC LIMIT 1
-- (utilisé par /api/products et /api/pricing/change-sheets POST)

CREATE INDEX IF NOT EXISTS idx_scrapings_user_created_desc
  ON scrapings (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrapings_user_ref_created_desc
  ON scrapings (user_id, reference_url, created_at DESC);

-- ============================================================================
-- 2) Table `pricing_change_sheets`
-- ============================================================================
-- Pattern principal : WHERE user_id = ? [AND status = ?] ORDER BY created_at DESC
-- (utilisé par /api/pricing/change-sheets GET et la barre de navigation)

CREATE INDEX IF NOT EXISTS idx_pricing_change_sheets_user_status_created
  ON pricing_change_sheets (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_change_sheets_user_created_desc
  ON pricing_change_sheets (user_id, created_at DESC);

-- ============================================================================
-- 3) Table `pricing_change_sheet_items`
-- ============================================================================
-- Pattern : WHERE sheet_id = ? AND applied = ?
-- (utilisé par la fonction trigger sync_pricing_change_sheet_counts)

CREATE INDEX IF NOT EXISTS idx_pricing_change_sheet_items_sheet_applied
  ON pricing_change_sheet_items (sheet_id, applied);

-- ============================================================================
-- Rollback (à n'exécuter que si nécessaire)
-- ============================================================================
-- DROP INDEX IF EXISTS idx_scrapings_user_created_desc;
-- DROP INDEX IF EXISTS idx_scrapings_user_ref_created_desc;
-- DROP INDEX IF EXISTS idx_pricing_change_sheets_user_status_created;
-- DROP INDEX IF EXISTS idx_pricing_change_sheets_user_created_desc;
-- DROP INDEX IF EXISTS idx_pricing_change_sheet_items_sheet_applied;
