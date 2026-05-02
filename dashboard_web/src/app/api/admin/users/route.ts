import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * GET /api/admin/users
 *
 * Liste les utilisateurs avec un récap d'activité réelle :
 *   - dernière connexion (Supabase Auth)
 *   - dernière action utilisateur (table user_activity, filtrée pour exclure
 *     les heartbeats et session_end qui sont automatiques)
 *   - dernière page visitée
 *   - nombre de comparaisons (scrapings) — sans la pollution des cron jobs
 *   - nombre d'alertes actives
 *
 * NB : la table `scrapings` contient aussi des entrées créées par
 * `scripts/scraper_cron.py` et l'alert_cron, donc on ne s'en sert PAS pour
 * mesurer l'activité utilisateur. On utilise uniquement `user_activity` qui
 * track les vrais événements UI.
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

  // user_activity : on ne garde que les events qui prouvent une présence
  // active de l'utilisateur (pas heartbeat / session_end). On agrège ça
  // côté Node parce qu'on a besoin du MAX par user_id et qu'il y a peu
  // de users (< 1000).
  const ACTIVE_EVENTS = ['page_view', 'session_start', 'scrape_start', 'scrape_complete']

  const [usersRes, alertsRes, scrapingsRes, activityRes, authUsersRes] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, email, role, subscription_plan, subscription_source, created_at, updated_at, avatar_url')
      .order('created_at', { ascending: false }),
    supabase.from('scraper_alerts').select('id, user_id, is_active, created_at'),
    supabase
      .from('scrapings')
      .select('user_id, created_at, reference_url')
      .order('created_at', { ascending: false }),
    supabase
      .from('user_activity')
      .select('user_id, event_type, page, created_at')
      .in('event_type', ACTIVE_EVENTS)
      .order('created_at', { ascending: false })
      .limit(5000),
    // Liste les users dans auth.users pour récupérer last_sign_in_at.
    // listUsers paginate par 1000 max ; on prend la première page (suffit
    // tant qu'il y a < 1000 users, sinon on fera plusieurs pages).
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  if (usersRes.error) {
    return NextResponse.json({ error: usersRes.error.message }, { status: 500 })
  }

  const alerts = alertsRes.data || []
  const scrapings = scrapingsRes.data || []
  const activity = activityRes.data || []
  const authUsersById: Record<string, any> = {}
  for (const au of authUsersRes.data?.users || []) {
    authUsersById[au.id] = au
  }

  // Indexes pour éviter le O(n²)
  const lastActivityByUser: Record<string, { created_at: string; page: string | null }> = {}
  for (const a of activity) {
    if (!lastActivityByUser[a.user_id]) {
      lastActivityByUser[a.user_id] = { created_at: a.created_at, page: a.page }
    }
  }

  const users = (usersRes.data || []).map((u: any) => {
    const userAlerts = alerts.filter((a: any) => a.user_id === u.id)
    const userScrapings = scrapings.filter((s: any) => s.user_id === u.id)
    const lastScraping = userScrapings[0]
    const lastActivity = lastActivityByUser[u.id] || null
    const authUser = authUsersById[u.id]
    return {
      ...u,
      alerts_total: userAlerts.length,
      alerts_active: userAlerts.filter((a: any) => a.is_active).length,
      scrapings_total: userScrapings.length,
      last_scraping_at: lastScraping?.created_at || null,
      last_reference_url: lastScraping?.reference_url || null,
      // Vraie dernière activité dans l'UI
      last_activity_at: lastActivity?.created_at || null,
      last_activity_page: lastActivity?.page || null,
      // Dernière connexion (Supabase Auth)
      last_sign_in_at: authUser?.last_sign_in_at || null,
      email_confirmed_at: authUser?.email_confirmed_at || null,
    }
  })

  return NextResponse.json({ users, count: users.length })
}
