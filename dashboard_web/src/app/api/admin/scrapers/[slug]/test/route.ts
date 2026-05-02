import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { proxyToBackend, hasBackend } from '@/lib/backend-proxy'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * POST /api/admin/scrapers/[slug]/test
 *
 * Lance un test live d'un scraper en pending via le backend FastAPI
 * (Railway). Renvoie un échantillon de produits pour que l'admin puisse
 * vérifier la qualité avant d'approuver.
 *
 * Body (optionnel) :
 *   { sampleLimit?: number, categories?: string[] }
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ slug: string }> }
) {
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
        hint: 'Définir BACKEND_URL et BACKEND_SECRET côté Vercel pour activer le test live.',
      },
      { status: 503 },
    )
  }

  const { slug } = await context.params

  let sampleLimit = 10
  let categories: string[] | undefined
  try {
    const body = await req.json()
    if (typeof body?.sampleLimit === 'number') {
      sampleLimit = Math.max(1, Math.min(50, Math.floor(body.sampleLimit)))
    }
    if (Array.isArray(body?.categories)) {
      categories = body.categories.filter((c: unknown) => typeof c === 'string')
    }
  } catch {
    // body optionnel
  }

  try {
    const response = await proxyToBackend('/scrapers-pending/test', {
      method: 'POST',
      body: { slug, sampleLimit, categories },
      timeout: 5 * 60_000, // 5 min
    })

    const text = await response.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      // payload textuel — on le renvoie tel quel
    }

    return NextResponse.json(payload, { status: response.status })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Erreur backend' },
      { status: 502 },
    )
  }
}
