/**
 * Récap quotidien des changements détectés, envoyé par email UNE fois par
 * jour, à l'heure choisie par chaque utilisateur (heure de l'Est).
 *
 * Déclenchement :
 *  - GitHub Actions appelle GET toutes les heures (`.github/workflows/email-digest.yml`).
 *    Chaque passage n'envoie qu'aux utilisateurs dont l'heure choisie == heure courante.
 *  - Vercel Cron appelle GET une fois par jour en fin de journée (filet de
 *    sécurité) : détecté via le user-agent `vercel-cron`, il passe en mode
 *    « rattrapage » et envoie aux utilisateurs dont l'heure est déjà passée
 *    mais qui n'ont rien reçu (ex. panne du cron horaire).
 *  - POST manuel depuis le dashboard (« Envoyer le récap maintenant ») :
 *    limité à l'utilisateur de la session, ignore l'heure et l'anti-doublon.
 *
 * Un email n'est envoyé QUE s'il y a au moins un changement dans la fenêtre.
 * Sécurisé par `CRON_SECRET` (header `Authorization: Bearer <token>`).
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import {
  dispatchDailyDigest,
  type UserChannelsConfig,
  type AlertChange,
} from '@/lib/notifications/dispatcher'
import {
  currentEasternHour,
  fetchDigestPrefsMap,
  defaultDigestPrefs,
  updateDigestPrefs,
  wasSentRecently,
} from '@/lib/notifications/digest-settings'

export const maxDuration = 300

const DEFAULT_SINCE_HOURS = 24

interface DigestRunOptions {
  sinceHours: number
  userId?: string
  dryRun: boolean
  /** Mode rattrapage : heure choisie <= heure courante (au lieu de ==). */
  catchUp: boolean
  /** Déclenchement manuel : ignore l'heure choisie et l'anti-doublon. */
  force: boolean
}

// ─── GET — Cron horaire (GitHub Actions) ou filet Vercel ────────────

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[Daily Digest] CRON_SECRET non configuré — endpoint non sécurisé en production')
  }

  const url = new URL(request.url)
  const sinceHours = parseInt(url.searchParams.get('since_hours') || '', 10) || DEFAULT_SINCE_HOURS
  const dryRun = url.searchParams.get('dry_run') === 'true'

  // Le cron Vercel (quotidien, fin de journée) sert de rattrapage.
  const userAgent = request.headers.get('user-agent') || ''
  const catchUp = url.searchParams.get('catch_up') === 'true' || userAgent.includes('vercel-cron')

  return runDailyDigest({ sinceHours, dryRun, catchUp, force: false })
}

// ─── POST — Déclenchement manuel (dashboard) ou test cron ──────────

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>))

  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const hasCronAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  let userId = typeof body.user_id === 'string' ? body.user_id : undefined

  if (!hasCronAuth) {
    // Sans secret cron, il faut une session — et on ne peut déclencher
    // le récap QUE pour soi-même.
    const sessionUser = await getCurrentUser().catch(() => null)
    if (!sessionUser) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    userId = sessionUser.id
  }

  const sinceHours = typeof body.since_hours === 'number' ? body.since_hours : DEFAULT_SINCE_HOURS
  const dryRun = body.dry_run === true
  // Un envoi manuel ignore l'heure programmée et l'anti-doublon.
  const force = hasCronAuth ? body.force === true : true

  return runDailyDigest({ sinceHours, userId, dryRun, catchUp: false, force })
}

// ─── Logique principale ─────────────────────────────────────────────

async function runDailyDigest(options: DigestRunOptions) {
  const startedAt = Date.now()
  const now = new Date()
  const serviceSupabase = createServiceClient()
  const sinceIso = new Date(now.getTime() - options.sinceHours * 3600_000).toISOString()
  const localHour = currentEasternHour(now)

  console.log(
    `[Daily Digest] Démarrage` +
    `${options.userId ? ` user=${options.userId}` : ''}` +
    ` since=${options.sinceHours}h localHour=${localHour}` +
    `${options.catchUp ? ' (catch_up)' : ''}${options.force ? ' (force)' : ''}${options.dryRun ? ' (dry_run)' : ''}`
  )

  try {
    // ── 1) Variations de la fenêtre ──
    let changesQuery = serviceSupabase
      .from('alert_changes')
      .select('id, alert_id, user_id, change_type, product_name, old_value, new_value, percentage_change, details, source_site, detected_at')
      .gte('detected_at', sinceIso)
      .order('detected_at', { ascending: false })
      .limit(5000)

    if (options.userId) {
      changesQuery = changesQuery.eq('user_id', options.userId)
    }

    const { data: changesRows, error: changesErr } = await changesQuery

    if (changesErr) {
      console.error('[Daily Digest] Erreur lecture alert_changes:', changesErr)
      return NextResponse.json({ error: changesErr.message }, { status: 500 })
    }

    if (!changesRows?.length) {
      console.log('[Daily Digest] Aucune variation sur la fenêtre — aucun email à envoyer.')
      return NextResponse.json({
        success: true,
        period_hours: options.sinceHours,
        local_hour: localHour,
        users_processed: 0,
        digests_sent: 0,
        total_changes: 0,
        elapsed_ms: Date.now() - startedAt,
      })
    }

    // ── 2) Filtrer les alertes dont l'email a été explicitement coupé ──
    // (une alerte supprimée ou désactivée ne bloque PAS le récap : les
    // changements détectés restent pertinents pour l'utilisateur)
    const alertIds = Array.from(new Set(changesRows.map(r => r.alert_id).filter(Boolean)))
    const mutedAlertIds = new Set<string>()
    if (alertIds.length > 0) {
      const { data: alertsRows } = await serviceSupabase
        .from('scraper_alerts')
        .select('id, email_notification')
        .in('id', alertIds)
      for (const a of alertsRows || []) {
        if (a.email_notification === false) mutedAlertIds.add(a.id)
      }
    }

    // ── 3) Grouper par utilisateur ──
    const changesByUser = new Map<string, AlertChange[]>()
    for (const row of changesRows) {
      if (!row.user_id) continue
      if (row.alert_id && mutedAlertIds.has(row.alert_id)) continue
      if (!changesByUser.has(row.user_id)) changesByUser.set(row.user_id, [])
      changesByUser.get(row.user_id)!.push({
        change_type: row.change_type,
        product_name: row.product_name || '',
        old_value: row.old_value,
        new_value: row.new_value,
        percentage_change: row.percentage_change,
        details: (row.details || {}) as Record<string, unknown>,
        source_site: row.source_site || '',
      })
    }

    // ── 4) Charger users + canaux + préférences digest ──
    const userIds = Array.from(changesByUser.keys())
    const [{ data: usersRows }, { data: channelsRows }, prefsMap] = await Promise.all([
      serviceSupabase.from('users').select('id, email, name').in('id', userIds),
      serviceSupabase
        .from('user_notification_channels')
        .select('user_id, email_enabled, email_address, sms_enabled, sms_phone, slack_enabled, slack_webhook_url, slack_channel')
        .in('user_id', userIds),
      fetchDigestPrefsMap(serviceSupabase, userIds),
    ])

    const userById = new Map<string, { email: string | null; name: string | null }>()
    for (const u of usersRows || []) {
      userById.set(u.id, { email: u.email || null, name: u.name || null })
    }

    const channelsByUser = new Map<string, UserChannelsConfig>()
    for (const c of channelsRows || []) {
      channelsByUser.set(c.user_id, {
        email_enabled: c.email_enabled ?? true,
        email_address: c.email_address || null,
        sms_enabled: !!c.sms_enabled,
        sms_phone: c.sms_phone || null,
        slack_enabled: !!c.slack_enabled,
        slack_webhook_url: c.slack_webhook_url || null,
        slack_channel: c.slack_channel || null,
      })
    }

    // ── 5) Envoyer chaque récap éligible ──
    let digestsSent = 0
    let skippedNotDue = 0
    let skippedAlreadySent = 0
    let skippedNoEmail = 0
    let totalChangesAggregated = 0
    const perUser: Array<Record<string, unknown>> = []

    for (const [userId, changes] of changesByUser) {
      totalChangesAggregated += changes.length
      const prefs = prefsMap.get(userId) || defaultDigestPrefs()

      // Heure d'envoi choisie par l'utilisateur
      if (!options.force) {
        if (!prefs.enabled) {
          skippedNotDue++
          perUser.push({ user_id: userId, sent: false, reason: 'digest_disabled' })
          continue
        }
        const due = options.catchUp ? prefs.hour <= localHour : prefs.hour === localHour
        if (!due) {
          skippedNotDue++
          continue
        }
        if (wasSentRecently(prefs, now)) {
          skippedAlreadySent++
          perUser.push({ user_id: userId, sent: false, reason: 'already_sent_recently' })
          continue
        }
      }

      const userInfo = userById.get(userId)
      const channels = channelsByUser.get(userId) || {
        email_enabled: true,
        email_address: userInfo?.email || null,
        sms_enabled: false,
        sms_phone: null,
        slack_enabled: false,
        slack_webhook_url: null,
        slack_channel: null,
      }

      const emailEnabled = channels.email_enabled ?? true
      const emailTarget = channels.email_address || userInfo?.email
      if (!emailEnabled || !emailTarget) {
        skippedNoEmail++
        perUser.push({ user_id: userId, sent: false, reason: 'email_disabled_or_missing' })
        continue
      }

      if (options.dryRun) {
        console.log(`[Daily Digest] [dry_run] user=${userId} → ${changes.length} changements (cible: ${emailTarget}, heure choisie: ${prefs.hour}h)`)
        digestsSent++
        perUser.push({ user_id: userId, sent: true, dry_run: true, changes: changes.length, target: emailTarget })
        continue
      }

      try {
        const result = await dispatchDailyDigest(
          {
            userId,
            userName: userInfo?.name || 'Utilisateur',
            userEmail: userInfo?.email || null,
            periodHours: options.sinceHours,
            changes,
            sendHourLocal: prefs.hour,
          },
          channels
        )

        if (result.email.attempted && result.email.ok) {
          digestsSent++
          perUser.push({ user_id: userId, sent: true, changes: changes.length, target: emailTarget })
          console.log(`[Daily Digest] ✅ user=${userId} → email envoyé (${changes.length} changements)`)
          const marked = await updateDigestPrefs(serviceSupabase, userId, { lastSentAt: now.toISOString() }, prefs)
          if (!marked.ok) {
            console.warn(`[Daily Digest] Impossible de marquer l'envoi pour user=${userId}: ${marked.error}`)
          }
        } else if (result.email.attempted && !result.email.ok) {
          perUser.push({ user_id: userId, sent: false, reason: 'send_failed', error: result.email.error })
          console.warn(`[Daily Digest] ❌ user=${userId} → email échoué: ${result.email.error}`)
        }
      } catch (err: any) {
        perUser.push({ user_id: userId, sent: false, reason: 'exception', error: err?.message })
        console.error(`[Daily Digest] Erreur user=${userId}:`, err?.message || err)
      }
    }

    const elapsedMs = Date.now() - startedAt
    console.log(
      `[Daily Digest] Terminé en ${elapsedMs}ms — ` +
      `users=${userIds.length} sent=${digestsSent} not_due=${skippedNotDue} ` +
      `already_sent=${skippedAlreadySent} no_email=${skippedNoEmail} changes=${totalChangesAggregated}`
    )

    return NextResponse.json({
      success: true,
      period_hours: options.sinceHours,
      local_hour: localHour,
      catch_up: options.catchUp,
      force: options.force,
      dry_run: options.dryRun,
      users_processed: userIds.length,
      digests_sent: digestsSent,
      skipped_not_due: skippedNotDue,
      skipped_already_sent: skippedAlreadySent,
      skipped_no_email: skippedNoEmail,
      total_changes: totalChangesAggregated,
      // Détail par utilisateur uniquement pour un envoi ciblé (manuel/test)
      ...(options.userId ? { detail: perUser } : {}),
      elapsed_ms: elapsedMs,
    })
  } catch (error: any) {
    console.error('[Daily Digest] Erreur fatale:', error)
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}
