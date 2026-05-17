/**
 * API du rapport : charge l'historique complet des scrapings de l'utilisateur
 * et construit un rapport factuel (présent / passé / tendances).
 *
 * Contrairement à `/api/analytics` qui ne s'appuie que sur le dernier
 * scraping et produit des interprétations, cette route est conçue pour
 * accumuler les données dans le temps.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { canAccessAnalytics } from '@/lib/plan-restrictions'
import {
  buildReport,
  emptyReport,
  type ScrapingSnapshot,
} from '@/lib/reports-calculations'

// Plafond raisonnable pour borner la mémoire/CPU. Couvre largement
// plusieurs mois de scraping quotidien.
const MAX_SCRAPINGS = 500

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    // Mêmes restrictions de plan que l'analyse pour éviter les
    // contournements (le rapport expose des données dérivées).
    const effectiveSource =
      user.subscription_source ||
      (user.promo_code_id ? ('promo' as const) : null)
    if (
      !canAccessAnalytics(user.subscription_plan ?? 'standard', effectiveSource)
    ) {
      return NextResponse.json(
        { error: 'Accès réservé aux plans Pro et Ultime' },
        { status: 403 },
      )
    }

    // Lecture du paramètre `limit` (optionnel) pour les futurs filtres.
    const url = new URL(request.url)
    const limitParam = Number(url.searchParams.get('limit')) || MAX_SCRAPINGS
    const limit = Math.max(1, Math.min(limitParam, MAX_SCRAPINGS))

    const supabase = await createClient()
    const { data: rows, error } = await supabase
      .from('scrapings')
      .select('id, products, metadata, reference_url, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      console.error('Error loading scrapings for report:', error)
      return NextResponse.json(
        { report: emptyReport(), error: 'Erreur de chargement' },
        { status: 200 },
      )
    }

    const scrapings: ScrapingSnapshot[] = (rows || []).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      reference_url: row.reference_url,
      products: row.products || [],
      metadata: row.metadata || {},
    }))

    if (scrapings.length === 0) {
      return NextResponse.json({
        report: emptyReport(),
        generated_at: new Date().toISOString(),
      })
    }

    const referenceHint =
      scrapings[scrapings.length - 1]?.reference_url ||
      (scrapings[scrapings.length - 1]?.metadata?.reference_url ?? null)

    const report = buildReport(scrapings, referenceHint)

    return NextResponse.json({
      report,
      generated_at: new Date().toISOString(),
    })
  } catch (err: unknown) {
    console.error('Error building report:', err)
    return NextResponse.json(
      {
        report: emptyReport(),
        error: err instanceof Error ? err.message : 'Erreur inconnue',
      },
      { status: 200 },
    )
  }
}
