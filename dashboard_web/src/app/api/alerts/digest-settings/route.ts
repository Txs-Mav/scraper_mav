/**
 * GET/PUT /api/alerts/digest-settings
 * Préférences du récap quotidien par email de l'utilisateur courant :
 * heure d'envoi (heure de l'Est), activation, dernier envoi, destinataire effectif.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createServiceClient } from '@/lib/supabase/service'
import {
  fetchDigestPrefs,
  updateDigestPrefs,
  DIGEST_TIMEZONE,
} from '@/lib/notifications/digest-settings'

async function resolveEmailTarget(userId: string, fallback: string | null): Promise<{ target: string | null; enabled: boolean }> {
  const service = createServiceClient()
  const { data } = await service
    .from('user_notification_channels')
    .select('email_enabled, email_address')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    target: data?.email_address || fallback,
    enabled: data?.email_enabled ?? true,
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const service = createServiceClient()
    const [prefs, email] = await Promise.all([
      fetchDigestPrefs(service, user.id),
      resolveEmailTarget(user.id, user.email || null),
    ])

    return NextResponse.json({
      digest_enabled: prefs.enabled,
      digest_hour: prefs.hour,
      digest_last_sent_at: prefs.lastSentAt,
      timezone: DIGEST_TIMEZONE,
      email_target: email.target,
      email_channel_enabled: email.enabled,
    })
  } catch (error: any) {
    console.error('[DigestSettings GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const patch: { enabled?: boolean; hour?: number } = {}

    if (body.digest_enabled !== undefined) {
      patch.enabled = body.digest_enabled === true
    }
    if (body.digest_hour !== undefined) {
      const hour = Number(body.digest_hour)
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return NextResponse.json({ error: 'Heure invalide (0-23)' }, { status: 400 })
      }
      patch.hour = hour
    }

    if (patch.enabled === undefined && patch.hour === undefined) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
    }

    const service = createServiceClient()
    const result = await updateDigestPrefs(service, user.id, patch)
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Enregistrement impossible' }, { status: 500 })
    }

    const prefs = await fetchDigestPrefs(service, user.id)
    return NextResponse.json({
      success: true,
      digest_enabled: prefs.enabled,
      digest_hour: prefs.hour,
      digest_last_sent_at: prefs.lastSentAt,
      timezone: DIGEST_TIMEZONE,
    })
  } catch (error: any) {
    console.error('[DigestSettings PUT] Error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
