import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient } from '@/lib/supabase/server'

/**
 * API route pour récupérer les produits scrapés
 * Données stockées uniquement dans Supabase (table scrapings)
 */
export async function GET() {
  try {
    const user = await getCurrentUser()

    // Si non connecté, retourner tableau vide
    if (!user) {
      return NextResponse.json({
        products: [],
        metadata: {},
        message: 'Connectez-vous pour voir vos données scrapées.'
      })
    }

      const supabase = await createClient()
      
      // Récupérer le dernier scraping de l'utilisateur
      const { data: scrapings, error } = await supabase
        .from('scrapings')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) {
        console.error('Error fetching scrapings from Supabase:', error)
      return NextResponse.json(
        { error: 'Failed to load data', message: error.message, products: [] },
        { status: 500 }
      )
    }

    if (scrapings && scrapings.length > 0) {
        const latestScraping = scrapings[0]
        // S'assurer que reference_url est toujours dans metadata pour le dashboard
        const metadata = {
          ...(latestScraping.metadata || {}),
          reference_url: latestScraping.reference_url || (latestScraping.metadata as any)?.reference_url,
          competitor_urls: latestScraping.competitor_urls || (latestScraping.metadata as any)?.competitor_urls || []
        }
        
        // Debug: vérifier les sourceSite uniques des produits
        const products = latestScraping.products || []
        const uniqueSourceSites = [...new Set(products.map((p: any) => p.sourceSite).filter(Boolean))]
        console.log('[API/products] Reference URL:', metadata.reference_url)
        console.log('[API/products] Competitor URLs:', metadata.competitor_urls)
        console.log('[API/products] Products count:', products.length)
        console.log('[API/products] Unique sourceSite values:', uniqueSourceSites)
        
        return NextResponse.json({
          products,
          metadata,
          scrapingId: latestScraping.id,
          createdAt: latestScraping.created_at,
          updatedAt: latestScraping.updated_at
      })
    }
    
    // Aucun scraping trouvé
    return NextResponse.json({
      products: [],
      metadata: {},
      message: 'Aucun scraping trouvé. Lancez votre premier scraping pour voir les données.'
    })
  } catch (error: any) {
    console.error('Error reading scraped data:', error)
    return NextResponse.json(
      { error: 'Failed to load data', message: error.message, products: [] },
      { status: 500 }
    )
  }
}
