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

/**
 * Email d'alerte ponctuelle — même langage visuel que le site et que le
 * récap quotidien : palette stone + accents orange, aucune emoji, badges
 * de type discrets, tableaux propres à en-tête sombre.
 * Exporté pour les aperçus/tests uniquement.
 */
export function buildAlertEmailHtml(payload: AlertNotificationPayload, dashboardUrl: string): string {
  const hostname = hostnameOf(payload.siteUrl)
  const totalChanges = payload.changes.length

  const { html: matchedTableHtml, count: matchedCount } = buildDigestMatchedTable(payload.changes)
  const chips = buildTypeChips(payload.changes)

  const rows = payload.changes.slice(0, 20).map(c => {
    const pct = typeof c.percentage_change === 'number'
      ? `<span style="font-weight:700;color:${c.percentage_change > 0 ? '#dc2626' : '#16a34a'};">${c.percentage_change > 0 ? '+' : ''}${c.percentage_change}%</span>`
      : '—'
    const matchedStar = (c.details as Record<string, any>)?.is_matched_with_reference === true
      ? ' <span style="color:#ea580c;">★&#xFE0E;</span>'
      : ''
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">
        <span style="display:inline-block;${typeCellStyle(c.change_type)}padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${groupLabel(c.change_type)}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-weight:500;font-size:13px;color:#111827;word-break:break-word;">${esc(c.product_name) || 'N/A'}${matchedStar}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#9ca3af;white-space:nowrap;text-align:right;">${esc(c.old_value) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;color:#111827;white-space:nowrap;text-align:right;">${esc(c.new_value) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;white-space:nowrap;text-align:right;">${pct}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1c1917;max-width:720px;margin:0 auto;padding:24px 16px;background:#f5f5f4;">
  <div style="background:white;border-radius:14px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e7e5e4;">

    <div style="border-bottom:2px solid #ea580c;padding-bottom:16px;margin-bottom:20px;">
      <div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#ea580c;">GO-DATA</div>
      <h1 style="margin:6px 0 2px;font-size:21px;color:#1c1917;">Alerte de surveillance — ${esc(hostname)}</h1>
      <p style="color:#78716c;margin:0;font-size:13px;">Bonjour ${esc(payload.userName)}, des changements viennent d'être détectés.</p>
    </div>

    <div style="background:#fff7ed;border:1px solid #fed7aa;padding:16px 20px;border-radius:10px;margin-bottom:8px;">
      <p style="margin:0 0 10px;font-weight:800;font-size:17px;color:#9a3412;">
        ${totalChanges} changement${totalChanges > 1 ? 's' : ''} détecté${totalChanges > 1 ? 's' : ''}${matchedCount > 0 ? ` <span style="font-size:12px;font-weight:700;color:#ea580c;">· ${matchedCount} produit${matchedCount > 1 ? 's' : ''} apparié${matchedCount > 1 ? 's' : ''} à votre référence</span>` : ''}
      </p>
      <div>${chips}</div>
      <p style="margin:8px 0 0;font-size:12px;color:#a8a29e;">Produits suivis : ${payload.previousCount} &rarr; ${payload.currentCount}</p>
    </div>

    ${matchedTableHtml}

    <h2 style="margin:28px 0 10px;font-size:13px;color:#78716c;text-transform:uppercase;letter-spacing:.06em;">Tous les changements${matchedCount > 0 ? ' <span style="font-weight:400;text-transform:none;letter-spacing:0;">(★&#xFE0E; = produit apparié à votre référence)</span>' : ''}</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e7e5e4;border-radius:10px;overflow:hidden;">
      <thead>
        <tr style="background:#1c1917;color:#fafaf9;font-size:12px;">
          <th style="padding:10px;text-align:left;font-weight:600;">Type</th>
          <th style="padding:10px;text-align:left;font-weight:600;">Produit</th>
          <th style="padding:10px;text-align:right;font-weight:600;">Avant</th>
          <th style="padding:10px;text-align:right;font-weight:600;">Après</th>
          <th style="padding:10px;text-align:right;font-weight:600;">Var.</th>
        </tr>
      </thead>
      <tbody style="background:#ffffff;">${rows}</tbody>
    </table>
    ${totalChanges > 20 ? `<p style="color:#a8a29e;font-size:12px;margin-top:8px;">Et ${totalChanges - 20} autres changements — consultez le dashboard pour la liste complète.</p>` : ''}

    <div style="margin-top:28px;text-align:center;">
      <a href="${dashboardUrl}/dashboard/alerte" style="display:inline-block;background:#ea580c;color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;">
        Ouvrir le dashboard
      </a>
    </div>
  </div>

  <p style="color:#a8a29e;font-size:11px;margin-top:20px;text-align:center;">
    Alerte envoyée automatiquement par Go-Data.
    <a href="${dashboardUrl}/dashboard/settings" style="color:#a8a29e;">Gérer mes canaux de notification</a>
  </p>
</body></html>`.trim()
}

// ─── Daily digest (récap quotidien agrégé) ──────────────────────────

export interface DailyDigestPayload {
  userId: string
  userName: string
  userEmail: string | null
  periodHours: number
  changes: AlertChange[]
  /** Heure d'envoi choisie (0-23, heure de l'Est) — affichée dans le pied de page. */
  sendHourLocal?: number
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const MAX_DIGEST_ROWS = 80

function typeCellStyle(type: string): string {
  switch (type) {
    case 'price_increase': return 'background:#fef2f2;color:#b91c1c;'
    case 'price_decrease': return 'background:#f0fdf4;color:#15803d;'
    case 'new_product': return 'background:#fff7ed;color:#c2410c;'
    case 'removed_product': return 'background:#f4f4f5;color:#52525b;'
    case 'stock_change': return 'background:#fffbeb;color:#b45309;'
    default: return 'background:#f4f4f5;color:#52525b;'
  }
}

/** Puces de synthèse par type (14 hausses, 69 baisses…) — sans emoji,
    teintes discrètes alignées sur les badges des tableaux. */
function buildTypeChips(changes: AlertChange[]): string {
  return summarize(changes)
    .filter(s => s.count > 0)
    .map(s =>
      `<span style="display:inline-block;${typeCellStyle(s.type)}padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;margin:0 6px 6px 0;">${s.count} ${s.label}</span>`
    )
    .join('')
}

/** Tableau des changements sur des produits appariés à la référence (écart de prix). */
function buildDigestMatchedTable(changes: AlertChange[]): { html: string; count: number } {
  const matched = changes.filter(c => (c.details as Record<string, any>)?.is_matched_with_reference === true)
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

    return `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">
        <div style="font-weight:600;color:#111827;word-break:break-word;">${esc(c.product_name) || 'N/A'}</div>
        ${c.source_site ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px;">${esc(c.source_site)}</div>` : ''}
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;white-space:nowrap;color:#6b7280;text-align:right;font-size:13px;">${refPrice !== null ? fmtMoney(refPrice) : '—'}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;white-space:nowrap;font-weight:600;color:#111827;text-align:right;font-size:13px;">${currPrice !== null ? fmtMoney(currPrice) : '—'}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;white-space:nowrap;font-weight:700;color:${diffColor};text-align:right;font-size:13px;">${diffLabel}</td>
    </tr>`
  }).join('')

  const html = `
    <h2 style="margin:28px 0 4px;font-size:13px;color:#78716c;text-transform:uppercase;letter-spacing:.06em;">Écarts vs votre site de référence (${matched.length})</h2>
    <p style="color:#a8a29e;font-size:12px;margin:0 0 10px;">Changements sur des produits que vous vendez aussi.</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e7e5e4;border-radius:10px;overflow:hidden;">
      <thead>
        <tr style="background:#1c1917;color:#fafaf9;font-size:12px;">
          <th style="padding:10px 12px;text-align:left;font-weight:600;">Produit concurrent</th>
          <th style="padding:10px 12px;text-align:right;font-weight:600;">Votre prix</th>
          <th style="padding:10px 12px;text-align:right;font-weight:600;">Prix concurrent</th>
          <th style="padding:10px 12px;text-align:right;font-weight:600;">Écart</th>
        </tr>
      </thead>
      <tbody style="background:#ffffff;">${rows}</tbody>
    </table>
    ${matched.length > 25 ? `<p style="color:#a8a29e;font-size:12px;margin-top:6px;">Et ${matched.length - 25} autres produits appariés…</p>` : ''}
  `
  return { html, count: matched.length }
}

/** Exporté pour les aperçus/tests uniquement. */
export function buildDailyDigestHtml(payload: DailyDigestPayload, dashboardUrl: string): string {
  const changes = payload.changes
  const totalChanges = changes.length
  const sites = new Set(changes.map(c => c.source_site).filter(Boolean))

  const chips = buildTypeChips(changes)

  const { html: matchedTableHtml, count: matchedCount } = buildDigestMatchedTable(changes)

  // Tri : changements appariés à la référence d'abord, puis par ampleur de variation
  const sorted = [...changes].sort((a, b) => {
    const am = (a.details as Record<string, any>)?.is_matched_with_reference === true ? 1 : 0
    const bm = (b.details as Record<string, any>)?.is_matched_with_reference === true ? 1 : 0
    if (am !== bm) return bm - am
    return Math.abs(b.percentage_change || 0) - Math.abs(a.percentage_change || 0)
  })

  const rows = sorted.slice(0, MAX_DIGEST_ROWS).map(c => {
    const pct = typeof c.percentage_change === 'number'
      ? `<span style="font-weight:700;color:${c.percentage_change > 0 ? '#dc2626' : '#16a34a'};">${c.percentage_change > 0 ? '+' : ''}${c.percentage_change}%</span>`
      : '—'
    const matchedStar = (c.details as Record<string, any>)?.is_matched_with_reference === true
      ? ' <span style="color:#ea580c;">★&#xFE0E;</span>'
      : ''
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">
        <span style="display:inline-block;${typeCellStyle(c.change_type)}padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${groupLabel(c.change_type)}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-weight:500;font-size:13px;color:#111827;word-break:break-word;">${esc(c.product_name) || 'N/A'}${matchedStar}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#6b7280;white-space:nowrap;">${esc(c.source_site) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#9ca3af;white-space:nowrap;text-align:right;">${esc(c.old_value) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;color:#111827;white-space:nowrap;text-align:right;">${esc(c.new_value) || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;white-space:nowrap;text-align:right;">${pct}</td>
    </tr>`
  }).join('')

  const dateLabel = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Toronto',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date())

  const footerHourNote = typeof payload.sendHourLocal === 'number'
    ? `chaque jour vers ${payload.sendHourLocal} h (heure de l'Est)`
    : 'une fois par jour'

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1c1917;max-width:720px;margin:0 auto;padding:24px 16px;background:#f5f5f4;">
  <div style="background:white;border-radius:14px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e7e5e4;">

    <div style="border-bottom:2px solid #ea580c;padding-bottom:16px;margin-bottom:20px;">
      <div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#ea580c;">GO-DATA</div>
      <h1 style="margin:6px 0 2px;font-size:21px;color:#1c1917;">Récap quotidien du marché</h1>
      <p style="color:#78716c;margin:0;font-size:13px;text-transform:capitalize;">${dateLabel}</p>
    </div>

    <p style="color:#57534e;margin:0 0 16px;font-size:14px;">Bonjour ${esc(payload.userName)}, voici les changements détectés sur les ${payload.periodHours === 24 ? 'dernières 24 heures' : `${payload.periodHours} dernières heures`} :</p>

    <div style="background:#fff7ed;border:1px solid #fed7aa;padding:16px 20px;border-radius:10px;margin-bottom:8px;">
      <p style="margin:0 0 10px;font-weight:800;font-size:17px;color:#9a3412;">
        ${totalChanges} changement${totalChanges > 1 ? 's' : ''} sur ${sites.size} site${sites.size > 1 ? 's' : ''} surveillé${sites.size > 1 ? 's' : ''}
      </p>
      <div>${chips}</div>
    </div>

    ${matchedTableHtml}

    <h2 style="margin:28px 0 10px;font-size:13px;color:#78716c;text-transform:uppercase;letter-spacing:.06em;">Tous les changements${matchedCount > 0 ? ' <span style="font-weight:400;text-transform:none;letter-spacing:0;">(★&#xFE0E; = produit apparié à votre référence)</span>' : ''}</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e7e5e4;border-radius:10px;overflow:hidden;">
      <thead>
        <tr style="background:#1c1917;color:#fafaf9;font-size:12px;">
          <th style="padding:10px;text-align:left;font-weight:600;">Type</th>
          <th style="padding:10px;text-align:left;font-weight:600;">Produit</th>
          <th style="padding:10px;text-align:left;font-weight:600;">Site</th>
          <th style="padding:10px;text-align:right;font-weight:600;">Avant</th>
          <th style="padding:10px;text-align:right;font-weight:600;">Après</th>
          <th style="padding:10px;text-align:right;font-weight:600;">Var.</th>
        </tr>
      </thead>
      <tbody style="background:#ffffff;">${rows}</tbody>
    </table>
    ${totalChanges > MAX_DIGEST_ROWS ? `<p style="color:#a8a29e;font-size:12px;margin-top:8px;">Et ${totalChanges - MAX_DIGEST_ROWS} autres changements — consultez le dashboard pour la liste complète.</p>` : ''}

    <div style="margin-top:28px;text-align:center;">
      <a href="${dashboardUrl}/dashboard/alerte" style="display:inline-block;background:#ea580c;color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;">
        Ouvrir le dashboard
      </a>
    </div>
  </div>

  <p style="color:#a8a29e;font-size:11px;margin-top:20px;text-align:center;">
    Récap envoyé automatiquement par Go-Data ${footerHourNote}.<br>
    <a href="${dashboardUrl}/dashboard/alerte" style="color:#a8a29e;">Modifier l'heure d'envoi</a> ·
    <a href="${dashboardUrl}/dashboard/settings" style="color:#a8a29e;">Gérer mes canaux de notification</a>
  </p>
</body></html>`.trim()
}

export interface DailyDigestDispatchResult {
  email: { attempted: boolean; ok: boolean; error?: string }
}

/**
 * Envoie le récap quotidien par email à un utilisateur.
 * Ne fait rien si payload.changes est vide.
 */
export async function dispatchDailyDigest(
  payload: DailyDigestPayload,
  userChannels: UserChannelsConfig | null
): Promise<DailyDigestDispatchResult> {
  const result: DailyDigestDispatchResult = {
    email: { attempted: false, ok: false },
  }

  const totalChanges = payload.changes.length
  if (totalChanges === 0) {
    return result
  }

  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://go-data-dashboard.vercel.app'
  const emailEnabled = userChannels?.email_enabled ?? true
  const emailTarget = userChannels?.email_address || payload.userEmail
  if (!emailEnabled || !emailTarget) {
    return result
  }

  const dateLabel = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Toronto',
    day: 'numeric', month: 'long',
  }).format(new Date())

  result.email.attempted = true
  try {
    const digestSummary = summarize(payload.changes)
      .filter(s => s.count > 0)
      .map(s => `${s.count} ${s.label}`)
      .join(', ')
    await sendEmail({
      to: emailTarget,
      subject: `Go-Data — ${totalChanges} changement${totalChanges > 1 ? 's' : ''} détecté${totalChanges > 1 ? 's' : ''} (${dateLabel})`,
      html: buildDailyDigestHtml(payload, dashboardUrl),
      text: `Go-Data — Récap quotidien\n\nBonjour ${payload.userName},\n${totalChanges} changement${totalChanges > 1 ? 's' : ''} détecté${totalChanges > 1 ? 's' : ''} sur les dernières ${payload.periodHours} heures${digestSummary ? ` (${digestSummary})` : ''}.\n\nOuvrir le dashboard : ${dashboardUrl}/dashboard/alerte\nGérer mes notifications : ${dashboardUrl}/dashboard/settings`,
      unsubscribeUrl: `${dashboardUrl}/dashboard/settings`,
    })
    result.email.ok = true
  } catch (err: any) {
    result.email.error = err?.message || String(err)
    console.error('[Daily Digest] Échec email:', result.email.error)
  }

  return result
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
      const alertSummary = summarize(payload.changes)
        .filter(s => s.count > 0)
        .map(s => `${s.count} ${s.label}`)
        .join(', ')
      await sendEmail({
        to: emailTarget,
        subject: `Go-Data — ${payload.changes.length} changement${payload.changes.length > 1 ? 's' : ''} sur ${hostname}`,
        html: buildAlertEmailHtml(payload, dashboardUrl),
        text: `Go-Data — Alerte de surveillance\n\nBonjour ${payload.userName},\n${payload.changes.length} changement${payload.changes.length > 1 ? 's' : ''} détecté${payload.changes.length > 1 ? 's' : ''} sur ${hostname}${alertSummary ? ` (${alertSummary})` : ''}.\n\nOuvrir le dashboard : ${dashboardUrl}/dashboard/alerte\nGérer mes notifications : ${dashboardUrl}/dashboard/settings`,
        unsubscribeUrl: `${dashboardUrl}/dashboard/settings`,
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
    html: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;max-width:560px;margin:0 auto;padding:24px 16px;background:#f5f5f4;">
      <div style="background:white;border-radius:14px;padding:28px;border:1px solid #e7e5e4;">
        <div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#ea580c;">GO-DATA</div>
        <h2 style="margin:8px 0 4px;font-size:19px;color:#1c1917;">Email de test reçu</h2>
        <p style="color:#57534e;font-size:14px;margin:0 0 4px;">Bonjour ${esc(userName)},</p>
        <p style="color:#57534e;font-size:14px;margin:0;">Votre canal <strong>email</strong> est bien configuré pour recevoir les alertes Go-Data.</p>
        <p style="margin-top:20px;"><a href="${dashboardUrl}/dashboard/settings" style="color:#ea580c;font-weight:600;">Gérer mes canaux</a></p>
      </div>
    </body></html>`,
    text: `Go-Data — Email de test\n\nBonjour ${userName},\nVotre canal email est bien configuré pour recevoir les alertes Go-Data.\n\nGérer mes canaux : ${dashboardUrl}/dashboard/settings`,
    unsubscribeUrl: `${dashboardUrl}/dashboard/settings`,
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
