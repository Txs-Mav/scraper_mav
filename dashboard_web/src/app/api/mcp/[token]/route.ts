import { NextResponse } from 'next/server'
import { createMcpHandler } from 'mcp-handler'
import { createServiceClient } from '@/lib/supabase/service'
import { hashMcpToken, isMcpTokenFormat } from '@/lib/mcp/tokens'
import { registerGodataTools, GODATA_INSTRUCTIONS } from '@/lib/mcp/godata-tools'

export const maxDuration = 60

/**
 * Endpoint MCP distant (connecteur Claude) : /api/mcp/<token>
 * Le token secret identifie le client ; toutes les lectures sont scopées à ses
 * user_ids. Lecture seule — aucun outil d'écriture n'est enregistré.
 */
async function handleMcp(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    if (!isMcpTokenFormat(token)) {
      return NextResponse.json({ error: 'Lien de connexion invalide.' }, { status: 401 })
    }

    const supabase = createServiceClient()
    const { data: row, error } = await supabase
      .from('mcp_tokens')
      .select('user_id, revoked_at')
      .eq('token_hash', hashMcpToken(token))
      .maybeSingle()

    if (error && (error as any).code === 'PGRST205') {
      return NextResponse.json(
        {
          error: 'Table mcp_tokens introuvable.',
          code: 'MCP_SCHEMA_MISSING',
          details: 'Exécutez la migration migration_mcp_tokens.sql dans Supabase SQL Editor.',
        },
        { status: 503 }
      )
    }
    if (error) {
      console.error('[MCP] Token lookup error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!row || row.revoked_at) {
      return NextResponse.json({ error: 'Lien de connexion invalide ou révoqué.' }, { status: 401 })
    }

    // Même périmètre que le dashboard : un compte principal voit aussi ses employés.
    let userIds: string[] = [row.user_id]
    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', row.user_id)
      .maybeSingle()
    if (userRow?.role === 'main') {
      const { data: employees } = await supabase
        .from('employees')
        .select('employee_id')
        .eq('main_account_id', row.user_id)
      userIds = [row.user_id, ...(employees?.map((e) => e.employee_id) || [])]
    }

    await supabase
      .from('mcp_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', row.user_id)

    const handler = createMcpHandler(
      (server) => registerGodataTools(server, { supabase, userIds }),
      {
        serverInfo: { name: 'go-data', version: '1.0.0' },
        instructions: GODATA_INSTRUCTIONS,
      }
    )
    return handler(request)
  } catch (error: any) {
    console.error('[MCP] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

export { handleMcp as GET, handleMcp as POST, handleMcp as DELETE }
