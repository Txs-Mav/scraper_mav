import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient } from '@/lib/supabase/server'

/**
 * API route pour la configuration du scraper
 * Stockée dans Supabase (table scraper_config) pour les utilisateurs connectés
 */

export async function GET() {
  try {
    const user = await getCurrentUser()

    // Si non connecté, retourner config par défaut
    if (!user) {
      return NextResponse.json({
        referenceUrl: "",
        urls: [],
        priceDifferenceFilter: null,
        isLocal: true
      })
    }

    const supabase = await createClient()

    // Récupérer la config de l'utilisateur
    const { data: config, error } = await supabase
      .from('scraper_config')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('Error fetching scraper config:', error)
      return NextResponse.json(
        { error: 'Failed to load config', message: error.message },
        { status: 500 }
      )
    }

    // Si pas de config existante, retourner config par défaut
    if (!config) {
      return NextResponse.json({
        referenceUrl: "",
        urls: [],
        priceDifferenceFilter: null,
        ignoreColors: false
      })
    }

    return NextResponse.json({
      referenceUrl: config.reference_url || "",
      urls: config.competitor_urls || [],
      priceDifferenceFilter: config.price_difference_filter,
      categories: config.categories || [],
      ignoreColors: config.ignore_colors || false,
      updatedAt: config.updated_at
    })
  } catch (error: any) {
    console.error('Error reading scraper config:', error)
    return NextResponse.json(
      { error: 'Failed to load config', message: error.message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    const body = await request.json()
    
    // Si non connecté, retourner erreur
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required', message: 'Vous devez être connecté pour sauvegarder la configuration.' },
        { status: 401 }
      )
    }

    const supabase = await createClient()

    const configData = {
      user_id: user.id,
      reference_url: body.referenceUrl || null,
      competitor_urls: body.urls || [],
      price_difference_filter: body.priceDifferenceFilter ?? null,
      categories: body.categories || [],
      ignore_colors: body.ignoreColors || false
    }

    // Upsert: créer ou mettre à jour la config
    const { data, error } = await supabase
      .from('scraper_config')
      .upsert(configData, {
        onConflict: 'user_id',
        ignoreDuplicates: false
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving scraper config:', error)
      return NextResponse.json(
        { error: 'Failed to save config', message: error.message },
        { status: 500 }
      )
    }
    
    return NextResponse.json({
      success: true,
      config: {
        referenceUrl: data.reference_url || "",
        urls: data.competitor_urls || [],
        priceDifferenceFilter: data.price_difference_filter,
        categories: data.categories || [],
        ignoreColors: data.ignore_colors || false,
        updatedAt: data.updated_at
      }
    })
  } catch (error: any) {
    console.error('Error saving scraper config:', error)
    return NextResponse.json(
      { error: 'Failed to save config', message: error.message },
      { status: 500 }
    )
  }
}
