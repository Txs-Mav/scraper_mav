import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { proxyToBackend, hasBackend } from '@/lib/backend-proxy'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * POST /api/admin/usine/batch
 *
 * Lance scraper_usine sur une liste d'URLs (1 par ligne) ou sur un upload de
 * fichier (.txt / .csv). Le backend FastAPI génère les scrapers en série,
 * un par URL.
 *
 * Modes acceptés :
 *
 *   1) Upload de fichier — multipart/form-data :
 *        FormData { file: <File>, dryRun?, forcePlaywright?, publishThreshold? }
 *
 *   2) JSON — Content-Type: application/json :
 *        { urls: string[], dryRun?, forcePlaywright?, publishThreshold? }
 *
 * Le fichier accepte les commentaires ('#') et les lignes vides.
 */

const MAX_URLS = 100
const MAX_FILE_SIZE = 1024 * 1024 // 1 MB

function parseUrlsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }
  if (!hasBackend()) {
    return NextResponse.json(
      { error: 'Backend non configuré (BACKEND_URL/BACKEND_SECRET)' },
      { status: 503 },
    )
  }

  let urls: string[] = []
  let dryRun = false
  let forcePlaywright = false
  let publishThreshold = 95

  const contentType = req.headers.get('content-type') || ''

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Fichier requis (champ "file")' }, { status: 400 })
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `Fichier trop volumineux (max ${MAX_FILE_SIZE / 1024} KB)` },
          { status: 413 },
        )
      }
      const text = await file.text()
      urls = parseUrlsFromText(text)

      const dr = form.get('dryRun')
      if (typeof dr === 'string') dryRun = dr === 'true' || dr === '1'
      const fp = form.get('forcePlaywright')
      if (typeof fp === 'string') forcePlaywright = fp === 'true' || fp === '1'
      const pt = form.get('publishThreshold')
      if (typeof pt === 'string' && !Number.isNaN(parseInt(pt, 10))) {
        publishThreshold = Math.max(50, Math.min(100, parseInt(pt, 10)))
      }
    } else {
      const body = await req.json().catch(() => ({}))
      if (Array.isArray(body?.urls)) {
        urls = body.urls.map((u: any) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
      } else if (typeof body?.text === 'string') {
        urls = parseUrlsFromText(body.text)
      }
      dryRun = !!body?.dryRun
      forcePlaywright = !!body?.forcePlaywright
      if (typeof body?.publishThreshold === 'number') {
        publishThreshold = Math.max(50, Math.min(100, body.publishThreshold))
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Lecture du body échouée' }, { status: 400 })
  }

  if (urls.length === 0) {
    return NextResponse.json(
      { error: 'Aucune URL trouvée dans le fichier ou le body' },
      { status: 400 },
    )
  }
  if (urls.length > MAX_URLS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_URLS} URLs par batch (reçu ${urls.length})` },
      { status: 400 },
    )
  }

  try {
    const res = await proxyToBackend('/scraper-usine/batch', {
      method: 'POST',
      body: { urls, dryRun, forcePlaywright, publishThreshold },
      timeout: 30_000,
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backend indisponible' }, { status: 502 })
  }
}
