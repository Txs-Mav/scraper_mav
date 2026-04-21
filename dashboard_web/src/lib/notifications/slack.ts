/**
 * Envoi de messages vers Slack via les Incoming Webhooks.
 * L'utilisateur fournit lui-même son URL de webhook (aucune clé API côté serveur).
 * Doc : https://api.slack.com/messaging/webhooks
 */

export interface SlackMessage {
  text: string
  blocks?: SlackBlock[]
  channel?: string
}

export interface SlackBlock {
  type: string
  [key: string]: unknown
}

const SLACK_WEBHOOK_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/

export function isValidSlackWebhook(url: string): boolean {
  if (!url) return false
  return SLACK_WEBHOOK_PATTERN.test(url.trim())
}

/**
 * Poste un message sur Slack via un Incoming Webhook.
 * Lance une erreur si le webhook est invalide ou si l'envoi échoue.
 */
export async function sendSlackMessage(
  webhookUrl: string,
  message: SlackMessage
): Promise<void> {
  if (!isValidSlackWebhook(webhookUrl)) {
    throw new Error('URL de webhook Slack invalide')
  }

  const payload: Record<string, unknown> = { text: message.text }
  if (message.blocks?.length) payload.blocks = message.blocks
  if (message.channel) payload.channel = message.channel

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Échec envoi Slack: HTTP ${res.status} ${text.slice(0, 120)}`)
  }
}

/**
 * Construit un bloc Slack structuré à partir d'un résumé d'alerte.
 */
export function buildAlertSlackBlocks(opts: {
  hostname: string
  totalChanges: number
  summary: { label: string; count: number; emoji: string }[]
  topChanges: { label: string; product: string; oldValue?: string | null; newValue?: string | null; pct?: number | null }[]
  dashboardUrl: string
}): SlackBlock[] {
  const { hostname, totalChanges, summary, topChanges, dashboardUrl } = opts

  const summaryText = summary
    .filter(s => s.count > 0)
    .map(s => `${s.emoji} *${s.count}* ${s.label}`)
    .join('  •  ') || 'Aucun changement significatif'

  const rows = topChanges.slice(0, 8).map(c => {
    const pct = typeof c.pct === 'number' ? ` (${c.pct > 0 ? '+' : ''}${c.pct}%)` : ''
    const from = c.oldValue ?? '—'
    const to = c.newValue ?? '—'
    return `• *${c.product}* — ${c.label}: ${from} → ${to}${pct}`
  }).join('\n') || '_(rien à afficher)_'

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Go-Data — ${totalChanges} changement${totalChanges > 1 ? 's' : ''}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Site :* \`${hostname}\`\n${summaryText}` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: rows },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Ouvrir le dashboard', emoji: true },
          url: dashboardUrl,
          style: 'primary',
        },
      ],
    },
  ]
}
