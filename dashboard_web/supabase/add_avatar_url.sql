-- Script pour ajouter la colonne avatar_url à la table users
-- À exécuter dans l'éditeur SQL de Supabase

-- Ajouter le champ avatar_url à la table users (si pas déjà présent)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'avatar_url'
  ) THEN
    ALTER TABLE users ADD COLUMN avatar_url TEXT;
    RAISE NOTICE 'Colonne avatar_url ajoutée avec succès';
  ELSE
    RAISE NOTICE 'Colonne avatar_url existe déjà';
  END IF;
END $$;

-- Vérifier que la colonne a été ajoutée
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'avatar_url';

