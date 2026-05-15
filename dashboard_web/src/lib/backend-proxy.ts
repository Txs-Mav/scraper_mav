const BACKEND_URL = process.env.BACKEND_URL
const BACKEND_SECRET = process.env.BACKEND_SECRET || ''

export function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
}

export function hasBackend(): boolean {
  return isServerless() && !!BACKEND_URL
}

/**
 * Erreur typée pour distinguer "infra non configurée" (503, message clair pour
 * l'utilisateur final) de "exception inattendue" (500). Levée par les routes
 * qui dépendent d'un backend Python externe quand on tourne dans un
 * environnement serverless sans `BACKEND_URL` configuré — cas où un `spawn()`
 * local planterait de toute façon (Vercel n'a pas `python3`).
 */
export class BackendUnavailableError extends Error {
  constructor(public readonly reason: 'no_backend_url' | 'backend_unreachable' | 'endpoint_missing', message: string) {
    super(message)
    this.name = 'BackendUnavailableError'
  }
}

/**
 * À appeler en tête d'une route API qui NE PEUT PAS tourner sans backend
 * Python (i.e. qui fait `spawn('python3', …)` en fallback). En serverless,
 * `python3` n'est pas dispo → on doit avoir un backend ou échouer proprement.
 *
 * Comportement :
 *   - Dev local (pas Vercel)   → no-op (le spawn local marchera).
 *   - Vercel + BACKEND_URL set → no-op (le proxy prendra le relai).
 *   - Vercel + pas de backend  → throw `BackendUnavailableError` avec message
 *                                user-friendly. À catcher et transformer en
 *                                réponse 503 dans le handler.
 */
export function assertBackendAvailableInServerless(): void {
  if (isServerless() && !BACKEND_URL) {
    throw new BackendUnavailableError(
      'no_backend_url',
      "Le service de recherche n'est pas disponible. " +
        "Variable d'environnement BACKEND_URL manquante sur l'hôte serverless.",
    )
  }
}

interface ProxyOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  params?: Record<string, string>
  timeout?: number
}

export async function proxyToBackend(
  path: string,
  options: ProxyOptions = {}
): Promise<Response> {
  if (!BACKEND_URL) {
    throw new Error('BACKEND_URL is not configured')
  }

  const { method = 'POST', body, params, timeout = 60_000 } = options

  const url = new URL(path, BACKEND_URL)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const headers: Record<string, string> = {
    'X-Backend-Secret': BACKEND_SECRET,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    return await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
