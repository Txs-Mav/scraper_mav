import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { 
      user_id, 
      site_url, 
      cache_key, 
      scraper_code, 
      selectors,
      product_urls,
      metadata,
      template_version 
    } = body

    // Vérifier l'authentification
    // Si user_id est fourni (appel depuis Python), l'utiliser directement
    // Sinon, vérifier via getCurrentUser() (appel depuis le frontend)
    let userId: string | null = null
    let isPythonCall = false

    if (user_id) {
      // Appel depuis le script Python - utiliser user_id fourni
      userId = user_id
      isPythonCall = true
    } else {
      // Appel depuis le frontend - vérifier via session
      const user = await getCurrentUser()
      if (!user) {
      return NextResponse.json(
          { error: 'Not authenticated' },
          { status: 401 }
      )
      }
      userId = user.id
    }

    if (!site_url || !cache_key || !scraper_code) {
      return NextResponse.json(
        { error: 'Missing required fields: site_url, cache_key, scraper_code' },
        { status: 400 }
      )
    }

    // Pour les appels Python, utiliser le service role pour bypasser RLS
    // Pour les appels frontend, utiliser le client avec session
    let supabase
    if (isPythonCall && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    } else {
      supabase = await createClient()
    }

    // Calculer la date d'expiration (7 jours)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Vérifier si un scraper existe déjà pour ce cache_key et cet utilisateur
    const { data: existing } = await supabase
      .from('scraper_cache')
      .select('id')
      .eq('user_id', userId)
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
          selectors: selectors || {},
          product_urls: product_urls || [],
          metadata: metadata || {},
          expires_at: expiresAt.toISOString(),
          template_version: template_version || '2.0',
          status: 'active',
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
          user_id: userId,
          site_url,
          cache_key,
          scraper_code,
          selectors: selectors || {},
          product_urls: product_urls || [],
          metadata: metadata || {},
          expires_at: expiresAt.toISOString(),
          template_version: template_version || '2.0',
          status: 'active',
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
      id: result.id,
      cache_key: result.cache_key,
      expires_at: result.expires_at,
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
