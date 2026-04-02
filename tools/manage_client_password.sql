-- =============================================================
-- Fonctions SQL a deployer UNE SEULE FOIS dans Supabase
-- Va dans : Supabase Dashboard > SQL Editor > New Query
-- Colle ce contenu et execute-le.
-- =============================================================

-- Fonction pour lire le mot de passe chiffre d'un utilisateur
CREATE OR REPLACE FUNCTION admin_get_encrypted_password(target_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  pwd TEXT;
BEGIN
  SELECT encrypted_password INTO pwd
  FROM auth.users
  WHERE id = target_user_id;

  IF pwd IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non trouve: %', target_user_id;
  END IF;

  RETURN pwd;
END;
$$;

-- Fonction pour restaurer le mot de passe chiffre d'un utilisateur
CREATE OR REPLACE FUNCTION admin_set_encrypted_password(target_user_id UUID, new_encrypted_password TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  UPDATE auth.users
  SET encrypted_password = new_encrypted_password,
      updated_at = NOW()
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilisateur non trouve: %', target_user_id;
  END IF;
END;
$$;

-- Revoquer l'acces public (seul le service_role pourra appeler ces fonctions)
REVOKE ALL ON FUNCTION admin_get_encrypted_password(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_encrypted_password(UUID, TEXT) FROM PUBLIC;
