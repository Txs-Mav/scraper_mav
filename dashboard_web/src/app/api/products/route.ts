import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'

/**
 * API route pour récupérer les produits scrapés
 * Données stockées dans Supabase, avec fallback sur le fichier local
 */
export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({
        products: [],
        metadata: {},
        message: 'Connectez-vous pour voir vos données scrapées.'
      })
    }

    const supabase = await createClient()

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
      const metadata = {
        ...(latestScraping.metadata || {}),
        reference_url: latestScraping.reference_url || (latestScraping.metadata as any)?.reference_url,
        competitor_urls: latestScraping.competitor_urls || (latestScraping.metadata as any)?.competitor_urls || []
      }

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

    // Aucun scraping dans Supabase : vérifier le fichier local en fallback
    const localFile = path.join(process.cwd(), '..', 'scraped_data.json')
    if (fs.existsSync(localFile)) {
      try {
        const localData = JSON.parse(fs.readFileSync(localFile, 'utf-8'))
        const products = localData.products || []
        if (products.length > 0) {
          console.log(`[API/products] Fallback local: ${products.length} produits depuis scraped_data.json`)
          return NextResponse.json({
            products,
            metadata: localData.metadata || {},
            source: 'local_fallback'
          })
        }
      } catch (e) {
        console.error('[API/products] Erreur lecture fichier local:', e)
      }
    }

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
