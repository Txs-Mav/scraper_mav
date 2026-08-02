import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * GET /api/admin/promo-codes
 *
 * Vue « campagnes » : chaque code magique avec la liste des comptes créés
 * via ce code et leur activité réelle :
 *   - dernière connexion (Supabase Auth) + email confirmé ou non
 *   - nombre de sessions (user_activity.session_start) — utile pour suivre
 *     une campagne flyers/QR où plusieurs concessionnaires s'inscrivent
 *   - dernière activité UI et nombre de comparaisons
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  const supabase = createServiceClient()

  const [codesRes, usersRes, activityRes, scrapingsRes, authUsersRes] = await Promise.all([
    supabase
      .from('promo_codes')
      .select('id, code, description, is_active, max_uses, current_uses, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('users')
      .select('id, name, email, subscription_plan, promo_code_id, created_at')
      .not('promo_code_id', 'is', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('user_activity')
      .select('user_id, event_type, created_at')
      .in('event_type', ['session_start', 'page_view'])
      .order('created_at', { ascending: false })
      .limit(10000),
    supabase.from('scrapings').select('user_id'),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  if (codesRes.error) {
    return NextResponse.json({ error: codesRes.error.message }, { status: 500 })
  }

  const promoUsers = usersRes.data || []
  const activity = activityRes.data || []
  const scrapings = scrapingsRes.data || []

  const authUsersById: Record<string, any> = {}
  for (const au of authUsersRes.data?.users || []) {
    authUsersById[au.id] = au
  }

  const sessionsByUser: Record<string, number> = {}
  const lastActivityByUser: Record<string, string> = {}
  for (const a of activity) {
    if (!lastActivityByUser[a.user_id]) lastActivityByUser[a.user_id] = a.created_at
    if (a.event_type === 'session_start') {
      sessionsByUser[a.user_id] = (sessionsByUser[a.user_id] || 0) + 1
    }
  }

  const scrapingsByUser: Record<string, number> = {}
  for (const s of scrapings) {
    scrapingsByUser[s.user_id] = (scrapingsByUser[s.user_id] || 0) + 1
  }

  const codes = (codesRes.data || []).map((c: any) => {
    const users = promoUsers
      .filter((u: any) => u.promo_code_id === c.id)
      .map((u: any) => {
        const authUser = authUsersById[u.id]
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          subscription_plan: u.subscription_plan,
          created_at: u.created_at,
          email_confirmed_at: authUser?.email_confirmed_at || null,
          last_sign_in_at: authUser?.last_sign_in_at || null,
          last_activity_at: lastActivityByUser[u.id] || null,
          sessions_total: sessionsByUser[u.id] || 0,
          scrapings_total: scrapingsByUser[u.id] || 0,
        }
      })
    return { ...c, users, users_count: users.length }
  })

  return NextResponse.json({ codes })
}
