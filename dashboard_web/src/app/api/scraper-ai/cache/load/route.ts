import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const user_id = searchParams.get('user_id')
    const cache_key = searchParams.get('cache_key')

    // Vérifier que user_id correspond à l'utilisateur authentifié
    if (user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized: user_id mismatch' },
        { status: 403 }
      )
    }

    if (!cache_key) {
      return NextResponse.json(
        { error: 'Missing required parameter: cache_key' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('scraper_cache')
      .select('scraper_code, metadata')
      .eq('user_id', user_id)
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

    return NextResponse.json({
      found: true,
      scraper_code: data.scraper_code,
      metadata: data.metadata || {}
    })
  } catch (error: any) {
    console.error('Error loading scraper cache:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

