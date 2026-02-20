import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * POST /api/scrapings/save
 *
 * Sauvegarde un scraping depuis le scraper Python ou le dashboard.
 * TOUJOURS INSERT (jamais update) pour garder l'historique nécessaire
 * aux alertes (comparaison entre 2 scrapings successifs).
 * Nettoyage automatique : garde les 5 derniers par (user, reference_url).
 */
export async function POST(request: Request) {
  try {
    const scrapingData = await request.json()

    if (!scrapingData.reference_url) {
      scrapingData.reference_url =
        scrapingData.site_url ||
        scrapingData.referenceUrl ||
        (scrapingData.metadata as any)?.reference_url ||
        (scrapingData.metadata as any)?.referenceUrl
    }

    if (scrapingData.execution_time_seconds != null && scrapingData.scraping_time_seconds == null) {
      scrapingData.scraping_time_seconds = scrapingData.execution_time_seconds
    }

    // ── Authentification ──
    let userId: string | null = null
    const sessionUser = await getCurrentUser()

    if (sessionUser) {
      userId = sessionUser.id
    } else if (scrapingData.user_id) {
      userId = scrapingData.user_id
    }

    if (!userId) {
      return NextResponse.json({
        success: true,
        scraping: scrapingData,
        isLocal: true,
        message: 'Scraping sauvegardé localement. Connectez-vous pour sauvegarder dans le cloud.'
      })
    }

    if (!scrapingData.reference_url) {
      return NextResponse.json(
        { error: 'reference_url is required' },
        { status: 400 }
      )
    }

    // ── Client Supabase (service role pour appels Python, sinon session) ──
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    let supabase
    if (!sessionUser && serviceRoleKey) {
      supabase = createServiceClient(supabaseUrl, serviceRoleKey)
    } else {
      supabase = await createClient()
    }

    // ── Vérifier la limite du plan (basée sur le nombre de SITES DISTINCTS) ──
    const { data: user } = await supabase
      .from('users')
      .select('subscription_plan, subscription_source, promo_code_id')
      .eq('id', userId)
      .single()

    const isPaid = user?.subscription_source === 'stripe' || user?.subscription_source === 'promo' || !!user?.promo_code_id
    const limit = isPaid ? Infinity : 6

    if (limit !== Infinity) {
      // Compter les reference_urls DISTINCTES (pas le total de lignes)
      const { data: distinctUrls } = await supabase
        .from('scrapings')
        .select('reference_url')
        .eq('user_id', userId)

      const uniqueUrls = new Set((distinctUrls || []).map(s => s.reference_url))

      // Si c'est un nouveau site et qu'on a atteint la limite
      if (!uniqueUrls.has(scrapingData.reference_url) && uniqueUrls.size >= limit) {
        return NextResponse.json(
          { error: 'Limite de 6 scrapings atteinte. Passez au plan Pro ou Ultime pour des scrapings illimités.' },
          { status: 403 }
        )
      }
    }

    // ── TOUJOURS INSERT (jamais update) pour garder l'historique ──
    const { data: result, error } = await supabase
      .from('scrapings')
      .insert({
        user_id: userId,
        reference_url: scrapingData.reference_url,
        competitor_urls: scrapingData.competitor_urls || [],
        products: scrapingData.products || [],
        metadata: scrapingData.metadata || {},
        scraping_time_seconds: scrapingData.scraping_time_seconds,
        mode: scrapingData.mode || (scrapingData.competitor_urls?.length ? 'comparison' : 'reference_only'),
      })
      .select()
      .single()

    if (error) {
      console.error('[Scrapings Save] Insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // ── Nettoyage : garder seulement les 5 derniers par (user, reference_url) ──
    try {
      await cleanupOldScrapings(supabase, userId, scrapingData.reference_url, 5)
    } catch (cleanupErr) {
      console.error('[Scrapings Save] Cleanup error (non-blocking):', cleanupErr)
    }

    return NextResponse.json({
      success: true,
      scraping: result,
    })
  } catch (error: any) {
    console.error('[Scrapings Save] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Supprime les scrapings les plus anciens pour un (user_id, reference_url),
 * en gardant seulement les N plus récents.
 */
async function cleanupOldScrapings(
  supabase: any,
  userId: string,
  referenceUrl: string,
  keepCount: number
) {
  const { data: allScrapings } = await supabase
    .from('scrapings')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('reference_url', referenceUrl)
    .order('created_at', { ascending: false })

  if (!allScrapings || allScrapings.length <= keepCount) return

  const idsToDelete = allScrapings.slice(keepCount).map((s: any) => s.id)

  if (idsToDelete.length > 0) {
    await supabase
      .from('scrapings')
      .delete()
      .in('id', idsToDelete)

    console.log(`[Scrapings Save] Nettoyage: ${idsToDelete.length} ancien(s) scraping(s) supprimé(s)`)
  }
}
