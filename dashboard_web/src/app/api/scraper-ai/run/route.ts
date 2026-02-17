import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { url, referenceUrl, forceRefresh, categories } = body

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      )
    }

    // Récupérer l'utilisateur connecté (OBLIGATOIRE)
    const user = await getCurrentUser()
    
    if (!user) {
      return NextResponse.json(
        { error: 'Authentification requise. Vous devez être connecté pour utiliser le scraper.' },
        { status: 401 }
      )
    }
    
    const userId = user.id

    // Utiliser scraper_ai.main pour exécuter le scraper
    const scraperAiModule = 'scraper_ai.main'
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
    
    // Construire la commande
    const args = ['-m', scraperAiModule]
    
    if (referenceUrl) {
      args.push('--reference', referenceUrl)
    }
    
    if (forceRefresh) {
      args.push('--force-refresh')
    }
    
    // Ajouter l'user ID pour le cache Supabase (toujours présent car auth obligatoire)
    args.push('--user-id', userId)
    
    // Ajouter les catégories si spécifiées
    if (categories && Array.isArray(categories) && categories.length > 0) {
      args.push('--categories', categories.join(','))
    }
    
    args.push(url)

    console.log(`[ScraperAI] Running scraper for: ${url}`)
    console.log(`[ScraperAI] Command: ${pythonCmd} ${args.join(' ')}`)
    console.log(`[ScraperAI] Working directory: ${path.join(process.cwd(), '..')}`)
    console.log(`[ScraperAI] User ID: ${userId || 'anonymous'}`)
    console.log(`[ScraperAI] Categories: ${categories || 'default (inventaire, occasion)'}`)
    console.log(`[ScraperAI] GEMINI_API_KEY present: ${!!process.env.GEMINI_API_KEY}`)

    return new Promise<Response>((resolve) => {
      // S'assurer que les variables d'environnement sont bien passées au processus Python
      const env = { 
        ...process.env, 
        PYTHONUNBUFFERED: '1',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        NEXTJS_API_URL: `http://localhost:${process.env.PORT || 3000}`,
        SCRAPER_USER_ID: userId || ''
      }
      
      console.log(`[ScraperAI] Starting Python process with env keys: ${Object.keys(env).filter(k => k.includes('GEMINI') || k.includes('PYTHON')).join(', ')}`)
      
      const pythonProcess = spawn(pythonCmd, args, {
        cwd: path.join(process.cwd(), '..'),
        stdio: 'pipe',
        shell: false,
        env: env
      })
      
      console.log(`[ScraperAI] Python process started with PID: ${pythonProcess.pid}`)

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
        console.log(`[ScraperAI] Process closed with code: ${code}`)
        console.log(`[ScraperAI] stdout length: ${stdout.length}, stderr length: ${stderr.length}`)
        
        if (code === 0) {
          console.log(`[ScraperAI] ✅ Scraping completed successfully`)
          resolve(NextResponse.json({
            success: true,
            message: `Scraping terminé pour ${url}`,
            stdout: stdout.slice(-5000) // Derniers 5000 caractères
          }))
        } else {
          console.error(`[ScraperAI] ❌ Scraping failed with code ${code}`)
          console.error(`[ScraperAI] stderr: ${stderr.slice(-1000)}`)
          resolve(NextResponse.json(
            {
              error: 'Scraping failed',
              message: stderr || stdout || 'Erreur inconnue',
              code,
              stdout: stdout.slice(-2000),
              stderr: stderr.slice(-2000)
            },
            { status: 500 }
          ))
        }
      })

      pythonProcess.on('error', (error) => {
        console.error(`[ScraperAI] Process error:`, error)
        console.error(`[ScraperAI] Error details:`, {
          message: error.message,
          code: (error as any).code,
          errno: (error as any).errno,
          syscall: (error as any).syscall
        })
        resolve(NextResponse.json(
          {
            error: 'Failed to start scraper',
            message: error.message,
            details: `Vérifiez que Python3 est installé et accessible. Erreur: ${error.message}`
          },
          { status: 500 }
        ))
      })

      // Timeout: 30 min pour le scraping
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill()
          resolve(NextResponse.json(
            {
              error: 'Scraping timeout',
              message: 'Le scraping a pris trop de temps'
            },
            { status: 500 }
          ))
        }
      }, 30 * 60 * 1000)
    })
  } catch (error: any) {
    console.error('Error running scraper:', error)
    return NextResponse.json(
      { error: 'Failed to run scraper', message: error.message },
      { status: 500 }
    )
  }
}

