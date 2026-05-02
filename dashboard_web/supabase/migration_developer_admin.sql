-- Migration : Rôle développeur + workflow de validation des scrapers
-- Date     : 2026-04-30
-- Objet    :
--   1. Ajoute le rôle 'developer' aux comptes (admin technique pour valider
--      les scrapers générés par scraper_usine avant qu'ils n'entrent en prod).
--   2. Étend shared_scrapers avec un workflow pending/approved/rejected pour
--      permettre la validation manuelle d'un scraper avant qu'il soit pris
--      en compte par le cron (scripts/scraper_cron.py).
--
-- Convention :
--   - validation_status='approved' AND is_active=true  → repris par le cron
--   - validation_status='pending'  AND is_active=false → en attente de revue
--   - validation_status='rejected'                     → écarté

-- =========================================================================
-- 1. Étendre les rôles autorisés sur la table users
-- =========================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('main', 'developer', 'employee', 'user', 'owner', 'member'));

COMMENT ON COLUMN users.role IS
    'Rôle applicatif. ''main'' = compte propriétaire/admin de Go-Data, ''developer'' = compte technique pour valider les scrapers, autres = utilisateurs finaux.';

-- =========================================================================
-- 2. Étendre shared_scrapers avec le workflow de validation
-- =========================================================================

ALTER TABLE shared_scrapers
    ADD COLUMN IF NOT EXISTS validation_status TEXT
        NOT NULL DEFAULT 'approved'
        CHECK (validation_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE shared_scrapers
    ADD COLUMN IF NOT EXISTS validation_score INTEGER;

ALTER TABLE shared_scrapers
    ADD COLUMN IF NOT EXISTS validation_grade TEXT;

ALTER TABLE shared_scrapers
    ADD COLUMN IF NOT EXISTS validation_report JSONB DEFAULT '{}'::JSONB;

ALTER TABLE shared_scrapers
    ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shared_scrapers
    ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE shared_scrapers
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE shared_scrapers
    ADD COLUMN IF NOT EXISTS submitted_by_pipeline TEXT;
COMMENT ON COLUMN shared_scrapers.submitted_by_pipeline IS
    'Identifiant de la pipeline qui a soumis ce scraper (ex: ''scraper_usine'').';

CREATE INDEX IF NOT EXISTS idx_shared_scrapers_validation_status
    ON shared_scrapers(validation_status);

-- =========================================================================
-- 3. Verrou implicite : RLS — seuls developer/main voient les pending
--    (les autres utilisateurs continuent de ne voir que is_active=true grâce
--    au filtre côté API ; on ajoute une politique stricte au cas où).
-- =========================================================================

DROP POLICY IF EXISTS "All authenticated users can view shared scrapers" ON shared_scrapers;

-- Lecture : tout le monde voit les approved/active. Les pending ne sont
-- visibles qu'aux comptes main et developer.
CREATE POLICY "Authenticated users can view approved scrapers"
  ON shared_scrapers FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      validation_status = 'approved'
      OR EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = auth.uid()
          AND u.role IN ('main', 'developer')
      )
    )
  );

-- Écriture : seuls les comptes main/developer peuvent modifier (UPDATE) les
-- enregistrements (par ex. pour approuver/rejeter). Les insertions du pipeline
-- passent par la service_role qui ignore RLS.
CREATE POLICY "Admin accounts can update shared scrapers"
  ON shared_scrapers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('main', 'developer')
    )
  );

CREATE POLICY "Admin accounts can delete shared scrapers"
  ON shared_scrapers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('main', 'developer')
    )
  );
