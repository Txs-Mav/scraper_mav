import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

// Types locaux : la table usine_lessons est créée par
// `dashboard_web/supabase/migration_usine_runs.sql` mais n'est pas encore
// reflétée dans les types générés. On cast donc localement.
type UsineLessonRow = {
  id: string
  created_at: string
  slug: string | null
  url: string | null
  platform: string | null
  phase: string
  error_signature: string
  field_fixed: string | null
  diff: string | null
  claude_rationale: string | null
  tokens_used: number | null
  iterations: number | null
  applied_to_template: boolean
  applied_at: string | null
  applied_notes: string | null
}

/**
 * GET /api/admin/usine/lessons
 * Liste les leçons Claude capturées par les hooks de scraper_usine
 * (claude_supervisor + claude_agent → table `usine_lessons`).
 *
 * Query params:
 *   - status: 'pending' (défaut) | 'applied' | 'all'
 *   - slug:   filtrer sur un scraper
 *   - phase:  filtrer sur supervisor_initial | auto_correct | agent_fallback
 *   - limit:  défaut 50 (max 200)
 *   - sinceDays: défaut 30
 *
 * Retourne :
 *   {
 *     lessons: [...],         // détaillées (incl. diff)
 *     summary: { byPlatform, byField, byPlatformField, total, pending }
 *   }
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  const url = new URL(request.url)
  const status = (url.searchParams.get('status') || 'pending') as
    | 'pending' | 'applied' | 'all'
  const slugFilter = url.searchParams.get('slug') || null
  const phaseFilter = url.searchParams.get('phase') || null
  const limitRaw = parseInt(url.searchParams.get('limit') || '50', 10)
  const limit = Math.min(200, Math.max(1, isFinite(limitRaw) ? limitRaw : 50))
  const sinceDaysRaw = parseInt(url.searchParams.get('sinceDays') || '30', 10)
  const sinceDays = Math.min(365, Math.max(1, isFinite(sinceDaysRaw) ? sinceDaysRaw : 30))

  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString()

  const supabase = createServiceClient()
  let query = supabase
    .from('usine_lessons')
    .select(
      'id, created_at, slug, url, platform, phase, error_signature, ' +
      'field_fixed, diff, claude_rationale, tokens_used, iterations, ' +
      'applied_to_template, applied_at, applied_notes'
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status === 'pending') query = query.eq('applied_to_template', false)
  else if (status === 'applied') query = query.eq('applied_to_template', true)
  if (slugFilter) query = query.eq('slug', slugFilter)
  if (phaseFilter) query = query.eq('phase', phaseFilter)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const lessons = ((data as unknown) as UsineLessonRow[] | null) || []

  // Agrégats légers — top platforms/fields sur l'échantillon retourné.
  const byPlatform = new Map<string, number>()
  const byField = new Map<string, number>()
  const byPlatformField = new Map<string, number>()
  let pendingCount = 0

  for (const l of lessons) {
    const plat = (l.platform || 'unknown').toLowerCase()
    const field = (l.field_fixed || 'unspecified').toLowerCase()
    byPlatform.set(plat, (byPlatform.get(plat) || 0) + 1)
    byField.set(field, (byField.get(field) || 0) + 1)
    const key = `${plat}|${field}`
    byPlatformField.set(key, (byPlatformField.get(key) || 0) + 1)
    if (!l.applied_to_template) pendingCount += 1
  }

  const toTop = (m: Map<string, number>, n = 10) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, count]) => ({ key, count }))

  return NextResponse.json({
    lessons,
    summary: {
      total: lessons.length,
      pending: pendingCount,
      byPlatform: toTop(byPlatform),
      byField: toTop(byField),
      byPlatformField: toTop(byPlatformField),
    },
    filters: { status, slug: slugFilter, phase: phaseFilter, sinceDays, limit },
  })
}

/**
 * PATCH /api/admin/usine/lessons
 * Body: { id: string, applied: boolean, notes?: string }
 *
 * Marque une leçon comme intégrée au template (ou la décoche).
 */
export async function PATCH(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  let body: { id?: string; applied?: boolean; notes?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }
  if (!body.id || typeof body.applied !== 'boolean') {
    return NextResponse.json(
      { error: 'id et applied (boolean) requis' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()
  const update: Record<string, unknown> = {
    applied_to_template: body.applied,
    applied_at: body.applied ? new Date().toISOString() : null,
    applied_by: body.applied ? user.id : null,
    applied_notes: body.notes ?? null,
  }
  const { data, error } = await supabase
    .from('usine_lessons')
    .update(update)
    .eq('id', body.id)
    .select('id, applied_to_template, applied_at, applied_notes')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Leçon introuvable' }, { status: 404 })
  }

  return NextResponse.json({ success: true, lesson: data })
}
