import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { createClient } from '@/lib/supabase/server'
import { hasBackend, proxyToBackend } from '@/lib/backend-proxy'

export async function POST(request: Request) {
  try {
    // Récupérer l'utilisateur connecté
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('[ScraperAI] ❌ Utilisateur non authentifié')
      return NextResponse.json(
        { error: 'Authentication required', message: 'Vous devez être connecté pour lancer un scraping' },
        { status: 401 }
      )
    }

    const userId = user.id
    const body = await request.json()
    const { referenceUrl, urls, forceRefresh, ignoreColors, inventoryOnly } = body

    // --- Proxy vers le backend Railway si on est sur Vercel ---
    if (hasBackend()) {
      try {
        const backendRes = await proxyToBackend('/scraper/run', {
          body: { userId, referenceUrl, urls, forceRefresh, ignoreColors, inventoryOnly },
        })
        const data = await backendRes.json()
        if (!backendRes.ok) {
          return NextResponse.json(data, { status: backendRes.status })
        }
        return NextResponse.json({
          ...data,
          logFile: data.jobId,
        })
      } catch (e: any) {
        console.error('[ScraperAI] ❌ Erreur proxy backend:', e)
        return NextResponse.json(
          { error: 'Backend unavailable', message: 'Le serveur de scraping est indisponible. Réessayez dans quelques instants.' },
          { status: 503 }
        )
      }
    }

    console.log(`[ScraperAI] ✅ Utilisateur authentifié: ${userId}`)

    // Log détaillé de ce qui est reçu du frontend
    console.log(`[ScraperAI] 📥 Body reçu:`)
    console.log(`[ScraperAI]   - referenceUrl: ${referenceUrl}`)
    console.log(`[ScraperAI]   - urls reçues (${(urls || []).length}):`, JSON.stringify(urls || []))
    console.log(`[ScraperAI]   - forceRefresh: ${forceRefresh}`)
    console.log(`[ScraperAI]   - ignoreColors: ${ignoreColors}`)
    console.log(`[ScraperAI]   - inventoryOnly: ${inventoryOnly}`)

    if (!referenceUrl) {
      return NextResponse.json(
        { error: 'referenceUrl is required' },
        { status: 400 }
      )
    }

    // Filtrer les URLs vides et s'assurer que le site de référence est dans la liste
    let allUrls = (urls || []).filter((url: string) => url && url.trim() !== '')
    if (!allUrls.includes(referenceUrl)) {
      allUrls.unshift(referenceUrl)
    }

    console.log(`[ScraperAI] 📊 URLs après filtrage (${allUrls.length}):`, JSON.stringify(allUrls))

    if (allUrls.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid URL is required' },
        { status: 400 }
      )
    }

    // Construire la commande avec l'user-id
    const scraperModule = 'scraper_ai.main'
    const args = ['-m', scraperModule]

    // IMPORTANT: Ajouter l'ID utilisateur pour l'authentification
    args.push('--user-id', userId)

    // Ajouter l'option --reference pour la comparaison de prix
    if (referenceUrl) {
      args.push('--reference', referenceUrl)
    }

    // Ajouter l'option --force-refresh si demandé
    if (forceRefresh) {
      args.push('--force-refresh')
    }

    // Ajouter l'option --ignore-colors si demandé (permet plus de matchs)
    if (ignoreColors) {
      args.push('--ignore-colors')
    }

    // NOTE: --inventory-only n'est PLUS passé au Python.
    // Le filtrage catalogue pour le site de référence se fait maintenant
    // côté comparaison (filterCatalogueFromReference dans alerts/check/route.ts).
    // Cela permet de sauvegarder TOUS les produits en Supabase et de filtrer
    // uniquement au moment de la comparaison, sans perdre de données.

    // Ajouter toutes les URLs à scraper
    args.push(...allUrls)

    console.log(`[ScraperAI] 📋 Configuration:`)
    console.log(`[ScraperAI]   - Module: ${scraperModule}`)
    console.log(`[ScraperAI]   - User ID: ${userId}`)
    console.log(`[ScraperAI]   - URLs: ${allUrls.length} site(s)`)
    console.log(`[ScraperAI]   - Référence: ${referenceUrl}`)
    console.log(`[ScraperAI]   - Force refresh: ${forceRefresh || false}`)
    console.log(`[ScraperAI]   - Ignorer couleurs: ${ignoreColors || false}`)
    console.log(`[ScraperAI]   - Filtrer catalogue (comparaison): ${inventoryOnly || false}`)
    console.log(`[ScraperAI] 🚀 Commande: python3 ${args.join(' ')}`)

    const pythonCmd = process.platform === 'win32' ? 'python -u' : 'python3 -u'
    const logsDir = path.join(process.cwd(), '..', 'scraper_logs')
    const timestamp = Date.now()
    const lockFile = path.join(logsDir, `scraper_${timestamp}.lock`)
    const logFile = path.join(logsDir, `scraper_${timestamp}.log`)
    const scriptFile = path.join(logsDir, `scraper_${timestamp}.sh`)

    // Créer le dossier de logs
    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true })
      }
    } catch (e) {
      console.error(`[ScraperAI] ❌ Erreur création dossier logs:`, e)
    }

    // Nettoyer les lock files orphelins (process mort ou > 6h)
    try {
      const lockFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('.lock'))
      for (const lf of lockFiles) {
        const lockPath = path.join(logsDir, lf)
        try {
          const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'))
          const ageMs = Date.now() - (lockData.startTime || 0)
          const maxAgeMs = 6 * 60 * 60 * 1000
          let processAlive = false
          if (lockData.pid) {
            try { process.kill(lockData.pid, 0); processAlive = true } catch { processAlive = false }
          }
          if (!processAlive || ageMs > maxAgeMs) {
            fs.unlinkSync(lockPath)
            console.log(`[ScraperAI] 🧹 Lock file orphelin supprimé: ${lf}`)
          }
        } catch {
          fs.unlinkSync(lockPath)
        }
      }
    } catch (e) {
      console.warn(`[ScraperAI] ⚠️ Nettoyage lock files:`, e)
    }

    // Échapper les arguments pour le shell
    const escapedArgs = args.map(arg => {
      const escaped = arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')
      return `"${escaped}"`
    }).join(' ')

    const urlsJson = JSON.stringify(allUrls).replace(/\\/g, '\\\\').replace(/\$/g, '\\$')
    const refUrlEscaped = referenceUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')

    // Détecter le vrai port depuis la requête (Next.js peut changer de port si 3000 est pris)
    let actualApiUrl = process.env.NEXTJS_API_URL || ''
    if (!actualApiUrl) {
      try {
        const reqUrl = new URL(request.url)
        actualApiUrl = reqUrl.origin
      } catch {
        actualApiUrl = `http://localhost:${process.env.PORT || 3000}`
      }
    }
    console.log(`[ScraperAI] 🔗 NEXTJS_API_URL résolu: ${actualApiUrl}`)

    const scriptContent = `#!/bin/bash
# Script généré automatiquement pour lancer le scraper Python
export PYTHONUNBUFFERED=1
export PYTHONDONTWRITEBYTECODE=1
export NEXTJS_API_URL="${actualApiUrl.replace(/"/g, '\\"')}"
cd "${path.join(process.cwd(), '..').replace(/"/g, '\\"')}"
nohup ${pythonCmd} ${escapedArgs} > "${logFile.replace(/"/g, '\\"')}" 2>&1 &
PYTHON_PID=$!
sleep 0.5
if kill -0 $PYTHON_PID 2>/dev/null; then
  cat > "${lockFile.replace(/"/g, '\\"')}" << LOCKEOF
{
  "pid": $PYTHON_PID,
  "startTime": ${timestamp},
  "userId": "${userId}",
  "urls": ${urlsJson},
  "referenceUrl": "${refUrlEscaped}",
  "logFile": "${logFile.replace(/"/g, '\\"')}"
}
LOCKEOF
  echo $PYTHON_PID
else
  echo "ERROR: Process failed to start" >&2
  exit 1
fi
`

    try {
      fs.writeFileSync(scriptFile, scriptContent, { mode: 0o755 })

      const shellProcess = spawn('bash', [scriptFile], {
        cwd: path.join(process.cwd(), '..'),
        stdio: 'pipe',
        shell: false,
        detached: false
      })

      let scriptOutput = ''
      shellProcess.stdout?.on('data', (data) => {
        scriptOutput += data.toString()
      })

      shellProcess.stderr?.on('data', (data) => {
        console.error(`[ScraperAI] ⚠️ Script stderr: ${data.toString()}`)
      })

      shellProcess.on('close', (code) => {
        try {
          if (fs.existsSync(scriptFile)) {
            fs.unlinkSync(scriptFile)
          }
        } catch (e) {
          // Ignorer
        }

        if (code === 0) {
          const pid = scriptOutput.trim()
          if (pid && !isNaN(parseInt(pid))) {
            console.log(`[ScraperAI] ✅ Scraping lancé avec PID: ${pid}`)
          }
        } else {
          console.error(`[ScraperAI] ❌ Erreur script (code ${code}): ${scriptOutput}`)
          try {
            if (fs.existsSync(lockFile)) {
              fs.unlinkSync(lockFile)
            }
          } catch (e) {
            // Ignorer
          }
        }
      })

    } catch (error: any) {
      console.error(`[ScraperAI] ❌ Erreur création/exécution script:`, error)
      try {
        if (fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile)
        if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile)
      } catch (e) {
        // Ignorer
      }
      return NextResponse.json(
        { error: 'Failed to start scraper', message: error.message },
        { status: 500 }
      )
    }

    // Attendre que le script shell se termine
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Lire le PID depuis le fichier de lock
    let pid: number | null = null
    try {
      if (fs.existsSync(lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'))
        if (lockData.pid) {
          pid = lockData.pid
          console.log(`[ScraperAI] ✅ Processus démarré avec PID: ${pid}`)
        }
      }
    } catch (e) {
      console.warn(`[ScraperAI] ⚠️ Lock file non lisible:`, e)
    }

    return NextResponse.json({
      success: true,
      message: `Scraping lancé pour ${allUrls.length} site(s)`,
      pid: pid,
      lockFile: lockFile,
      logFile: logFile,
      timestamp: timestamp,
      urls: allUrls,
      referenceUrl: referenceUrl
    })
  } catch (error: any) {
    console.error('[ScraperAI] ❌ Erreur:', error)
    return NextResponse.json(
      { error: 'Failed to run scraper', message: error.message },
      { status: 500 }
    )
  }
}

// API pour lire les logs en temps réel
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const logFile = searchParams.get('logFile')
    const lastLine = parseInt(searchParams.get('lastLine') || '0')

    if (!logFile) {
      return NextResponse.json({ error: 'logFile parameter required' }, { status: 400 })
    }

    // --- Proxy vers le backend Railway si on est sur Vercel ---
    if (hasBackend()) {
      try {
        const backendRes = await proxyToBackend('/scraper/logs', {
          method: 'GET',
          params: { jobId: logFile, lastLine: String(lastLine) },
        })
        const data = await backendRes.json()
        return NextResponse.json(data)
      } catch (e: any) {
        return NextResponse.json({
          lines: [],
          totalLines: 0,
          isComplete: false,
          error: 'Backend unavailable',
        })
      }
    }

    // Vérifier que le fichier existe
    if (!fs.existsSync(logFile)) {
      return NextResponse.json({
        lines: [],
        totalLines: 0,
        isComplete: false,
        error: 'Log file not found yet'
      })
    }

    const content = fs.readFileSync(logFile, 'utf-8')
    const allLines = content.split('\n')
    const newLines = allLines.slice(lastLine)

    // Vérifier si le scraping est VRAIMENT terminé
    // On attend des patterns de FIN DÉFINITIVE qui n'apparaissent qu'une fois à la toute fin
    const contentLower = content.toLowerCase()

    // Patterns de FIN NORMALE (uniquement le résumé FINAL de main.py, pas les résumés par site)
    // "⭐ Site de référence:" n'apparaît que dans le résumé final de main.py
    const hasFinalSummary = content.includes('✅ SCRAPING TERMINÉ!') && content.includes('⭐ Site de référence:')
    const hasDataLocation = content.includes('☁️  Données dans:')
    const hasSavedLocally = content.includes('💾 Sauvegardé localement:') || content.includes('💾 Backup local:')

    // Patterns d'erreur qui terminent le scraping (crash Python inclus)
    const hasFatalError =
      contentLower.includes('erreur fatale') ||
      contentLower.includes('erreur critique') ||
      content.includes('AUTHENTIFICATION REQUISE') ||
      content.includes('❌ Aucun site de référence configuré') ||
      content.includes('Traceback (most recent call last)') ||
      content.includes('TypeError:') ||
      content.includes('AttributeError:') ||
      content.includes('KeyError:') ||
      content.includes('ImportError:') ||
      content.includes('ModuleNotFoundError:') ||
      contentLower.includes('fatal error') ||
      contentLower.includes('exception:')

    // Le scraping est complet si on a la fin normale OU un crash fatal
    const isComplete = hasFinalSummary || hasDataLocation || hasSavedLocally || hasFatalError

    return NextResponse.json({
      lines: newLines,
      totalLines: allLines.length,
      isComplete: isComplete,
      hasError: hasFatalError,
      content: lastLine === 0 ? content : undefined
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to read log', message: error.message },
      { status: 500 }
    )
  }
}
