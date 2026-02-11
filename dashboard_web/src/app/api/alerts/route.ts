import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { canAccessOrganisation, getAlertLimit, type PlanId } from '@/lib/plan-restrictions'

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
    // Fallback : si subscription_source est null mais promo_code_id est défini → promo
    const source = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)

    if (!canAccessOrganisation(plan, source)) {
      return NextResponse.json({ error: 'Accès réservé aux plans Pro et Ultime' }, { status: 403 })
    }

    const supabase = await createClient()

    // Récupérer les alertes avec les infos du scraper cache
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
            details: "Exécutez la migration 'dashboard_web/supabase/migration_alerts.sql' dans Supabase SQL Editor.",
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
      // -1 signifie illimité côté frontend
      alert_limit: alertLimit === Infinity ? -1 : alertLimit,
    })
  } catch (error: any) {
    console.error('[Alerts GET] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * POST /api/alerts - Créer une nouvelle alerte
 * Vérifie les limites du plan avant création.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const plan = (user.subscription_plan || 'standard') as PlanId
    // Fallback : si subscription_source est null mais promo_code_id est défini → promo
    const source = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)

    if (!canAccessOrganisation(plan, source)) {
      return NextResponse.json({ error: 'Accès réservé aux plans Pro et Ultime' }, { status: 403 })
    }

    const supabase = await createClient()

    // ── Vérifier la limite d'alertes pour le plan ──
    const alertLimit = getAlertLimit(plan, source)

    const { count, error: countError } = await supabase
      .from('scraper_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    // Si la table n'existe pas encore dans le projet Supabase
    if (countError?.code === 'PGRST205') {
      return NextResponse.json(
        {
          error: "Configuration Supabase incomplète: tables d'alertes introuvables.",
          code: 'ALERTS_SCHEMA_MISSING',
          details: "Exécutez la migration 'dashboard_web/supabase/migration_alerts.sql' dans Supabase SQL Editor.",
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

    const { scraper_cache_id, schedule_hour, schedule_minute, email_notification } = await request.json()

    if (!scraper_cache_id) {
      return NextResponse.json({ error: 'scraper_cache_id requis' }, { status: 400 })
    }
    if (schedule_hour === undefined || schedule_hour < 0 || schedule_hour > 23) {
      return NextResponse.json({ error: 'Heure invalide (0-23)' }, { status: 400 })
    }

    // Vérifier que le scraper cache appartient à l'utilisateur
    const { data: cache } = await supabase
      .from('scraper_cache')
      .select('id')
      .eq('id', scraper_cache_id)
      .eq('user_id', user.id)
      .single()

    if (!cache) {
      return NextResponse.json({ error: 'Scraper non trouvé' }, { status: 404 })
    }

    const { data: alert, error } = await supabase
      .from('scraper_alerts')
      .upsert({
        user_id: user.id,
        scraper_cache_id,
        schedule_hour,
        schedule_minute: schedule_minute || 0,
        email_notification: email_notification !== false,
        is_active: true,
      }, { onConflict: 'user_id,scraper_cache_id' })
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
      if ((error as any).code === 'PGRST205') {
        return NextResponse.json(
          {
            error: "Configuration Supabase incomplète: tables d'alertes introuvables.",
            code: 'ALERTS_SCHEMA_MISSING',
            details: "Exécutez la migration 'dashboard_web/supabase/migration_alerts.sql' dans Supabase SQL Editor.",
          },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ alert })
  } catch (error: any) {
    console.error('[Alerts POST] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
