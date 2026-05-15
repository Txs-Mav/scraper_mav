import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * /api/admin/search-sources
 *
 * Gestion centralisée des secrets / proxies utilisés par les adapters Python
 * de recherche fédérée (Facebook Marketplace, Walmart, Best Buy, AutoTrader,
 * Kijiji, LesPAC). Les valeurs sont stockées en DB (`system_config`) et
 * injectées comme variables d'environnement dans le subprocess Python par
 * `/api/product-search`.
 *
 * Sécurité :
 *   - Accès strictement réservé au compte dev (DEV_ADMIN_EMAIL).
 *   - Les `key` doivent appartenir à la whitelist ci-dessous.
 *   - Les valeurs `is_secret=true` ne sont jamais renvoyées en clair en GET.
 *
 * Méthodes :
 *   - GET  : liste les clés (valeurs masquées si secrètes)
 *   - PUT  : upsert d'une ou plusieurs paires {key, value}
 *
 * Le test live d'une source est dans le sous-route `/test`.
 */

// ---------------------------------------------------------------------------
// Whitelist des clés gérables. Toute clé hors de cette liste est rejetée.
// Doit rester synchrone avec la table system_config (cf. migration).
// ---------------------------------------------------------------------------
const ALLOWED_KEYS = new Set<string>([
  // Facebook Marketplace
  'FB_COOKIES_JSON',
  'FB_PROXY_URL',
  'FB_PROXY_USERNAME',
  'FB_PROXY_PASSWORD',
  // Walmart
  'WALMART_PROXY_URL',
  'WALMART_PROXY_USERNAME',
  'WALMART_PROXY_PASSWORD',
  // Best Buy
  'BESTBUY_PROXY_URL',
  'BESTBUY_PROXY_USERNAME',
  'BESTBUY_PROXY_PASSWORD',
  // AutoTrader
  'AUTOTRADER_PROXY_URL',
  'AUTOTRADER_PROXY_USERNAME',
  'AUTOTRADER_PROXY_PASSWORD',
  // Kijiji
  'KIJIJI_PROXY_URL',
  'KIJIJI_PROXY_USERNAME',
  'KIJIJI_PROXY_PASSWORD',
  // LesPAC
  'LESPAC_PROXY_URL',
  'LESPAC_PROXY_USERNAME',
  'LESPAC_PROXY_PASSWORD',
])

interface ConfigRow {
  key: string
  value: string | null
  is_secret: boolean
  last_test_at: string | null
  last_test_status: 'success' | 'error' | 'never' | null
  last_test_error: string | null
  last_test_duration_seconds: number | null
  updated_at: string | null
}

interface ConfigDTO {
  key: string
  /** Valeur masquée si is_secret=true et value non-null. */
  value: string | null
  has_value: boolean
  is_secret: boolean
  last_test_at: string | null
  last_test_status: 'success' | 'error' | 'never'
  last_test_error: string | null
  last_test_duration_seconds: number | null
  updated_at: string | null
}

function maskValue(row: ConfigRow): ConfigDTO {
  const hasValue = !!(row.value && row.value.length > 0)
  return {
    key: row.key,
    value: row.is_secret ? null : row.value,
    has_value: hasValue,
    is_secret: row.is_secret,
    last_test_at: row.last_test_at,
    last_test_status: row.last_test_status || 'never',
    last_test_error: row.last_test_error,
    last_test_duration_seconds: row.last_test_duration_seconds,
    updated_at: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// GET — lecture (masque les valeurs secrètes)
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('system_config')
    .select('key, value, is_secret, last_test_at, last_test_status, last_test_error, last_test_duration_seconds, updated_at')
    .order('key', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data as ConfigRow[] | null) || []
  // On ne renvoie QUE les clés du whitelist (au cas où une clé orpheline traîne).
  const items = rows.filter((r) => ALLOWED_KEYS.has(r.key)).map(maskValue)

  // Si la table est vide (migration pas encore jouée), on renvoie quand même
  // un squelette avec les clés du whitelist pour que l'UI puisse afficher
  // les cartes vides.
  const seen = new Set(items.map((i) => i.key))
  for (const key of ALLOWED_KEYS) {
    if (!seen.has(key)) {
      items.push({
        key,
        value: null,
        has_value: false,
        is_secret: !key.endsWith('_URL') && !key.endsWith('_USERNAME'),
        last_test_at: null,
        last_test_status: 'never',
        last_test_error: null,
        last_test_duration_seconds: null,
        updated_at: null,
      })
    }
  }

  items.sort((a, b) => a.key.localeCompare(b.key))
  return NextResponse.json({ items })
}

// ---------------------------------------------------------------------------
// PUT — upsert d'une ou plusieurs paires
//
// Body : { items: Array<{ key: string, value: string | null }> }
//   - value === null OU "" => on stocke NULL (suppression logique)
//   - value === "****"     => no-op (sentinel UI pour "ne pas écraser")
// ---------------------------------------------------------------------------

export async function PUT(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const rawItems = (body as { items?: unknown })?.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: '`items` doit être un tableau non vide' }, { status: 400 })
  }

  const toUpsert: Array<{ key: string; value: string | null }> = []
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') {
      return NextResponse.json({ error: 'Item invalide' }, { status: 400 })
    }
    const key = (it as { key?: unknown }).key
    const rawValue = (it as { value?: unknown }).value
    if (typeof key !== 'string' || !ALLOWED_KEYS.has(key)) {
      return NextResponse.json(
        { error: `Clé non autorisée: ${String(key)}` },
        { status: 400 },
      )
    }
    if (rawValue === '****') {
      // Sentinel : l'UI a renvoyé la valeur masquée sans modification → on skip.
      continue
    }
    let value: string | null
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      value = null
    } else if (typeof rawValue === 'string') {
      value = rawValue
    } else {
      return NextResponse.json(
        { error: `Valeur invalide pour la clé ${key} (doit être string ou null)` },
        { status: 400 },
      )
    }
    toUpsert.push({ key, value })
  }

  if (toUpsert.length === 0) {
    return NextResponse.json({ updated: 0, skipped: rawItems.length })
  }

  const supabase = createServiceClient()
  const updatedAt = new Date().toISOString()

  // Supabase ne fait pas un vrai upsert qui préserve `is_secret` ; on fait
  // donc une boucle d'updates ciblées (avec INSERT si la ligne n'existe pas).
  let updated = 0
  for (const it of toUpsert) {
    const { error: upsertErr } = await supabase
      .from('system_config')
      .upsert(
        {
          key: it.key,
          value: it.value,
          // is_secret : déterminé par le serveur via la convention de nommage.
          // Les `*_URL` et `*_USERNAME` ne sont pas considérés secrets ;
          // les autres oui (cookies, password, etc.).
          is_secret: !(it.key.endsWith('_URL') || it.key.endsWith('_USERNAME')),
          updated_by: user.id,
          updated_at: updatedAt,
        },
        { onConflict: 'key' },
      )
    if (upsertErr) {
      return NextResponse.json(
        { error: `Échec upsert ${it.key}: ${upsertErr.message}` },
        { status: 500 },
      )
    }
    updated++
  }

  return NextResponse.json({ updated, skipped: rawItems.length - updated })
}
