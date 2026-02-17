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
    const { user_id, cache_key } = body

    // Vérifier que user_id correspond à l'utilisateur authentifié
    if (user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized: user_id mismatch' },
        { status: 403 }
      )
    }

    if (!cache_key) {
      return NextResponse.json(
        { error: 'Missing required field: cache_key' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Calculer la nouvelle date d'expiration (7 jours)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Rafraîchir la date d'expiration et réactiver le scraper
    const { data, error } = await supabase
      .from('scraper_cache')
      .update({
        expires_at: expiresAt.toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user_id)
      .eq('cache_key', cache_key)
      .select('id, cache_key, expires_at')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Scraper not found' },
          { status: 404 }
        )
      }
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      cache_key: data.cache_key,
      expires_at: data.expires_at,
      message: 'Cache expiry refreshed to 7 days'
    })
  } catch (error: any) {
    console.error('Error refreshing cache expiry:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
