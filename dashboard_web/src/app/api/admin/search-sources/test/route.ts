import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'
import { buildSearchEnv, resolveProjectRoot } from '@/lib/product-search/spawn'

/**
 * POST /api/admin/search-sources/test
 *
 * Lance le CLI Python `scraper_ai.scraper_search.main` avec une requête
 * témoin sur UN seul adapter pour vérifier que la config en DB
 * (cookies / proxy) fonctionne live. Met à jour `last_test_*` dans
 * `system_config` pour chaque clé liée à la source testée.
 *
 * Body :
 *   {
 *     source: 'facebook'|'walmart'|'bestbuy'|'autotrader'|'kijiji'|'lespac',
 *     query?: string,   // défaut: une query générique adaptée à la source
 *   }
 */

// ---------------------------------------------------------------------------
// Configuration par source : flag CLI Python + clés DB associées + query témoin
// ---------------------------------------------------------------------------

interface SourceMeta {
  flag: string
  defaultQuery: string
  keys: string[]
}

const SOURCES: Record<string, SourceMeta> = {
  facebook: {
    flag: '--facebook',
    defaultQuery: 'iphone',
    keys: ['FB_COOKIES_JSON', 'FB_PROXY_URL', 'FB_PROXY_USERNAME', 'FB_PROXY_PASSWORD'],
  },
  walmart: {
    flag: '--walmart',
    defaultQuery: 'airpods',
    keys: ['WALMART_PROXY_URL', 'WALMART_PROXY_USERNAME', 'WALMART_PROXY_PASSWORD'],
  },
  bestbuy: {
    flag: '--bestbuy',
    defaultQuery: 'airpods',
    keys: ['BESTBUY_PROXY_URL', 'BESTBUY_PROXY_USERNAME', 'BESTBUY_PROXY_PASSWORD'],
  },
  autotrader: {
    flag: '--autotrader',
    defaultQuery: 'honda civic',
    keys: ['AUTOTRADER_PROXY_URL', 'AUTOTRADER_PROXY_USERNAME', 'AUTOTRADER_PROXY_PASSWORD'],
  },
  kijiji: {
    flag: '--kijiji',
    defaultQuery: 'velo',
    keys: ['KIJIJI_PROXY_URL', 'KIJIJI_PROXY_USERNAME', 'KIJIJI_PROXY_PASSWORD'],
  },
  lespac: {
    flag: '--lespac',
    defaultQuery: 'velo',
    keys: ['LESPAC_PROXY_URL', 'LESPAC_PROXY_USERNAME', 'LESPAC_PROXY_PASSWORD'],
  },
}

const TEST_TIMEOUT_SECONDS = 45

interface CliAdapterRun {
  name?: string
  hits_returned?: number
  duration_seconds?: number
  error?: string
}

interface CliResult {
  total?: number
  elapsed_seconds?: number
  adapters_run?: CliAdapterRun[]
  hits?: unknown[]
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  let body: { source?: string; query?: string }
  try {
    body = (await req.json()) as { source?: string; query?: string }
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const sourceKey = (body.source || '').toLowerCase()
  const meta = SOURCES[sourceKey]
  if (!meta) {
    return NextResponse.json(
      { error: `Source inconnue: ${body.source}. Valides: ${Object.keys(SOURCES).join(', ')}` },
      { status: 400 },
    )
  }
  const query = (body.query || meta.defaultQuery).trim() || meta.defaultQuery

  // ----------------------------------------------------------------------
  // Spawn du CLI Python (mêmes helpers que /api/product-search)
  // ----------------------------------------------------------------------
  const rootDir = resolveProjectRoot()
  const { env, cleanup } = await buildSearchEnv(rootDir)
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'

  const args = [
    '-m', 'scraper_ai.scraper_search.main',
    query,
    '--json', '--quiet',
    '--max-results', '3',
    '--min-score', '0.0',
    '--timeout', String(TEST_TIMEOUT_SECONDS),
    '--total-timeout', String(TEST_TIMEOUT_SECONDS),
    // On exclut les concessionnaires pour aller vite (test focalisé sur la source).
    '--no-dedicated',
    meta.flag,
  ]

  const startedAt = Date.now()
  const cliResult: { stdout: string; stderr: string; code: number | null; killed: boolean } =
    await new Promise((resolve) => {
      const proc = spawn(pythonCmd, args, { cwd: rootDir, stdio: 'pipe', env })
      let stdout = ''
      let stderr = ''
      let killed = false
      proc.stdout?.on('data', (d) => (stdout += d.toString()))
      proc.stderr?.on('data', (d) => (stderr += d.toString()))
      proc.on('close', (code) => resolve({ stdout, stderr, code, killed }))
      proc.on('error', () => resolve({ stdout, stderr, code: -1, killed }))

      setTimeout(() => {
        if (!proc.killed) {
          killed = true
          proc.kill()
        }
      }, (TEST_TIMEOUT_SECONDS + 10) * 1000)
    })

  cleanup()
  const durationSeconds = (Date.now() - startedAt) / 1000

  // ----------------------------------------------------------------------
  // Interprétation du résultat
  // ----------------------------------------------------------------------
  let parsed: CliResult | null = null
  if (cliResult.stdout) {
    const jsonStart = cliResult.stdout.indexOf('{')
    if (jsonStart >= 0) {
      try {
        parsed = JSON.parse(cliResult.stdout.slice(jsonStart)) as CliResult
      } catch {
        // JSON malformé : on garde parsed=null et on traitera comme erreur.
      }
    }
  }

  const adapterRun = parsed?.adapters_run?.[0]
  // L'adapter a abouti si on a un JSON valide et pas d'erreur explicite.
  const success =
    cliResult.code === 0 && !!parsed && !adapterRun?.error
  const errorMessage = !success
    ? adapterRun?.error ||
      (cliResult.killed ? `Timeout (>${TEST_TIMEOUT_SECONDS}s)` : null) ||
      (cliResult.stderr || '').slice(-300) ||
      'Échec inconnu (pas de JSON parsable)'
    : null

  // ----------------------------------------------------------------------
  // Persistance dans system_config (toutes les clés de la source)
  // ----------------------------------------------------------------------
  try {
    const supabase = createServiceClient()
    const testedAt = new Date().toISOString()
    for (const key of meta.keys) {
      await supabase
        .from('system_config')
        .upsert(
          {
            key,
            last_test_at: testedAt,
            last_test_status: success ? 'success' : 'error',
            last_test_error: errorMessage,
            last_test_duration_seconds: durationSeconds,
            is_secret: !(key.endsWith('_URL') || key.endsWith('_USERNAME')),
          },
          { onConflict: 'key' },
        )
    }
  } catch (e: unknown) {
    console.warn('[search-sources/test] update test status failed:', e)
  }

  return NextResponse.json({
    source: sourceKey,
    success,
    error: errorMessage,
    duration_seconds: durationSeconds,
    hits_returned: adapterRun?.hits_returned ?? parsed?.total ?? 0,
    adapter_name: adapterRun?.name,
    stderr_tail: success ? null : (cliResult.stderr || '').slice(-500),
  })
}
