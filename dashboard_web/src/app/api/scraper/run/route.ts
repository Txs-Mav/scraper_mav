import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { referenceUrl, urls, forceRefresh } = body

    if (!referenceUrl) {
      return NextResponse.json(
        { error: 'referenceUrl is required' },
        { status: 400 }
      )
    }

    // Filtrer les URLs vides et s'assurer que le site de référence est dans la liste
    // Permettre le scraping avec seulement le site de référence (pas besoin de concurrents)
    let allUrls = (urls || []).filter((url: string) => url && url.trim() !== '')
    if (!allUrls.includes(referenceUrl)) {
      allUrls.unshift(referenceUrl)
    }

    // Si aucune URL valide (même pas le site de référence), erreur
    if (allUrls.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid URL is required' },
        { status: 400 }
      )
    }

    // Utiliser scraper_ai (agent IA automatique)
    // L'agent IA vérifie automatiquement le cache et génère un scraper si nécessaire
    const scraperModule = 'scraper_ai.main'

    // Construire la commande
    const args = ['-m', scraperModule]

    // Ajouter l'option --reference pour la comparaison de prix
    if (referenceUrl) {
      args.push('--reference', referenceUrl)
    }

    // Ajouter l'option --force-refresh si demandé
    if (forceRefresh) {
      args.push('--force-refresh')
    }

    // Ajouter toutes les URLs à scraper
    args.push(...allUrls)

    console.log(`[ScraperAI] Module: ${scraperModule}`)
    console.log(`[ScraperAI] URLs to scrape: ${allUrls.length}`)
    console.log(`[ScraperAI] Reference URL: ${referenceUrl}`)
    console.log(`[ScraperAI] Force refresh: ${forceRefresh || false}`)
    console.log(`[ScraperAI] Full command: python3 ${args.join(' ')}`)
    console.log(`[ScraperAI] L'agent IA va automatiquement analyser les sites et générer des scrapers si nécessaire`)

    // Lancer le scraping en arrière-plan avec nohup ou spawn détaché
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'

    // Utiliser un script shell avec nohup pour lancer Python complètement détaché
    // Cela évite de bloquer Next.js car le script shell se termine immédiatement
    const logsDir = path.join(process.cwd(), '..', 'scraper_logs')
    const timestamp = Date.now()
    const lockFile = path.join(logsDir, `scraper_${timestamp}.lock`)
    const logFile = path.join(logsDir, `scraper_${timestamp}.log`)
    const scriptFile = path.join(logsDir, `scraper_${timestamp}.sh`)

    // Créer le dossier de logs s'il n'existe pas
    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true })
      }
    } catch (e) {
      console.error(`[ScraperAI] Erreur création dossier logs:`, e)
    }

    // Créer le script shell qui lance Python avec nohup
    // Échapper les arguments pour éviter les problèmes de shell
    const escapedArgs = args.map(arg => {
      // Échapper les guillemets et caractères spéciaux pour le shell
      const escaped = arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')
      return `"${escaped}"`
    }).join(' ')


    console.log(`[ScraperAI] Escaped args: ${escapedArgs}`)
    console.log(`LETS SEE`)
    // Préparer les données JSON pour le fichier de lock
    // Le PID sera ajouté par le script shell
    const lockDataTemplate = {
      pid: 0, // Sera remplacé
      startTime: timestamp,
      urls: allUrls,
      referenceUrl: referenceUrl
    }

    // Créer le script shell qui lance Python avec nohup
    // Échapper le JSON pour le shell
    const urlsJson = JSON.stringify(allUrls).replace(/\\/g, '\\\\').replace(/\$/g, '\\$')
    const refUrlEscaped = referenceUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')

    const scriptContent = `#!/bin/bash
# Script généré automatiquement pour lancer le scraper Python
cd "${path.join(process.cwd(), '..').replace(/"/g, '\\"')}"
nohup ${pythonCmd} ${escapedArgs} > "${logFile.replace(/"/g, '\\"')}" 2>&1 &
PYTHON_PID=$!
# Attendre un peu pour s'assurer que le processus est lancé
sleep 0.5
# Vérifier que le processus existe toujours
if kill -0 $PYTHON_PID 2>/dev/null; then
  # Écrire le PID dans le fichier de lock
  cat > "${lockFile.replace(/"/g, '\\"')}" << LOCKEOF
{
  "pid": $PYTHON_PID,
  "startTime": ${timestamp},
  "urls": ${urlsJson},
  "referenceUrl": "${refUrlEscaped}"
}
LOCKEOF
  echo $PYTHON_PID
else
  echo "ERROR: Process failed to start" >&2
  exit 1
fi
`

    try {
      // Écrire le script shell
      fs.writeFileSync(scriptFile, scriptContent, { mode: 0o755 })

      // Exécuter le script shell (il se termine immédiatement après avoir lancé Python)
      const shellProcess = spawn('bash', [scriptFile], {
        cwd: path.join(process.cwd(), '..'),
        stdio: 'pipe',
        shell: false,
        detached: false // Le script shell doit se terminer rapidement
      })

      let scriptOutput = ''
      shellProcess.stdout?.on('data', (data) => {
        scriptOutput += data.toString()
      })

      shellProcess.stderr?.on('data', (data) => {
        console.error(`[ScraperAI Script Error] ${data.toString()}`)
      })

      shellProcess.on('close', (code) => {
        // Nettoyer le script shell après exécution
        try {
          if (fs.existsSync(scriptFile)) {
            fs.unlinkSync(scriptFile)
          }
        } catch (e) {
          // Ignorer les erreurs de suppression
        }

        if (code === 0) {
          // Le script s'est terminé avec succès, Python est lancé en arrière-plan
          const pid = scriptOutput.trim()
          if (pid && !isNaN(parseInt(pid))) {
            console.log(`[ScraperAI] ✅ Scraping lancé avec PID: ${pid}`)
            // Vérifier que le lock file existe et contient le bon PID
            try {
              if (fs.existsSync(lockFile)) {
                const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'))
                if (lockData.pid) {
                  console.log(`[ScraperAI] ✅ Lock file créé avec PID: ${lockData.pid}`)
                }
              }
            } catch (e) {
              console.warn(`[ScraperAI] ⚠️ Lock file non lisible:`, e)
            }
          } else {
            console.warn(`[ScraperAI] ⚠️ PID non valide reçu: ${pid}`)
          }
        } else {
          console.error(`[ScraperAI] ❌ Erreur lors du lancement du script (code ${code})`)
          console.error(`[ScraperAI] Output: ${scriptOutput}`)
          // Supprimer le lock file si le script a échoué
          try {
            if (fs.existsSync(lockFile)) {
              fs.unlinkSync(lockFile)
            }
          } catch (e) {
            // Ignorer les erreurs de suppression
          }
        }
      })

      console.log(`LETS SEE 2`)

      // Ne pas attendre le script - retourner immédiatement
      // Le script shell se terminera rapidement (environ 0.5s) et Python continuera en arrière-plan
      // Next.js ne sera pas bloqué
    } catch (error: any) {
      console.error(`[ScraperAI] Erreur création/exécution script:`, error)
      // Nettoyer en cas d'erreur
      try {
        if (fs.existsSync(scriptFile)) {
          fs.unlinkSync(scriptFile)
        }
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile)
        }
      } catch (e) {
        // Ignorer les erreurs de nettoyage
      }
    }

    // Attendre un court délai pour que le script shell se termine et crée le lock file
    // Le script shell se termine rapidement (~0.5s), donc 1 seconde devrait suffire
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Lire le PID depuis le fichier de lock
    let pid: number | null = null
    try {
      if (fs.existsSync(lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'))
        if (lockData.pid) {
          pid = lockData.pid
          console.log(`[ScraperAI] ✅ PID lu depuis lock file: ${pid}`)
        }
      }
    } catch (e) {
      console.warn(`[ScraperAI] ⚠️ Impossible de lire le PID depuis le lock file:`, e)
    }

    console.log(`LETS SEE 3`)

    // Retourner la réponse avec le PID si disponible
    // Le script shell a lancé Python en arrière-plan avec nohup et s'est terminé
    // Python continue à s'exécuter complètement indépendamment de Next.js
    // Next.js n'est pas bloqué car le script shell s'est terminé rapidement
    return NextResponse.json({
      success: true,
      message: `Scraping lancé pour ${allUrls.length} site(s). Le processus continue en arrière-plan.`,
      pid: pid,
      lockFile: lockFile,
      logFile: logFile,
      note: 'Le processus Python est complètement détaché et fonctionne comme depuis le terminal'
    })
  } catch (error: any) {
    console.error('Error running scraper:', error)
    return NextResponse.json(
      { error: 'Failed to run scraper', message: error.message },
      { status: 500 }
    )
  }
}
