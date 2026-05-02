import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { proxyToBackend, hasBackend } from '@/lib/backend-proxy'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * POST /api/admin/cron/trigger
 *
 * Déclenche manuellement le cron de scraping (équivalent du cron horaire
 * Vercel) via le backend FastAPI. Réservé aux comptes admin/dev.
 */
export async function POST() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  if (!hasBackend()) {
    return NextResponse.json(
      {
        error: 'Backend de scraping non configuré',
        hint: 'Définir BACKEND_URL et BACKEND_SECRET côté Vercel pour activer le déclenchement manuel.',
      },
      { status: 503 },
    )
  }

  try {
    const res = await proxyToBackend('/cron/scrape', { method: 'POST', timeout: 15_000 })
    const data = await res.json().catch(() => ({ error: 'Réponse backend invalide' }))
    return NextResponse.json(data, { status: res.ok ? 202 : res.status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backend indisponible' }, { status: 502 })
  }
}
