import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasBackend, proxyToBackend } from '@/lib/backend-proxy'

/**
 * POST /api/products/analyze
 *
 * Comparaison rapide depuis les données pré-scrapées (scraped_site_data).
 * Le cron GitHub Actions scrape tous les sites toutes les 30 min.
 * Cet endpoint proxie vers le backend Railway qui exécute compare_from_cache.py (~2-5s).
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const userId = user.id

    if (!hasBackend()) {
      return NextResponse.json({
        success: false,
        error: 'no_backend',
        message: 'Backend non disponible. Configurez BACKEND_URL.',
      }, { status: 503 })
    }

    const backendRes = await proxyToBackend('/products/analyze', {
      body: { userId },
      timeout: 120_000,
    })
    const data = await backendRes.json()
    return NextResponse.json(data, { status: backendRes.status })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[analyze] Error:', message)
    return NextResponse.json(
      { error: 'internal_error', message },
      { status: 500 }
    )
  }
}
