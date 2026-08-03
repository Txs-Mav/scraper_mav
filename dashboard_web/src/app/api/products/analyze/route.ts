import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeFromCache } from '@/lib/analyze-from-cache'

export const maxDuration = 30

/**
 * POST /api/products/analyze
 *
 * Comparaison rapide depuis les données pré-scrapées (scraped_site_data).
 * Exécute le matching directement via Supabase (~2-5s).
 */
export async function POST(request: Request) {
  try {
    const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' as const : 'fr' as const
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const result = await analyzeFromCache(user.id, locale)

    if (!result.ok) {
      const status = result.error === 'no_config' || result.error === 'no_reference_cache' ? 404 : 500
      return NextResponse.json(
        { success: false, error: result.error, message: result.message },
        { status }
      )
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      source: 'direct_supabase_with_comparison',
      stats: result.stats,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[analyze] Error:', message)
    return NextResponse.json(
      { error: 'internal_error', message },
      { status: 500 }
    )
  }
}
