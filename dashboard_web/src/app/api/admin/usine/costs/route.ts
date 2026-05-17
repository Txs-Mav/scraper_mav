import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * GET /api/admin/usine/costs
 *
 * Phase 5.3 du plan optim couts Claude scraper_usine.
 *
 * Renvoie les cartes de cout pour le dashboard /admin/usine :
 *   - cost_7d, cost_30d, cost_total
 *   - average_cost_per_site
 *   - mode_distribution (hybrid vs full_claude)
 *   - top_5_sites_by_cost
 *
 * Source : table `usine_runs` colonne `cost_usd_total` (alimentee par
 * scraper_ai/scraper_usine/main.py au moment de la finalisation du run,
 * lue depuis l'audit JSON Phase 1.1).
 *
 * Migration requise : migration_usine_runs_cost_tracking.sql
 */
type CostRow = {
  cost_usd_total: number | null
  mode_used: 'hybrid' | 'full_claude' | null
  slug: string | null
  url: string | null
  started_at: string
  validation_score: number | null
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  let supabase
  try {
    supabase = createServiceClient()
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Supabase service client KO' },
      { status: 503 },
    )
  }

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()

  // 30 jours suffit pour calculer 7d et 30d en un seul fetch
  const { data, error } = await supabase
    .from('usine_runs' as any)
    .select('cost_usd_total, mode_used, slug, url, started_at, validation_score')
    .gte('started_at', thirtyDaysAgo)
    .not('cost_usd_total', 'is', null)
    .order('started_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: `Lecture usine_runs KO: ${error.message}` },
      { status: 500 },
    )
  }

  const rows = (data || []) as unknown as CostRow[]

  let cost7d = 0
  let cost30d = 0
  let runs7d = 0
  let runs30d = 0
  let modeHybrid = 0
  let modeFullClaude = 0
  const costBySite: Record<string, { cost: number; runs: number; url: string | null; lastScore: number | null }> = {}

  for (const r of rows) {
    const cost = Number(r.cost_usd_total || 0)
    cost30d += cost
    runs30d += 1
    if (r.started_at >= sevenDaysAgo) {
      cost7d += cost
      runs7d += 1
    }
    if (r.mode_used === 'hybrid') modeHybrid += 1
    else if (r.mode_used === 'full_claude') modeFullClaude += 1

    if (r.slug) {
      const entry = costBySite[r.slug] || { cost: 0, runs: 0, url: r.url, lastScore: null }
      entry.cost += cost
      entry.runs += 1
      if (entry.lastScore === null) entry.lastScore = r.validation_score
      costBySite[r.slug] = entry
    }
  }

  const top5 = Object.entries(costBySite)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5)
    .map(([slug, info]) => ({
      slug,
      url: info.url,
      cost_usd_total: Number(info.cost.toFixed(4)),
      runs: info.runs,
      last_score: info.lastScore,
    }))

  return NextResponse.json({
    cost_7d_usd: Number(cost7d.toFixed(4)),
    cost_30d_usd: Number(cost30d.toFixed(4)),
    runs_7d: runs7d,
    runs_30d: runs30d,
    average_cost_per_run_7d_usd: runs7d ? Number((cost7d / runs7d).toFixed(4)) : 0,
    average_cost_per_run_30d_usd: runs30d ? Number((cost30d / runs30d).toFixed(4)) : 0,
    mode_distribution: {
      hybrid: modeHybrid,
      full_claude: modeFullClaude,
      hybrid_pct: (modeHybrid + modeFullClaude) > 0
        ? Math.round((modeHybrid / (modeHybrid + modeFullClaude)) * 100)
        : 0,
    },
    top_5_sites_by_cost: top5,
  })
}
