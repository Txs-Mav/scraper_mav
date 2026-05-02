-- Migration : Normaliser les rôles applicatifs
-- Date     : 2026-05-01
-- Objet    :
--   La politique d'autorisation pour la console développeur (/admin) est passée
--   du rôle Postgres (`users.role`) vers une vérification par email contre
--   `DEV_ADMIN_EMAIL` (.env). Cette migration corrige les données existantes :
--
--   1. Tous les comptes actuellement en `role='main'` (héritage avant la
--      politique dev-by-email) sont rétrogradés en `role='user'`, SAUF :
--        a) le compte dont l'email correspond à dev@go-data.ca (rôle 'developer')
--        b) les comptes ayant déjà le rôle 'employee' ou 'member' (logique métier
--           "manager d'équipe" — préservée)
--
--   2. Le compte dev@go-data.ca est forcé à `role='developer'`.
--
--   3. Trigger BEFORE UPDATE pour empêcher qu'un user devienne 'main' ou
--      'developer' via PostgREST sans passer par la service_role (script
--      `scripts/create_developer.py` ou SQL Editor).
--
-- ⚠️  ADAPTATION REQUISE :
--   Si l'email du compte dev a été changé dans .env (DEV_ADMIN_EMAIL), modifie
--   la valeur de la constante ci-dessous AVANT d'exécuter la migration.

-- =========================================================================
-- 0. Email du compte dev (à synchroniser avec DEV_ADMIN_EMAIL du .env)
-- =========================================================================

DO $$
DECLARE
    dev_email TEXT := 'dev@go-data.ca';
    nb_demoted INTEGER;
    nb_promoted INTEGER;
BEGIN

    -- =====================================================================
    -- 1. Rétrograder tous les 'main' qui ne sont pas le dev admin
    -- =====================================================================

    UPDATE users
    SET role = 'user',
        updated_at = NOW()
    WHERE role = 'main'
      AND LOWER(email) <> LOWER(dev_email);

    GET DIAGNOSTICS nb_demoted = ROW_COUNT;
    RAISE NOTICE '[normalize_admin_role] % compte(s) rétrogradés de main → user', nb_demoted;

    -- =====================================================================
    -- 2. Forcer le compte dev à role='developer'
    -- =====================================================================

    UPDATE users
    SET role = 'developer',
        updated_at = NOW()
    WHERE LOWER(email) = LOWER(dev_email)
      AND role <> 'developer';

    GET DIAGNOSTICS nb_promoted = ROW_COUNT;
    IF nb_promoted > 0 THEN
        RAISE NOTICE '[normalize_admin_role] Compte % promu en role=developer', dev_email;
    ELSE
        RAISE NOTICE '[normalize_admin_role] Compte % déjà au rôle developer (ou inexistant)', dev_email;
    END IF;

END;
$$;

-- =========================================================================
-- 3. Trigger : empêcher un user d'être promu 'main' ou 'developer' sans
--    passer par la service_role (qui bypass RLS et les triggers SECURITY
--    DEFINER ne sont pas appliqués au service_role).
-- =========================================================================

CREATE OR REPLACE FUNCTION protect_admin_role_changes()
RETURNS TRIGGER AS $$
DECLARE
    is_service_role BOOLEAN;
BEGIN
    -- Le service_role bypass RLS mais passe quand même par les triggers
    -- BEFORE UPDATE — on l'identifie via le claim role du JWT courant.
    is_service_role := COALESCE(
        current_setting('request.jwt.claims', TRUE)::jsonb ->> 'role',
        ''
    ) = 'service_role';

    IF is_service_role THEN
        RETURN NEW;
    END IF;

    -- Bloquer toute promotion vers 'main' ou 'developer' depuis l'API client.
    IF NEW.role IN ('main', 'developer') AND OLD.role NOT IN ('main', 'developer') THEN
        RAISE EXCEPTION 'Promotion vers le rôle ''%'' interdite via l''API client. Utilise scripts/create_developer.py.', NEW.role
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_admin_role_changes ON users;
CREATE TRIGGER protect_admin_role_changes
    BEFORE UPDATE OF role ON users
    FOR EACH ROW
    EXECUTE FUNCTION protect_admin_role_changes();

-- =========================================================================
-- 4. Audit : afficher l'état des rôles après migration
-- =========================================================================

DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '─── Distribution des rôles après migration ───';
    FOR rec IN
        SELECT role, COUNT(*) AS n
        FROM users
        GROUP BY role
        ORDER BY role
    LOOP
        RAISE NOTICE '  % : % compte(s)', rec.role, rec.n;
    END LOOP;
END;
$$;
