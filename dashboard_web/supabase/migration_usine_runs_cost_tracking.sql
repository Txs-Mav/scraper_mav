-- Migration : ajout colonnes cout Claude + mode hybride sur usine_runs
-- Date     : 2026-05-16
-- Plan     : optim-couts-claude-scraper-usine (Phase 5.3)
--
-- Ajoute le tracking de cout USD et du mode (hybrid/full_claude) pour
-- chaque run scraper_usine. Permet au dashboard /admin/usine d'afficher
-- les cartes "Cout 7j", "Cout 30j", "Cout par site moyen" et de tracer
-- combien de fois l'admin a utilise le toggle "Mode qualite max".
--
-- Backfill : les anciennes lignes auront cost_usd_total=NULL et
-- mode_used=NULL. Le dashboard les ignore proprement (NULLIF + COALESCE).

ALTER TABLE usine_runs
  ADD COLUMN IF NOT EXISTS cost_usd_total NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS cost_breakdown JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS mode_used TEXT
    CHECK (mode_used IN ('hybrid', 'full_claude'));

-- Index pour les requetes "cout sur N jours" (Phase 5.3 dashboard cards)
CREATE INDEX IF NOT EXISTS idx_usine_runs_cost_time
  ON usine_runs(started_at DESC) WHERE cost_usd_total IS NOT NULL;

COMMENT ON COLUMN usine_runs.cost_usd_total IS
  'Cout total USD du run (somme des cost_usd des events audit Claude). Phase 1.1 + 5.3 du plan optim couts.';

COMMENT ON COLUMN usine_runs.cost_breakdown IS
  'Breakdown du cout par phase {phase4_diagnose: 0.X, phase4_write: 0.Y, ...}. Permet d''analyser ou est consomme le budget Claude.';

COMMENT ON COLUMN usine_runs.mode_used IS
  'Mode de generation : hybrid (Opus diagnose + Sonnet write) ou full_claude (Opus partout). Phase 2.8 du plan.';
