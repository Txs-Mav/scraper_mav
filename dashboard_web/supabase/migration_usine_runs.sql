-- Migration : tables d'exécution + apprentissage de scraper_usine
-- Date     : 2026-05-16
-- Plan     : usine-bench-cron-lessons (Phase 1 + Phase 2)
--
-- Quatre tables séparées (split par cycle de vie) + une vue admin agrégée :
--   1. usine_queue        -- URLs à usiner (admin soumet, cron consomme)
--   2. usine_runs         -- historique persistant des runs (manuel + cron)
--   3. usine_healthchecks -- surveillance régulière des scrapers approuvés
--   4. usine_lessons      -- diffs de corrections Claude pour améliorer
--                            les templates au fil du temps
--
-- Convention :
--   - Toutes les écritures passent par le service_role (backend FastAPI ou
--     GitHub Action). Les UI lisent via auth.uid() avec un rôle main/developer.
--   - On suit la même convention de rôles que migration_developer_admin.sql
--     (role IN ('main','developer')).
--   - Les insertions du pipeline Python utilisent SUPABASE_SERVICE_ROLE_KEY
--     et bypassent RLS.

-- =========================================================================
-- 1. usine_queue — URLs en attente
-- =========================================================================

CREATE TABLE IF NOT EXISTS usine_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 5,        -- 1=haute, 9=basse
  options JSONB NOT NULL DEFAULT '{}'::JSONB, -- { dryRun, forcePlaywright, publishThreshold, profile }

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed','cancelled')),

  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  last_error TEXT,

  picked_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usine_queue_status_priority
  ON usine_queue(status, priority, created_at);

-- Empêche les doublons actifs pour une même URL (deux pending pour le même
-- site n'a pas de sens) — partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usine_queue_url_active
  ON usine_queue(url)
  WHERE status IN ('pending','running');

COMMENT ON TABLE usine_queue IS
    'File d''URLs en attente d''usinage par scraper_usine. Le cron 2h dépile, le backend FastAPI peut aussi pousser des entrées via /admin/usine/queue.';

-- =========================================================================
-- 2. usine_runs — historique persistant des runs
-- =========================================================================

CREATE TABLE IF NOT EXISTS usine_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  queue_id UUID REFERENCES usine_queue(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  slug TEXT,                                  -- rempli après Phase 3 (generator)

  trigger TEXT NOT NULL                       -- manual | cron | retry | backfill
    CHECK (trigger IN ('manual','cron','retry','backfill')),

  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  duration_ms INTEGER,

  status TEXT                                 -- success | partial | failed | timeout
    CHECK (status IN ('success','partial','failed','timeout')),

  validation_score NUMERIC(5,2),
  validation_grade TEXT,
  platform TEXT,                              -- ex: shopify, powergo_nextjs, edealer
  base_class TEXT,                            -- ex: DedicatedScraper, MotoplexScraper

  claude_supervisor_used BOOLEAN DEFAULT FALSE,
  claude_agent_used BOOLEAN DEFAULT FALSE,

  total_products INTEGER,
  published BOOLEAN DEFAULT FALSE,
  shared_scraper_id UUID REFERENCES shared_scrapers(id) ON DELETE SET NULL,

  log_excerpt TEXT,                           -- ~8000 derniers chars stdout/stderr
  artifact_paths JSONB DEFAULT '{}'::JSONB,   -- { analysis, strategy, report, audit, trace }

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usine_runs_slug_time
  ON usine_runs(slug, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_usine_runs_status_time
  ON usine_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_usine_runs_trigger_time
  ON usine_runs(trigger, started_at DESC);

COMMENT ON TABLE usine_runs IS
    'Historique persistant de chaque run scraper_usine. Remplace les jobs en RAM côté backend/main.py — les logs survivent aux redéploiements.';

-- =========================================================================
-- 3. usine_healthchecks — surveillance des scrapers approuvés
-- =========================================================================

CREATE TABLE IF NOT EXISTS usine_healthchecks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  slug TEXT NOT NULL,
  ran_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  score NUMERIC(5,2),
  grade TEXT,
  duration_ms INTEGER,
  products_found INTEGER,

  -- variation par rapport au healthcheck précédent du même slug
  delta_vs_previous NUMERIC(5,2),

  -- true si chute > 15 points (déclenche une alerte côté cron)
  alerting BOOLEAN NOT NULL DEFAULT FALSE,

  error TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usine_healthchecks_slug_time
  ON usine_healthchecks(slug, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_usine_healthchecks_alerting
  ON usine_healthchecks(alerting, ran_at DESC)
  WHERE alerting = TRUE;

COMMENT ON TABLE usine_healthchecks IS
    'Mesure du score (--check) à chaque tick du cron 2h pour chaque scraper approuvé. delta_vs_previous < -15 => alerting=true + email admin.';

-- =========================================================================
-- 4. usine_lessons — capture des corrections Claude
-- =========================================================================
--
-- Insérée par les hooks dans claude_supervisor.py et claude_agent.py à chaque
-- correction réussie. Permet d'agréger mensuellement (scripts/usine_lessons_report.py)
-- les patterns d'erreurs récurrents et de proposer des modifications de
-- templates (blocks/*.j2) ou de recettes (platforms.py).
--
-- Le champ error_signature normalise le symptôme pour qu'on puisse compter
-- les occurrences (ex: "missing_field:price|platform:shopify").

CREATE TABLE IF NOT EXISTS usine_lessons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  slug TEXT,
  url TEXT,
  platform TEXT,
  phase TEXT NOT NULL                         -- supervisor_initial | auto_correct | agent_fallback
    CHECK (phase IN ('supervisor_initial','auto_correct','agent_fallback','agent_tool_fix')),

  error_signature TEXT NOT NULL,              -- ex: missing_field:price|platform:shopify
  field_fixed TEXT,                           -- price | name | year | images | url | ...

  before_code TEXT,                           -- snapshot avant correction (peut être truncated)
  after_code TEXT,                            -- snapshot après correction
  diff TEXT,                                  -- unified diff

  claude_rationale TEXT,                      -- extrait de la réponse Claude expliquant le why
  tokens_used INTEGER,
  iterations INTEGER,

  -- workflow d'amélioration continue : true quand le template a été mis à jour
  -- pour empêcher le pattern de se reproduire. Marqué via l'UI admin.
  applied_to_template BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at TIMESTAMP WITH TIME ZONE,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_usine_lessons_signature_platform
  ON usine_lessons(error_signature, platform);
CREATE INDEX IF NOT EXISTS idx_usine_lessons_created_at
  ON usine_lessons(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usine_lessons_unapplied
  ON usine_lessons(created_at DESC)
  WHERE applied_to_template = FALSE;

COMMENT ON TABLE usine_lessons IS
    'Capture des corrections Claude pour améliorer scraper_usine au fil du temps. Source pour scripts/usine_lessons_report.py et l''onglet /admin/usine?tab=lessons.';

-- =========================================================================
-- 5. Vue admin agrégée — usine_dashboard_v
-- =========================================================================

CREATE OR REPLACE VIEW usine_dashboard_v AS
SELECT
    s.id                                 AS shared_scraper_id,
    s.site_slug                          AS slug,
    s.site_name,
    s.site_domain,
    s.validation_status,
    s.validation_score                   AS approval_score,
    -- latest healthcheck
    (
      SELECT h.score FROM usine_healthchecks h
      WHERE h.slug = s.site_slug
      ORDER BY h.ran_at DESC LIMIT 1
    )                                    AS latest_score,
    (
      SELECT h.ran_at FROM usine_healthchecks h
      WHERE h.slug = s.site_slug
      ORDER BY h.ran_at DESC LIMIT 1
    )                                    AS latest_healthcheck_at,
    -- comptes 7 jours
    (
      SELECT COUNT(*) FROM usine_runs r
      WHERE r.slug = s.site_slug
        AND r.status = 'failed'
        AND r.started_at > NOW() - INTERVAL '7 days'
    )                                    AS failures_7d,
    (
      SELECT COUNT(*) FROM usine_runs r
      WHERE r.slug = s.site_slug
        AND r.started_at > NOW() - INTERVAL '7 days'
    )                                    AS runs_7d,
    -- leçons en attente
    (
      SELECT COUNT(*) FROM usine_lessons l
      WHERE l.slug = s.site_slug
        AND l.applied_to_template = FALSE
    )                                    AS pending_lessons,
    -- alerte active ?
    EXISTS(
      SELECT 1 FROM usine_healthchecks h
      WHERE h.slug = s.site_slug
        AND h.alerting = TRUE
        AND h.ran_at > NOW() - INTERVAL '24 hours'
    )                                    AS has_active_alert
FROM shared_scrapers s
WHERE s.validation_status = 'approved';

COMMENT ON VIEW usine_dashboard_v IS
    'Agrégation pour l''onglet santé de /admin/usine — score latest, failures 7d, leçons pending, alertes actives.';

-- =========================================================================
-- 6. RLS — lecture restreinte aux comptes main/developer
-- =========================================================================
--
-- Tous ces objets sont des outils d'admin technique. Les utilisateurs finaux
-- ne doivent voir ni la queue ni les runs. Les écritures passent par le
-- service_role (qui bypass RLS), donc on n'écrit pas de policy WRITE.

ALTER TABLE usine_queue        ENABLE ROW LEVEL SECURITY;
ALTER TABLE usine_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE usine_healthchecks ENABLE ROW LEVEL SECURITY;
ALTER TABLE usine_lessons      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can read usine_queue"        ON usine_queue;
DROP POLICY IF EXISTS "Admin can read usine_runs"         ON usine_runs;
DROP POLICY IF EXISTS "Admin can read usine_healthchecks" ON usine_healthchecks;
DROP POLICY IF EXISTS "Admin can read usine_lessons"      ON usine_lessons;
DROP POLICY IF EXISTS "Admin can update usine_lessons"    ON usine_lessons;
DROP POLICY IF EXISTS "Admin can update usine_queue"      ON usine_queue;

CREATE POLICY "Admin can read usine_queue"
  ON usine_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('main','developer')
    )
  );

CREATE POLICY "Admin can update usine_queue"
  ON usine_queue FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('main','developer')
    )
  );

CREATE POLICY "Admin can read usine_runs"
  ON usine_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('main','developer')
    )
  );

CREATE POLICY "Admin can read usine_healthchecks"
  ON usine_healthchecks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('main','developer')
    )
  );

CREATE POLICY "Admin can read usine_lessons"
  ON usine_lessons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('main','developer')
    )
  );

-- "Marquer corrigé" sur l'UI : un admin peut modifier applied_*
CREATE POLICY "Admin can update usine_lessons"
  ON usine_lessons FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('main','developer')
    )
  );

-- =========================================================================
-- 7. Trigger updated_at sur usine_queue (les autres tables sont append-only)
-- =========================================================================

CREATE OR REPLACE FUNCTION _update_usine_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_usine_queue_updated_at ON usine_queue;
CREATE TRIGGER trg_usine_queue_updated_at
  BEFORE UPDATE ON usine_queue
  FOR EACH ROW EXECUTE FUNCTION _update_usine_queue_updated_at();
