/**
 * Client Resend pour envoi d'emails
 * Les emails sont envoyés depuis le domaine Go-data (ex: noreply@go-data.co)
 */
import { Resend } from 'resend'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'Go-Data <noreply@go-data.co>'

let resendClient: Resend | null = null

function getResendClient(): Resend | null {
  if (!RESEND_API_KEY) {
    console.warn('[Resend] RESEND_API_KEY non configuré - les emails ne seront pas envoyés')
    return null
  }
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY)
  }
  return resendClient
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
}

/**
 * Envoie un email via Resend depuis le domaine Go-data
 */
export async function sendEmail({ to, subject, html, text, replyTo }: SendEmailOptions) {
  const client = getResendClient()
  if (!client) {
    throw new Error('Resend non configuré. Définissez RESEND_API_KEY et RESEND_FROM_EMAIL dans .env.local')
  }

  const emailPayload: Record<string, unknown> = {
    from: RESEND_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
  }
  if (html) emailPayload.html = html
  else if (text) emailPayload.text = text
  if (replyTo) emailPayload.replyTo = replyTo

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await client.emails.send(emailPayload as any)

  if (error) {
    console.error('[Resend] Erreur envoi email:', error)
    throw new Error(error.message || 'Erreur lors de l\'envoi de l\'email')
  }

  return { id: data?.id, success: true }
}

export { RESEND_FROM, RESEND_API_KEY }
