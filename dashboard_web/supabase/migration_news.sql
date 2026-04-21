-- Migration : Feed "Nouvelles" (annonces produit) + suivi de lecture par utilisateur
-- Permet de publier des annonces (modal au login + feed dans Aide & Support)
-- et de garder la trace des utilisateurs qui ont cliqué "Compris".

-- 1. Table des nouvelles
CREATE TABLE IF NOT EXISTS news (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body_md TEXT NOT NULL,
  show_in_modal BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT true,
  published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_published
  ON news(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_modal
  ON news(show_in_modal, is_published, published_at DESC);

-- 2. Table de suivi "lu / compris" par utilisateur
CREATE TABLE IF NOT EXISTS user_news_reads (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  news_id UUID NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, news_id)
);

CREATE INDEX IF NOT EXISTS idx_user_news_reads_user
  ON user_news_reads(user_id);

-- 3. Trigger updated_at sur news
DROP TRIGGER IF EXISTS update_news_updated_at ON news;
CREATE TRIGGER update_news_updated_at
  BEFORE UPDATE ON news
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. RLS : news
ALTER TABLE news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read published news" ON news;
CREATE POLICY "Authenticated users can read published news"
  ON news FOR SELECT
  USING (
    is_published = true
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'main'
    )
  );

DROP POLICY IF EXISTS "Main accounts can insert news" ON news;
CREATE POLICY "Main accounts can insert news"
  ON news FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'main'
    )
  );

DROP POLICY IF EXISTS "Main accounts can update news" ON news;
CREATE POLICY "Main accounts can update news"
  ON news FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'main'
    )
  );

DROP POLICY IF EXISTS "Main accounts can delete news" ON news;
CREATE POLICY "Main accounts can delete news"
  ON news FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'main'
    )
  );

-- 5. RLS : user_news_reads
ALTER TABLE user_news_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own news reads" ON user_news_reads;
CREATE POLICY "Users can view their own news reads"
  ON user_news_reads FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own news reads" ON user_news_reads;
CREATE POLICY "Users can insert their own news reads"
  ON user_news_reads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own news reads" ON user_news_reads;
CREATE POLICY "Users can delete their own news reads"
  ON user_news_reads FOR DELETE
  USING (auth.uid() = user_id);

-- 6. Seed : première annonce "Nouveautés Go-Data"
INSERT INTO news (slug, title, summary, body_md, show_in_modal, is_published)
VALUES (
  'nouveautes-go-data-v1',
  'Nouveautés Go-Data',
  'Canaux d''alertes multi-plateformes, fréquence d''actualisation et tendances par concession.',
  E'Bonjour,\n\nMerci d''être à bord de Go-Data. Voici les trois nouveautés que je viens de déployer pour vous faire gagner du temps au quotidien :\n\n### 1. Canaux d''alertes — Email, Slack et SMS (bientôt)\n\nRecevez désormais les **modifications de prix** par **email**, **Slack** ou **SMS** (SMS en cours de finalisation). Activez et testez chaque canal depuis **Paramètres → Canaux d''alertes**.\n\n### 2. Fréquence d''actualisation des alertes\n\nDans la page **Alertes**, vous pouvez maintenant choisir **à quelle fréquence** vos données sont actualisées (quotidien, intervalle en heures ou en minutes). Plus besoin d''attendre : configurez le rythme qui convient à votre concession.\n\n### 3. Tendances par concession (top nav)\n\nLe petit **chevron** à côté de *Tableau de bord* ouvre maintenant un menu avec **Comparaisons** et **Surveillance de marché** — idéal pour suivre les tendances site par site.\n\n---\n\n**À venir :** un feed complet des nouvelles fonctionnalités. Vous le retrouverez dès maintenant dans **Aide & Support → Nouvelles** en bas à gauche.\n\nSi vous avez la moindre question, écrivez-moi à gestion@go-data.co.\n\n— **Maverick Menard**, fondateur Go-Data',
  true,
  true
)
ON CONFLICT (slug) DO NOTHING;
