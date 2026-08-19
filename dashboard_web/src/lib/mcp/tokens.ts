import { createHash, randomBytes } from 'node:crypto'

export const MCP_TOKEN_PREFIX = 'gdmcp_'

/** Génère un token secret opaque, retourné en clair une seule fois à la création. */
export function generateMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`
}

/** Seul le hash est stocké en base — un dump de la table ne permet pas de se connecter. */
export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Aperçu non sensible affiché dans les paramètres (ex: "gdmcp_a1b2c3…"). */
export function mcpTokenPreview(token: string): string {
  return `${token.slice(0, MCP_TOKEN_PREFIX.length + 6)}…`
}

export function isMcpTokenFormat(value: string): boolean {
  return /^gdmcp_[A-Za-z0-9_-]{20,80}$/.test(value)
}

export function mcpConnectorUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/mcp/${token}`
}
