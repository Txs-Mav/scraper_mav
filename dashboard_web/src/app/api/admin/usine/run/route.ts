import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { proxyToBackend, hasBackend } from '@/lib/backend-proxy'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * POST /api/admin/usine/run
 *
 * Lance scraper_usine sur une URL pour générer un nouveau scraper dédié.
 * Le scraper généré atterrit en pending dans /admin/scrapers.
 *
 * Body : { url: string, dryRun?: boolean, forcePlaywright?: boolean, publishThreshold?: number }
 */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }
  if (!hasBackend()) {
    return NextResponse.json(
      { error: 'Backend non configuré (BACKEND_URL/BACKEND_SECRET)' },
      { status: 503 },
    )
  }

  let body: any = {}
  try { body = await req.json() } catch { /* body optionnel */ }

  const url = (body?.url || '').toString().trim()
  if (!url) {
    return NextResponse.json({ error: 'URL requise' }, { status: 400 })
  }

  try {
    const res = await proxyToBackend('/scraper-usine/run', {
      method: 'POST',
      body: {
        url,
        dryRun: !!body?.dryRun,
        forcePlaywright: !!body?.forcePlaywright,
        publishThreshold: typeof body?.publishThreshold === 'number' ? body.publishThreshold : 95,
      },
      timeout: 30_000,
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backend indisponible' }, { status: 502 })
  }
}
