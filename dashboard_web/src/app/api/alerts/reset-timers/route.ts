import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'

/**
 * POST /api/alerts/reset-timers
 *
 * Resets last_run_at to NULL for all active alerts belonging to the current user
 * (or all users if called with CRON_SECRET). This makes them eligible for the
 * next GitHub Actions cron run, effectively restarting the 40-min cycle.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`

  let targetUserId: string | null = null

  if (!isCronAuth) {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    targetUserId = user.id
  }

  const serviceSupabase = createServiceClient()

  let query = serviceSupabase
    .from('scraper_alerts')
    .update({ last_run_at: null })
    .eq('is_active', true)
    .not('reference_url', 'is', null)

  if (targetUserId) {
    query = query.eq('user_id', targetUserId)
  }

  const { error, count } = await query.select('id')

  if (error) {
    console.error('[Reset Timers] Erreur:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const resetCount = count ?? 0
  console.log(`[Reset Timers] ${resetCount} alerte(s) réinitialisée(s)${targetUserId ? ` pour user ${targetUserId.slice(0, 8)}` : ' (tous)'}`)

  return NextResponse.json({
    success: true,
    reset_count: resetCount,
    message: `${resetCount} alerte(s) réinitialisée(s) — le prochain cron les reprendra`,
  })
}
