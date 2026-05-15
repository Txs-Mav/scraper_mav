import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { getCurrentUser } from '@/lib/supabase/helpers'
import {
  hasBackend,
  proxyToBackend,
  assertBackendAvailableInServerless,
  BackendUnavailableError,
} from '@/lib/backend-proxy'
import { buildSearchEnv, resolveProjectRoot } from '@/lib/product-search/spawn'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Cap dur Vercel : Pro = 60s par défaut (Hobby = 10s). On s'aligne pour ne pas
 * se faire couper en plein milieu d'une recherche. Toute logique de timeout
 * interne (Python + garde-fou Node) doit rester sous ce plafond avec une
 * marge pour la sérialisation/réponse.
 */
export const maxDuration = 60

/** Marge pour sérialiser et renvoyer la réponse avant que Vercel coupe. */
const VERCEL_TIMEOUT_MARGIN_SECONDS = 5
const MAX_INTERNAL_TIMEOUT_SECONDS = maxDuration - VERCEL_TIMEOUT_MARGIN_SECONDS

/**
 * POST /api/product-search
 *
 * Lance une recherche fédérée multi-sites.
 *
 * Body :
 *   {
 *     query: string,                  // texte libre (ex: "iPhone 15 Pro 256GB")
 *     category?: string,              // path ex: "electronique.cellulaire" (optionnel)
 *     adapters?: {                    // sources à interroger
 *       amazon?: boolean,
 *       ebay?: boolean,
 *       kijiji?: boolean,
 *       autotrader?: boolean,
 *       shopify?: string[],           // domaines Shopify (ex: ["allbirds.com"])
 *       dedicated?: boolean,          // concessionnaires véhicules
 *       genericDealers?: string[],    // domaines sans scraper dédié (on-site search)
 *       includeMyCompetitors?: boolean, // fusionne competitor_urls du user
 *     },
 *     maxResults?: number,            // défaut 30
 *     minScore?: number,              // défaut 0.3
 *     timeout?: number,               // défaut 60s/adapter
 *   }
 *
 * Réponse : structure `SearchResult.to_dict()` du module Python.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      query,
      category,
      adapters = {},
      maxResults = 30,
      minScore = 0.3,
      timeout = 45,
    } = body || {}

    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json(
        { error: 'query is required' },
        { status: 400 }
      )
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Authentification requise' },
        { status: 401 }
      )
    }

    // ----------------------------------------------------------------
    // Expansion des concessionnaires génériques (fusion avec les URLs
    // competitor_urls du user si includeMyCompetitors=true).
    // ----------------------------------------------------------------
    const rawGenericDealers = Array.isArray(adapters?.genericDealers)
      ? (adapters.genericDealers as string[])
      : []
    const includeMyCompetitors = !!adapters?.includeMyCompetitors
    const genericDealers = await expandGenericDealers(
      user.id,
      rawGenericDealers,
      includeMyCompetitors,
    )
    const normalizedAdapters = {
      ...(adapters || {}),
      genericDealers,
      // includeMyCompetitors a été résolu côté serveur — on le retire pour
      // ne pas le propager inutilement au backend Python.
      includeMyCompetitors: undefined,
    }

    if (hasBackend()) {
      try {
        const backendRes = await proxyToBackend('/product-search', {
          body: {
            query,
            category,
            adapters: normalizedAdapters,
            maxResults,
            minScore,
            timeout,
            userId: user.id,
          },
          // Le backend Python doit finir AVANT que Vercel coupe la fonction.
          // On laisse 3s de marge pour la sérialisation aller-retour.
          timeout: (maxDuration - 3) * 1000,
        })

        if (backendRes.status === 404) {
          console.error(
            '[ProductSearch] Backend Railway répond 404 sur /product-search — ' +
              "l'endpoint n'est pas (encore) implémenté côté backend Python.",
          )
          return NextResponse.json(
            {
              error: 'feature_unavailable',
              message:
                "La recherche produit n'est pas disponible en production " +
                "pour le moment. L'équipe a été notifiée.",
            },
            { status: 503 },
          )
        }

        const data = await backendRes.json()
        return NextResponse.json(data, { status: backendRes.status })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[ProductSearch] Backend proxy failed:', msg)
        return NextResponse.json(
          {
            error: 'backend_unreachable',
            message:
              'Le service de recherche est temporairement indisponible. ' +
              'Réessaie dans quelques instants.',
          },
          { status: 503 },
        )
      }
    }

    // En serverless sans BACKEND_URL, le spawn() planterait (Vercel n'a pas
    // python3). On échoue immédiatement avec un message clair plutôt que
    // d'attendre 60s qu'un ENOENT remonte.
    assertBackendAvailableInServerless()

    const result = await runProductSearch({
      query: query.trim(),
      category: typeof category === 'string' ? category.trim() : null,
      adapters: normalizedAdapters,
      maxResults: Math.min(Math.max(Number(maxResults) || 30, 1), 100),
      minScore: Math.min(Math.max(Number(minScore) || 0.3, 0), 1),
      // Plafonné par MAX_INTERNAL_TIMEOUT_SECONDS / 2 car le total Python =
      // timeout * 2 et le garde-fou Node ajoute encore 10s par-dessus. Cf.
      // runProductSearch() pour le calcul détaillé.
      timeout: Math.min(
        Math.max(Number(timeout) || 30, 5),
        Math.floor((MAX_INTERNAL_TIMEOUT_SECONDS - 10) / 2),
      ),
    })
    return NextResponse.json(result)
  } catch (error: unknown) {
    if (error instanceof BackendUnavailableError) {
      console.error('[ProductSearch] backend unavailable:', error.reason, error.message)
      return NextResponse.json(
        { error: error.reason, message: error.message },
        { status: 503 },
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ProductSearch] error:', message)
    return NextResponse.json(
      { error: 'Failed to run product search', message },
      { status: 500 }
    )
  }
}

interface SearchOptions {
  query: string
  category: string | null
  adapters: {
    amazon?: boolean
    ebay?: boolean
    kijiji?: boolean
    bestbuy?: boolean
    walmart?: boolean
    costco?: boolean
    lespac?: boolean
    autotrader?: boolean
    cycletrader?: boolean
    facebook?: boolean
    shopify?: string[]
    dedicated?: boolean
    genericDealers?: string[]
  }
  maxResults: number
  minScore: number
  timeout: number
}

/**
 * Extrait un nom de domaine bare depuis une URL ou un domaine déjà bare.
 * Renvoie "" si invalide.
 */
function extractDomain(input: string): string {
  if (!input) return ''
  let s = input.trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^https?:\/\//, '')
  s = s.split('/', 1)[0]
  if (s.startsWith('www.')) s = s.slice(4)
  // Sanity check très basique : doit ressembler à un domaine.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return ''
  return s
}

/**
 * Si `includeMyCompetitors=true`, on récupère la liste des URLs concurrents
 * de l'utilisateur depuis `scraper_config.competitor_urls` (cf.
 * /api/scraper/config/route.ts) et on les ajoute à `genericDealers`.
 *
 * On déduplique et on filtre les domaines déjà couverts par un scraper dédié
 * côté Python (le filtrage final est dans build_generic_dealer_adapters,
 * mais autant éviter les doublons inutiles dans la commande CLI).
 */
async function expandGenericDealers(
  userId: string,
  base: string[],
  includeMyCompetitors: boolean,
): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []

  const push = (raw: string) => {
    const d = extractDomain(raw)
    if (!d || seen.has(d)) return
    seen.add(d)
    out.push(d)
  }

  for (const v of base) push(v)

  if (includeMyCompetitors) {
    try {
      const supabase = createServiceClient()
      const { data } = await supabase
        .from('scraper_config')
        .select('competitor_urls')
        .eq('user_id', userId)
        .maybeSingle()
      const urls: string[] = Array.isArray(data?.competitor_urls)
        ? (data!.competitor_urls as string[])
        : []
      for (const u of urls) push(u)
    } catch (e: unknown) {
      console.warn(
        '[ProductSearch] expandGenericDealers — fetch competitor_urls failed:',
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  return out
}

async function runProductSearch(opts: SearchOptions): Promise<unknown> {
  const cwd = resolveProjectRoot()
  const { env, cleanup } = await buildSearchEnv(cwd)

  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'

    // Budget temps :
    //   - timeout par adapter           = opts.timeout (30s par défaut)
    //   - total timeout côté Python     = opts.timeout * 2 (les adapters tournent
    //                                     en parallèle mais on fait souvent plus
    //                                     de N batches que de workers)
    //   - garde-fou côté Node (kill)    = totalPy + 10s (laisse au Python le temps
    //                                     de finir proprement et de sérialiser le JSON)
    //
    // Sur Vercel le tout est plafonné à `maxDuration` (cf. export en tête de
    // fichier) — opts.timeout est déjà clampé par l'appelant pour rester sous
    // ce plafond, mais on garde une ceinture + bretelle ici au cas où.
    const perAdapterTimeout = opts.timeout
    const totalPyTimeout = opts.timeout * 2
    const nodeKillTimeout = Math.min(
      (totalPyTimeout + 10) * 1000,
      MAX_INTERNAL_TIMEOUT_SECONDS * 1000,
    )

    const args = ['-m', 'scraper_ai.scraper_search.main',
                  opts.query, '--json', '--quiet',
                  '--max-results', String(opts.maxResults),
                  '--min-score', String(opts.minScore),
                  '--timeout', String(perAdapterTimeout),
                  '--total-timeout', String(totalPyTimeout)]

    if (opts.category) args.push('--category', opts.category)
    if (opts.adapters.amazon) args.push('--amazon')
    if (opts.adapters.ebay) args.push('--ebay')
    if (opts.adapters.kijiji) args.push('--kijiji')
    if (opts.adapters.bestbuy) args.push('--bestbuy')
    if (opts.adapters.walmart) args.push('--walmart')
    if (opts.adapters.costco) args.push('--costco')
    if (opts.adapters.lespac) args.push('--lespac')
    if (opts.adapters.autotrader) args.push('--autotrader')
    if (opts.adapters.cycletrader) args.push('--cycletrader')
    if (opts.adapters.facebook) args.push('--facebook')
    if (opts.adapters.shopify && opts.adapters.shopify.length > 0) {
      args.push('--shopify', opts.adapters.shopify.join(','))
    }
    if (opts.adapters.genericDealers && opts.adapters.genericDealers.length > 0) {
      args.push('--generic-dealers', opts.adapters.genericDealers.join(','))
    }
    if (opts.adapters.dedicated === false) {
      args.push('--no-dedicated')
    } else {
      // Une recherche interactive doit rester rapide : les concessionnaires
      // lisent l'inventaire en cache, sans lancer 20 scrapes synchrones.
      args.push('--dedicated-cache-only')
    }

    console.log(`[ProductSearch] ${pythonCmd} ${args.join(' ')}`)

    const proc = spawn(pythonCmd, args, {
      cwd,
      stdio: 'pipe',
      env,
    })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => (stdout += d.toString()))
    proc.stderr?.on('data', (d) => (stderr += d.toString()))

    proc.on('close', (code) => {
      cleanup()
      if (code !== 0) {
        console.error(`[ProductSearch] Python exited ${code} :: ${stderr.slice(-500)}`)
        return reject(new Error(stderr || `Python exited with code ${code}`))
      }
      // L'output peut contenir des lignes de log Python avant le JSON.
      // On cherche la 1re { qui démarre un JSON valide.
      const jsonStart = stdout.indexOf('{')
      const raw = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout
      try {
        resolve(JSON.parse(raw))
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        reject(new Error(`Invalid JSON from search: ${msg}\n${stdout.slice(0, 500)}`))
      }
    })

    proc.on('error', (err) => {
      cleanup()
      reject(err)
    })

    setTimeout(() => {
      if (!proc.killed) {
        proc.kill()
        cleanup()
        reject(
          new Error(
            `La recherche a dépassé ${nodeKillTimeout / 1000}s. ` +
              'Essaie avec moins de sources actives ou une requête plus précise.',
          ),
        )
      }
    }, nodeKillTimeout)
  })
}
