import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

/**
 * GET /api/alerts/changes - Récupérer l'historique des changements détectés
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const unreadOnly = url.searchParams.get('unread') === 'true'

    const supabase = await createClient()

    let query = supabase
      .from('alert_changes')
      .select(`
        *,
        scraper_alerts (
          id,
          scraper_cache (
            site_url,
            cache_key
          )
        )
      `)
      .eq('user_id', user.id)
      .order('detected_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('is_read', false)
    }

    const { data: changes, error } = await query

    if (error) {
      console.error('[Alert Changes GET] Error:', error)
      if ((error as any).code === 'PGRST205') {
        return NextResponse.json(
          {
            error: "Configuration Supabase incomplète: historique d'alertes introuvable.",
            code: 'ALERTS_SCHEMA_MISSING',
            details: "Exécutez la migration 'dashboard_web/supabase/migration_alerts.sql' dans Supabase SQL Editor.",
          },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Compter les non-lus
    const { count: unreadCount } = await supabase
      .from('alert_changes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)

    return NextResponse.json({
      changes: changes || [],
      unread_count: unreadCount || 0,
    })
  } catch (error: any) {
    console.error('[Alert Changes GET] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * PATCH /api/alerts/changes - Marquer des changements comme lus
 */
export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const { ids, mark_all_read } = await request.json()
    const supabase = await createClient()

    if (mark_all_read) {
      await supabase
        .from('alert_changes')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
    } else if (ids?.length) {
      await supabase
        .from('alert_changes')
        .update({ is_read: true })
        .in('id', ids)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Alert Changes PATCH] Error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
