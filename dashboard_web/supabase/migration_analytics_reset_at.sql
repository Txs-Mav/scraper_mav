-- Migration : ajouter un "point de reset" pour la page Analyse, sans
-- toucher à l'historique des scrapings (qui alimente le rapport et doit
-- s'accumuler dans le temps).
--
-- Sémantique :
--   * `users.analytics_reset_at` (nullable) marque une borne temporelle.
--   * `/api/analytics` ignore les scrapings dont `created_at <= analytics_reset_at`.
--   * `/api/reports` ignore cette borne et utilise tout l'historique.
--   * Le bouton « Réinitialiser » côté Analyse fait simplement
--     `UPDATE users SET analytics_reset_at = NOW() WHERE id = auth.uid()`.
--     C'est instantané et non destructif.
--
-- À exécuter dans l'éditeur SQL de Supabase. Additif et non destructif.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS analytics_reset_at TIMESTAMP WITH TIME ZONE NULL;

COMMENT ON COLUMN users.analytics_reset_at IS
  'Borne temporelle utilisée par la page Analyse pour ignorer les scrapings antérieurs. NULL = pas de borne (comportement par défaut). Ne pas confondre avec une suppression : l''historique reste intact pour la page Rapport.';

-- ============================================================================
-- Rollback (à n'exécuter que si nécessaire)
-- ============================================================================
-- ALTER TABLE users DROP COLUMN IF EXISTS analytics_reset_at;
