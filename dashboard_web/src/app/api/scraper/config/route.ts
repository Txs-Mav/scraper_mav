import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * API route pour la configuration du scraper
 * Stockée dans Supabase (table scraper_config) pour les utilisateurs connectés.
 *
 * Quand la config change, on synchronise automatiquement une entrée
 * dans scraper_alerts pour que le cron horaire déclenche le scraping.
 */

export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({
        referenceUrl: "",
        urls: [],
        priceDifferenceFilter: null,
        isLocal: true
      })
    }

    const supabase = await createClient()

    const { data: config, error } = await supabase
      .from('scraper_config')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching scraper config:', error)
      return NextResponse.json(
        { error: 'Failed to load config', message: error.message },
        { status: 500 }
      )
    }

    if (!config) {
      return NextResponse.json({
        referenceUrl: "",
        urls: [],
        priceDifferenceFilter: null,
        ignoreColors: false,
        inventoryOnly: true
      })
    }

    return NextResponse.json({
      referenceUrl: config.reference_url || "",
      urls: config.competitor_urls || [],
      priceDifferenceFilter: config.price_difference_filter,
      categories: config.categories || [],
      ignoreColors: config.ignore_colors || false,
      inventoryOnly: config.filter_catalogue_reference ?? true,
      matchMode: config.match_mode || 'exact',
      updatedAt: config.updated_at
    })
  } catch (error: any) {
    console.error('Error reading scraper config:', error)
    return NextResponse.json(
      { error: 'Failed to load config', message: error.message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    const body = await request.json()

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required', message: 'Vous devez être connecté pour sauvegarder la configuration.' },
        { status: 401 }
      )
    }

    const supabase = await createClient()

    // ── Load previous config to detect URL changes ──
    const { data: prevConfig } = await supabase
      .from('scraper_config')
      .select('reference_url, competitor_urls')
      .eq('user_id', user.id)
      .single()

    const prevRefUrl = prevConfig?.reference_url || ''
    const prevCompetitors: string[] = prevConfig?.competitor_urls || []

    const newRefUrl = (body.referenceUrl || '').trim()
    const newCompetitors: string[] = (body.urls || []).map((u: string) => u.trim()).filter(Boolean)
    const skipAutoScrape = body.skipAutoScrape === true

    const configData = {
      user_id: user.id,
      reference_url: newRefUrl || null,
      competitor_urls: newCompetitors,
      price_difference_filter: body.priceDifferenceFilter ?? null,
      categories: body.categories || [],
      ignore_colors: body.ignoreColors || false,
      filter_catalogue_reference: body.inventoryOnly || false,
      match_mode: body.matchMode || 'exact'
    }

    const { data, error } = await supabase
      .from('scraper_config')
      .upsert(configData, {
        onConflict: 'user_id',
        ignoreDuplicates: false
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving scraper config:', error)
      return NextResponse.json(
        { error: 'Failed to save config', message: error.message },
        { status: 500 }
      )
    }

    // ── Sync scraper_alerts for automatic hourly monitoring ──
    let alertSynced = false
    let scrapingTriggered = false

    if (newRefUrl) {
      try {
        const syncResult = await syncAlertFromConfig(user.id, newRefUrl, newCompetitors)
        alertSynced = syncResult.synced

        // Detect if URLs changed (trigger immediate scraping)
        const prevAllSorted = [prevRefUrl, ...prevCompetitors].filter(Boolean).sort().join('|')
        const newAllSorted = [newRefUrl, ...newCompetitors].filter(Boolean).sort().join('|')
        const urlsChanged = prevAllSorted !== newAllSorted
        const isFirstConfig = !prevRefUrl

        if ((urlsChanged || isFirstConfig) && !skipAutoScrape) {
          console.log(`[Config] URLs changed or first config, triggering immediate scraping for user ${user.id}`)
          triggerImmediateScraping(user.id, newRefUrl, newCompetitors).catch(err => {
            console.warn('[Config] Immediate scraping trigger failed (non-blocking):', err.message)
          })
          scrapingTriggered = true
        }
      } catch (syncErr: any) {
        console.warn('[Config] Alert sync failed (non-blocking):', syncErr.message)
      }
    }

    return NextResponse.json({
      success: true,
      alert_synced: alertSynced,
      scraping_triggered: scrapingTriggered,
      config: {
        referenceUrl: data.reference_url || "",
        urls: data.competitor_urls || [],
        priceDifferenceFilter: data.price_difference_filter,
        categories: data.categories || [],
        ignoreColors: data.ignore_colors || false,
        inventoryOnly: data.filter_catalogue_reference ?? true,
        matchMode: data.match_mode || 'exact',
        updatedAt: data.updated_at
      }
    })
  } catch (error: any) {
    console.error('Error saving scraper config:', error)
    return NextResponse.json(
      { error: 'Failed to save config', message: error.message },
      { status: 500 }
    )
  }
}

// ─── Sync config → scraper_alerts so the hourly cron picks it up ────

async function syncAlertFromConfig(
  userId: string,
  referenceUrl: string,
  competitorUrls: string[]
): Promise<{ synced: boolean; alertId?: string }> {
  const serviceSupabase = createServiceClient()

  const normalizeUrl = (url: string) => {
    try {
      const u = new URL(url)
      return `${u.protocol}//${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
    } catch {
      return url.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/www\./, 'https://')
    }
  }

  // Fetch ALL active alerts for this user to find a match (exact or normalized)
  const { data: userAlerts } = await serviceSupabase
    .from('scraper_alerts')
    .select('id, reference_url, competitor_urls')
    .eq('user_id', userId)
    .eq('is_active', true)

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
      console.error('[Config] Alert update failed:', error.message)
      return { synced: false }
    }

    // Deactivate ALL other alerts for this user (stale alerts from old configs)
    const otherAlertIds = (userAlerts || [])
      .filter(a => a.id !== existing.id)
      .map(a => a.id)
    if (otherAlertIds.length > 0) {
      await serviceSupabase
        .from('scraper_alerts')
        .update({ is_active: false })
        .in('id', otherAlertIds)
      console.log(`[Config] Deactivated ${otherAlertIds.length} stale alert(s)`)
    }

    console.log(`[Config] Alert updated: ${existing.id}`)
    return { synced: true, alertId: existing.id }
  }

  // No matching alert found — deactivate ALL existing alerts for this user
  if (userAlerts && userAlerts.length > 0) {
    await serviceSupabase
      .from('scraper_alerts')
      .update({ is_active: false })
      .eq('user_id', userId)
    console.log(`[Config] Deactivated ${userAlerts.length} old alert(s)`)
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
    console.error('[Config] Alert creation failed:', error.message)
    return { synced: false }
  }

  console.log(`[Config] New alert created: ${newAlert.id} for ref=${referenceUrl}`)
  return { synced: true, alertId: newAlert.id }
}

// ─── Fire-and-forget: trigger immediate scraping via alerts/check ────

async function triggerImmediateScraping(
  userId: string,
  referenceUrl: string,
  competitorUrls: string[]
): Promise<void> {
  const serviceSupabase = createServiceClient()

  // Find the alert for this user+reference
  const { data: alert } = await serviceSupabase
    .from('scraper_alerts')
    .select('id')
    .eq('user_id', userId)
    .eq('reference_url', referenceUrl)
    .eq('is_active', true)
    .single()

  if (!alert) {
    console.warn('[Config] No alert found to trigger scraping')
    return
  }

  const baseUrl =
    process.env.NEXTJS_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    `http://localhost:${process.env.PORT || 3000}`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.CRON_SECRET) {
    headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`
  }

  const res = await fetch(`${baseUrl}/api/alerts/check`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ alert_id: alert.id, trigger_scraping: true }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn(`[Config] Immediate scraping returned ${res.status}: ${text.slice(0, 200)}`)
  } else {
    console.log(`[Config] Immediate scraping triggered for alert ${alert.id}`)
  }
}
