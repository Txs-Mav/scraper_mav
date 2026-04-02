-- ============================================================
-- Migration: user_activity — tracking d'activité utilisateurs
-- ============================================================
--
-- Requêtes admin utiles :
--
-- Dernière activité par utilisateur :
--   SELECT ua.user_id, u.name, u.email, MAX(ua.created_at) AS last_seen
--   FROM user_activity ua JOIN users u ON u.id = ua.user_id
--   GROUP BY ua.user_id, u.name, u.email ORDER BY last_seen DESC;
--
-- Durée de session moyenne par utilisateur :
--   SELECT ua.user_id, u.name, COUNT(*) AS sessions,
--          ROUND(AVG(ua.duration_seconds)/60.0, 1) AS avg_min
--   FROM user_activity ua JOIN users u ON u.id = ua.user_id
--   WHERE ua.event_type = 'session_end' AND ua.duration_seconds > 0
--   GROUP BY ua.user_id, u.name ORDER BY avg_min DESC;
--
-- Pages les plus visitées :
--   SELECT page, COUNT(*) AS views
--   FROM user_activity WHERE event_type = 'page_view'
--   GROUP BY page ORDER BY views DESC;
--
-- Utilisateurs actifs aujourd'hui :
--   SELECT DISTINCT ua.user_id, u.name, u.email
--   FROM user_activity ua JOIN users u ON u.id = ua.user_id
--   WHERE ua.created_at > NOW() - INTERVAL '24 hours';
--
-- Historique complet d'un utilisateur :
--   SELECT event_type, page, duration_seconds, metadata, created_at
--   FROM user_activity WHERE user_id = '<UUID>'
--   ORDER BY created_at DESC LIMIT 50;
--
-- Scrapings par utilisateur (derniers 7 jours) :
--   SELECT ua.user_id, u.name,
--          COUNT(*) FILTER (WHERE ua.event_type = 'scrape_start') AS scrapes,
--          ROUND(AVG((ua.metadata->>'elapsed_seconds')::numeric), 0) AS avg_sec
--   FROM user_activity ua JOIN users u ON u.id = ua.user_id
--   WHERE ua.event_type IN ('scrape_start','scrape_complete')
--     AND ua.created_at > NOW() - INTERVAL '7 days'
--   GROUP BY ua.user_id, u.name ORDER BY scrapes DESC;
--
-- ============================================================

CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  page TEXT,
  session_id TEXT,
  duration_seconds INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_event ON user_activity(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_session ON user_activity(session_id) WHERE session_id IS NOT NULL;

-- No RLS policies — access via service role only (API route uses service client)
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

-- Auto-cleanup: keep only last 90 days (run periodically or via pg_cron)
-- DELETE FROM user_activity WHERE created_at < NOW() - INTERVAL '90 days';
