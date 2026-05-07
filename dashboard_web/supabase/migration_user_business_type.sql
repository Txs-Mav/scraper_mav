-- Migration: stocker le type de commerce choisi à la création du compte

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'recreational_vehicles';

UPDATE users
SET business_type = 'recreational_vehicles'
WHERE business_type IS NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_business_type_check;
ALTER TABLE users
  ADD CONSTRAINT users_business_type_check
  CHECK (
    business_type IN (
      'recreational_vehicles',
      'automotive',
      'marine',
      'sports_outdoor',
      'fashion',
      'electronics',
      'other'
    )
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_subscription_plan TEXT;
  user_business_type TEXT;
BEGIN
  user_subscription_plan := COALESCE(NEW.raw_user_meta_data->>'subscription_plan', 'free');
  user_business_type := COALESCE(NEW.raw_user_meta_data->>'business_type', 'recreational_vehicles');

  INSERT INTO public.users (id, email, name, role, subscription_plan, business_type)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', 'User'),
    'user',
    user_subscription_plan,
    user_business_type
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (
    NEW.id,
    user_subscription_plan,
    'active'
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
