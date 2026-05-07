-- Migration : Verrouiller users.email côté client
-- Date     : 2026-05-07
-- Objet    :
--   Le contrôle d'accès /admin gate sur l'email Supabase Auth (auth.users.email)
--   comparé à DEV_ADMIN_EMAIL. Mais le code helper `getCurrentUser()` lit aussi
--   public.users — et certaines RLS legacy permettent à un user de modifier
--   son propre `email` dans cette table. Si quelqu'un changeait son email
--   applicatif vers DEV_ADMIN_EMAIL, il pourrait, dans une version antérieure
--   du code, tromper le contrôle d'accès.
--
--   Cette migration ajoute une 2e couche de défense :
--     1. Un trigger BEFORE UPDATE qui empêche tout client (anon/authenticated)
--        de modifier la colonne `email` dans public.users. Seule la
--        service_role peut le faire (pour les scripts admin).
--     2. Synchronisation : le trigger AFTER INSERT sur auth.users (s'il
--        existe déjà via Supabase) met à jour public.users.email. On
--        s'assure ici que public.users.email reste cohérent en lecture.

-- =========================================================================
-- 1. Trigger : interdire la modification de public.users.email côté client
-- =========================================================================

CREATE OR REPLACE FUNCTION protect_user_email_changes()
RETURNS TRIGGER AS $$
DECLARE
    is_service_role BOOLEAN;
BEGIN
    -- service_role bypass : on l'identifie via le claim role du JWT courant.
    is_service_role := COALESCE(
        current_setting('request.jwt.claims', TRUE)::jsonb ->> 'role',
        ''
    ) = 'service_role';

    IF is_service_role THEN
        RETURN NEW;
    END IF;

    -- Bloquer toute modification de l'email côté client.
    IF NEW.email IS DISTINCT FROM OLD.email THEN
        RAISE EXCEPTION 'Modification de users.email interdite via l''API client. Passez par Supabase Auth (updateUser) ou la service_role.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_user_email_changes ON users;
CREATE TRIGGER protect_user_email_changes
    BEFORE UPDATE OF email ON users
    FOR EACH ROW
    EXECUTE FUNCTION protect_user_email_changes();

COMMENT ON FUNCTION protect_user_email_changes() IS
    'Empêche un utilisateur authentifié de modifier sa propre colonne email '
    'dans public.users via l''API client. Seul le service_role peut '
    'effectuer ce changement (scripts admin, sync depuis auth.users).';

-- =========================================================================
-- 2. Audit : signaler les éventuelles divergences entre auth.users et
--    public.users (utile après l'incident de mai 2026).
-- =========================================================================

DO $$
DECLARE
    nb_divergent INTEGER;
BEGIN
    SELECT COUNT(*) INTO nb_divergent
    FROM public.users pu
    JOIN auth.users au ON au.id = pu.id
    WHERE LOWER(pu.email) <> LOWER(au.email);

    IF nb_divergent > 0 THEN
        RAISE WARNING '[lock_user_email] % compte(s) ont un public.users.email DIFFÉRENT de auth.users.email — investigue !', nb_divergent;
    ELSE
        RAISE NOTICE '[lock_user_email] Tous les emails sont synchronisés.';
    END IF;
END;
$$;
