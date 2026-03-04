const BACKEND_URL = process.env.BACKEND_URL
const BACKEND_SECRET = process.env.BACKEND_SECRET || ''

export function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
}

export function hasBackend(): boolean {
  return isServerless() && !!BACKEND_URL
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
