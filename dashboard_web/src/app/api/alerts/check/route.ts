import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { sendEmail } from '@/lib/resend'
import { spawn } from 'child_process'
import path from 'path'
import { hasBackend, proxyToBackend } from '@/lib/backend-proxy'

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

// ─── GET — Vercel Cron (toutes les heures) ──────────────────────────

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

const SCHEDULE_TOLERANCE_MS = 10 * 60_000 // 10 min de tolérance pour absorber les délais de cron

function isAlertDueForCheck(alert: any, now: Date): boolean {
  if (alert.schedule_type === 'interval' && alert.schedule_interval_hours) {
    if (!alert.last_run_at) return true
    const lastRun = new Date(alert.last_run_at)
    const nextDue = new Date(lastRun.getTime() + alert.schedule_interval_hours * 3600_000 - SCHEDULE_TOLERANCE_MS)
    return now >= nextDue
  }

  if (alert.schedule_type === 'daily') {
    const hour = alert.schedule_hour ?? 8
    return hour === now.getUTCHours()
  }

  if (!alert.last_run_at) return true
  const lastRun = new Date(alert.last_run_at)
  return now >= new Date(lastRun.getTime() + 3600_000 - SCHEDULE_TOLERANCE_MS)
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

              if (alert.email_notification) {
                await sendAlertEmailSafe(
                  userId,
                  refUrl,
                  cappedChanges,
                  totalCurrentCount,
                  totalPreviousCount,
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

// ─── Envoi d'email sécurisé ─────────────────────────────────────────

async function sendAlertEmailSafe(
  userId: string,
  siteUrl: string,
  changes: Change[],
  currentCount: number,
  previousCount: number,
  serviceSupabase: any
) {
  try {
    const { data: userData } = await serviceSupabase
      .from('users')
      .select('email, name')
      .eq('id', userId)
      .single()

    if (!userData?.email) {
      console.warn(`[Alert Check] User ${userId} n'a pas d'email, email non envoyé`)
      return
    }

    await sendAlertEmail(
      userData.email,
      userData.name || 'Utilisateur',
      siteUrl,
      changes,
      currentCount,
      previousCount
    )
    console.log(`[Alert Check] Email envoyé à ${userData.email}`)
  } catch (emailErr) {
    console.error('[Alert Check] Erreur email (non bloquante):', emailErr)
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

    // 1. Backend proxy (production Vercel → Railway)
    if (hasBackend()) {
      ok = await triggerViaBackendProxy(userId, config)
    }
    // 2. Webhook (custom scraper endpoint)
    else if (process.env.SCRAPER_WEBHOOK_URL) {
      ok = await triggerViaWebhook(process.env.SCRAPER_WEBHOOK_URL, userId, config)
    }
    // 3. Local Python
    else {
      ok = await triggerViaLocalPython(userId, config)
    }

    // Après scraping réussi, lier le scraper_cache si absent
    if (ok) {
      await linkScraperCacheToAlerts(userId, config.reference_url)
    }

    return ok
  } catch (err: any) {
    console.error(`[Alert Scrape] Erreur:`, err.message)
    return false
  }
}

async function triggerViaBackendProxy(userId: string, config: ScrapingConfig): Promise<boolean> {
  try {
    const allUrls = [
      config.reference_url,
      ...(config.competitor_urls || []).filter((url) => url && url !== config.reference_url),
    ]

    console.log(`[Alert Scrape] Proxy backend groupé pour ref=${config.reference_url} + ${allUrls.length - 1} concurrent(s)`)

    const batchRes = await proxyToBackend('/scraper-ai/run', {
      body: {
        userId,
        url: config.reference_url,
        urls: allUrls,
        referenceUrl: config.reference_url,
        categories: config.categories,
      },
      timeout: 30 * 60 * 1000,
    })
    if (!batchRes.ok) {
      const text = await batchRes.text().catch(() => '')
      console.error(`[Alert Scrape] Backend proxy erreur ${batchRes.status}: ${text.slice(0, 200)}`)
      return false
    }

    console.log(`[Alert Scrape] Backend proxy OK pour user ${userId}`)
    return true
  } catch (err: any) {
    console.error(`[Alert Scrape] Backend proxy erreur:`, err.message)
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

async function triggerViaWebhook(
  webhookUrl: string,
  userId: string,
  config: ScrapingConfig
): Promise<boolean> {
  try {
    console.log(`[Alert Scrape] Appel webhook: ${webhookUrl}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000)

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SCRAPER_WEBHOOK_SECRET
          ? { Authorization: `Bearer ${process.env.SCRAPER_WEBHOOK_SECRET}` }
          : {}),
      },
      body: JSON.stringify({
        user_id: userId,
        reference_url: config.reference_url,
        competitor_urls: config.competitor_urls || [],
        categories: config.categories || [],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[Alert Scrape] Webhook erreur ${res.status}: ${text.slice(0, 200)}`)
      return false
    }

    console.log(`[Alert Scrape] Webhook OK pour user ${userId}`)
    return true
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`[Alert Scrape] Webhook timeout pour user ${userId}`)
    } else {
      console.error(`[Alert Scrape] Webhook erreur:`, err.message)
    }
    return false
  }
}

async function triggerViaLocalPython(
  userId: string,
  config: ScrapingConfig
): Promise<boolean> {
  const referenceUrl = config.reference_url
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
  const args = [
    '-m', 'scraper_ai.main',
    '--reference', referenceUrl,
    '--user-id', userId,
  ]

  if (config.categories?.length) {
    args.push('--categories', config.categories.join(','))
  }

  // Le référent DOIT être dans les positionnels sinon le script sort immédiatement
  args.push(referenceUrl)

  if (config.competitor_urls?.length) {
    for (const url of config.competitor_urls) {
      if (url !== referenceUrl) args.push(url)
    }
  }

  const workingDir = path.join(process.cwd(), '..')

  console.log(`[Alert Scrape] Commande: ${pythonCmd} ${args.join(' ')}`)
  console.log(`[Alert Scrape] Répertoire: ${workingDir}`)

  return new Promise<boolean>((resolve) => {
    const proc = spawn(pythonCmd, args, {
      cwd: workingDir,
      stdio: 'pipe',
      shell: false,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        NEXTJS_API_URL: process.env.NEXTJS_API_URL || `http://localhost:${process.env.PORT || process.env.NEXT_DEV_PORT || 3000}`,
        SCRAPER_USER_ID: userId,
      },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (d) => {
      const text = d.toString()
      stdout += text
      if (text.includes('✅') || text.includes('❌') || text.includes('📈') || text.includes('ERROR')) {
        console.log(`[Alert Scrape] ${text.trim()}`)
      }
    })

    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[Alert Scrape] Scraping terminé avec succès pour user ${userId}`)
        resolve(true)
      } else {
        console.error(`[Alert Scrape] Scraping échoué (code ${code}): ${stderr.slice(-500)}`)
        resolve(false)
      }
    })

    proc.on('error', (err) => {
      console.warn(`[Alert Scrape] Python non disponible: ${err.message}`)
      resolve(false)
    })

    setTimeout(() => {
      if (!proc.killed) {
        proc.kill()
        console.warn(`[Alert Scrape] Timeout pour user ${userId}`)
        resolve(false)
      }
    }, 15 * 60 * 1000)
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
          details: { prix: curr.prix, disponibilite: curr.disponibilite, sourceUrl: curr.sourceUrl },
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
        details: { sourceUrl: curr.sourceUrl },
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
          details: { prix: prev.prix, sourceUrl: prev.sourceUrl },
          source_site: sourceSite,
        })
      }
    }
  }

  return changes
}

// ─── Email d'alerte ─────────────────────────────────────────────────

async function sendAlertEmail(
  email: string,
  name: string,
  siteUrl: string,
  changes: Change[],
  currentCount: number,
  previousCount: number
) {
  const priceIncreases = changes.filter(c => c.change_type === 'price_increase')
  const priceDecreases = changes.filter(c => c.change_type === 'price_decrease')
  const newProducts = changes.filter(c => c.change_type === 'new_product')
  const removedProducts = changes.filter(c => c.change_type === 'removed_product')
  const stockChanges = changes.filter(c => c.change_type === 'stock_change')

  let hostname = siteUrl
  try { hostname = new URL(siteUrl).hostname.replace('www.', '') } catch { /* ignore */ }

  const changesHtml = changes.slice(0, 20).map(c => {
    const icon = c.change_type === 'price_increase' ? '📈' :
                 c.change_type === 'price_decrease' ? '📉' :
                 c.change_type === 'new_product' ? '🆕' :
                 c.change_type === 'removed_product' ? '❌' : '🔄'
    const label = c.change_type === 'price_increase' ? 'Hausse' :
                  c.change_type === 'price_decrease' ? 'Baisse' :
                  c.change_type === 'new_product' ? 'Nouveau' :
                  c.change_type === 'removed_product' ? 'Retiré' : 'Stock'
    const pctBadge = c.percentage_change
      ? ` <span style="color:${c.percentage_change > 0 ? '#dc2626' : '#16a34a'};font-weight:700;">(${c.percentage_change > 0 ? '+' : ''}${c.percentage_change}%)</span>`
      : ''
    const siteBadge = c.source_site
      ? `<span style="display:inline-block;background:#eff6ff;color:#2563eb;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:500;margin-left:4px;">${c.source_site}</span>`
      : ''

    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${icon} ${label}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:500;max-width:250px;overflow:hidden;text-overflow:ellipsis;">${c.product_name || 'N/A'}${siteBadge}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${c.old_value || '—'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:${
        c.change_type === 'price_decrease' ? '#16a34a' :
        c.change_type === 'price_increase' ? '#dc2626' : '#2563eb'
      };">${c.new_value || '—'}${pctBadge}</td>
    </tr>`
  }).join('')

  const badges: string[] = []
  if (priceIncreases.length) badges.push(`<span style="color:#dc2626;">📈 ${priceIncreases.length} hausse${priceIncreases.length > 1 ? 's' : ''}</span>`)
  if (priceDecreases.length) badges.push(`<span style="color:#16a34a;">📉 ${priceDecreases.length} baisse${priceDecreases.length > 1 ? 's' : ''}</span>`)
  if (newProducts.length) badges.push(`<span style="color:#2563eb;">🆕 ${newProducts.length} nouveau${newProducts.length > 1 ? 'x' : ''}</span>`)
  if (removedProducts.length) badges.push(`<span style="color:#ea580c;">❌ ${removedProducts.length} retiré${removedProducts.length > 1 ? 's' : ''}</span>`)
  if (stockChanges.length) badges.push(`<span style="color:#7c3aed;">🔄 ${stockChanges.length} stock</span>`)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://go-data-dashboard.vercel.app'

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1f2937;max-width:700px;margin:0 auto;padding:24px;background:#f9fafb;">
  <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="margin-bottom:24px;">
      <h1 style="color:#2563eb;margin:0 0 4px;font-size:22px;">Go-Data — Rapport d'alerte</h1>
      <p style="color:#6b7280;margin:0;font-size:14px;">Bonjour ${name},</p>
    </div>

    <div style="background:linear-gradient(135deg,#eff6ff,#f0fdf4);border:1px solid #bfdbfe;padding:20px;border-radius:10px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-weight:700;font-size:16px;color:#1e40af;">
        ${changes.length} changement${changes.length > 1 ? 's' : ''} sur ${hostname}
      </p>
      <div style="font-size:13px;">${badges.join(' &middot; ')}</div>
      <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Produits : ${previousCount} &rarr; ${currentCount}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#1e293b;color:white;">
          <th style="padding:10px 12px;text-align:left;border-radius:8px 0 0 0;">Type</th>
          <th style="padding:10px 12px;text-align:left;">Produit</th>
          <th style="padding:10px 12px;text-align:left;">Avant</th>
          <th style="padding:10px 12px;text-align:left;border-radius:0 8px 0 0;">Après</th>
        </tr>
      </thead>
      <tbody style="background:#f9fafb;">${changesHtml}</tbody>
    </table>

    ${changes.length > 20 ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Et ${changes.length - 20} autres changements…</p>` : ''}

    <div style="margin-top:28px;text-align:center;">
      <a href="${appUrl}/dashboard/alerte" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
        Voir tous les détails
      </a>
    </div>
  </div>

  <p style="color:#9ca3af;font-size:11px;margin-top:24px;text-align:center;">
    Cet email est envoyé automatiquement par Go-Data.
    <a href="${appUrl}/dashboard/alerte" style="color:#9ca3af;">Gérer mes alertes</a>
  </p>
</body></html>`.trim()

  await sendEmail({
    to: email,
    subject: `Go-Data — ${changes.length} changement${changes.length > 1 ? 's' : ''} sur ${hostname}`,
    html,
  })
}
