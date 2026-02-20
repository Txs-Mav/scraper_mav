import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail } from '@/lib/resend'
import { spawn } from 'child_process'
import path from 'path'

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
}

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

  return runAlertCheck({ fromCron: true })
}

// ─── POST — Appel manuel depuis le dashboard ────────────────────────

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  return runAlertCheck({ alertId: body.alert_id, fromCron: false })
}

// ─── Logique principale ─────────────────────────────────────────────

async function runAlertCheck(options: { alertId?: string; fromCron: boolean }) {
  try {
    const serviceSupabase = createServiceClient()

    // ── Récupérer les alertes à traiter ──
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
      .eq('is_active', true)

    if (options.alertId) {
      alertsQuery = alertsQuery.eq('id', options.alertId)
    } else if (options.fromCron) {
      const currentHour = new Date().getUTCHours()
      alertsQuery = alertsQuery.eq('schedule_hour', currentHour)
    }

    const { data: alerts, error: alertsError } = await alertsQuery

    if (alertsError) {
      console.error('[Alert Check] DB error:', alertsError)
      return NextResponse.json({ error: alertsError.message }, { status: 500 })
    }

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

    for (const [userId, userAlerts] of alertsByUser) {
      try {
        // ── Étape 1 : Déclencher un nouveau scraping (cron uniquement) ──
        if (options.fromCron) {
          console.log(`[Alert Check] Déclenchement du scraping pour user ${userId}...`)
          const scrapingOk = await triggerUserScraping(userId, serviceSupabase)
          if (!scrapingOk) {
            console.warn(`[Alert Check] Scraping échoué/indisponible pour user ${userId}, comparaison des données existantes`)
          }
        }

        // ── Étape 2 : Pour chaque alerte, comparer et détecter les changements ──
        for (const alert of userAlerts) {
          try {
            const siteUrl = alert.scraper_cache?.site_url
            if (!siteUrl) {
              console.warn(`[Alert Check] Alerte ${alert.id} sans site_url, ignorée`)
              continue
            }

            // Récupérer les 2 derniers scrapings de l'utilisateur
            const { data: scrapings } = await serviceSupabase
              .from('scrapings')
              .select('id, products, metadata, created_at')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(2)

            if (!scrapings || scrapings.length < 2) {
              console.log(`[Alert Check] Alerte ${alert.id}: pas assez de scrapings pour comparer`)
              await serviceSupabase
                .from('scraper_alerts')
                .update({ last_run_at: new Date().toISOString() })
                .eq('id', alert.id)
              totalChecked++
              continue
            }

            // ── DÉDUPLICATION : ne pas re-détecter les mêmes changements ──
            // On vérifie que le scraping le plus récent est PLUS RÉCENT que le dernier check
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

            // ── Filtrer les produits par le site surveillé ──
            const currentSiteProducts = filterProductsBySite(currentProducts, siteUrl)
            const previousSiteProducts = filterProductsBySite(previousProducts, siteUrl)

            console.log(
              `[Alert Check] Alerte ${alert.id} (${siteUrl}): ` +
              `${previousSiteProducts.length} → ${currentSiteProducts.length} produits`
            )

            // Première exécution — pas de données précédentes pour ce site
            if (previousSiteProducts.length === 0) {
              console.log(`[Alert Check] Alerte ${alert.id}: première exécution, pas de base de comparaison`)
              await serviceSupabase
                .from('scraper_alerts')
                .update({ last_run_at: new Date().toISOString() })
                .eq('id', alert.id)
              totalChecked++
              continue
            }

            // ── PROTECTION scraping raté : si 0 produits courants mais N produits précédents,
            // c'est probablement un scraping échoué — ne pas signaler tous comme "retirés" ──
            if (currentSiteProducts.length === 0 && previousSiteProducts.length > 0) {
              console.warn(
                `[Alert Check] Alerte ${alert.id}: 0 produits courants mais ${previousSiteProducts.length} précédents — ` +
                `scraping probablement échoué, skip pour éviter faux positifs`
              )
              await serviceSupabase
                .from('scraper_alerts')
                .update({ last_run_at: new Date().toISOString() })
                .eq('id', alert.id)
              totalChecked++
              continue
            }

            // Protection supplémentaire : si le nombre de produits chute de >80%,
            // c'est suspect (scraping partiel) — on prévient mais on continue
            const dropRatio = previousSiteProducts.length > 0
              ? currentSiteProducts.length / previousSiteProducts.length
              : 1
            if (dropRatio < 0.2 && previousSiteProducts.length > 5) {
              console.warn(
                `[Alert Check] Alerte ${alert.id}: chute suspecte de ${previousSiteProducts.length} → ${currentSiteProducts.length} produits (${Math.round(dropRatio * 100)}%)`
              )
            }

            // ── Détecter les changements ──
            const changes = detectChanges(previousSiteProducts, currentSiteProducts)

            if (changes.length > 0) {
              console.log(`[Alert Check] Alerte ${alert.id}: ${changes.length} changement(s) détecté(s)`)

              const changesToInsert = changes.map(c => ({
                alert_id: alert.id,
                user_id: userId,
                change_type: c.change_type,
                product_name: c.product_name,
                old_value: c.old_value,
                new_value: c.new_value,
                percentage_change: c.percentage_change,
                details: c.details,
                detected_at: new Date().toISOString(),
              }))

              const { error: insertErr } = await serviceSupabase
                .from('alert_changes')
                .insert(changesToInsert)

              if (insertErr) {
                console.error(`[Alert Check] Erreur insertion changements:`, insertErr)
              }

              // ── Envoyer l'email de résumé ──
              if (alert.email_notification) {
                await sendAlertEmailSafe(
                  userId,
                  siteUrl,
                  changes,
                  currentSiteProducts.length,
                  previousSiteProducts.length,
                  serviceSupabase
                )
              }

              totalChanges += changes.length

              await serviceSupabase
                .from('scraper_alerts')
                .update({
                  last_run_at: new Date().toISOString(),
                  last_change_detected_at: new Date().toISOString(),
                })
                .eq('id', alert.id)
            } else {
              console.log(`[Alert Check] Alerte ${alert.id}: aucun changement`)
              await serviceSupabase
                .from('scraper_alerts')
                .update({ last_run_at: new Date().toISOString() })
                .eq('id', alert.id)
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

    console.log(
      `[Alert Check] Terminé: ${totalChecked} vérifié(s), ${totalChanges} changement(s), ${totalSkipped} ignoré(s) (pas de nouveau scraping)`
    )

    return NextResponse.json({
      success: true,
      checked: totalChecked,
      changes_detected: totalChanges,
      skipped_no_new_data: totalSkipped,
    })
  } catch (error: any) {
    console.error('[Alert Check] Erreur fatale:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ─── Envoi d'email sécurisé (ne crashe pas le flow si email échoue) ──

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

// ─── Déclenchement du scraping ──────────────────────────────────────

/**
 * Déclenche le scraping pour un utilisateur.
 *
 * Stratégie en 2 étapes :
 * 1. Si SCRAPER_WEBHOOK_URL est configuré → appel HTTP (production Vercel)
 * 2. Sinon → spawn Python local (développement / VPS)
 */
async function triggerUserScraping(userId: string, serviceSupabase: any): Promise<boolean> {
  try {
    const { data: config } = await serviceSupabase
      .from('scraper_config')
      .select('reference_url, competitor_urls, categories')
      .eq('user_id', userId)
      .single()

    if (!config?.reference_url) {
      console.warn(`[Alert Scrape] Pas de config scraper pour user ${userId}`)
      return false
    }

    // ── Stratégie 1 : Webhook HTTP (pour Vercel / production serverless) ──
    const webhookUrl = process.env.SCRAPER_WEBHOOK_URL
    if (webhookUrl) {
      return triggerViaWebhook(webhookUrl, userId, config)
    }

    // ── Stratégie 2 : Spawn Python local ──
    return triggerViaLocalPython(userId, config)
  } catch (err: any) {
    console.error(`[Alert Scrape] Erreur:`, err.message)
    return false
  }
}

async function triggerViaWebhook(
  webhookUrl: string,
  userId: string,
  config: { reference_url: string; competitor_urls?: string[]; categories?: string[] }
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
  config: { reference_url: string; competitor_urls?: string[]; categories?: string[] }
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
        NEXTJS_API_URL: process.env.NEXTJS_API_URL || `http://localhost:${process.env.PORT || 3000}`,
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

// ─── Détection des changements ──────────────────────────────────────

const MIN_PRICE_CHANGE_PCT = 1
const MIN_PRICE_CHANGE_ABS = 2
const MIN_VALID_PRICE = 1

function formatPrice(price: number): string {
  return `${price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`
}

function detectChanges(previous: Product[], current: Product[]): Change[] {
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
      if (curr.prix && curr.prix >= MIN_VALID_PRICE) {
        changes.push({
          change_type: 'new_product',
          product_name: curr.name,
          old_value: null,
          new_value: formatPrice(curr.prix),
          percentage_change: null,
          details: { prix: curr.prix, disponibilite: curr.disponibilite, sourceUrl: curr.sourceUrl },
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

      if (Math.abs(pct) >= MIN_PRICE_CHANGE_PCT && Math.abs(diff) >= MIN_PRICE_CHANGE_ABS) {
        changes.push({
          change_type: pct > 0 ? 'price_increase' : 'price_decrease',
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
        })
      }
    }

    if (
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
      })
    }
  }

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
      })
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

    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${icon} ${label}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:500;max-width:250px;overflow:hidden;text-overflow:ellipsis;">${c.product_name || 'N/A'}</td>
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
      <h1 style="color:#2563eb;margin:0 0 4px;font-size:22px;">Go-Data — Rapport quotidien</h1>
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
