import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { spawn } from 'child_process'
import path from 'path'
import { hasBackend, proxyToBackend } from '@/lib/backend-proxy'
import { dispatchAlertNotifications, type UserChannelsConfig } from '@/lib/notifications/dispatcher'
import { analyzeFromCache } from '@/lib/analyze-from-cache'

export const maxDuration = 300

// ─── Types ──────────────────────────────────────────────────────────

interface Product {
  name: string
  prix: number
  disponibilite?: string
  sourceUrl?: string
  sourceSite?: string
  marque?: string
  modele?: string
  image?: string
  // Champs enrichis par /api/products/analyze (matching vs référence)
  prixReference?: number
  differencePrix?: number | null
  produitReference?: {
    name?: string
    sourceUrl?: string
    prix?: number
    image?: string
  } | null
  matchLevel?: string
  [key: string]: any
}

interface Change {
  change_type: string
  product_name: string
  old_value: string | null
  new_value: string | null
  percentage_change: number | null
  details: Record<string, any>
  source_site: string
}

interface AlertConfig {
  watch_price_increase: boolean
  watch_price_decrease: boolean
  watch_new_products: boolean
  watch_removed_products: boolean
  watch_stock_changes: boolean
  min_price_change_pct: number
  min_price_change_abs: number
}

const MIN_VALID_PRICE = 1

// ─── GET — Vercel Cron (quotidien 08:00 UTC, analyse seule) ─────────

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[Alert Check] CRON_SECRET non configuré — endpoint non sécurisé en production')
  }

  const url = new URL(request.url)
  const explicitAnalysisOnly = url.searchParams.get('analysis_only') === 'true'

  // Sur Vercel (serverless), le scraping local Python est impossible.
  // Si pas de BACKEND_URL configuré, forcer analysis_only pour éviter des échecs silencieux.
  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
  const hasBackendUrl = !!process.env.BACKEND_URL
  const analysisOnly = explicitAnalysisOnly || (isServerless && !hasBackendUrl)

  if (isServerless && !hasBackendUrl && !explicitAnalysisOnly) {
    console.log('[Alert Check] Vercel sans BACKEND_URL → mode analysis_only automatique')
  }

  return runAlertCheck({ fromCron: true, analysisOnly })
}

// ─── POST — Appel interne ou manuel ─────────────────────────────────

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))

  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    const sessionUser = await getCurrentUser().catch(() => null)
    const hasCronAuth = authHeader === `Bearer ${cronSecret}`
    if (!hasCronAuth && !sessionUser) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
  }

  return runAlertCheck({
    alertId: body.alert_id,
    fromCron: false,
    triggerScraping: body.trigger_scraping === true,
    skipScheduleUpdate: body.skip_schedule_update === true,
  })
}

// ─── Sélection des alertes éligibles ────────────────────────────────

const SCHEDULE_TOLERANCE_MS = 5 * 60_000 // 5 min de tolérance pour absorber les délais de cron

function getIntervalMs(alert: any): number {
  if (alert.schedule_interval_minutes) return alert.schedule_interval_minutes * 60_000
  if (alert.schedule_interval_hours) return alert.schedule_interval_hours * 3600_000
  return 40 * 60_000 // défaut 40 min
}

function isAlertDueForCheck(alert: any, now: Date): boolean {
  if (alert.schedule_type === 'interval') {
    if (!alert.last_run_at) return true
    const lastRun = new Date(alert.last_run_at)
    const intervalMs = getIntervalMs(alert)
    const nextDue = new Date(lastRun.getTime() + intervalMs - SCHEDULE_TOLERANCE_MS)
    return now >= nextDue
  }

  if (alert.schedule_type === 'daily') {
    const hour = alert.schedule_hour ?? 8
    return hour === now.getUTCHours()
  }

  if (!alert.last_run_at) return true
  const lastRun = new Date(alert.last_run_at)
  return now >= new Date(lastRun.getTime() + 40 * 60_000 - SCHEDULE_TOLERANCE_MS)
}

// ─── Logique principale ─────────────────────────────────────────────

async function runAlertCheck(options: { alertId?: string; fromCron: boolean; triggerScraping?: boolean; analysisOnly?: boolean; skipScheduleUpdate?: boolean }) {
  try {
    const serviceSupabase = createServiceClient()
    const now = new Date()

    console.log(
      `[Alert Check] Démarrage — mode=${options.fromCron ? 'cron' : 'manual'}` +
      `${options.analysisOnly ? ' (analysis_only)' : ''}` +
      `${options.alertId ? ` alertId=${options.alertId}` : ''}` +
      `${options.triggerScraping ? ' +scraping' : ''}` +
      ` — ${now.toISOString()}`
    )

    // ── Récupérer les alertes ──
    let alertsQuery = serviceSupabase
      .from('scraper_alerts')
      .select(`
        *,
        scraper_cache (
          id,
          site_url,
          cache_key,
          last_product_count,
          user_id
        )
      `)

    if (options.alertId) {
      alertsQuery = alertsQuery.eq('id', options.alertId)
    } else {
      alertsQuery = alertsQuery.eq('is_active', true)
    }

    const { data: allAlerts, error: alertsError } = await alertsQuery

    if (alertsError) {
      console.error('[Alert Check] DB error:', alertsError)
      return NextResponse.json({ error: alertsError.message }, { status: 500 })
    }

    // Filtrer les alertes éligibles (pour le cron, vérifier schedule)
    const alerts = options.alertId
      ? allAlerts
      : (allAlerts || []).filter(a => !options.fromCron || isAlertDueForCheck(a, now))

    if (!alerts?.length) {
      return NextResponse.json({
        success: true,
        message: 'Aucune alerte à vérifier pour ce créneau',
        checked: 0,
        changes_detected: 0,
      })
    }

    console.log(`[Alert Check] ${alerts.length} alerte(s) à traiter`)

    // ── Grouper les alertes par user_id ──
    const alertsByUser = new Map<string, typeof alerts>()
    for (const alert of alerts) {
      const uid = alert.user_id
      if (!alertsByUser.has(uid)) alertsByUser.set(uid, [])
      alertsByUser.get(uid)!.push(alert)
    }

    let totalChecked = 0
    let totalChanges = 0
    let totalSkipped = 0
    const shouldScrape = !options.analysisOnly && (options.fromCron || options.triggerScraping === true)

    for (const [userId, userAlerts] of alertsByUser) {
      try {
        // ── Déclencher le scraping ──
        if (shouldScrape) {
          for (const alert of userAlerts) {
            const refUrl = alert.reference_url || alert.scraper_cache?.site_url
            if (!refUrl) {
              console.warn(`[Alert Check] Alerte ${alert.id} sans URL de référence, scraping impossible`)
              continue
            }
            const competitors: string[] = alert.competitor_urls || []
            const categories: string[] = alert.categories || ['inventaire', 'occasion', 'catalogue']
            console.log(`[Alert Check] Scraping ref=${refUrl} + ${competitors.length} concurrent(s) pour user ${userId}...`)
            const ok = await triggerAlertScraping(userId, {
              reference_url: refUrl,
              competitor_urls: competitors,
              categories,
            })
            if (!ok) {
              console.warn(`[Alert Check] Scraping échoué pour ${refUrl}, comparaison des données existantes`)
            }
          }
        }

        // ── Pour chaque alerte, comparer et détecter les changements ──
        for (const alert of userAlerts) {
          try {
            const refUrl = alert.reference_url || alert.scraper_cache?.site_url
            if (!refUrl) {
              console.warn(`[Alert Check] Alerte ${alert.id} sans URL de référence, ignorée`)
              continue
            }

            let { data: scrapings } = await serviceSupabase
              .from('scrapings')
              .select('id, products, metadata, created_at, reference_url')
              .eq('user_id', userId)
              .eq('reference_url', refUrl)
              .order('created_at', { ascending: false })
              .limit(2)

            if (!scrapings || scrapings.length < 2) {
              const normalizedRefUrl = normalizeUrl(refUrl)
              const { data: allUserScrapings } = await serviceSupabase
                .from('scrapings')
                .select('id, products, metadata, created_at, reference_url')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(20)

              if (allUserScrapings?.length) {
                const matchingScrapings = allUserScrapings.filter(
                  (s: any) => normalizeUrl(s.reference_url) === normalizedRefUrl
                )
                if (matchingScrapings.length >= 2) {
                  scrapings = matchingScrapings.slice(0, 2)
                  console.log(
                    `[Alert Check] Alerte ${alert.id}: fallback URL normalisée trouvé ` +
                    `(${matchingScrapings[0].reference_url} ≈ ${refUrl})`
                  )
                }
              }
            }

            if (!scrapings || scrapings.length < 2) {
              console.log(`[Alert Check] Alerte ${alert.id}: pas assez de scrapings pour ref=${refUrl} (trouvé: ${scrapings?.length || 0})`)
              if (shouldScrape && !options.skipScheduleUpdate) {
                await serviceSupabase
                  .from('scraper_alerts')
                  .update({ last_run_at: now.toISOString() })
                  .eq('id', alert.id)
              }
              totalChecked++
              continue
            }

            // ── Déduplication : vérifier nouveau scraping depuis le dernier check ──
            const latestScrapingDate = new Date(scrapings[0].created_at)
            if (alert.last_run_at) {
              const lastRunDate = new Date(alert.last_run_at)
              if (latestScrapingDate <= lastRunDate) {
                console.log(
                  `[Alert Check] Alerte ${alert.id}: pas de nouveau scraping depuis le dernier check ` +
                  `(scraping: ${scrapings[0].created_at}, last_run: ${alert.last_run_at})`
                )
                totalSkipped++
                totalChecked++
                continue
              }
            }

            const currentProducts: Product[] = scrapings[0].products || []
            const previousProducts: Product[] = scrapings[1].products || []

            // ── Config de l'alerte pour les seuils et filtres ──
            const alertConfig: AlertConfig = {
              watch_price_increase: alert.watch_price_increase ?? true,
              watch_price_decrease: alert.watch_price_decrease ?? true,
              watch_new_products: alert.watch_new_products ?? true,
              watch_removed_products: alert.watch_removed_products ?? true,
              watch_stock_changes: alert.watch_stock_changes ?? true,
              min_price_change_pct: alert.min_price_change_pct ?? 1,
              min_price_change_abs: alert.min_price_change_abs ?? 2,
            }

            // ── Analyser TOUS les sites : référence + concurrents ──
            const competitorUrls: string[] = alert.competitor_urls || []
            const allSiteUrls = [refUrl, ...competitorUrls]
            const allChanges: Change[] = []
            let totalCurrentCount = 0
            let totalPreviousCount = 0
            let hasAnyPreviousData = false

            for (const siteUrl of allSiteUrls) {
              const isReference = normalizeUrl(siteUrl) === normalizeUrl(refUrl)
              let currentSiteProducts = filterProductsBySite(currentProducts, siteUrl)
              let previousSiteProducts = filterProductsBySite(previousProducts, siteUrl)

              if (isReference && alert.filter_catalogue_reference !== false) {
                const preFilterCount = currentSiteProducts.length
                currentSiteProducts = filterCatalogueFromReference(currentSiteProducts)
                previousSiteProducts = filterCatalogueFromReference(previousSiteProducts)
                if (preFilterCount !== currentSiteProducts.length) {
                  console.log(
                    `[Alert Check] Alerte ${alert.id}: filtrage catalogue référence ${preFilterCount} → ${currentSiteProducts.length} produits`
                  )
                }
              }

              const siteHostname = extractHostname(siteUrl)

              totalCurrentCount += currentSiteProducts.length
              totalPreviousCount += previousSiteProducts.length

              console.log(
                `[Alert Check] Alerte ${alert.id} (${siteHostname}): ` +
                `${previousSiteProducts.length} → ${currentSiteProducts.length} produits`
              )

              if (previousSiteProducts.length === 0) continue
              hasAnyPreviousData = true

              if (currentSiteProducts.length === 0 && previousSiteProducts.length > 0) {
                console.warn(
                  `[Alert Check] Alerte ${alert.id} (${siteHostname}): 0 produits courants mais ${previousSiteProducts.length} précédents — skip ce site`
                )
                continue
              }

              const dropRatio = currentSiteProducts.length / previousSiteProducts.length
              if (dropRatio < 0.2 && previousSiteProducts.length > 5) {
                console.warn(
                  `[Alert Check] Alerte ${alert.id} (${siteHostname}): chute suspecte ${previousSiteProducts.length} → ${currentSiteProducts.length} (${Math.round(dropRatio * 100)}%)`
                )
              }

              const siteChanges = detectChanges(previousSiteProducts, currentSiteProducts, alertConfig, siteHostname)
              allChanges.push(...siteChanges)
            }

            if (!hasAnyPreviousData) {
              console.log(`[Alert Check] Alerte ${alert.id}: première exécution, pas de base de comparaison`)
              if (shouldScrape && !options.skipScheduleUpdate) {
                await serviceSupabase
                  .from('scraper_alerts')
                  .update({ last_run_at: now.toISOString() })
                  .eq('id', alert.id)
              }
              totalChecked++
              continue
            }

            if (allChanges.length > 0) {
              const MAX_CHANGES_PER_ALERT = 200
              if (allChanges.length > MAX_CHANGES_PER_ALERT) {
                console.warn(
                  `[Alert Check] Alerte ${alert.id}: ${allChanges.length} changements détectés, ` +
                  `tronqué à ${MAX_CHANGES_PER_ALERT} (possible anomalie de scraping)`
                )
              }
              const cappedChanges = allChanges.slice(0, MAX_CHANGES_PER_ALERT)
              console.log(`[Alert Check] Alerte ${alert.id}: ${cappedChanges.length} changement(s) détecté(s) sur ${allSiteUrls.length} site(s)`)

              const changesToInsert = cappedChanges.map(c => ({
                alert_id: alert.id,
                user_id: userId,
                change_type: c.change_type,
                product_name: c.product_name,
                old_value: c.old_value,
                new_value: c.new_value,
                percentage_change: c.percentage_change,
                details: c.details,
                source_site: c.source_site,
                detected_at: now.toISOString(),
              }))

              const { error: insertErr } = await serviceSupabase
                .from('alert_changes')
                .insert(changesToInsert)

              if (insertErr) {
                console.error(`[Alert Check] Erreur insertion changements:`, insertErr)
              }

            const wantsEmail = alert.email_notification !== false
            const wantsSms = alert.sms_notification !== false
            const wantsSlack = alert.slack_notification !== false

            if (wantsEmail || wantsSms || wantsSlack) {
              await sendAlertNotificationsSafe(
                userId,
                refUrl,
                cappedChanges,
                totalCurrentCount,
                totalPreviousCount,
                { email: wantsEmail, sms: wantsSms, slack: wantsSlack },
                serviceSupabase
              )
            }

              totalChanges += cappedChanges.length

              if (options.skipScheduleUpdate) {
                await serviceSupabase
                  .from('scraper_alerts')
                  .update({ last_change_detected_at: now.toISOString() })
                  .eq('id', alert.id)
              } else {
                await serviceSupabase
                  .from('scraper_alerts')
                  .update({
                    last_run_at: now.toISOString(),
                    last_change_detected_at: now.toISOString(),
                  })
                  .eq('id', alert.id)
              }
            } else {
              console.log(`[Alert Check] Alerte ${alert.id}: aucun changement sur ${allSiteUrls.length} site(s)`)
              if (!options.skipScheduleUpdate) {
                await serviceSupabase
                  .from('scraper_alerts')
                  .update({ last_run_at: now.toISOString() })
                  .eq('id', alert.id)
              }
            }

            totalChecked++
          } catch (err) {
            console.error(`[Alert Check] Erreur alerte ${alert.id}:`, err)
          }
        }
      } catch (err) {
        console.error(`[Alert Check] Erreur user ${userId}:`, err)
      }
    }

    const elapsedMs = Date.now() - now.getTime()
    console.log(
      `[Alert Check] Terminé en ${elapsedMs}ms: ${totalChecked} vérifié(s), ${totalChanges} changement(s), ${totalSkipped} ignoré(s)` +
      `${options.analysisOnly ? ' (analysis_only)' : ''}`
    )

    return NextResponse.json({
      success: true,
      checked: totalChecked,
      changes_detected: totalChanges,
      skipped_no_new_data: totalSkipped,
      analysis_only: options.analysisOnly || false,
      elapsed_ms: elapsedMs,
    })
  } catch (error: any) {
    console.error('[Alert Check] Erreur fatale:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ─── Envoi multi-canal sécurisé (email / SMS / Slack) ───────────────

async function sendAlertNotificationsSafe(
  userId: string,
  siteUrl: string,
  changes: Change[],
  currentCount: number,
  previousCount: number,
  flags: { email: boolean; sms: boolean; slack: boolean },
  serviceSupabase: any
) {
  try {
    const { data: userData } = await serviceSupabase
      .from('users')
      .select('email, name')
      .eq('id', userId)
      .single()

    const { data: channelsRow } = await serviceSupabase
      .from('user_notification_channels')
      .select('email_enabled, email_address, sms_enabled, sms_phone, slack_enabled, slack_webhook_url, slack_channel')
      .eq('user_id', userId)
      .maybeSingle()

    const userChannels: UserChannelsConfig | null = channelsRow
      ? {
          email_enabled: channelsRow.email_enabled ?? true,
          email_address: channelsRow.email_address || userData?.email || null,
          sms_enabled: !!channelsRow.sms_enabled,
          sms_phone: channelsRow.sms_phone || null,
          slack_enabled: !!channelsRow.slack_enabled,
          slack_webhook_url: channelsRow.slack_webhook_url || null,
          slack_channel: channelsRow.slack_channel || null,
        }
      : {
          email_enabled: true,
          email_address: userData?.email || null,
          sms_enabled: false,
          sms_phone: null,
          slack_enabled: false,
          slack_webhook_url: null,
          slack_channel: null,
        }

    const result = await dispatchAlertNotifications(
      {
        userId,
        userName: userData?.name || 'Utilisateur',
        userEmail: userData?.email || null,
        siteUrl,
        changes,
        currentCount,
        previousCount,
      },
      userChannels,
      flags
    )

    const summary: string[] = []
    if (result.email.attempted) summary.push(`email:${result.email.ok ? 'OK' : 'FAIL'}`)
    if (result.sms.attempted) summary.push(`sms:${result.sms.ok ? 'OK' : 'FAIL'}`)
    if (result.slack.attempted) summary.push(`slack:${result.slack.ok ? 'OK' : 'FAIL'}`)
    console.log(`[Alert Check] Notifications user=${userId} — ${summary.join(' · ') || 'aucune'}`)
  } catch (notifyErr) {
    console.error('[Alert Check] Erreur notifications (non bloquante):', notifyErr)
  }
}

// ─── Déclenchement du scraping par config d'alerte ──────────────────

interface ScrapingConfig {
  reference_url: string
  competitor_urls?: string[]
  categories?: string[]
}

async function triggerAlertScraping(userId: string, config: ScrapingConfig): Promise<boolean> {
  try {
    let ok = false

    // Toujours utiliser compare_from_cache (lecture depuis scraped_site_data)
    // Le cron GitHub Actions scrape tous les sites toutes les 30 min,
    // donc on n'a jamais besoin de re-scraper ici.
    if (hasBackend()) {
      ok = await triggerCacheAnalysisViaBackend(userId, config)
    } else {
      ok = await triggerCacheAnalysisLocal(userId, config)
    }

    // Fallback ultime : matching JS intégré pour garantir que les produits
    // appariés (prixReference / produitReference) soient présents dans le
    // dernier scraping — critique pour l'email de matching vs référence.
    if (!ok) {
      console.log(`[Alert Scrape] Fallback analyze-from-cache (JS) pour user ${userId}`)
      try {
        const result = await analyzeFromCache(userId)
        ok = result.ok
        if (ok) {
          console.log(
            `[Alert Scrape] Fallback OK: ${result.stats?.matchedProducts || 0} matches, ` +
            `${result.stats?.totalProducts || 0} produits`
          )
        } else {
          console.warn(`[Alert Scrape] Fallback échoué: ${result.error} — ${result.message}`)
        }
      } catch (err: any) {
        console.error(`[Alert Scrape] Fallback erreur:`, err.message)
      }
    }

    if (ok) {
      await linkScraperCacheToAlerts(userId, config.reference_url)
    }

    return ok
  } catch (err: any) {
    console.error(`[Alert Scrape] Erreur:`, err.message)
    return false
  }
}

async function triggerCacheAnalysisViaBackend(userId: string, config: ScrapingConfig): Promise<boolean> {
  try {
    console.log(`[Alert Analysis] Proxy backend → /products/analyze pour ref=${config.reference_url}`)

    const res = await proxyToBackend('/products/analyze', {
      body: {
        userId,
        referenceUrl: config.reference_url,
        competitorUrls: config.competitor_urls || [],
      },
      timeout: 120_000,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[Alert Analysis] Backend proxy erreur ${res.status}: ${text.slice(0, 200)}`)
      return false
    }

    console.log(`[Alert Analysis] Backend proxy OK pour user ${userId}`)
    return true
  } catch (err: any) {
    console.error(`[Alert Analysis] Backend proxy erreur:`, err.message)
    return false
  }
}

async function linkScraperCacheToAlerts(userId: string, referenceUrl: string): Promise<void> {
  try {
    const serviceSupabase = createServiceClient()
    let refHost: string
    try {
      refHost = new URL(referenceUrl).hostname.replace('www.', '').toLowerCase()
    } catch { return }

    const { data: caches } = await serviceSupabase
      .from('scraper_cache')
      .select('id, site_url')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (!caches?.length) return

    const match = caches.find((c: any) => {
      try {
        return new URL(c.site_url).hostname.replace('www.', '').toLowerCase() === refHost
      } catch { return false }
    })

    if (!match) return

    const { error } = await serviceSupabase
      .from('scraper_alerts')
      .update({ scraper_cache_id: match.id })
      .eq('user_id', userId)
      .eq('reference_url', referenceUrl)
      .is('scraper_cache_id', null)

    if (error) {
      console.warn(`[Alert Scrape] Liaison cache échouée:`, error.message)
    } else {
      console.log(`[Alert Scrape] Cache lié: ${match.id} → référence ${refHost}`)
    }
  } catch (err: any) {
    console.warn(`[Alert Scrape] Liaison cache erreur (non bloquante):`, err.message)
  }
}

async function triggerCacheAnalysisLocal(
  userId: string,
  config: ScrapingConfig
): Promise<boolean> {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
  const scriptPath = path.join(process.cwd(), '..', 'scripts', 'compare_from_cache.py')
  const args = [scriptPath, '--user-id', userId]

  if (config.reference_url) {
    args.push('--reference', config.reference_url)
  }
  if (config.competitor_urls?.length) {
    args.push('--competitors', config.competitor_urls.join(','))
  }

  const workingDir = path.join(process.cwd(), '..')

  console.log(`[Alert Analysis] Commande: ${pythonCmd} ${args.join(' ')}`)

  return new Promise<boolean>((resolve) => {
    const proc = spawn(pythonCmd, args, {
      cwd: workingDir,
      stdio: 'pipe',
      shell: false,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (d) => {
      const text = d.toString()
      stdout += text
      if (text.includes('✅') || text.includes('❌') || text.includes('📊')) {
        console.log(`[Alert Analysis] ${text.trim()}`)
      }
    })

    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[Alert Analysis] Analyse cache terminée pour user ${userId}`)
        resolve(true)
      } else {
        console.error(`[Alert Analysis] Analyse échouée (code ${code}): ${stderr.slice(-500)}`)
        resolve(false)
      }
    })

    proc.on('error', (err) => {
      console.warn(`[Alert Analysis] Python non disponible: ${err.message}`)
      resolve(false)
    })

    setTimeout(() => {
      if (!proc.killed) {
        proc.kill()
        console.warn(`[Alert Analysis] Timeout pour user ${userId}`)
        resolve(false)
      }
    }, 2 * 60 * 1000)
  })
}

// ─── Normalisation et extraction d'URL ──────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname.replace('www.', '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return url.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/www\./, 'https://')
  }
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

// ─── Filtrage des produits par site ─────────────────────────────────

function filterProductsBySite(products: Product[], siteUrl: string): Product[] {
  let targetHost = ''
  try {
    targetHost = new URL(siteUrl).hostname.replace('www.', '').toLowerCase()
  } catch {
    targetHost = siteUrl.toLowerCase()
  }

  return products.filter(p => {
    const productSite = p.sourceSite || p.sourceUrl || ''
    if (!productSite) return false
    try {
      const pHost = new URL(productSite).hostname.replace('www.', '').toLowerCase()
      return pHost === targetHost
    } catch {
      return productSite.toLowerCase().includes(targetHost)
    }
  })
}

/**
 * Filtre les produits catalogue du site référence.
 * Le site référence ne garde que les produits en inventaire réel (pas le catalogue
 * fabricant), pour comparer uniquement le stock en concession.
 * Les sites concurrents gardent TOUS leurs produits (catalogue inclus).
 */
function filterCatalogueFromReference(products: Product[]): Product[] {
  return products.filter(p => {
    const cat = (p.sourceCategorie || '').toLowerCase()
    return cat !== 'catalogue'
  })
}

// ─── Normalisation des noms de produits ──────────────────────────────

function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ')
    .replace(/[""''«»]/g, '')
    .replace(/\s+/g, ' ')
}

function productSecondaryKey(p: Product): string | null {
  const marque = (p.marque || '').toLowerCase().trim()
  const modele = (p.modele || '').toLowerCase().trim()
  if (!marque && !modele) return null
  return `${marque}|${modele}`
}

// ─── Détection des changements (avec seuils configurables) ──────────

function formatPrice(price: number): string {
  return `${price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`
}

function matchInfoFromProduct(p: Product): Record<string, any> {
  const matched = !!p.produitReference || typeof p.prixReference === 'number'
  if (!matched) return { is_matched_with_reference: false }
  return {
    is_matched_with_reference: true,
    reference_product_name: p.produitReference?.name || null,
    reference_product_url: p.produitReference?.sourceUrl || null,
    reference_price: typeof p.prixReference === 'number' ? p.prixReference : (p.produitReference?.prix ?? null),
    price_diff_vs_reference: typeof p.differencePrix === 'number' ? p.differencePrix : null,
    match_level: p.matchLevel || 'exact',
  }
}

function detectChanges(previous: Product[], current: Product[], config: AlertConfig, sourceSite: string): Change[] {
  const changes: Change[] = []

  const prevByName = new Map<string, Product>()
  const prevByKey  = new Map<string, Product>()
  for (const p of previous) {
    if (!p.name) continue
    prevByName.set(normalizeProductName(p.name), p)
    const sk = productSecondaryKey(p)
    if (sk) prevByKey.set(sk, p)
  }

  const currByName = new Map<string, Product>()
  const currByKey  = new Map<string, Product>()
  for (const p of current) {
    if (!p.name) continue
    currByName.set(normalizeProductName(p.name), p)
    const sk = productSecondaryKey(p)
    if (sk) currByKey.set(sk, p)
  }

  const matchedPrevKeys = new Set<string>()

  for (const [nameKey, curr] of currByName) {
    let prev = prevByName.get(nameKey)
    let prevMatchKey = nameKey

    if (!prev) {
      const sk = productSecondaryKey(curr)
      if (sk) {
        prev = prevByKey.get(sk)
        if (prev) prevMatchKey = normalizeProductName(prev.name)
      }
    }

    if (!prev) {
      if (config.watch_new_products && curr.prix && curr.prix >= MIN_VALID_PRICE) {
        changes.push({
          change_type: 'new_product',
          product_name: curr.name,
          old_value: null,
          new_value: formatPrice(curr.prix),
          percentage_change: null,
          details: {
            prix: curr.prix,
            disponibilite: curr.disponibilite,
            sourceUrl: curr.sourceUrl,
            image: curr.image || null,
            ...matchInfoFromProduct(curr),
          },
          source_site: sourceSite,
        })
      }
      continue
    }

    matchedPrevKeys.add(prevMatchKey)

    if (
      prev.prix && curr.prix &&
      prev.prix >= MIN_VALID_PRICE && curr.prix >= MIN_VALID_PRICE &&
      prev.prix !== curr.prix
    ) {
      const diff = curr.prix - prev.prix
      const pct = (diff / prev.prix) * 100

      if (Math.abs(pct) >= config.min_price_change_pct && Math.abs(diff) >= config.min_price_change_abs) {
        const isIncrease = pct > 0
        const changeType = isIncrease ? 'price_increase' : 'price_decrease'

        if ((isIncrease && config.watch_price_increase) || (!isIncrease && config.watch_price_decrease)) {
          changes.push({
            change_type: changeType,
            product_name: curr.name,
            old_value: formatPrice(prev.prix),
            new_value: formatPrice(curr.prix),
            percentage_change: Math.round(pct * 100) / 100,
            details: {
              old_prix: prev.prix,
              new_prix: curr.prix,
              diff: Math.round(diff * 100) / 100,
              sourceUrl: curr.sourceUrl,
              image: curr.image || null,
              ...matchInfoFromProduct(curr),
            },
            source_site: sourceSite,
          })
        }
      }
    }

    if (
      config.watch_stock_changes &&
      prev.disponibilite && curr.disponibilite &&
      prev.disponibilite.toLowerCase().trim() !== curr.disponibilite.toLowerCase().trim()
    ) {
      changes.push({
        change_type: 'stock_change',
        product_name: curr.name,
        old_value: prev.disponibilite,
        new_value: curr.disponibilite,
        percentage_change: null,
        details: {
          sourceUrl: curr.sourceUrl,
          image: curr.image || null,
          ...matchInfoFromProduct(curr),
        },
        source_site: sourceSite,
      })
    }
  }

  if (config.watch_removed_products) {
    for (const [nameKey, prev] of prevByName) {
      if (matchedPrevKeys.has(nameKey)) continue
      const sk = productSecondaryKey(prev)
      if (sk && currByKey.has(sk)) continue

      if (prev.prix && prev.prix >= MIN_VALID_PRICE) {
        changes.push({
          change_type: 'removed_product',
          product_name: prev.name,
          old_value: formatPrice(prev.prix),
          new_value: null,
          percentage_change: null,
          details: {
            prix: prev.prix,
            sourceUrl: prev.sourceUrl,
            image: prev.image || null,
            ...matchInfoFromProduct(prev),
          },
          source_site: sourceSite,
        })
      }
    }
  }

  return changes
}

// Le rendu HTML des emails d'alerte est désormais géré par
// @/lib/notifications/dispatcher (buildAlertEmailHtml).
