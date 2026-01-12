import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { user_id, site_url, cache_key, scraper_code, metadata } = body

    // Vérifier que user_id correspond à l'utilisateur authentifié
    if (user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized: user_id mismatch' },
        { status: 403 }
      )
    }

    if (!site_url || !cache_key || !scraper_code) {
      return NextResponse.json(
        { error: 'Missing required fields: site_url, cache_key, scraper_code' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Vérifier si un scraper existe déjà pour ce cache_key et cet utilisateur
    const { data: existing } = await supabase
      .from('scraper_cache')
      .select('id')
      .eq('user_id', user_id)
      .eq('cache_key', cache_key)
      .single()

    let result

    if (existing) {
      // Mettre à jour le scraper existant
      const { data, error } = await supabase
        .from('scraper_cache')
        .update({
          site_url,
          scraper_code,
          metadata: metadata || {},
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
      // Créer un nouveau scraper
      const { data, error } = await supabase
        .from('scraper_cache')
        .insert({
          user_id,
          site_url,
          cache_key,
          scraper_code,
          metadata: metadata || {},
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
      cache_key: result.cache_key,
      message: 'Scraper saved to Supabase'
    })
  } catch (error: any) {
    console.error('Error saving scraper cache:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

