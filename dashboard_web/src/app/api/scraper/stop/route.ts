import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { hasBackend, proxyToBackend } from '@/lib/backend-proxy'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { logFile } = body

    if (hasBackend()) {
      try {
        const backendRes = await proxyToBackend('/scraper/stop', {
          body: { userId: user.id, jobId: logFile },
          timeout: 15_000,
        })
        const data = await backendRes.json()
        return NextResponse.json(data, { status: backendRes.ok ? 200 : backendRes.status })
      } catch {
        return NextResponse.json(
          { error: 'Backend unavailable' },
          { status: 503 }
        )
      }
    }

    const logsDir = path.join(process.cwd(), '..', 'scraper_logs')

    // Find the lock file that matches the log file to get the PID
    let pid: number | null = null
    let lockFilePath: string | null = null

    try {
      const lockFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('.lock'))
      for (const lf of lockFiles) {
        const lockPath = path.join(logsDir, lf)
        try {
          const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'))
          if (lockData.logFile === logFile || lockData.userId === user.id) {
            pid = lockData.pid
            lockFilePath = lockPath
            break
          }
        } catch {
          continue
        }
      }
    } catch {
      // logsDir may not exist
    }

    if (!pid) {
      return NextResponse.json({ success: true, message: 'No active process found' })
    }

    // Kill the process tree (Python may have spawned child processes)
    let killed = false
    try {
      process.kill(-pid, 'SIGTERM')
      killed = true
    } catch {
      try {
        process.kill(pid, 'SIGTERM')
        killed = true
      } catch {
        killed = false
      }
    }

    // Give it a moment, then force-kill if still alive
    if (killed) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        process.kill(pid, 0)
        // Still alive — force kill
        try { process.kill(-pid, 'SIGKILL') } catch {
          try { process.kill(pid, 'SIGKILL') } catch { /* already dead */ }
        }
      } catch {
        // Process is gone
      }
    }

    // Clean up lock file
    if (lockFilePath) {
      try { fs.unlinkSync(lockFilePath) } catch { /* ok */ }
    }

    // Append a stop marker to the log file so the frontend detects completion
    if (logFile && fs.existsSync(logFile)) {
      try {
        fs.appendFileSync(logFile, '\n❌ Extraction arrêtée par l\'utilisateur\n✅ SCRAPING TERMINÉ!\n⭐ Site de référence: (arrêté)\n')
      } catch { /* ok */ }
    }

    console.log(`[ScraperAI] 🛑 Scraping arrêté par l'utilisateur (PID: ${pid})`)

    return NextResponse.json({
      success: true,
      message: 'Scraping stopped',
      pid,
    })
  } catch (error: any) {
    console.error('[ScraperAI] ❌ Erreur arrêt scraping:', error)
    return NextResponse.json(
      { error: 'Failed to stop scraper', message: error.message },
      { status: 500 }
    )
  }
}
