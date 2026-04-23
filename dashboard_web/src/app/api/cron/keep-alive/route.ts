/**
 * Cron keep-alive Supabase.
 *
 * Pourquoi : sur le plan Free, un projet Supabase est automatiquement
 * mis en pause après ~7 jours sans activité. Ce endpoint pingue la DB
 * et le service Auth quotidiennement pour garantir que le projet reste
 * actif même quand aucun utilisateur ne se connecte.
 *
 * Il sert aussi de sonde de disponibilité : si un des services ne
 * répond pas, le cron retourne une 503 que Vercel loggera.
 *
 * Déclenché par Vercel Cron (voir vercel.json).
 * Protégé par Authorization: Bearer ${CRON_SECRET}.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const AUTH_TIMEOUT_MS = 10_000
const DB_TIMEOUT_MS = 10_000

type CheckResult = {
  ok: boolean
  latency_ms: number
  error?: string
}

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))

    if (error) {
      return { ok: false, latency_ms: Date.now() - start, error: error.message }
    }
    return { ok: true, latency_ms: Date.now() - start }
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkAuth(): Promise<CheckResult> {
  const start = Date.now()
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !apikey) {
    return { ok: false, latency_ms: 0, error: 'Missing Supabase env vars' }
  }

  try {
    const response = await fetch(url, {
      headers: { apikey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      cache: 'no-store',
    })
    const latency = Date.now() - start
    if (!response.ok) {
      return { ok: false, latency_ms: latency, error: `HTTP ${response.status}` }
    }
    return { ok: true, latency_ms: latency }
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[Keep-Alive] CRON_SECRET non configuré — endpoint non sécurisé en production')
  }

  const [db, auth] = await Promise.all([checkDatabase(), checkAuth()])
  const ok = db.ok && auth.ok

  const payload = {
    ok,
    timestamp: new Date().toISOString(),
    checks: { database: db, auth },
  }

  if (!ok) {
    console.error('[Keep-Alive] Supabase dégradé', payload)
    return NextResponse.json(payload, { status: 503 })
  }

  console.log('[Keep-Alive] OK', {
    db_ms: db.latency_ms,
    auth_ms: auth.latency_ms,
  })
  return NextResponse.json(payload)
}
