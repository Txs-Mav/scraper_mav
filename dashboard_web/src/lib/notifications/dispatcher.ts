/**
 * Dispatcher multi-canal pour les alertes Go-Data.
 * Orchestre l'envoi vers email (Resend), SMS (Twilio) et Slack (Incoming Webhook)
 * en fonction des préférences utilisateur et des toggles par alerte.
 */

import { sendEmail } from '@/lib/resend'
import { sendSms, isTwilioConfigured, normalizePhone } from './twilio'
import { sendSlackMessage, isValidSlackWebhook, buildAlertSlackBlocks } from './slack'

export interface AlertChange {
  change_type: string
  product_name: string
  old_value: string | null
  new_value: string | null
  percentage_change: number | null
  details: Record<string, unknown>
  source_site: string
}

export interface AlertNotificationPayload {
  userId: string
  userName: string
  userEmail: string | null
  siteUrl: string
  changes: AlertChange[]
  currentCount: number
  previousCount: number
}

export interface AlertChannelFlags {
  email: boolean
  sms: boolean
  slack: boolean
}

export interface UserChannelsConfig {
  email_enabled: boolean
  email_address: string | null
  sms_enabled: boolean
  sms_phone: string | null
  slack_enabled: boolean
  slack_webhook_url: string | null
  slack_channel: string | null
}

export interface DispatchResult {
  email: { attempted: boolean; ok: boolean; error?: string }
  sms: { attempted: boolean; ok: boolean; error?: string }
  slack: { attempted: boolean; ok: boolean; error?: string }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

function groupLabel(type: string): string {
  switch (type) {
    case 'price_increase': return 'Hausse'
    case 'price_decrease': return 'Baisse'
    case 'new_product': return 'Nouveau'
    case 'removed_product': return 'Retiré'
    case 'stock_change': return 'Stock'
    default: return type
  }
}

function groupEmoji(type: string): string {
  switch (type) {
    case 'price_increase': return '📈'
    case 'price_decrease': return '📉'
    case 'new_product': return '🆕'
    case 'removed_product': return '❌'
    case 'stock_change': return '🔄'
    default: return '🔔'
  }
}

function summarize(changes: AlertChange[]) {
  const counts: Record<string, number> = {}
  for (const c of changes) {
    counts[c.change_type] = (counts[c.change_type] || 0) + 1
  }
  return [
    { type: 'price_increase', label: 'hausses', emoji: '📈', count: counts.price_increase || 0 },
    { type: 'price_decrease', label: 'baisses', emoji: '📉', count: counts.price_decrease || 0 },
    { type: 'new_product', label: 'nouveaux', emoji: '🆕', count: counts.new_product || 0 },
    { type: 'removed_product', label: 'retirés', emoji: '❌', count: counts.removed_product || 0 },
    { type: 'stock_change', label: 'stock', emoji: '🔄', count: counts.stock_change || 0 },
  ]
}

// ─── SMS ─────────────────────────────────────────────────────────────

function buildSmsBody(payload: AlertNotificationPayload, dashboardUrl: string): string {
  const hostname = hostnameOf(payload.siteUrl)
  const sum = summarize(payload.changes).filter(s => s.count > 0)
  const summaryLine = sum.map(s => `${s.count} ${s.label}`).join(', ') || 'changements détectés'
  const head = `Go-Data: ${payload.changes.length} changement${payload.changes.length > 1 ? 's' : ''} sur ${hostname} (${summaryLine}).`

  const top = payload.changes.slice(0, 3).map(c => {
    const pct = typeof c.percentage_change === 'number' ? ` ${c.percentage_change > 0 ? '+' : ''}${c.percentage_change}%` : ''
    return `${groupEmoji(c.change_type)} ${c.product_name}${pct}`
  }).join(' | ')

  return `${head}${top ? '\n' + top : ''}\n${dashboardUrl}/dashboard/alerte`
}

// ─── Slack ───────────────────────────────────────────────────────────

function buildSlackPayload(payload: AlertNotificationPayload, dashboardUrl: string) {
  const hostname = hostnameOf(payload.siteUrl)
  const sum = summarize(payload.changes)
  const top = payload.changes.slice(0, 8).map(c => ({
    label: groupLabel(c.change_type),
    product: c.product_name,
    oldValue: c.old_value,
    newValue: c.new_value,
    pct: c.percentage_change,
  }))

  const text = `Go-Data — ${payload.changes.length} changement${payload.changes.length > 1 ? 's' : ''} sur ${hostname}`
  const blocks = buildAlertSlackBlocks({
    hostname,
    totalChanges: payload.changes.length,
    summary: sum,
    topChanges: top,
    dashboardUrl: `${dashboardUrl}/dashboard/alerte`,
  })

  return { text, blocks }
}

// ─── Email HTML ──────────────────────────────────────────────────────

function fmtMoney(n: unknown): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n || ''))
  if (!isFinite(v) || v <= 0) return '—'
  return `${v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`
}

function buildMatchedProductsTable(changes: AlertChange[]): { html: string; count: number } {
  const matched = changes.filter(c => {
    const d = c.details as Record<string, any>
    return d?.is_matched_with_reference === true
  })
  if (matched.length === 0) return { html: '', count: 0 }

  const rows = matched.slice(0, 25).map(c => {
    const d = c.details as Record<string, any>
    const refPrice = typeof d.reference_price === 'number' ? d.reference_price : null
    const currPrice = typeof d.new_prix === 'number'
      ? d.new_prix
      : (typeof d.prix === 'number' ? d.prix : null)
    const diff = typeof d.price_diff_vs_reference === 'number'
      ? d.price_diff_vs_reference
      : (refPrice !== null && currPrice !== null ? currPrice - refPrice : null)

    let diffLabel = '—'
    let diffColor = '#6b7280'
    if (diff !== null && refPrice) {
      const pct = (diff / refPrice) * 100
      const sign = diff > 0 ? '+' : ''
      diffLabel = `${sign}${diff.toFixed(0)} $ (${sign}${pct.toFixed(1)}%)`
      diffColor = diff > 0 ? '#dc2626' : diff < 0 ? '#16a34a' : '#6b7280'
    }

    const refName = d.reference_product_name || '—'
    const siteBadge = c.source_site
      ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${c.source_site}</div>`
      : ''

    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;max-width:240px;">
        <div style="font-weight:600;color:#111827;word-break:break-word;">${c.product_name || 'N/A'}</div>
        ${siteBadge}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;max-width:220px;word-break:break-word;">${refName}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;color:#6b7280;text-align:right;">${refPrice !== null ? fmtMoney(refPrice) : '—'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;font-weight:600;color:#111827;text-align:right;">${currPrice !== null ? fmtMoney(currPrice) : '—'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;font-weight:700;color:${diffColor};text-align:right;">${diffLabel}</td>
    </tr>`
  }).join('')

  const table = `
    <h2 style="margin:24px 0 8px;font-size:14px;color:#1e293b;text-transform:uppercase;letter-spacing:.04em;">Produits en correspondance avec la référence (${matched.length})</h2>
    <p style="color:#6b7280;font-size:12px;margin:0 0 10px;">Changements sur des produits appariés avec votre site de référence.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#0f172a;color:white;">
          <th style="padding:10px 12px;text-align:left;">Produit concurrent</th>
          <th style="padding:10px 12px;text-align:left;">Produit référence</th>
          <th style="padding:10px 12px;text-align:right;">Prix réf.</th>
          <th style="padding:10px 12px;text-align:right;">Prix actuel</th>
          <th style="padding:10px 12px;text-align:right;">Écart</th>
        </tr>
      </thead>
      <tbody style="background:#ffffff;">${rows}</tbody>
    </table>
    ${matched.length > 25 ? `<p style="color:#6b7280;font-size:12px;margin-top:6px;">Et ${matched.length - 25} autres produits appariés…</p>` : ''}
  `
  return { html: table, count: matched.length }
}

function buildAlertEmailHtml(payload: AlertNotificationPayload, dashboardUrl: string): string {
  const hostname = hostnameOf(payload.siteUrl)
  const sum = summarize(payload.changes)

  const { html: matchedTableHtml, count: matchedCount } = buildMatchedProductsTable(payload.changes)

  const changesHtml = payload.changes.slice(0, 20).map(c => {
    const pctBadge = typeof c.percentage_change === 'number'
      ? ` <span style="color:${c.percentage_change > 0 ? '#dc2626' : '#16a34a'};font-weight:700;">(${c.percentage_change > 0 ? '+' : ''}${c.percentage_change}%)</span>`
      : ''
    const siteBadge = c.source_site
      ? `<span style="display:inline-block;background:#eff6ff;color:#2563eb;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:500;margin-left:4px;">${c.source_site}</span>`
      : ''
    const matchedBadge = (c.details as Record<string, any>)?.is_matched_with_reference
      ? '<span style="display:inline-block;background:#ecfdf5;color:#047857;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;margin-left:4px;">★ Match réf.</span>'
      : ''
    const color = c.change_type === 'price_decrease' ? '#16a34a'
      : c.change_type === 'price_increase' ? '#dc2626' : '#2563eb'
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${groupEmoji(c.change_type)} ${groupLabel(c.change_type)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:500;max-width:250px;overflow:hidden;text-overflow:ellipsis;">${c.product_name || 'N/A'}${siteBadge}${matchedBadge}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${c.old_value || '—'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:${color};">${c.new_value || '—'}${pctBadge}</td>
    </tr>`
  }).join('')

  const badges = sum.filter(s => s.count > 0).map(s => {
    const color = s.type === 'price_increase' ? '#dc2626'
      : s.type === 'price_decrease' ? '#16a34a'
      : s.type === 'new_product' ? '#2563eb'
      : s.type === 'removed_product' ? '#ea580c' : '#7c3aed'
    return `<span style="color:${color};">${s.emoji} ${s.count} ${s.label}</span>`
  }).join(' &middot; ')

  const matchBadge = matchedCount > 0
    ? `<span style="display:inline-block;background:#d1fae5;color:#065f46;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-left:8px;">★ ${matchedCount} match${matchedCount > 1 ? 's' : ''} réf.</span>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1f2937;max-width:720px;margin:0 auto;padding:24px;background:#f9fafb;">
  <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="margin-bottom:24px;">
      <h1 style="color:#2563eb;margin:0 0 4px;font-size:22px;">Go-Data — Rapport d'alerte</h1>
      <p style="color:#6b7280;margin:0;font-size:14px;">Bonjour ${payload.userName},</p>
    </div>

    <div style="background:linear-gradient(135deg,#eff6ff,#f0fdf4);border:1px solid #bfdbfe;padding:20px;border-radius:10px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-weight:700;font-size:16px;color:#1e40af;">
        ${payload.changes.length} changement${payload.changes.length > 1 ? 's' : ''} sur ${hostname}${matchBadge}
      </p>
      <div style="font-size:13px;">${badges}</div>
      <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Produits : ${payload.previousCount} &rarr; ${payload.currentCount}</p>
    </div>

    ${matchedTableHtml}

    <h2 style="margin:24px 0 8px;font-size:14px;color:#1e293b;text-transform:uppercase;letter-spacing:.04em;">Tous les changements</h2>
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

    ${payload.changes.length > 20 ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Et ${payload.changes.length - 20} autres changements…</p>` : ''}

    <div style="margin-top:28px;text-align:center;">
      <a href="${dashboardUrl}/dashboard/alerte" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
        Voir tous les détails
      </a>
    </div>
  </div>

  <p style="color:#9ca3af;font-size:11px;margin-top:24px;text-align:center;">
    Cet email est envoyé automatiquement par Go-Data.
    <a href="${dashboardUrl}/dashboard/settings" style="color:#9ca3af;">Gérer mes canaux de notification</a>
  </p>
</body></html>`.trim()
}

// ─── Dispatcher principal ────────────────────────────────────────────

/**
 * Envoie les notifications d'alerte sur tous les canaux activés.
 * Chaque canal est indépendant : une erreur sur l'un n'empêche pas les autres.
 */
export async function dispatchAlertNotifications(
  payload: AlertNotificationPayload,
  userChannels: UserChannelsConfig | null,
  alertFlags: AlertChannelFlags
): Promise<DispatchResult> {
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://go-data-dashboard.vercel.app'
  const hostname = hostnameOf(payload.siteUrl)

  const result: DispatchResult = {
    email: { attempted: false, ok: false },
    sms: { attempted: false, ok: false },
    slack: { attempted: false, ok: false },
  }

  // ── EMAIL ──
  const emailEnabled = alertFlags.email && (userChannels?.email_enabled ?? true)
  const emailTarget = userChannels?.email_address || payload.userEmail
  if (emailEnabled && emailTarget) {
    result.email.attempted = true
    try {
      await sendEmail({
        to: emailTarget,
        subject: `Go-Data — ${payload.changes.length} changement${payload.changes.length > 1 ? 's' : ''} sur ${hostname}`,
        html: buildAlertEmailHtml(payload, dashboardUrl),
      })
      result.email.ok = true
    } catch (err: any) {
      result.email.error = err?.message || String(err)
      console.error('[Notifications] Échec email:', result.email.error)
    }
  }

  // ── SMS ──
  const smsEnabled = alertFlags.sms && !!userChannels?.sms_enabled
  const smsTarget = userChannels?.sms_phone && normalizePhone(userChannels.sms_phone)
  if (smsEnabled && smsTarget && isTwilioConfigured()) {
    result.sms.attempted = true
    try {
      await sendSms({ to: smsTarget, body: buildSmsBody(payload, dashboardUrl) })
      result.sms.ok = true
    } catch (err: any) {
      result.sms.error = err?.message || String(err)
      console.error('[Notifications] Échec SMS:', result.sms.error)
    }
  } else if (smsEnabled && !isTwilioConfigured()) {
    result.sms.error = 'Twilio non configuré côté serveur'
  }

  // ── SLACK ──
  const slackEnabled = alertFlags.slack && !!userChannels?.slack_enabled
  const slackWebhook = userChannels?.slack_webhook_url
  if (slackEnabled && slackWebhook && isValidSlackWebhook(slackWebhook)) {
    result.slack.attempted = true
    try {
      const { text, blocks } = buildSlackPayload(payload, dashboardUrl)
      await sendSlackMessage(slackWebhook, {
        text,
        blocks,
        ...(userChannels?.slack_channel ? { channel: userChannels.slack_channel } : {}),
      })
      result.slack.ok = true
    } catch (err: any) {
      result.slack.error = err?.message || String(err)
      console.error('[Notifications] Échec Slack:', result.slack.error)
    }
  }

  return result
}

// ─── Helpers pour les tests unitaires de canaux ─────────────────────

export async function sendTestEmail(to: string, userName: string): Promise<void> {
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://go-data-dashboard.vercel.app'
  await sendEmail({
    to,
    subject: 'Go-Data — Test de notification email',
    html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;padding:24px;">
      <h2 style="color:#2563eb;">✅ Email de test reçu</h2>
      <p>Bonjour ${userName},</p>
      <p>Ceci est un message de test confirmant que votre canal <strong>email</strong> est bien configuré pour recevoir les alertes Go-Data.</p>
      <p style="margin-top:24px;"><a href="${dashboardUrl}/dashboard/settings" style="color:#2563eb;">Gérer mes canaux</a></p>
    </body></html>`,
  })
}

export async function sendTestSms(to: string): Promise<void> {
  if (!isTwilioConfigured()) {
    throw new Error('Twilio non configuré côté serveur')
  }
  const normalized = normalizePhone(to)
  if (!normalized) throw new Error('Numéro de téléphone invalide')
  await sendSms({
    to: normalized,
    body: 'Go-Data: ✅ Test de notification SMS réussi. Vos alertes arriveront sur ce numéro.',
  })
}

export async function sendTestSlack(webhookUrl: string, channel?: string | null): Promise<void> {
  await sendSlackMessage(webhookUrl, {
    text: '✅ Go-Data — Test de notification Slack réussi. Vos alertes arriveront ici.',
    ...(channel ? { channel } : {}),
  })
}
