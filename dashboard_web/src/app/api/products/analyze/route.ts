import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { hasBackend, proxyToBackend } from '@/lib/backend-proxy'
/**
 * POST /api/products/analyze
 *
 * Comparaison rapide depuis les données pré-scrapées (scraped_site_data).
 * Le cron GitHub Actions scrape tous les sites toutes les 30 min.
 * Cet endpoint lit les produits déjà scrapés et fait la comparaison (~2-5s).
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const userId = user.id

    // Proxy vers le backend si on est sur Vercel/serverless
    if (hasBackend()) {
      try {
        const backendRes = await proxyToBackend('/products/analyze', {
          body: { userId },
          timeout: 120_000,
        })
        const data = await backendRes.json()
        return NextResponse.json(data, { status: backendRes.status })
      } catch {
        // Fallback to local execution
      }
    }

    // Exécuter le script de comparaison Python
    const projectRoot = path.resolve(process.cwd(), '..')
    const pythonScript = path.join(projectRoot, 'scripts', 'compare_from_cache.py')

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PYTHONUNBUFFERED: '1',
    }

    // Passer les credentials Supabase au script Python
    if (process.env.SUPABASE_URL) env.SUPABASE_URL = process.env.SUPABASE_URL
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && !env.SUPABASE_URL) {
      env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    }
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    }

    return new Promise<NextResponse>((resolve) => {
      let stdout = ''
      let stderr = ''

      // 120s : assez pour cache (~5s) + éventuel fallback scraping (~90s max)
      const proc = spawn('python3', [pythonScript, '--user-id', userId], {
        env,
        cwd: projectRoot,
        timeout: 120_000,
      })

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(NextResponse.json({
            success: true,
            message: 'Comparaison terminée depuis les données pré-scrapées',
            source: 'scraped_site_data',
            logs: stdout.split('\n').filter(l => l.trim()).slice(-20),
          }))
        } else {
          console.error('[analyze] Script failed:', stderr || stdout)
          resolve(NextResponse.json({
            success: false,
            error: 'no_cached_data',
            message: 'Aucune donnée pré-scrapée disponible. Utilisez le scraping manuel.',
            logs: stdout.split('\n').filter(l => l.trim()).slice(-10),
          }, { status: 404 }))
        }
      })

      proc.on('error', (err: Error) => {
        console.error('[analyze] Spawn error:', err)
        resolve(NextResponse.json({
          success: false,
          error: 'script_error',
          message: err.message,
        }, { status: 500 }))
      })
    })

  } catch (error: any) {
    console.error('[analyze] Error:', error)
    return NextResponse.json(
      { error: 'internal_error', message: error.message },
      { status: 500 }
    )
  }
}
