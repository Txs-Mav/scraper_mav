import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const user = await getCurrentUser()

    // Si connecté, lire depuis Supabase
    if (user) {
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
        // Fallback sur fichier local
      } else if (scrapings && scrapings.length > 0) {
        const latestScraping = scrapings[0]
        return NextResponse.json({
          products: latestScraping.products || [],
          metadata: latestScraping.metadata || {},
        })
      }
    }

    // Fallback : lire depuis le fichier local (pour non connecté ou si Supabase échoue)
    const filePath = path.join(process.cwd(), '..', 'scraped_data.json')
    
    if (fs.existsSync(filePath)) {
      const fileContents = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(fileContents)
      return NextResponse.json(data)
    }
    
    return NextResponse.json({ products: [], metadata: {} })
  } catch (error: any) {
    console.error('Error reading scraped data:', error)
    return NextResponse.json(
      { error: 'Failed to load data', message: error.message, products: [] },
      { status: 500 }
    )
  }
}

