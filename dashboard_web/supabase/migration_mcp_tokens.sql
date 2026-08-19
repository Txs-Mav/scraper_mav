-- Migration: Tokens de connexion MCP (connecteur Claude)
-- Permet à chaque client de générer un lien secret pour connecter Claude (claude.ai)
-- à ses données Go-Data en lecture seule via le protocole MCP.
-- Le token n'est jamais stocké en clair : seul son hash SHA-256 est conservé.

-- 1. Table des tokens (un token actif par utilisateur)
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,

  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user_id ON mcp_tokens(user_id);

-- 2. Trigger updated_at
DROP TRIGGER IF EXISTS update_mcp_tokens_updated_at ON mcp_tokens;
CREATE TRIGGER update_mcp_tokens_updated_at
  BEFORE UPDATE ON mcp_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. RLS (l'endpoint MCP lit via service role ; le dashboard via la session utilisateur)
ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own mcp token" ON mcp_tokens;
CREATE POLICY "Users can view their own mcp token"
  ON mcp_tokens FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own mcp token" ON mcp_tokens;
CREATE POLICY "Users can insert their own mcp token"
  ON mcp_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own mcp token" ON mcp_tokens;
CREATE POLICY "Users can update their own mcp token"
  ON mcp_tokens FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own mcp token" ON mcp_tokens;
CREATE POLICY "Users can delete their own mcp token"
  ON mcp_tokens FOR DELETE
  USING (auth.uid() = user_id);
