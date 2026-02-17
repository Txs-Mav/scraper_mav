-- Migration: Ajouter subscription_source pour distinguer paiement Stripe vs code promo
-- Un plan pro/ultime n'est "confirmé" que si source = 'stripe' ou 'promo'

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'subscription_source'
  ) THEN
    ALTER TABLE users ADD COLUMN subscription_source TEXT 
      CHECK (subscription_source IS NULL OR subscription_source IN ('stripe', 'promo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_subscription_source 
  ON users(subscription_source) WHERE subscription_source IS NOT NULL;

-- Migrer les utilisateurs existants : promo_code_id = promo, plan pro/ultime sans promo = stripe
UPDATE users
SET subscription_source = CASE
  WHEN promo_code_id IS NOT NULL THEN 'promo'
  WHEN subscription_plan IN ('pro', 'ultime') THEN 'stripe'
  ELSE NULL
END
WHERE subscription_source IS NULL AND (promo_code_id IS NOT NULL OR subscription_plan IN ('pro', 'ultime'));
