/**
 * Préférences du récap quotidien par email.
 *
 * Stockées dans `user_settings.notifications` (JSONB) pour éviter toute
 * migration de schéma :
 *   {
 *     "email": true,                     // legacy
 *     "digest_enabled": true,
 *     "digest_hour": 8,                  // 0-23, heure de l'Est (America/Toronto)
 *     "digest_last_sent_at": "2026-07-21T12:07:00.000Z"
 *   }
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const DIGEST_TIMEZONE = 'America/Toronto'
export const DEFAULT_DIGEST_HOUR = 8
/** Fenêtre anti-doublon : on ne renvoie pas de récap si un a été envoyé il y a moins de 20 h. */
export const DIGEST_DEDUPE_HOURS = 20

export interface DigestPrefs {
  enabled: boolean
  hour: number
  lastSentAt: string | null
  /** JSONB `notifications` complet, pour préserver les autres clés à l'écriture. */
  rawNotifications: Record<string, unknown>
  hasSettingsRow: boolean
}

export function defaultDigestPrefs(): DigestPrefs {
  return {
    enabled: true,
    hour: DEFAULT_DIGEST_HOUR,
    lastSentAt: null,
    rawNotifications: {},
    hasSettingsRow: false,
  }
}

function parsePrefs(notifications: unknown, hasRow: boolean): DigestPrefs {
  const raw = (notifications && typeof notifications === 'object')
    ? notifications as Record<string, unknown>
    : {}
  const hour = typeof raw.digest_hour === 'number' && raw.digest_hour >= 0 && raw.digest_hour <= 23
    ? Math.floor(raw.digest_hour)
    : DEFAULT_DIGEST_HOUR
  return {
    enabled: raw.digest_enabled !== false,
    hour,
    lastSentAt: typeof raw.digest_last_sent_at === 'string' ? raw.digest_last_sent_at : null,
    rawNotifications: raw,
    hasSettingsRow: hasRow,
  }
}

/** Heure courante (0-23) dans le fuseau de l'Est (gère l'heure d'été automatiquement). */
export function currentEasternHour(now: Date = new Date()): number {
  const hourStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: DIGEST_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(now)
  const h = parseInt(hourStr, 10)
  return isNaN(h) ? now.getUTCHours() : h % 24
}

/** Charge les préférences digest d'un lot d'utilisateurs. */
export async function fetchDigestPrefsMap(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, DigestPrefs>> {
  const map = new Map<string, DigestPrefs>()
  if (userIds.length === 0) return map

  const { data, error } = await supabase
    .from('user_settings')
    .select('user_id, notifications')
    .in('user_id', userIds)

  if (error) {
    console.warn('[DigestSettings] Lecture user_settings échouée (défauts utilisés):', error.message)
    return map
  }

  for (const row of data || []) {
    map.set(row.user_id, parsePrefs(row.notifications, true))
  }
  return map
}

export async function fetchDigestPrefs(
  supabase: SupabaseClient,
  userId: string
): Promise<DigestPrefs> {
  const map = await fetchDigestPrefsMap(supabase, [userId])
  return map.get(userId) || defaultDigestPrefs()
}

/**
 * Écrit des clés digest dans `user_settings.notifications` en préservant
 * les autres clés du JSONB (read-modify-write).
 */
export async function updateDigestPrefs(
  supabase: SupabaseClient,
  userId: string,
  patch: { enabled?: boolean; hour?: number; lastSentAt?: string },
  existing?: DigestPrefs
): Promise<{ ok: boolean; error?: string }> {
  const prefs = existing || await fetchDigestPrefs(supabase, userId)

  const notifications: Record<string, unknown> = { ...prefs.rawNotifications }
  if (patch.enabled !== undefined) notifications.digest_enabled = patch.enabled
  if (patch.hour !== undefined) notifications.digest_hour = Math.min(23, Math.max(0, Math.floor(patch.hour)))
  if (patch.lastSentAt !== undefined) notifications.digest_last_sent_at = patch.lastSentAt
  // Valeurs par défaut explicites pour les lignes neuves
  if (notifications.digest_enabled === undefined) notifications.digest_enabled = prefs.enabled
  if (notifications.digest_hour === undefined) notifications.digest_hour = prefs.hour

  if (prefs.hasSettingsRow) {
    const { error } = await supabase
      .from('user_settings')
      .update({ notifications, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase
      .from('user_settings')
      .insert({ user_id: userId, notifications })
    if (error && error.code === '23505') {
      // Ligne créée entre-temps : retomber sur un update
      const { error: updErr } = await supabase
        .from('user_settings')
        .update({ notifications, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
      if (updErr) return { ok: false, error: updErr.message }
    } else if (error) {
      return { ok: false, error: error.message }
    }
  }
  return { ok: true }
}

/** Un récap a-t-il déjà été envoyé récemment (fenêtre anti-doublon) ? */
export function wasSentRecently(prefs: DigestPrefs, now: Date = new Date()): boolean {
  if (!prefs.lastSentAt) return false
  const last = new Date(prefs.lastSentAt).getTime()
  if (isNaN(last)) return false
  return now.getTime() - last < DIGEST_DEDUPE_HOURS * 3600_000
}
