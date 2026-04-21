/**
 * Client Twilio minimaliste pour l'envoi de SMS.
 * Pas de dépendance npm : on appelle directement l'API REST avec fetch + Basic Auth.
 *
 * Variables d'environnement requises :
 *   TWILIO_ACCOUNT_SID   (ex: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)
 *   TWILIO_AUTH_TOKEN    (token secret)
 *   TWILIO_FROM_NUMBER   (numéro expéditeur, format E.164: +15550001234)
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER

export interface SendSmsOptions {
  to: string
  body: string
}

export function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER)
}

/**
 * Normalise un numéro de téléphone en format E.164 (+1...).
 * Retourne null si le numéro est clairement invalide.
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[\s\-().]/g, '')
  if (!cleaned) return null

  if (cleaned.startsWith('+')) {
    return /^\+\d{8,15}$/.test(cleaned) ? cleaned : null
  }

  const digits = cleaned.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

/**
 * Envoie un SMS via l'API Twilio.
 * Lance une erreur si Twilio n'est pas configuré ou si l'envoi échoue.
 */
export async function sendSms({ to, body }: SendSmsOptions): Promise<{ sid: string }> {
  if (!isTwilioConfigured()) {
    throw new Error('Twilio non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)')
  }

  const normalized = normalizePhone(to)
  if (!normalized) {
    throw new Error(`Numéro invalide: ${to}`)
  }

  const MAX_SMS_LENGTH = 1500
  const safeBody = body.length > MAX_SMS_LENGTH ? body.slice(0, MAX_SMS_LENGTH - 1) + '…' : body

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')

  const form = new URLSearchParams()
  form.append('To', normalized)
  form.append('From', TWILIO_FROM_NUMBER!)
  form.append('Body', safeBody)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })

  const data: any = await res.json().catch(() => ({}))

  if (!res.ok) {
    const msg = data?.message || `Twilio HTTP ${res.status}`
    throw new Error(`Échec envoi SMS: ${msg}`)
  }

  return { sid: data.sid }
}
