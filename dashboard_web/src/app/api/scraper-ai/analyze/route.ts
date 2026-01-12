import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { url, forceRefresh } = body
    
    // Récupérer l'utilisateur connecté pour passer user_id au script Python
    const user = await getCurrentUser()
    const user_id = user?.id || null

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      )
    }

    // Utiliser scraper_ai pour analyser le site
    const scraperAiModule = 'scraper_ai.html_analyzer'
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
    
    // Créer un script temporaire pour analyser
    const scriptPath = path.join(process.cwd(), '..', 'analyze_site.py')
    const escapedUrl = url.replace(/"/g, '\\"')
    const scriptContent = `
import sys
import json
import os
from pathlib import Path

# Ajouter le chemin parent au PYTHONPATH
sys.path.insert(0, str(Path(__file__).parent))

try:
    from scraper_ai.html_analyzer import HTMLAnalyzer
    import requests
except ImportError as e:
    print(json.dumps({
        'success': False,
        'error': f'Import error: {str(e)}',
        'errorType': 'ImportError',
        'pythonPath': sys.path
    }))
    sys.exit(1)

url = "${escapedUrl}"
force_refresh = ${forceRefresh || false}
user_id = ${user_id ? `"${user_id}"` : 'None'}

try:
    analyzer = HTMLAnalyzer(user_id=user_id)
    
    # Récupérer le HTML
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
    
    print(f"📥 Récupération du HTML de {url}...", flush=True)
    response = session.get(url, timeout=30)
    response.raise_for_status()
    html_content = response.text
    
    print(f"✅ {len(html_content)} caractères récupérés", flush=True)
    
    # Analyser et générer le scraper
    print(f"🔍 Analyse du site avec Gemini + Outils AI...", flush=True)
    result = analyzer.analyze_and_generate_scraper(
        url=url,
        html_content=html_content,
        force_refresh=force_refresh
    )
    
    # Retourner le résultat (JSON sur la dernière ligne)
    output = {
        'success': True,
        'scraperData': result,
        'metadata': result.get('metadata', {})
    }
    print(json.dumps(output), flush=True)
    
except Exception as e:
    import traceback
    error_output = {
        'success': False,
        'error': str(e),
        'errorType': type(e).__name__,
        'traceback': traceback.format_exc()
    }
    print(json.dumps(error_output), flush=True)
    sys.exit(1)
`

    // Écrire le script temporaire
    fs.writeFileSync(scriptPath, scriptContent)

    return new Promise<Response>((resolve) => {
      const pythonProcess = spawn(pythonCmd, [scriptPath], {
        cwd: path.join(process.cwd(), '..'),
        stdio: 'pipe',
        shell: false,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })

      let stdout = ''
      let stderr = ''

      pythonProcess.stdout?.on('data', (data) => {
        const text = data.toString()
        stdout += text
        console.log(`[ScraperAI] ${text}`)
      })

      pythonProcess.stderr?.on('data', (data) => {
        const text = data.toString()
        stderr += text
        console.error(`[ScraperAI Error] ${text}`)
      })

      pythonProcess.on('close', (code) => {
        // Nettoyer le script temporaire
        try {
          fs.unlinkSync(scriptPath)
        } catch (e) {
          // Ignorer les erreurs de suppression
        }

        if (code === 0) {
          try {
            // Parser la dernière ligne JSON de stdout
            const lines = stdout.trim().split('\n')
            const lastLine = lines[lines.length - 1]
            const result = JSON.parse(lastLine)
            
            if (result.success) {
              resolve(NextResponse.json(result))
            } else {
              resolve(NextResponse.json(
                { error: result.error || 'Unknown error' },
                { status: 500 }
              ))
            }
          } catch (parseError) {
            resolve(NextResponse.json(
              {
                error: 'Failed to parse result',
                message: stdout.slice(-1000) || stderr.slice(-1000)
              },
              { status: 500 }
            ))
          }
        } else {
          resolve(NextResponse.json(
            {
              error: 'Analysis failed',
              message: stderr || stdout || 'Erreur inconnue',
              code
            },
            { status: 500 }
          ))
        }
      })

      pythonProcess.on('error', (error) => {
        console.error(`[ScraperAI] Process error:`, error)
        resolve(NextResponse.json(
          {
            error: 'Failed to start analysis',
            message: error.message
          },
          { status: 500 }
        ))
      })

      // Timeout: 5 min pour l'analyse
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill()
          resolve(NextResponse.json(
            {
              error: 'Analysis timeout',
              message: 'L\'analyse a pris trop de temps'
            },
            { status: 500 }
          ))
        }
      }, 5 * 60 * 1000)
    })
  } catch (error: any) {
    console.error('Error analyzing site:', error)
    return NextResponse.json(
      { error: 'Failed to analyze site', message: error.message },
      { status: 500 }
    )
  }
}

