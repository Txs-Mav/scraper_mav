import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { canAccessAnalytics } from '@/lib/plan-restrictions'
import {
  calculatePricePositioning,
  calculateProductAnalysis,
  calculateOpportunities,
  calculateRetailerAnalysis,
  calculateAlerts,
  calculateStats,
  calculatePriceEvolution,
  type AnalyticsData,
  type Product,
  type ScrapeMetadata
} from '@/lib/analytics-calculations'

export async function GET() {
  try {
    let products: Product[] = []
    let metadata: ScrapeMetadata = {}
    let dataAsOf: string | null = null
    let totalScrapes = 0
    let scrapesParJour: Array<{ date: string; count: number }> = []
    
    // Charger depuis Supabase (utilisateur connecté requis)
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }
    // Analytics réservé aux plans Pro et Ultime
    const effectiveSource = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)
    if (!canAccessAnalytics(user.subscription_plan ?? 'standard', effectiveSource)) {
      return NextResponse.json(
        { error: 'Accès réservé aux plans Pro et Ultime' },
        { status: 403 }
      )
    }
    try {
      const supabase = await createClient()
      const { data: scrapings, error } = await supabase
        .from('scrapings')
        .select('products, metadata, reference_url, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
      if (!error && scrapings && scrapings.length > 0) {
        const latestScraping = scrapings[0]
        products = latestScraping.products || []
        metadata = {
          ...(latestScraping.metadata || {}),
          reference_url: latestScraping.reference_url || latestScraping.metadata?.reference_url,
        }
        dataAsOf = latestScraping.created_at || null
      }

      const { data: scrapeDates, error: datesError } = await supabase
        .from('scrapings')
        .select('created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
      if (!datesError && scrapeDates) {
        totalScrapes = scrapeDates.length
        scrapesParJour = calculateScrapesPerDay(scrapeDates)
      }
    } catch (e) {
      console.warn('Error loading from Supabase:', e)
    }
    
    // Si pas de produits, retourner des analytics vides au lieu d'erreur
    if (products.length === 0) {
      const emptyAnalytics: AnalyticsData = {
        positionnement: {
          position: 'average',
          ecartPourcentage: 0,
          ecartValeur: 0,
          classement: 0,
          totalDetailleurs: 0,
          message: 'Aucune donnée disponible'
        },
        produits: [],
        evolutionPrix: [],
        opportunites: [],
        detailleurs: [],
        alertes: [],
        stats: {
          prixMoyen: 0,
          heuresEconomisees: 0,
          nombreScrapes: 0,
          scrapesParJour: []
        }
      }
      return NextResponse.json({ analytics: emptyAnalytics })
    }
    
    // Identifier le site de référence
    const referenceSite = metadata.reference_url ||
      // fallback: si absent, utiliser le premier produit mais la normalisation se fera ensuite
      (products.length > 0 ? products[0].sourceSite : null)
    
    // Extraire le domaine du site de référence
    let referenceDomain = 'unknown'
    if (referenceSite) {
      try {
        // Si c'est déjà un hostname, l'utiliser directement
        if (!referenceSite.startsWith('http')) {
          referenceDomain = referenceSite
        } else {
          referenceDomain = new URL(referenceSite).hostname
        }
      } catch {
        // Si ce n'est pas une URL valide, utiliser la valeur telle quelle
        referenceDomain = referenceSite
      }
    }
    
    // Si toujours unknown, essayer d'extraire depuis les produits
    if (referenceDomain === 'unknown' && products.length > 0) {
      const firstProductSite = products[0].sourceSite
      if (firstProductSite) {
        try {
          if (!firstProductSite.startsWith('http')) {
            referenceDomain = firstProductSite
          } else {
            referenceDomain = new URL(firstProductSite).hostname
          }
        } catch {
          referenceDomain = firstProductSite
        }
      }
    }
    
    // Calculer toutes les métriques
    const analytics: AnalyticsData = {
      positionnement: calculatePricePositioning(products, referenceDomain),
      produits: calculateProductAnalysis(products, referenceDomain),
      evolutionPrix: calculatePriceEvolution(products),
      opportunites: calculateOpportunities(products, referenceDomain),
      detailleurs: calculateRetailerAnalysis(products),
      alertes: calculateAlerts(products, referenceDomain),
      stats: calculateStats(products, scrapesParJour, totalScrapes)
    }

    return NextResponse.json({
      analytics,
      data_as_of: dataAsOf,
      generated_at: new Date().toISOString(),
    })
  } catch (error: unknown) {
    console.error('Error calculating analytics:', error)
    // En cas d'erreur, retourner des analytics vides au lieu d'erreur
    const emptyAnalytics: AnalyticsData = {
      positionnement: {
        position: 'average',
        ecartPourcentage: 0,
        ecartValeur: 0,
        classement: 0,
        totalDetailleurs: 0,
        message: 'Aucune donnée disponible'
      },
      produits: [],
      evolutionPrix: [],
      opportunites: [],
      detailleurs: [],
      alertes: [],
      stats: {
        prixMoyen: 0,
        heuresEconomisees: 0,
        nombreScrapes: 0,
        scrapesParJour: []
      }
    }
    return NextResponse.json({ analytics: emptyAnalytics })
  }
}

/**
 * Calcule le nombre de scrapes par jour depuis les lignes Supabase d'un utilisateur.
 */
function calculateScrapesPerDay(
  scrapeRows: Array<{ created_at: string }>
): Array<{ date: string; count: number }> {
  const scrapesByDay: Record<string, number> = {}

  for (const row of scrapeRows) {
    if (!row.created_at) continue
    const dateKey = row.created_at.split('T')[0]
    if (!scrapesByDay[dateKey]) scrapesByDay[dateKey] = 0
    scrapesByDay[dateKey]++
  }

  return Object.entries(scrapesByDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

