import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { canAccessAnalytics } from '@/lib/plan-restrictions'

/**
 * Réinitialise l'historique de scrapings de l'utilisateur — action
 * destructive et irréversible. Le Rapport repart de zéro.
 *
 * Cette route est volontairement séparée de `/api/analytics/reset` qui,
 * elle, ne fait que repositionner une borne temporelle (non destructive).
 *
 * Stratégie d'implémentation :
 *   - Service-role direct : l'identité est déjà vérifiée par
 *     `getCurrentUser()`, et le DELETE reste strictement filtré par
 *     `user_id`. RLS peut être lent sur des JSONB volumineux.
 *   - Suppression par batchs (`BATCH_SIZE`) pour éviter qu'un unique
 *     gros DELETE ne fasse exploser le timeout serveur quand la colonne
 *     `products` (JSONB) est volumineuse.
 *   - On efface aussi `users.analytics_reset_at` (devient inutile une
 *     fois l'historique vidé).
 */

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const BATCH_SIZE = 25
const MAX_BATCHES = 200 // garde-fou : 5 000 scrapings par appel

export async function POST() {
  let userId: string | null = null
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 },
      )
    }
    userId = user.id

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
      console.error('[reports/reset] service-role init failed:', detail)
      return NextResponse.json(
        { error: 'Configuration serveur incomplète', details: detail },
        { status: 500 },
      )
    }

    let totalDeleted = 0

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const { data: ids, error: selectError } = await service
        .from('scrapings')
        .select('id')
        .eq('user_id', user.id)
        .limit(BATCH_SIZE)

      if (selectError) {
        console.error('[reports/reset] select error:', {
          userId,
          code: selectError.code,
          message: selectError.message,
          details: selectError.details,
          hint: selectError.hint,
        })
        return NextResponse.json(
          {
            error: 'Erreur lors de la lecture des données à supprimer',
            code: selectError.code,
            details: selectError.message,
            hint: selectError.hint,
            partial: totalDeleted,
          },
          { status: 500 },
        )
      }

      if (!ids || ids.length === 0) break

      const idList = ids.map((row) => row.id)
      const { error: deleteError, count } = await service
        .from('scrapings')
        .delete({ count: 'exact' })
        .in('id', idList)
        .eq('user_id', user.id)

      if (deleteError) {
        console.error('[reports/reset] delete error:', {
          userId,
          batch,
          batchSize: idList.length,
          totalDeleted,
          code: deleteError.code,
          message: deleteError.message,
          details: deleteError.details,
          hint: deleteError.hint,
        })
        return NextResponse.json(
          {
            error: 'Erreur lors de la suppression des données',
            code: deleteError.code,
            details: deleteError.message,
            hint: deleteError.hint,
            partial: totalDeleted,
          },
          { status: 500 },
        )
      }

      totalDeleted += count ?? idList.length

      if (idList.length < BATCH_SIZE) break
    }

    // L'historique est vidé : la borne analytics_reset_at n'a plus de
    // raison d'être. On la remet à NULL pour repartir proprement.
    const { error: clearBoundError } = await service
      .from('users')
      .update({ analytics_reset_at: null })
      .eq('id', user.id)
    if (clearBoundError) {
      // Non bloquant : on log et on continue.
      console.warn('[reports/reset] clear analytics_reset_at failed:', {
        userId,
        code: clearBoundError.code,
        message: clearBoundError.message,
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Historique du Rapport réinitialisé',
      deleted: totalDeleted,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[reports/reset] exception:', { userId, message, error })
    return NextResponse.json(
      { error: 'Erreur interne', details: message },
      { status: 500 },
    )
  }
}
