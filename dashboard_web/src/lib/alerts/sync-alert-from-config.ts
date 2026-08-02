/**
 * Synchronise la configuration scraper d'un utilisateur (`scraper_config`)
 * vers une alerte active unique (`scraper_alerts`) pour que la surveillance
 * automatique détecte les changements.
 *
 * Utilisé par :
 *  - POST /api/scraper/config (à chaque sauvegarde de config)
 *  - GET  /api/alerts (self-heal : recrée/réactive l'alerte si elle a été
 *    désactivée alors qu'une config valide existe)
 */
import { createServiceClient } from '@/lib/supabase/service'

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return url.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/www\./, 'https://')
  }
}

export async function syncAlertFromConfig(
  userId: string,
  referenceUrl: string,
  competitorUrls: string[]
): Promise<{ synced: boolean; alertId?: string }> {
  const serviceSupabase = createServiceClient()

  // Fetch ALL alerts for this user to find a match (exact or normalized).
  // On inclut les alertes inactives : si l'utilisateur a la même référence
  // qu'avant, on la réactive au lieu d'en créer une nouvelle.
  const { data: userAlerts } = await serviceSupabase
    .from('scraper_alerts')
    .select('id, reference_url, competitor_urls, is_active')
    .eq('user_id', userId)

  const normalizedRef = normalizeUrl(referenceUrl)
  const existing = userAlerts?.find(a =>
    a.reference_url === referenceUrl || normalizeUrl(a.reference_url) === normalizedRef
  )

  // Read current config to get filter_catalogue_reference
  const { data: currentConfig } = await serviceSupabase
    .from('scraper_config')
    .select('filter_catalogue_reference')
    .eq('user_id', userId)
    .single()
  const filterCatalogue = currentConfig?.filter_catalogue_reference ?? true

  if (existing) {
    // Update the matched alert AND fix reference_url to the canonical form
    const { error } = await serviceSupabase
      .from('scraper_alerts')
      .update({
        reference_url: referenceUrl,
        competitor_urls: competitorUrls,
        is_active: true,
        filter_catalogue_reference: filterCatalogue,
      })
      .eq('id', existing.id)

    if (error) {
      console.error('[AlertSync] Alert update failed:', error.message)
      return { synced: false }
    }

    // Deactivate ALL other alerts for this user (stale alerts from old configs)
    const otherActiveIds = (userAlerts || [])
      .filter(a => a.id !== existing.id && a.is_active)
      .map(a => a.id)
    if (otherActiveIds.length > 0) {
      await serviceSupabase
        .from('scraper_alerts')
        .update({ is_active: false })
        .in('id', otherActiveIds)
      console.log(`[AlertSync] Deactivated ${otherActiveIds.length} stale alert(s)`)
    }

    console.log(`[AlertSync] Alert updated: ${existing.id}`)
    return { synced: true, alertId: existing.id }
  }

  // No matching alert found — deactivate ALL existing alerts for this user
  if (userAlerts && userAlerts.length > 0) {
    await serviceSupabase
      .from('scraper_alerts')
      .update({ is_active: false })
      .eq('user_id', userId)
    console.log(`[AlertSync] Deactivated ${userAlerts.length} old alert(s)`)
  }

  // Create new alert entry
  const { data: newAlert, error } = await serviceSupabase
    .from('scraper_alerts')
    .insert({
      user_id: userId,
      reference_url: referenceUrl,
      competitor_urls: competitorUrls,
      categories: ['inventaire', 'occasion', 'catalogue'],
      filter_catalogue_reference: filterCatalogue,
      schedule_type: 'interval',
      schedule_hour: 0,
      schedule_minute: 0,
      schedule_interval_minutes: 40,
      is_active: true,
      email_notification: true,
      watch_price_increase: true,
      watch_price_decrease: true,
      watch_new_products: true,
      watch_removed_products: true,
      watch_stock_changes: true,
      min_price_change_pct: 1,
      min_price_change_abs: 2,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[AlertSync] Alert creation failed:', error.message)
    return { synced: false }
  }

  console.log(`[AlertSync] New alert created: ${newAlert.id} for ref=${referenceUrl}`)
  return { synced: true, alertId: newAlert.id }
}

/**
 * Self-heal : garantit qu'un utilisateur avec une config scraper valide a
 * bien une alerte active. Retourne true si une synchronisation a eu lieu.
 */
export async function ensureActiveAlertForUser(userId: string): Promise<boolean> {
  const serviceSupabase = createServiceClient()

  const { data: config } = await serviceSupabase
    .from('scraper_config')
    .select('reference_url, competitor_urls')
    .eq('user_id', userId)
    .maybeSingle()

  if (!config?.reference_url) return false

  const { count } = await serviceSupabase
    .from('scraper_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)

  if (count && count > 0) return false

  console.log(`[AlertSync] Self-heal: no active alert for user ${userId}, re-syncing from config`)
  const result = await syncAlertFromConfig(
    userId,
    config.reference_url,
    config.competitor_urls || []
  )
  return result.synced
}
