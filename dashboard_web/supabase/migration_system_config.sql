-- Migration : Stockage centralisé de la configuration système (cookies FB,
--             URLs/credentials de proxies pour les adapters de recherche
--             fédérée). Géré exclusivement par la console développeur
--             (/admin/search-sources).
--
-- Date     : 2026-05-13
--
-- Rationale :
--   Les adapters Python (Facebook Marketplace, Walmart, Best Buy, AutoTrader,
--   Kijiji, LesPAC) lisent leurs secrets via os.getenv(). Plutôt que d'éditer
--   le .env à la main sur chaque déploiement, on stocke ces valeurs en DB.
--   Le bridge Next.js → Python (/api/product-search/route.ts) lit la table
--   et injecte les valeurs comme variables d'environnement dans le subprocess.
--
-- Sécurité :
--   - RLS : seuls les comptes dev (email = DEV_ADMIN_EMAIL) peuvent lire/écrire.
--   - Les valeurs avec is_secret=true ne sont jamais renvoyées en clair par
--     l'API GET (toujours masquées en "****").
--   - L'écriture passe par la service_role (qui ignore RLS) ; un check
--     applicatif vérifie l'email avant de modifier.

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT TRUE,
  last_test_at TIMESTAMP WITH TIME ZONE,
  last_test_status TEXT CHECK (last_test_status IN ('success', 'error', 'never')),
  last_test_error TEXT,
  last_test_duration_seconds FLOAT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE system_config IS
  'Configuration système globale (cookies, proxies) pour les adapters de recherche fédérée. Géré via /admin/search-sources.';
COMMENT ON COLUMN system_config.key IS
  'Identifiant unique (ex: FB_COOKIES_JSON, WALMART_PROXY_URL). Doit appartenir au whitelist côté API.';
COMMENT ON COLUMN system_config.is_secret IS
  'Si TRUE, la valeur n''est jamais renvoyée en clair par l''API GET (masquée en ****).';
COMMENT ON COLUMN system_config.last_test_status IS
  'Résultat du dernier test de connexion via /api/admin/search-sources/test.';

CREATE INDEX IF NOT EXISTS idx_system_config_updated_at
  ON system_config(updated_at DESC);

-- =========================================================================
-- RLS : table 100% restreinte aux comptes dev admin
-- =========================================================================

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Aucun client (anon / authenticated) ne doit pouvoir lire directement la table :
-- la lecture passe exclusivement par l'API qui filtre/masque les secrets.
-- En conséquence on ne crée AUCUNE policy SELECT côté authenticated.
-- La service_role utilisée par l'API bypasse RLS de toute façon.

-- Pour éviter qu'un client puisse jamais insérer/modifier directement, on ne
-- crée AUCUNE policy d'écriture non plus. Seule la service_role peut écrire.

-- =========================================================================
-- Seed : les clés attendues sont créées vides pour qu'elles apparaissent
--        dans l'UI admin même avant la première sauvegarde.
-- =========================================================================

INSERT INTO system_config (key, value, is_secret, last_test_status) VALUES
  -- Facebook Marketplace
  ('FB_COOKIES_JSON',       NULL, TRUE,  'never'),
  ('FB_PROXY_URL',          NULL, FALSE, 'never'),
  ('FB_PROXY_USERNAME',     NULL, FALSE, 'never'),
  ('FB_PROXY_PASSWORD',     NULL, TRUE,  'never'),
  -- Walmart
  ('WALMART_PROXY_URL',     NULL, FALSE, 'never'),
  ('WALMART_PROXY_USERNAME',NULL, FALSE, 'never'),
  ('WALMART_PROXY_PASSWORD',NULL, TRUE,  'never'),
  -- Best Buy
  ('BESTBUY_PROXY_URL',     NULL, FALSE, 'never'),
  ('BESTBUY_PROXY_USERNAME',NULL, FALSE, 'never'),
  ('BESTBUY_PROXY_PASSWORD',NULL, TRUE,  'never'),
  -- AutoTrader
  ('AUTOTRADER_PROXY_URL',     NULL, FALSE, 'never'),
  ('AUTOTRADER_PROXY_USERNAME',NULL, FALSE, 'never'),
  ('AUTOTRADER_PROXY_PASSWORD',NULL, TRUE,  'never'),
  -- Kijiji
  ('KIJIJI_PROXY_URL',     NULL, FALSE, 'never'),
  ('KIJIJI_PROXY_USERNAME',NULL, FALSE, 'never'),
  ('KIJIJI_PROXY_PASSWORD',NULL, TRUE,  'never'),
  -- LesPAC
  ('LESPAC_PROXY_URL',     NULL, FALSE, 'never'),
  ('LESPAC_PROXY_USERNAME',NULL, FALSE, 'never'),
  ('LESPAC_PROXY_PASSWORD',NULL, TRUE,  'never')
ON CONFLICT (key) DO NOTHING;
