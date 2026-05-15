-- Migration : permettre plusieurs business_type stockés en CSV
--
-- Contexte : users.business_type est un TEXT avec un CHECK strict sur une
-- liste fermée de 7 valeurs. On veut maintenant pouvoir cocher plusieurs
-- domaines à la fois sur /dashboard/recherche (modal d'onboarding). Le code
-- côté Next.js sérialise la sélection en CSV : "fashion,electronics".
--
-- On garde la même colonne (pas de schéma cassé), mais on remplace le CHECK
-- par un regex qui valide :
--   - chaîne vide acceptée (NULL aussi)
--   - chaîne CSV non-vide où chaque token est l'un des 7 business_type valides
--
-- Helpers de parsing/sérialisation : dashboard_web/src/lib/account-navigation.ts
--   - parseBusinessTypes(raw)    → BusinessType[]
--   - serializeBusinessTypes(arr) → "fashion,electronics"

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_business_type_check;

-- POSIX regex (~) :
--   ^ V (,V)* $
-- où V = (recreational_vehicles|automotive|marine|sports_outdoor|fashion|electronics|other)
ALTER TABLE users
  ADD CONSTRAINT users_business_type_check
  CHECK (
    business_type IS NULL
    OR business_type = ''
    OR business_type ~ '^(recreational_vehicles|automotive|marine|sports_outdoor|fashion|electronics|other)(,(recreational_vehicles|automotive|marine|sports_outdoor|fashion|electronics|other))*$'
  );

-- Vérification rapide (no-op si tout est OK, lève une erreur si une ligne
-- existante viole déjà la nouvelle contrainte) :
DO $$
DECLARE
  violation_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO violation_count
  FROM users
  WHERE business_type IS NOT NULL
    AND business_type <> ''
    AND business_type !~ '^(recreational_vehicles|automotive|marine|sports_outdoor|fashion|electronics|other)(,(recreational_vehicles|automotive|marine|sports_outdoor|fashion|electronics|other))*$';

  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Migration impossible : % ligne(s) avec business_type invalide. Inspecte avec : SELECT id, email, business_type FROM users WHERE business_type !~ ''^...''', violation_count;
  END IF;
END$$;
