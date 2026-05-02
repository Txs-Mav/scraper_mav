import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { proxyToBackend, hasBackend } from '@/lib/backend-proxy'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * GET /api/admin/usine/logs?jobId=xxx&lastLine=N
 *
 * Récupère les logs en streaming d'un job scraper_usine.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!isDevAdminUser(user)) return NextResponse.json({ error: 'Accès réservé' }, { status: 403 })
  if (!hasBackend()) return NextResponse.json({ error: 'Backend non configuré' }, { status: 503 })

  const url = new URL(req.url)
  const jobId = url.searchParams.get('jobId')
  const lastLine = url.searchParams.get('lastLine') || '0'
  if (!jobId) return NextResponse.json({ error: 'jobId requis' }, { status: 400 })

  try {
    const res = await proxyToBackend('/scraper/logs', {
      method: 'GET',
      params: { jobId, lastLine },
      timeout: 15_000,
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backend indisponible' }, { status: 502 })
  }
}
