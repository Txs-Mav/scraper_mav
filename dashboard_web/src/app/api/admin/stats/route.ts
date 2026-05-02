import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * GET /api/admin/stats
 *
 * Renvoie un snapshot pour la page d'accueil de la console développeur :
 *   - compteurs scrapers (pending / approved / rejected / actifs)
 *   - dernier run du cron horaire (depuis scraped_site_data)
 *   - nb sites en erreur / temporairement cachés
 *   - compteurs utilisateurs par plan / rôle
 *   - dernières alertes / comparaisons
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  // Bypass RLS — voir /api/admin/users pour le raisonnement.
  const supabase = createServiceClient()

  const [scrapers, scrapedData, users, alerts, scrapings] = await Promise.all([
    supabase.from('shared_scrapers').select('id, validation_status, is_active'),
    supabase
      .from('scraped_site_data')
      .select('site_domain, status, scraped_at, updated_at, product_count, error_message, metadata, scrape_duration_seconds')
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase.from('users').select('id, role, subscription_plan, created_at'),
    supabase.from('scraper_alerts').select('id, is_active, created_at'),
    supabase
      .from('scrapings')
      .select('id, user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  // ── Scrapers ──
  const scraperRows = scrapers.data || []
  const scraperStats = {
    total: scraperRows.length,
    pending: scraperRows.filter((s: any) => s.validation_status === 'pending').length,
    approved: scraperRows.filter((s: any) => s.validation_status === 'approved').length,
    rejected: scraperRows.filter((s: any) => s.validation_status === 'rejected').length,
    active: scraperRows.filter((s: any) => s.is_active).length,
  }

  // ── Cron / scraping data ──
  const cronLockDomain = '__cron_lock__'
  const lockRow = (scrapedData.data || []).find((r: any) => r.site_domain === cronLockDomain)
  const realRows = (scrapedData.data || []).filter((r: any) => r.site_domain !== cronLockDomain)

  const successCount = realRows.filter((r: any) => r.status === 'success').length
  const errorCount = realRows.filter((r: any) => r.status === 'error').length
  const hidden = realRows.filter((r: any) => r.metadata?.temporarily_hidden === true)

  const lastSuccessRun = realRows
    .filter((r: any) => r.status === 'success')
    .map((r: any) => r.scraped_at)
    .filter(Boolean)
    .sort()
    .pop() || null

  // ── Utilisateurs ──
  const userRows = users.data || []
  const usersByPlan: Record<string, number> = {}
  for (const u of userRows) {
    const plan = (u as any).subscription_plan || 'free'
    usersByPlan[plan] = (usersByPlan[plan] || 0) + 1
  }
  const usersByRole: Record<string, number> = {}
  for (const u of userRows) {
    const role = (u as any).role || 'unknown'
    usersByRole[role] = (usersByRole[role] || 0) + 1
  }

  // 30 derniers jours
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const recentSignups = userRows.filter((u: any) => new Date(u.created_at) > thirtyDaysAgo).length

  // ── Alertes ──
  const alertRows = alerts.data || []
  const activeAlerts = alertRows.filter((a: any) => a.is_active).length

  return NextResponse.json({
    scrapers: scraperStats,
    cron: {
      status: lockRow?.status || 'idle',
      last_lock_update: lockRow?.updated_at || null,
      last_success_run: lastSuccessRun,
      sites_total: realRows.length,
      sites_success: successCount,
      sites_error: errorCount,
      sites_hidden: hidden.length,
      hidden_domains: hidden.slice(0, 20).map((r: any) => ({
        domain: r.site_domain,
        hidden_at: r.metadata?.hidden_at || null,
        last_error: r.error_message || null,
      })),
    },
    users: {
      total: userRows.length,
      by_plan: usersByPlan,
      by_role: usersByRole,
      signups_30d: recentSignups,
    },
    alerts: {
      total: alertRows.length,
      active: activeAlerts,
    },
    activity: {
      recent_scrapings: (scrapings.data || []).slice(0, 10),
    },
  })
}
