/**
 * Helpers partagés pour spawner le CLI Python `scraper_ai.scraper_search.main`.
 *
 * Utilisés à la fois par :
 *   - /api/product-search          (recherche utilisateur multi-sources)
 *   - /api/admin/search-sources/test (test live d'une source unique)
 *
 * Responsabilités :
 *   1. Résoudre la racine du projet (selon qu'on est en dev local ou serverless).
 *   2. Charger les ENV depuis les .env locaux (legacy).
 *   3. Surcharger avec les valeurs de `system_config` (DB) — *priorité haute*.
 *   4. Convertir `FB_COOKIES_JSON` (stocké en DB) en fichier temp + exporter
 *      `FB_COOKIES_FILE=<path>` (l'adapter Python attend un chemin disque).
 *   5. Cleanup du fichier temp après l'exécution.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

export interface SearchSpawnEnv {
  /** Variables d'environnement à passer au subprocess Python. */
  env: NodeJS.ProcessEnv
  /** Fichiers temporaires à supprimer après l'exécution (cookies, etc.). */
  cleanup: () => void
}

/**
 * Cherche `scraper_ai/` à partir du cwd, sinon remonte d'un niveau.
 * En prod (Vercel/Railway) la racine est le cwd ; en dev (run depuis
 * `dashboard_web/`) on remonte d'un cran.
 */
export function resolveProjectRoot(): string {
  if (fs.existsSync(path.join(process.cwd(), 'scraper_ai'))) {
    return process.cwd()
  }
  return path.join(process.cwd(), '..')
}

/**
 * Parsing rudimentaire de fichiers .env (suffisant pour les K/V simples
 * utilisés ici). Ne remplace pas dotenv mais évite la dépendance.
 */
export function loadDotEnv(rootDir: string): Record<string, string> {
  const env: Record<string, string> = {}
  const candidates = [
    path.join(rootDir, '.env'),
    path.join(rootDir, 'dashboard_web', '.env.local'),
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), 'dashboard_web', '.env.local'),
  ]

  for (const envPath of candidates) {
    try {
      const raw = fs.readFileSync(envPath, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq <= 0) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        env[key] = value
      }
    } catch {
      // Fichier optionnel.
    }
  }

  return env
}

interface SystemConfigRow {
  key: string
  value: string | null
}

/**
 * Lit `system_config` (DB) et renvoie un dict K/V des valeurs non-nulles.
 * Échec silencieux : si Supabase indisponible on retourne {} (et les adapters
 * tomberont sur les ENV legacy).
 */
export async function loadSystemConfig(): Promise<Record<string, string>> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('system_config')
      .select('key, value')
    if (error) {
      console.warn('[search-spawn] system_config load failed:', error.message)
      return {}
    }
    const out: Record<string, string> = {}
    for (const row of (data as SystemConfigRow[] | null) || []) {
      if (row.value && row.value.length > 0) {
        out[row.key] = row.value
      }
    }
    return out
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[search-spawn] system_config exception:', msg)
    return {}
  }
}

/**
 * Construit l'environnement à passer au subprocess Python.
 *
 * Priorité (du plus faible au plus fort) :
 *   1. process.env (variables du run Node)
 *   2. Fichiers .env (local dev legacy)
 *   3. Table system_config (DB) — overrides finaux
 *
 * Gère le cas spécial FB_COOKIES_JSON → écrit dans un fichier temp et
 * exporte FB_COOKIES_FILE.
 */
export async function buildSearchEnv(rootDir: string): Promise<SearchSpawnEnv> {
  const dotenv = loadDotEnv(rootDir)
  const systemConfig = await loadSystemConfig()

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...dotenv,
    ...systemConfig,
    PYTHONUNBUFFERED: '1',
  }

  const cleanupFns: Array<() => void> = []

  // Cas spécial : FB_COOKIES_JSON (DB) → FB_COOKIES_FILE (path disque).
  // L'adapter Python attend un chemin vers un JSON Cookie-Editor exporté.
  const cookiesJson = systemConfig.FB_COOKIES_JSON
  if (cookiesJson && cookiesJson.trim().length > 0) {
    try {
      // Validation rapide : doit parser en JSON.
      JSON.parse(cookiesJson)
      const tmpPath = path.join(
        os.tmpdir(),
        `fb_cookies_${randomUUID()}.json`,
      )
      fs.writeFileSync(tmpPath, cookiesJson, { mode: 0o600 })
      env.FB_COOKIES_FILE = tmpPath
      cleanupFns.push(() => {
        try {
          fs.unlinkSync(tmpPath)
        } catch {
          // Cleanup best-effort.
        }
      })
    } catch (e: unknown) {
      console.warn(
        '[search-spawn] FB_COOKIES_JSON présent mais JSON invalide, ignoré:',
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  return {
    env,
    cleanup: () => {
      for (const fn of cleanupFns) fn()
    },
  }
}
