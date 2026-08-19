import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { generateMcpToken, hashMcpToken, mcpTokenPreview, mcpConnectorUrl } from '@/lib/mcp/tokens'

function appOrigin(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
}

function schemaMissingResponse() {
  return NextResponse.json(
    {
      error: 'Table mcp_tokens introuvable.',
      code: 'MCP_SCHEMA_MISSING',
      details: 'Exécutez la migration migration_mcp_tokens.sql dans Supabase SQL Editor.',
    },
    { status: 503 }
  )
}

/**
 * GET /api/mcp/tokens
 * État du lien de connexion Claude de l'utilisateur courant (jamais le token en clair).
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('mcp_tokens')
      .select('token_prefix, created_at, last_used_at, revoked_at')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error && (error as any).code === 'PGRST205') return schemaMissingResponse()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ token: data || null })
  } catch (error: any) {
    console.error('[McpTokens GET] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * POST /api/mcp/tokens
 * Génère (ou régénère) le lien de connexion. Le token en clair n'est retourné
 * qu'ici, une seule fois — seul son hash est stocké.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const supabase = await createClient()
    const token = generateMcpToken()
    const fields = {
      token_hash: hashMcpToken(token),
      token_prefix: mcpTokenPreview(token),
      last_used_at: null,
      revoked_at: null,
    }

    const { data: existing, error: readError } = await supabase
      .from('mcp_tokens')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (readError && (readError as any).code === 'PGRST205') return schemaMissingResponse()
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })

    if (existing) {
      const { error } = await supabase.from('mcp_tokens').update(fields).eq('user_id', user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await supabase.from('mcp_tokens').insert({ user_id: user.id, ...fields })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      url: mcpConnectorUrl(token, appOrigin(request)),
      token_prefix: fields.token_prefix,
    })
  } catch (error: any) {
    console.error('[McpTokens POST] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * DELETE /api/mcp/tokens
 * Révoque le lien de connexion (le connecteur Claude cesse de fonctionner).
 */
export async function DELETE() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const supabase = await createClient()
    const { error } = await supabase
      .from('mcp_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user.id)

    if (error && (error as any).code === 'PGRST205') return schemaMissingResponse()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[McpTokens DELETE] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
