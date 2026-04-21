import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { sendTestEmail, sendTestSms, sendTestSlack } from '@/lib/notifications/dispatcher'
import { normalizePhone } from '@/lib/notifications/twilio'
import { isValidSlackWebhook } from '@/lib/notifications/slack'

/**
 * POST /api/users/notification-channels/test
 * Body : { channel: 'email' | 'sms' | 'slack' }
 * Envoie un message de test sur le canal choisi en utilisant la config stockée.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const channel = body.channel as 'email' | 'sms' | 'slack' | undefined

    if (!channel || !['email', 'sms', 'slack'].includes(channel)) {
      return NextResponse.json({ error: "channel doit être 'email', 'sms' ou 'slack'" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: config } = await supabase
      .from('user_notification_channels')
      .select('email_address, sms_phone, slack_webhook_url, slack_channel')
      .eq('user_id', user.id)
      .maybeSingle()

    const emailTarget = config?.email_address || user.email
    const smsTarget = config?.sms_phone
    const slackWebhook = config?.slack_webhook_url

    try {
      if (channel === 'email') {
        if (!emailTarget) {
          return NextResponse.json({ error: 'Aucune adresse email configurée' }, { status: 400 })
        }
        await sendTestEmail(emailTarget, user.name || 'Utilisateur')
        return NextResponse.json({ success: true, target: emailTarget })
      }

      if (channel === 'sms') {
        if (!smsTarget || !normalizePhone(smsTarget)) {
          return NextResponse.json({ error: 'Aucun numéro SMS configuré' }, { status: 400 })
        }
        await sendTestSms(smsTarget)
        return NextResponse.json({ success: true, target: smsTarget })
      }

      // slack
      if (!slackWebhook || !isValidSlackWebhook(slackWebhook)) {
        return NextResponse.json({ error: 'Aucun webhook Slack configuré' }, { status: 400 })
      }
      await sendTestSlack(slackWebhook, config?.slack_channel || null)
      return NextResponse.json({ success: true })
    } catch (err: any) {
      console.error(`[NotificationChannels test:${channel}]`, err)
      return NextResponse.json({ error: err?.message || 'Erreur lors du test' }, { status: 502 })
    }
  } catch (error: any) {
    console.error('[NotificationChannels test] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
