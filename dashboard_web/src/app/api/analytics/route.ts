import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
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
    
    // PRIORITÉ 1: Essayer de charger depuis Supabase si utilisateur connecté
    const user = await getCurrentUser()
    if (user) {
      try {
        const supabase = await createClient()
        
        // Récupérer le dernier scraping de l'utilisateur
        const { data: scrapings, error } = await supabase
          .from('scrapings')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
        
        if (!error && scrapings && scrapings.length > 0) {
          const latestScraping = scrapings[0]
          products = latestScraping.products || []
          metadata = latestScraping.metadata || {}
        }
      } catch (e) {
        console.warn('Error loading from Supabase, fallback to local:', e)
      }
    }
    
    // PRIORITÉ 2: Fallback sur fichier local si pas de données Supabase
    if (products.length === 0) {
      const filePath = path.join(process.cwd(), '..', 'scraped_data.json')
      
      if (fs.existsSync(filePath)) {
        try {
          const fileContents = fs.readFileSync(filePath, 'utf-8')
          const data = JSON.parse(fileContents)
          products = data.products || []
          metadata = data.metadata || {}
        } catch (e) {
          console.warn('Error reading scraped_data.json:', e)
        }
      }
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
    let referenceSite = metadata.reference_url || 
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
      } catch (e) {
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
        } catch (e) {
          referenceDomain = firstProductSite
        }
      }
    }
    
    // Calculer les scrapes par jour depuis les logs
    const scrapesParJour = calculateScrapesPerDay()
    
    // Calculer toutes les métriques
    const analytics: AnalyticsData = {
      positionnement: calculatePricePositioning(products, referenceDomain),
      produits: calculateProductAnalysis(products),
      evolutionPrix: calculatePriceEvolution(products),
      opportunites: calculateOpportunities(products),
      detailleurs: calculateRetailerAnalysis(products),
      alertes: calculateAlerts(products, referenceDomain),
      stats: calculateStats(products, scrapesParJour)
    }
    
    return NextResponse.json({ analytics })
  } catch (error: any) {
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
 * Calcule le nombre de scrapes par jour depuis les fichiers de logs
 */
function calculateScrapesPerDay(): Array<{ date: string; count: number }> {
  try {
    const logsDir = path.join(process.cwd(), '..', 'scraper_logs')
    
    if (!fs.existsSync(logsDir)) {
      return []
    }
    
    // Lire tous les fichiers .lock pour obtenir les timestamps
    const files = fs.readdirSync(logsDir)
    const lockFiles = files.filter(f => f.endsWith('.lock'))
    
    // Grouper par jour
    const scrapesByDay: Record<string, number> = {}
    
    lockFiles.forEach(file => {
      try {
        const lockPath = path.join(logsDir, file)
        const lockContent = fs.readFileSync(lockPath, 'utf-8')
        const lockData = JSON.parse(lockContent)
        
        if (lockData.startTime) {
          const date = new Date(lockData.startTime)
          const dateKey = date.toISOString().split('T')[0] // Format YYYY-MM-DD
          
          if (!scrapesByDay[dateKey]) {
            scrapesByDay[dateKey] = 0
          }
          scrapesByDay[dateKey]++
        }
      } catch (e) {
        // Ignorer les fichiers invalides
        console.warn(`Error reading lock file ${file}:`, e)
      }
    })
    
    // Convertir en tableau et trier par date
    return Object.entries(scrapesByDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (error) {
    console.error('Error calculating scrapes per day:', error)
    return []
  }
}

