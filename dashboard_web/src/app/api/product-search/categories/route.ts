import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import {
  hasBackend,
  isServerless,
  proxyToBackend,
  BackendUnavailableError,
} from '@/lib/backend-proxy'

export const maxDuration = 20

/**
 * GET /api/product-search/categories
 *
 * Renvoie la taxonomie complète sous forme d'arbre JSON. Utilisée par l'UI
 * pour afficher le sélecteur hiérarchique de catégories.
 *
 * Réponse :
 *   { tree: [{ slug, name, path, children: [...] }, ...] }
 */
export async function GET() {
  try {
    if (hasBackend()) {
      try {
        const backendRes = await proxyToBackend('/product-search/categories', {
          method: 'GET',
          timeout: 15_000,
        })
        if (backendRes.status === 404) {
          console.error(
            "[ProductSearch] /product-search/categories non implémenté côté backend Railway",
          )
          return NextResponse.json(
            {
              error: 'feature_unavailable',
              message: 'Service de catégories indisponible en production.',
            },
            { status: 503 },
          )
        }
        const data = await backendRes.json()
        return NextResponse.json(data, { status: backendRes.status })
      } catch (e: unknown) {
        console.error('[ProductSearch] Backend proxy failed:', e)
        // En serverless, le fallback `spawn()` plantera de toute façon
        // (pas de python3 sur Vercel). On échoue clairement plutôt que de
        // remonter un ENOENT cryptique.
        if (isServerless()) {
          return NextResponse.json(
            {
              error: 'backend_unreachable',
              message: 'Le backend de catégories est temporairement indisponible.',
            },
            { status: 503 },
          )
        }
        // Dev local : on tente le spawn (python3 dispo).
      }
    }

    const tree = await runPythonScript()
    return NextResponse.json({ tree })
  } catch (error: unknown) {
    if (error instanceof BackendUnavailableError) {
      return NextResponse.json(
        { error: error.reason, message: error.message },
        { status: 503 },
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ProductSearch] categories error:', message)
    return NextResponse.json(
      { error: 'Failed to load categories', message },
      { status: 500 }
    )
  }
}

function runPythonScript(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
    const cwd = path.join(process.cwd(), '..')
    const code = `
import json
from scraper_ai.scraper_search.categories import (
    root_categories, children_of, get_path,
)

def serialize(slug):
    from scraper_ai.scraper_search.categories import _CATEGORIES_BY_SLUG
    cat = _CATEGORIES_BY_SLUG[slug]
    return {
        "slug": cat.slug,
        "name": cat.name,
        "path": get_path(cat.slug),
        "children": [serialize(child) for child in cat.children],
    }

tree = [serialize(r.slug) for r in root_categories()]
print(json.dumps(tree, ensure_ascii=False))
`

    const proc = spawn(pythonCmd, ['-c', code], {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => (stdout += d.toString()))
    proc.stderr?.on('data', (d) => (stderr += d.toString()))

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `Python exited with code ${code}`))
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        reject(new Error(`Invalid JSON from Python: ${msg}\n${stdout.slice(0, 500)}`))
      }
    })

    proc.on('error', (err) => reject(err))

    setTimeout(() => {
      if (!proc.killed) {
        proc.kill()
        reject(new Error('Categories load timeout'))
      }
    }, 15_000)
  })
}
