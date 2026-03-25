import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

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
 * PATCH /api/alerts/[id] - Mettre à jour une alerte (tous les champs configurables)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const supabase = await createClient()
    const updates: Record<string, any> = {}

    // Scraping config
    if (body.competitor_urls !== undefined) {
      updates.competitor_urls = (body.competitor_urls as string[]).filter(u => u && isValidUrl(u.trim()))
    }
    if (body.categories !== undefined) {
      updates.categories = (body.categories as string[]).filter(c => VALID_CATEGORIES.includes(c))
    }

    // Scheduling
    if (body.schedule_type !== undefined) {
      if (!['daily', 'interval'].includes(body.schedule_type)) {
        return NextResponse.json({ error: "schedule_type doit être 'daily' ou 'interval'" }, { status: 400 })
      }
      updates.schedule_type = body.schedule_type
    }
    if (body.schedule_hour !== undefined) updates.schedule_hour = body.schedule_hour
    if (body.schedule_minute !== undefined) updates.schedule_minute = body.schedule_minute
    if (body.schedule_interval_minutes !== undefined) {
      if (body.schedule_interval_minutes !== null && !VALID_INTERVALS_MINUTES.includes(body.schedule_interval_minutes)) {
        return NextResponse.json({ error: `Intervalle invalide. Valeurs acceptées (minutes): ${VALID_INTERVALS_MINUTES.join(', ')}` }, { status: 400 })
      }
      updates.schedule_interval_minutes = body.schedule_interval_minutes
      if (body.schedule_interval_minutes) {
        updates.schedule_interval_hours = Math.ceil(body.schedule_interval_minutes / 60)
      }
    }
    if (body.schedule_interval_hours !== undefined && body.schedule_interval_minutes === undefined) {
      if (body.schedule_interval_hours !== null && !VALID_INTERVALS_HOURS.includes(body.schedule_interval_hours)) {
        return NextResponse.json({ error: `Intervalle invalide. Valeurs acceptées: ${VALID_INTERVALS_HOURS.join(', ')}` }, { status: 400 })
      }
      updates.schedule_interval_hours = body.schedule_interval_hours
      if (body.schedule_interval_hours) {
        updates.schedule_interval_minutes = body.schedule_interval_hours * 60
      }
    }

    // Toggle & email
    if (body.is_active !== undefined) updates.is_active = body.is_active
    if (body.email_notification !== undefined) updates.email_notification = body.email_notification

    // Watch types
    if (body.watch_price_increase !== undefined) updates.watch_price_increase = body.watch_price_increase
    if (body.watch_price_decrease !== undefined) updates.watch_price_decrease = body.watch_price_decrease
    if (body.watch_new_products !== undefined) updates.watch_new_products = body.watch_new_products
    if (body.watch_removed_products !== undefined) updates.watch_removed_products = body.watch_removed_products
    if (body.watch_stock_changes !== undefined) updates.watch_stock_changes = body.watch_stock_changes

    // Thresholds
    if (body.min_price_change_pct !== undefined) updates.min_price_change_pct = Math.max(0, body.min_price_change_pct)
    if (body.min_price_change_abs !== undefined) updates.min_price_change_abs = Math.max(0, body.min_price_change_abs)

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
    }

    const { data: alert, error } = await supabase
      .from('scraper_alerts')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
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
      console.error('[Alerts PATCH] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ alert })
  } catch (error: any) {
    console.error('[Alerts PATCH] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * DELETE /api/alerts/[id] - Supprimer une alerte
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const { id } = await params
    const supabase = await createClient()

    const { error } = await supabase
      .from('scraper_alerts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('[Alerts DELETE] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Alerts DELETE] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
