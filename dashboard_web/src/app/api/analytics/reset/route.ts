import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { canAccessAnalytics } from '@/lib/plan-restrictions'

/**
 * « Réinitialiser » la page Analyse : on ne supprime PAS l'historique des
 * scrapings (le rapport en dépend et doit s'accumuler dans le temps).
 *
 * À la place, on positionne une borne `users.analytics_reset_at = NOW()`
 * que l'API analytics utilise comme filtre :
 *   - les scrapings <= cette borne sont ignorés côté Analyse ;
 *   - le rapport ignore cette borne et conserve tout l'historique.
 *
 * Action quasi-instantanée (un seul UPDATE), donc plus aucun timeout.
 */

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 },
      )
    }

    const effectiveSource =
      user.subscription_source ||
      (user.promo_code_id ? ('promo' as const) : null)
    if (
      !canAccessAnalytics(
        user.subscription_plan ?? 'standard',
        effectiveSource,
      )
    ) {
      return NextResponse.json(
        { error: 'Accès réservé aux plans Pro et Ultime' },
        { status: 403 },
      )
    }

    let service
    try {
      service = createServiceClient()
    } catch (initError: unknown) {
      const detail =
        initError instanceof Error ? initError.message : 'Service indisponible'
      console.error('[analytics/reset] service-role init failed:', detail)
      return NextResponse.json(
        { error: 'Configuration serveur incomplète', details: detail },
        { status: 500 },
      )
    }

    const resetAt = new Date().toISOString()
    const { error: updateError } = await service
      .from('users')
      .update({ analytics_reset_at: resetAt })
      .eq('id', user.id)

    if (updateError) {
      console.error('[analytics/reset] update error:', {
        userId: user.id,
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      })
      return NextResponse.json(
        {
          error: 'Erreur lors de la réinitialisation',
          code: updateError.code,
          details: updateError.message,
          hint: updateError.hint,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      message:
        "Page Analyse réinitialisée. L'historique du Rapport est conservé.",
      analytics_reset_at: resetAt,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[analytics/reset] exception:', { message, error })
    return NextResponse.json(
      { error: 'Erreur interne', details: message },
      { status: 500 },
    )
  }
}
