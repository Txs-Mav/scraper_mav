import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { normalizePhone } from '@/lib/notifications/twilio'
import { isValidSlackWebhook } from '@/lib/notifications/slack'

interface ChannelsRow {
  email_enabled: boolean
  email_address: string | null
  sms_enabled: boolean
  sms_phone: string | null
  sms_verified: boolean
  slack_enabled: boolean
  slack_webhook_url: string | null
  slack_channel: string | null
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function defaultChannels(userEmail: string | null): ChannelsRow {
  return {
    email_enabled: true,
    email_address: userEmail,
    sms_enabled: false,
    sms_phone: null,
    sms_verified: false,
    slack_enabled: false,
    slack_webhook_url: null,
    slack_channel: null,
  }
}

/**
 * GET /api/users/notification-channels
 * Retourne la configuration des canaux de notification de l'utilisateur courant.
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('user_notification_channels')
      .select('email_enabled, email_address, sms_enabled, sms_phone, sms_verified, slack_enabled, slack_webhook_url, slack_channel')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error && (error as any).code === 'PGRST205') {
      return NextResponse.json(
        {
          error: 'Table user_notification_channels introuvable.',
          code: 'CHANNELS_SCHEMA_MISSING',
          details: "Exécutez la migration migration_notification_channels.sql dans Supabase SQL Editor.",
        },
        { status: 503 }
      )
    }
    if (error) {
      console.error('[NotificationChannels GET] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const channels = data || defaultChannels(user.email || null)

    return NextResponse.json({
      channels,
      twilio_available: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
    })
  } catch (error: any) {
    console.error('[NotificationChannels GET] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * PUT /api/users/notification-channels
 * Met à jour la configuration des canaux (upsert).
 */
export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const supabase = await createClient()

    const updates: Partial<ChannelsRow> = {}

    // Email
    if (body.email_enabled !== undefined) updates.email_enabled = !!body.email_enabled
    if (body.email_address !== undefined) {
      const raw = (body.email_address || '').trim()
      if (raw && !EMAIL_REGEX.test(raw)) {
        return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 })
      }
      updates.email_address = raw || null
    }

    // SMS
    if (body.sms_enabled !== undefined) updates.sms_enabled = !!body.sms_enabled
    if (body.sms_phone !== undefined) {
      const raw = (body.sms_phone || '').trim()
      if (raw) {
        const normalized = normalizePhone(raw)
        if (!normalized) {
          return NextResponse.json({ error: 'Numéro de téléphone invalide (format E.164 attendu, ex: +15145551234)' }, { status: 400 })
        }
        updates.sms_phone = normalized
      } else {
        updates.sms_phone = null
      }
    }

    // Slack
    if (body.slack_enabled !== undefined) updates.slack_enabled = !!body.slack_enabled
    if (body.slack_webhook_url !== undefined) {
      const raw = (body.slack_webhook_url || '').trim()
      if (raw && !isValidSlackWebhook(raw)) {
        return NextResponse.json(
          { error: "URL de webhook Slack invalide. Elle doit commencer par https://hooks.slack.com/services/" },
          { status: 400 }
        )
      }
      updates.slack_webhook_url = raw || null
    }
    if (body.slack_channel !== undefined) {
      const raw = (body.slack_channel || '').trim()
      if (raw && !/^[#@]?[\w-]{1,80}$/.test(raw)) {
        return NextResponse.json({ error: 'Nom de canal Slack invalide' }, { status: 400 })
      }
      updates.slack_channel = raw || null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
    }

    // Si SMS activé : exiger un numéro
    if (updates.sms_enabled === true) {
      const phone = updates.sms_phone ?? null
      if (!phone) {
        // Vérifier la valeur existante
        const { data: existing } = await supabase
          .from('user_notification_channels')
          .select('sms_phone')
          .eq('user_id', user.id)
          .maybeSingle()
        if (!existing?.sms_phone) {
          return NextResponse.json({ error: 'Un numéro de téléphone est requis pour activer les SMS' }, { status: 400 })
        }
      }
    }

    // Si Slack activé : exiger un webhook
    if (updates.slack_enabled === true) {
      const webhook = updates.slack_webhook_url ?? null
      if (!webhook) {
        const { data: existing } = await supabase
          .from('user_notification_channels')
          .select('slack_webhook_url')
          .eq('user_id', user.id)
          .maybeSingle()
        if (!existing?.slack_webhook_url) {
          return NextResponse.json({ error: 'Un webhook Slack est requis pour activer Slack' }, { status: 400 })
        }
      }
    }

    const { data: existing } = await supabase
      .from('user_notification_channels')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('user_notification_channels')
        .update(updates)
        .eq('user_id', user.id)
      if (error) {
        console.error('[NotificationChannels PUT] Update error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else {
      const { error } = await supabase
        .from('user_notification_channels')
        .insert({ user_id: user.id, ...updates })
      if (error) {
        console.error('[NotificationChannels PUT] Insert error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    const { data: channels } = await supabase
      .from('user_notification_channels')
      .select('email_enabled, email_address, sms_enabled, sms_phone, sms_verified, slack_enabled, slack_webhook_url, slack_channel')
      .eq('user_id', user.id)
      .maybeSingle()

    return NextResponse.json({ channels: channels || defaultChannels(user.email || null) })
  } catch (error: any) {
    console.error('[NotificationChannels PUT] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
