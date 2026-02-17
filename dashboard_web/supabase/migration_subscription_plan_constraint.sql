-- Migration: Mettre à jour la contrainte subscription_plan pour inclure 'pro' et 'ultime'

-- Supprimer l'ancienne contrainte
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_subscription_plan_check;

-- Ajouter la nouvelle contrainte avec les bonnes valeurs
ALTER TABLE users ADD CONSTRAINT users_subscription_plan_check 
  CHECK (subscription_plan IS NULL OR subscription_plan IN ('free', 'standard', 'pro', 'ultime', 'premium'));

-- Mettre à jour les anciens plans 'premium' vers 'ultime' si nécessaire
UPDATE users SET subscription_plan = 'ultime' WHERE subscription_plan = 'premium';

-- Faire de même pour la table subscriptions
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check 
  CHECK (plan IN ('free', 'standard', 'pro', 'ultime', 'premium'));

-- Mettre à jour les anciens plans dans subscriptions
UPDATE subscriptions SET plan = 'ultime' WHERE plan = 'premium';
