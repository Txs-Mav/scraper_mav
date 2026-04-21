-- Migration: Canaux de notification multi-plateformes (email, SMS, Slack)
-- Permet à chaque utilisateur de configurer ses canaux préférés pour recevoir
-- les alertes Go-Data.

-- 1. Table de configuration des canaux par utilisateur
CREATE TABLE IF NOT EXISTS user_notification_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- EMAIL
  email_enabled BOOLEAN DEFAULT true,
  email_address TEXT,

  -- SMS (via Twilio côté serveur)
  sms_enabled BOOLEAN DEFAULT false,
  sms_phone TEXT,
  sms_verified BOOLEAN DEFAULT false,

  -- SLACK (Incoming Webhook)
  slack_enabled BOOLEAN DEFAULT false,
  slack_webhook_url TEXT,
  slack_channel TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notification_channels_user_id
  ON user_notification_channels(user_id);

-- 2. Ajouter les toggles par alerte (complément du email_notification existant)
-- Defaults à TRUE pour que la configuration principale reste au niveau utilisateur
-- (une alerte envoie sur tous les canaux activés par l'utilisateur, sauf override explicite).
ALTER TABLE scraper_alerts
  ADD COLUMN IF NOT EXISTS sms_notification BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS slack_notification BOOLEAN DEFAULT true;

-- 3. Trigger updated_at
DROP TRIGGER IF EXISTS update_user_notification_channels_updated_at
  ON user_notification_channels;
CREATE TRIGGER update_user_notification_channels_updated_at
  BEFORE UPDATE ON user_notification_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. RLS
ALTER TABLE user_notification_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notification channels"
  ON user_notification_channels;
CREATE POLICY "Users can view their own notification channels"
  ON user_notification_channels FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own notification channels"
  ON user_notification_channels;
CREATE POLICY "Users can insert their own notification channels"
  ON user_notification_channels FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notification channels"
  ON user_notification_channels;
CREATE POLICY "Users can update their own notification channels"
  ON user_notification_channels FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own notification channels"
  ON user_notification_channels;
CREATE POLICY "Users can delete their own notification channels"
  ON user_notification_channels FOR DELETE
  USING (auth.uid() = user_id);

-- 5. Backfill : créer un enregistrement par utilisateur existant avec email
INSERT INTO user_notification_channels (user_id, email_enabled, email_address)
SELECT u.id, true, u.email
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_notification_channels unc WHERE unc.user_id = u.id
);
