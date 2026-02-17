-- Script SQL pour révoquer automatiquement les codes promo désactivés
-- À exécuter manuellement ou via un cron job pour rétrograder les utilisateurs
-- dont le code promo a été désactivé

-- Rétrograder tous les utilisateurs dont le code promo a été désactivé
UPDATE users
SET 
  subscription_plan = 'standard',
  promo_code_id = NULL
WHERE promo_code_id IN (
  SELECT id 
  FROM promo_codes 
  WHERE is_active = false
);

-- Mettre à jour les subscriptions correspondantes
UPDATE subscriptions
SET 
  plan = 'standard',
  status = 'active'
WHERE user_id IN (
  SELECT id 
  FROM users 
  WHERE promo_code_id IN (
    SELECT id 
    FROM promo_codes 
    WHERE is_active = false
  )
);

-- Afficher les utilisateurs affectés (pour information)
SELECT 
  u.id,
  u.email,
  u.name,
  u.subscription_plan,
  pc.code as promo_code,
  pc.is_active as promo_active
FROM users u
LEFT JOIN promo_codes pc ON u.promo_code_id = pc.id
WHERE pc.is_active = false OR (u.promo_code_id IS NOT NULL AND pc.id IS NULL);
