-- Migration pour ajouter le champ pending_plan à la table users
-- À exécuter dans l'éditeur SQL de Supabase

-- Ajouter le champ pending_plan pour stocker le plan choisi lors de la création
-- Ce champ est utilisé pour rediriger vers Stripe après la confirmation de l'email
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'pending_plan'
  ) THEN
    ALTER TABLE users ADD COLUMN pending_plan TEXT CHECK (pending_plan IN ('pro', 'ultime'));
  END IF;
END $$;

-- Index pour les requêtes sur pending_plan
CREATE INDEX IF NOT EXISTS idx_users_pending_plan ON users(pending_plan) WHERE pending_plan IS NOT NULL;
