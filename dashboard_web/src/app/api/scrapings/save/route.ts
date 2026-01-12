import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

/**
 * API route pour sauvegarder un scraping depuis le scraper Python
 * Remplace l'écriture dans scraped_data.json
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    const scrapingData = await request.json()

    // Si non connecté, retourner les données pour sauvegarde locale
    if (!user) {
      return NextResponse.json({
        success: true,
        scraping: scrapingData,
        isLocal: true,
        message: 'Scraping sauvegardé localement. Connectez-vous pour sauvegarder dans le cloud.'
      })
    }

    if (!scrapingData.reference_url) {
      return NextResponse.json(
        { error: 'reference_url is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Vérifier la limite pour plan gratuit
    if (user.subscription_plan === 'free') {
      const { count } = await supabase
        .from('scrapings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)

      // Vérifier si on met à jour un scraping existant ou on en crée un nouveau
      const { data: existing } = await supabase
        .from('scrapings')
        .select('id')
        .eq('user_id', user.id)
        .eq('reference_url', scrapingData.reference_url)
        .single()

      // Si c'est un nouveau scraping et qu'on a atteint la limite
      if (!existing && (count || 0) >= 10) {
        return NextResponse.json(
          { error: 'Limite de 10 scrapings atteinte. Passez au plan Standard ou Premium pour des scrapings illimités.' },
          { status: 403 }
        )
      }
    }

    // Vérifier si un scraping existe déjà pour cette référence et cet utilisateur
    const { data: existing } = await supabase
      .from('scrapings')
      .select('id')
      .eq('user_id', user.id)
      .eq('reference_url', scrapingData.reference_url)
      .single()

    let result

    if (existing) {
      // Mettre à jour le scraping existant
      const { data, error } = await supabase
        .from('scrapings')
        .update({
          competitor_urls: scrapingData.competitor_urls || [],
          products: scrapingData.products || [],
          metadata: scrapingData.metadata || {},
          scraping_time_seconds: scrapingData.scraping_time_seconds,
          mode: scrapingData.mode,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }

      result = data
    } else {
      // Créer un nouveau scraping
      const { data, error } = await supabase
        .from('scrapings')
        .insert({
          user_id: user.id,
          reference_url: scrapingData.reference_url,
          competitor_urls: scrapingData.competitor_urls || [],
          products: scrapingData.products || [],
          metadata: scrapingData.metadata || {},
          scraping_time_seconds: scrapingData.scraping_time_seconds,
          mode: scrapingData.mode,
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }

      result = data
    }

    return NextResponse.json({
      success: true,
      scraping: result,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

