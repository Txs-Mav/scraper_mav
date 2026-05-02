/**
 * Helpers pour lire/écrire des fichiers dans un repo GitHub via l'API REST
 * Contents (https://docs.github.com/en/rest/repos/contents).
 *
 * Utilisé par les routes admin (`/api/admin/scrapers/[slug]/approve`) pour
 * pousser un workflow GitHub Action sans avoir besoin d'un git CLI côté
 * Vercel/Edge runtime.
 *
 * Variables d'environnement requises :
 *   GITHUB_PAT     — Personal Access Token (scope `contents:write`)
 *   GITHUB_REPO    — `owner/repo` (ex: "mavmenard/scraper-mav")
 *   GITHUB_BRANCH  — branche cible (défaut: 'main')
 *
 * Si l'une des variables n'est pas définie, les helpers retournent un objet
 * d'erreur explicite plutôt que de planter (mode dégradé contrôlé).
 */

const DEFAULT_BRANCH = 'main'
const GITHUB_API_BASE = 'https://api.github.com'

export interface GitHubConfig {
  pat: string
  repo: string
  branch: string
}

export interface GitHubError {
  ok: false
  reason: 'env_missing' | 'http_error' | 'network_error' | 'unexpected'
  status?: number
  message: string
}

export interface GitHubFileMetadata {
  ok: true
  exists: boolean
  sha?: string         // sha du blob (requis pour update)
  size?: number
  htmlUrl?: string
}

export interface GitHubCommitResult {
  ok: true
  action: 'created' | 'updated' | 'unchanged'
  path: string
  sha: string
  commitSha?: string
  commitUrl?: string
}

/**
 * Lit la configuration GitHub depuis l'environnement.
 * Retourne `null` si une variable critique manque (mode dégradé).
 */
export function getGitHubConfig(): GitHubConfig | null {
  const pat = process.env.GITHUB_PAT?.trim()
  const repo = process.env.GITHUB_REPO?.trim()
  const branch = (process.env.GITHUB_BRANCH || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH
  if (!pat || !repo) return null
  return { pat, repo, branch }
}

function buildHeaders(pat: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${pat}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'go-data-dashboard',
  }
}

/**
 * Récupère les métadonnées d'un fichier (existence + sha).
 * Le sha est nécessaire pour faire un PUT update sans conflit.
 */
export async function getFileMetadata(
  path: string,
  config?: GitHubConfig | null,
): Promise<GitHubFileMetadata | GitHubError> {
  const cfg = config ?? getGitHubConfig()
  if (!cfg) {
    return {
      ok: false,
      reason: 'env_missing',
      message: 'GITHUB_PAT / GITHUB_REPO non configurés.',
    }
  }

  const url = `${GITHUB_API_BASE}/repos/${cfg.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(cfg.branch)}`

  let resp: Response
  try {
    resp = await fetch(url, { headers: buildHeaders(cfg.pat), cache: 'no-store' })
  } catch (e: any) {
    return {
      ok: false,
      reason: 'network_error',
      message: e?.message ?? 'Erreur réseau GitHub',
    }
  }

  if (resp.status === 404) {
    return { ok: true, exists: false }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    return {
      ok: false,
      reason: 'http_error',
      status: resp.status,
      message: `GitHub API ${resp.status}: ${text.slice(0, 300)}`,
    }
  }

  const data = await resp.json().catch(() => null) as any
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      reason: 'unexpected',
      message: 'Réponse GitHub inattendue (path est-il un dossier ?)',
    }
  }
  return {
    ok: true,
    exists: true,
    sha: data.sha as string,
    size: data.size as number,
    htmlUrl: data.html_url as string,
  }
}

/**
 * Crée ou met à jour un fichier dans le repo via l'API Contents.
 * Idempotent : si le contenu est identique à la version distante, on
 * retourne `action: 'unchanged'` sans créer de commit.
 */
export async function upsertFile(args: {
  path: string
  content: string                      // texte brut, sera encodé en base64
  commitMessage: string
  config?: GitHubConfig | null
  authorName?: string
  authorEmail?: string
}): Promise<GitHubCommitResult | GitHubError> {
  const cfg = args.config ?? getGitHubConfig()
  if (!cfg) {
    return {
      ok: false,
      reason: 'env_missing',
      message: 'GITHUB_PAT / GITHUB_REPO non configurés.',
    }
  }

  const meta = await getFileMetadata(args.path, cfg)
  if (!meta.ok) return meta

  const newContentB64 = utf8ToBase64(args.content)

  if (meta.exists && meta.sha) {
    // Vérifie si le contenu distant est identique pour éviter un commit vide.
    const remote = await fetchRawFileContent(args.path, cfg)
    if (remote.ok && remote.content === args.content) {
      return {
        ok: true,
        action: 'unchanged',
        path: args.path,
        sha: meta.sha,
      }
    }
  }

  const body: Record<string, any> = {
    message: args.commitMessage,
    content: newContentB64,
    branch: cfg.branch,
  }
  if (meta.exists && meta.sha) body.sha = meta.sha
  if (args.authorName && args.authorEmail) {
    body.committer = { name: args.authorName, email: args.authorEmail }
    body.author = { name: args.authorName, email: args.authorEmail }
  }

  const url = `${GITHUB_API_BASE}/repos/${cfg.repo}/contents/${encodeURIComponent(args.path).replace(/%2F/g, '/')}`

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'PUT',
      headers: { ...buildHeaders(cfg.pat), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e: any) {
    return {
      ok: false,
      reason: 'network_error',
      message: e?.message ?? 'Erreur réseau GitHub',
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    return {
      ok: false,
      reason: 'http_error',
      status: resp.status,
      message: `GitHub PUT ${resp.status}: ${text.slice(0, 300)}`,
    }
  }

  const data = await resp.json().catch(() => null) as any
  return {
    ok: true,
    action: meta.exists ? 'updated' : 'created',
    path: args.path,
    sha: data?.content?.sha,
    commitSha: data?.commit?.sha,
    commitUrl: data?.commit?.html_url,
  }
}

/**
 * Lit le contenu brut d'un fichier (décodé en UTF-8) pour comparer avec
 * le contenu local et éviter les commits no-op.
 */
async function fetchRawFileContent(
  path: string,
  config: GitHubConfig,
): Promise<{ ok: true; content: string } | GitHubError> {
  const url = `${GITHUB_API_BASE}/repos/${config.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(config.branch)}`
  let resp: Response
  try {
    resp = await fetch(url, { headers: buildHeaders(config.pat), cache: 'no-store' })
  } catch (e: any) {
    return { ok: false, reason: 'network_error', message: e?.message ?? 'Erreur réseau' }
  }
  if (!resp.ok) {
    return {
      ok: false,
      reason: 'http_error',
      status: resp.status,
      message: `GitHub raw ${resp.status}`,
    }
  }
  const data = await resp.json().catch(() => null) as any
  const b64 = (data?.content ?? '').replace(/\s+/g, '')
  if (!b64) return { ok: true, content: '' }
  return { ok: true, content: base64ToUtf8(b64) }
}

/** Encode UTF-8 → base64 (compat Node + Edge runtime). */
function utf8ToBase64(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8').toString('base64')
  }
  // Edge runtime fallback
  const bytes = new TextEncoder().encode(input)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  // eslint-disable-next-line no-undef
  return btoa(bin)
}

/** Décode base64 → UTF-8 (compat Node + Edge runtime). */
function base64ToUtf8(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'base64').toString('utf-8')
  }
  // eslint-disable-next-line no-undef
  const bin = atob(input)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
