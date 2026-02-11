import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

/**
 * PATCH /api/alerts/[id] - Mettre à jour une alerte
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

    // Construire les champs à mettre à jour
    const updates: Record<string, any> = {}
    if (body.schedule_hour !== undefined) updates.schedule_hour = body.schedule_hour
    if (body.schedule_minute !== undefined) updates.schedule_minute = body.schedule_minute
    if (body.is_active !== undefined) updates.is_active = body.is_active
    if (body.email_notification !== undefined) updates.email_notification = body.email_notification

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
