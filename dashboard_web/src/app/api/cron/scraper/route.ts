import { NextResponse } from 'next/server'
import { proxyToBackend } from '@/lib/backend-proxy'

async function triggerScraperCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[Scraper Cron] CRON_SECRET non configuré — endpoint non sécurisé en production')
  }

  try {
    const backendRes = await proxyToBackend('/cron/scrape', {
      method: 'POST',
      timeout: 15_000,
    })
    const data = await backendRes.json().catch(() => ({
      error: 'Réponse backend invalide',
    }))

    return NextResponse.json(data, {
      status: backendRes.ok ? 202 : backendRes.status,
    })
  } catch (error) {
    console.error('[Scraper Cron] Backend indisponible:', error)
    return NextResponse.json(
      {
        error: 'Backend unavailable',
        message: 'BACKEND_URL/BACKEND_SECRET doivent pointer vers le backend Railway.',
      },
      { status: 503 }
    )
  }
}

export async function GET(request: Request) {
  return triggerScraperCron(request)
}

export async function POST(request: Request) {
  return triggerScraperCron(request)
}
