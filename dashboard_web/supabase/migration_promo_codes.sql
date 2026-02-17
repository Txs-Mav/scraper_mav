-- Migration pour ajouter le système de codes promo
-- À exécuter dans l'éditeur SQL de Supabase

-- 1. Créer la table promo_codes
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  max_uses INTEGER, -- NULL = illimité
  current_uses INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deactivated_at TIMESTAMP WITH TIME ZONE
);

-- 2. Ajouter le champ promo_code_id à la table users
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'promo_code_id'
  ) THEN
    ALTER TABLE users ADD COLUMN promo_code_id UUID REFERENCES promo_codes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Créer les index
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_is_active ON promo_codes(is_active);
CREATE INDEX IF NOT EXISTS idx_users_promo_code_id ON users(promo_code_id);

-- 4. Créer le trigger pour updated_at
CREATE TRIGGER update_promo_codes_updated_at BEFORE UPDATE ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Insérer 15 codes promo
INSERT INTO promo_codes (code, description, is_active, max_uses) VALUES
  ('PROMO2024-1A2B3C', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-4D5E6F', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-7G8H9I', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-JK1L2M', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-3N4O5P', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-6Q7R8S', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-9T0U1V', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-W2X3Y4Z', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-5A6B7C', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-8D9E0F', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-1G2H3I', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-4J5K6L', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-7M8N9O', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-0P1Q2R', 'Code promo premium gratuit à vie', true, NULL),
  ('PROMO2024-3S4T5U', 'Code promo premium gratuit à vie', true, NULL)
ON CONFLICT (code) DO NOTHING;
