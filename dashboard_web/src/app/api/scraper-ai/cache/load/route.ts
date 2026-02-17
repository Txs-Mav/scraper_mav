import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const user_id = searchParams.get('user_id')
    const cache_key = searchParams.get('cache_key')

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

    if (!cache_key) {
      return NextResponse.json(
        { error: 'Missing required parameter: cache_key' },
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

    const { data, error } = await supabase
      .from('scraper_cache')
      .select('id, scraper_code, selectors, product_urls, metadata, expires_at, status, template_version, last_product_count, last_run_at')
      .eq('user_id', userId)
      .eq('cache_key', cache_key)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // Aucun résultat trouvé
        return NextResponse.json({
          found: false,
          message: 'Scraper not found'
        })
      }
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Vérifier si le cache est expiré
    const isExpired = data.expires_at && new Date(data.expires_at) < new Date()
    const status = isExpired ? 'expired' : (data.status || 'active')

    return NextResponse.json({
      found: true,
      id: data.id,
      scraper_code: data.scraper_code,
      selectors: data.selectors || {},
      product_urls: data.product_urls || [],
      metadata: data.metadata || {},
      expires_at: data.expires_at,
      status: status,
      template_version: data.template_version,
      last_product_count: data.last_product_count,
      last_run_at: data.last_run_at,
      is_expired: isExpired
    })
  } catch (error: any) {
    console.error('Error loading scraper cache:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
