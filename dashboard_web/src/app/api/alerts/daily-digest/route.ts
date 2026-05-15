/**
 * Récap quotidien agrégé des variations d'alertes.
 *
 * Pour chaque utilisateur ayant au moins une alerte active, on agrège
 * toutes les variations détectées (table `alert_changes`) sur la fenêtre
 * `since_hours` (24 h par défaut). Un seul email digest est envoyé par
 * utilisateur, et UNIQUEMENT si le total de variations > 0.
 *
 * Appelé par Vercel Cron (voir `vercel.json`).
 * Sécurisé par `CRON_SECRET` (header `Authorization: Bearer <token>`).
 *
 * Test manuel :
 *   curl -X POST https://app.go-data.co/api/alerts/daily-digest \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"user_id": "<uuid>", "since_hours": 24, "dry_run": true}'
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import {
  dispatchDailyDigest,
  type DigestAlertGroup,
  type UserChannelsConfig,
  type AlertChange,
} from '@/lib/notifications/dispatcher'

export const maxDuration = 300

const DEFAULT_SINCE_HOURS = 24

interface DigestRunOptions {
  sinceHours: number
  userId?: string
  dryRun: boolean
}

// ─── GET — Vercel Cron quotidien ────────────────────────────────────

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

  return runDailyDigest({ sinceHours, dryRun })
}

// ─── POST — Déclenchement manuel ou test ────────────────────────────

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>))

  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    const sessionUser = await getCurrentUser().catch(() => null)
    const hasCronAuth = authHeader === `Bearer ${cronSecret}`
    if (!hasCronAuth && !sessionUser) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
  }

  const sinceHours = typeof body.since_hours === 'number' ? body.since_hours : DEFAULT_SINCE_HOURS
  const userId = typeof body.user_id === 'string' ? body.user_id : undefined
  const dryRun = body.dry_run === true

  return runDailyDigest({ sinceHours, userId, dryRun })
}

// ─── Logique principale ─────────────────────────────────────────────

async function runDailyDigest(options: DigestRunOptions) {
  const startedAt = Date.now()
  const serviceSupabase = createServiceClient()
  const sinceIso = new Date(Date.now() - options.sinceHours * 3600_000).toISOString()

  console.log(
    `[Daily Digest] Démarrage` +
    `${options.userId ? ` user=${options.userId}` : ''}` +
    ` since=${options.sinceHours}h${options.dryRun ? ' (dry_run)' : ''}`
  )

  try {
    // ── 1) Récupérer toutes les variations de la fenêtre ──
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
        users_processed: 0,
        digests_sent: 0,
        total_changes: 0,
        elapsed_ms: Date.now() - startedAt,
      })
    }

    // ── 2) Grouper par user puis par alerte ──
    const changesByUser = new Map<string, Map<string, AlertChange[]>>()
    for (const row of changesRows) {
      if (!row.user_id || !row.alert_id) continue
      if (!changesByUser.has(row.user_id)) changesByUser.set(row.user_id, new Map())
      const byAlert = changesByUser.get(row.user_id)!
      if (!byAlert.has(row.alert_id)) byAlert.set(row.alert_id, [])
      byAlert.get(row.alert_id)!.push({
        change_type: row.change_type,
        product_name: row.product_name || '',
        old_value: row.old_value,
        new_value: row.new_value,
        percentage_change: row.percentage_change,
        details: (row.details || {}) as Record<string, unknown>,
        source_site: row.source_site || '',
      })
    }

    // ── 3) Charger les URLs de référence des alertes concernées ──
    const allAlertIds = new Set<string>()
    for (const byAlert of changesByUser.values()) {
      for (const aid of byAlert.keys()) allAlertIds.add(aid)
    }

    const alertUrlMap = new Map<string, string>()
    if (allAlertIds.size > 0) {
      const { data: alertsRows } = await serviceSupabase
        .from('scraper_alerts')
        .select('id, reference_url, is_active, email_notification')
        .in('id', Array.from(allAlertIds))

      for (const a of alertsRows || []) {
        // On ne digère que les alertes encore actives avec l'email activé.
        if (a.is_active === false) continue
        if (a.email_notification === false) continue
        if (a.reference_url) alertUrlMap.set(a.id, a.reference_url as string)
      }
    }

    // ── 4) Charger users + canaux ──
    const userIds = Array.from(changesByUser.keys())
    const { data: usersRows } = await serviceSupabase
      .from('users')
      .select('id, email, name')
      .in('id', userIds)

    const userById = new Map<string, { email: string | null; name: string | null }>()
    for (const u of usersRows || []) {
      userById.set(u.id, { email: u.email || null, name: u.name || null })
    }

    const { data: channelsRows } = await serviceSupabase
      .from('user_notification_channels')
      .select('user_id, email_enabled, email_address, sms_enabled, sms_phone, slack_enabled, slack_webhook_url, slack_channel')
      .in('user_id', userIds)

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

    // ── 5) Construire et envoyer chaque digest ──
    let digestsSent = 0
    let usersSkippedNoChanges = 0
    let usersSkippedNoEmail = 0
    let totalChangesAggregated = 0

    for (const [userId, byAlert] of changesByUser) {
      const groups: DigestAlertGroup[] = []
      for (const [alertId, changes] of byAlert) {
        const refUrl = alertUrlMap.get(alertId)
        if (!refUrl) continue // alerte inactive, supprimée, ou email désactivé
        groups.push({ alertId, siteUrl: refUrl, changes })
      }

      const totalForUser = groups.reduce((s, g) => s + g.changes.length, 0)
      totalChangesAggregated += totalForUser

      if (totalForUser === 0 || groups.length === 0) {
        usersSkippedNoChanges++
        continue
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
        usersSkippedNoEmail++
        continue
      }

      if (options.dryRun) {
        console.log(
          `[Daily Digest] [dry_run] user=${userId} → ${totalForUser} variations sur ${groups.length} alerte(s) (cible: ${emailTarget})`
        )
        digestsSent++
        continue
      }

      try {
        const result = await dispatchDailyDigest(
          {
            userId,
            userName: userInfo?.name || 'Utilisateur',
            userEmail: userInfo?.email || null,
            periodHours: options.sinceHours,
            groups,
          },
          channels
        )

        if (result.email.attempted && result.email.ok) {
          digestsSent++
          console.log(
            `[Daily Digest] ✅ user=${userId} → email envoyé (${totalForUser} variations / ${groups.length} alertes)`
          )
        } else if (result.email.attempted && !result.email.ok) {
          console.warn(`[Daily Digest] ❌ user=${userId} → email échoué: ${result.email.error}`)
        }
      } catch (err: any) {
        console.error(`[Daily Digest] Erreur user=${userId}:`, err?.message || err)
      }
    }

    const elapsedMs = Date.now() - startedAt
    console.log(
      `[Daily Digest] Terminé en ${elapsedMs}ms — ` +
      `users_processed=${userIds.length} digests_sent=${digestsSent} ` +
      `skipped_no_changes=${usersSkippedNoChanges} skipped_no_email=${usersSkippedNoEmail} ` +
      `total_changes=${totalChangesAggregated}`
    )

    return NextResponse.json({
      success: true,
      period_hours: options.sinceHours,
      dry_run: options.dryRun,
      users_processed: userIds.length,
      digests_sent: digestsSent,
      skipped_no_changes: usersSkippedNoChanges,
      skipped_no_email: usersSkippedNoEmail,
      total_changes: totalChangesAggregated,
      elapsed_ms: elapsedMs,
    })
  } catch (error: any) {
    console.error('[Daily Digest] Erreur fatale:', error)
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  }
}
