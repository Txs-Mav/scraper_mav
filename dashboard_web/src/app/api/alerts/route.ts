import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { canAccessOrganisation, getAlertLimit, type PlanId } from '@/lib/plan-restrictions'

const VALID_INTERVALS_HOURS = [1, 2, 4, 6, 12, 24]
const VALID_INTERVALS_MINUTES = [20, 30, 40, 60, 120, 240, 360, 720, 1440]
const VALID_CATEGORIES = ['inventaire', 'occasion', 'catalogue']

function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * GET /api/alerts - Récupérer toutes les alertes de l'utilisateur + limites du plan
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const plan = (user.subscription_plan || 'standard') as PlanId
    const source = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)

    if (!canAccessOrganisation(plan, source)) {
      return NextResponse.json({ error: 'Accès réservé aux plans Pro et Ultime' }, { status: 403 })
    }

    const supabase = await createClient()

    const { data: alerts, error } = await supabase
      .from('scraper_alerts')
      .select(`
        *,
        scraper_cache (
          id,
          site_url,
          cache_key,
          last_product_count,
          status,
          last_run_at
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Alerts GET] Error:', error)
      if ((error as any).code === 'PGRST205') {
        return NextResponse.json(
          {
            error: "Configuration Supabase incomplète: tables d'alertes introuvables.",
            code: 'ALERTS_SCHEMA_MISSING',
            details: "Exécutez les migrations alerts dans Supabase SQL Editor.",
          },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const alertLimit = getAlertLimit(plan, source)

    return NextResponse.json({
      alerts: alerts || [],
      alert_count: alerts?.length || 0,
      alert_limit: alertLimit === Infinity ? -1 : alertLimit,
    })
  } catch (error: any) {
    console.error('[Alerts GET] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * POST /api/alerts - Créer une alerte = scraping configurable
 * L'utilisateur configure reference_url + competitor_urls + fréquence + seuils.
 * Les résultats de scraping apparaîtront dans le dashboard principal.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const plan = (user.subscription_plan || 'standard') as PlanId
    const source = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)

    if (!canAccessOrganisation(plan, source)) {
      return NextResponse.json({ error: 'Accès réservé aux plans Pro et Ultime' }, { status: 403 })
    }

    const supabase = await createClient()

    const alertLimit = getAlertLimit(plan, source)

    const { count, error: countError } = await supabase
      .from('scraper_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (countError?.code === 'PGRST205') {
      return NextResponse.json(
        {
          error: "Configuration Supabase incomplète: tables d'alertes introuvables.",
          code: 'ALERTS_SCHEMA_MISSING',
          details: "Exécutez les migrations alerts dans Supabase SQL Editor.",
        },
        { status: 503 }
      )
    }
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 })
    }

    if (count !== null && alertLimit !== Infinity && count >= alertLimit) {
      const planLabel = plan === 'pro' ? 'Pro (3 alertes max)' : 'votre plan'
      return NextResponse.json(
        { error: `Limite atteinte pour le plan ${planLabel}. Passez au plan Ultime pour des alertes illimitées.` },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      reference_url,
      competitor_urls = [],
      categories = VALID_CATEGORIES,
      schedule_type = 'interval',
      schedule_hour = 8,
      schedule_minute = 0,
      schedule_interval_hours,
      schedule_interval_minutes,
      email_notification = true,
      sms_notification = true,
      slack_notification = true,
      watch_price_increase = true,
      watch_price_decrease = true,
      watch_new_products = true,
      watch_removed_products = true,
      watch_stock_changes = true,
      min_price_change_pct = 1,
      min_price_change_abs = 2,
    } = body

    // ── Validation ──
    if (!reference_url || !isValidUrl(reference_url)) {
      return NextResponse.json({ error: 'URL de référence invalide. Fournissez une URL complète (https://...)' }, { status: 400 })
    }

    const validCompetitors = (competitor_urls as string[]).filter(u => u && isValidUrl(u.trim()))

    if (schedule_type === 'daily') {
      if (schedule_hour === undefined || schedule_hour < 0 || schedule_hour > 23) {
        return NextResponse.json({ error: 'Heure invalide (0-23)' }, { status: 400 })
      }
    } else if (schedule_type === 'interval') {
      const hasMinutes = schedule_interval_minutes && VALID_INTERVALS_MINUTES.includes(schedule_interval_minutes)
      const hasHours = schedule_interval_hours && VALID_INTERVALS_HOURS.includes(schedule_interval_hours)
      if (!hasMinutes && !hasHours) {
        return NextResponse.json({ error: `Intervalle invalide. Valeurs acceptées (minutes): ${VALID_INTERVALS_MINUTES.join(', ')}` }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: "schedule_type doit être 'daily' ou 'interval'" }, { status: 400 })
    }

    const validCategories = (categories as string[]).filter(c => VALID_CATEGORIES.includes(c))

    // ── Auto-lier un scraper_cache existant ──
    let scraperCacheId: string | null = null
    try {
      const refHost = new URL(reference_url).hostname.replace('www.', '').toLowerCase()
      const { data: caches } = await supabase
        .from('scraper_cache')
        .select('id, site_url')
        .eq('user_id', user.id)
        .eq('status', 'active')

      if (caches) {
        const match = caches.find((c: any) => {
          try {
            return new URL(c.site_url).hostname.replace('www.', '').toLowerCase() === refHost
          } catch { return false }
        })
        if (match) scraperCacheId = match.id
      }
    } catch { /* ignore */ }

    const resolvedIntervalMinutes = schedule_type === 'interval'
      ? (schedule_interval_minutes || (schedule_interval_hours ? schedule_interval_hours * 60 : 40))
      : null

    const insertData: Record<string, any> = {
      user_id: user.id,
      reference_url,
      competitor_urls: validCompetitors,
      categories: validCategories.length > 0 ? validCategories : VALID_CATEGORIES,
      scraper_cache_id: scraperCacheId,
      schedule_type,
      schedule_hour: schedule_type === 'daily' ? schedule_hour : 0,
      schedule_minute: schedule_type === 'daily' ? (schedule_minute || 0) : 0,
      schedule_interval_hours: schedule_type === 'interval' ? (schedule_interval_hours || null) : null,
      schedule_interval_minutes: resolvedIntervalMinutes,
      email_notification: email_notification !== false,
      sms_notification: sms_notification !== false,
      slack_notification: slack_notification !== false,
      is_active: true,
      watch_price_increase,
      watch_price_decrease,
      watch_new_products,
      watch_removed_products,
      watch_stock_changes,
      min_price_change_pct: Math.max(0, min_price_change_pct),
      min_price_change_abs: Math.max(0, min_price_change_abs),
    }

    const { data: alert, error } = await supabase
      .from('scraper_alerts')
      .insert(insertData)
      .select(`
        *,
        scraper_cache (
          id,
          site_url,
          cache_key,
          last_product_count,
          status,
          last_run_at
        )
      `)
      .single()

    if (error) {
      console.error('[Alerts POST] Error:', error)
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Une alerte existe déjà pour cette URL de référence.' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (alert?.id) {
      const baseUrl =
        process.env.NEXTJS_API_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        `http://localhost:${process.env.PORT || 3000}`
      const triggerHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (process.env.CRON_SECRET) {
        triggerHeaders['Authorization'] = `Bearer ${process.env.CRON_SECRET}`
      }
      fetch(`${baseUrl}/api/alerts/check`, {
        method: 'POST',
        headers: triggerHeaders,
        body: JSON.stringify({ alert_id: alert.id, trigger_scraping: true }),
      }).catch((err) => {
        console.warn('[Alerts POST] Initial scraping trigger failed (non-blocking):', err.message)
      })
    }

    return NextResponse.json({ alert, initial_scraping_triggered: true })
  } catch (error: any) {
    console.error('[Alerts POST] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
