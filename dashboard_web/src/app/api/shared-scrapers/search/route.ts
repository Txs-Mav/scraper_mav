import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const user_id = searchParams.get('user_id')

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ scrapers: [], count: 0 })
    }

    let supabase
    if (user_id && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    } else {
      const user = await getCurrentUser()
      if (!user) {
        return NextResponse.json(
          { error: 'Not authenticated' },
          { status: 401 }
        )
      }
      supabase = await createClient()
    }

    const searchTerm = query.trim().toLowerCase()

    const [scrapersResult, hiddenResult] = await Promise.all([
      supabase
        .from('shared_scrapers')
        .select('id, site_name, site_slug, site_url, site_domain, search_keywords, scraper_module, description, categories, vehicle_types, extracted_fields, is_active, logo_url, version')
        .eq('is_active', true)
        .or(`site_name.ilike.%${searchTerm}%,site_slug.ilike.%${searchTerm}%,site_domain.ilike.%${searchTerm}%,search_keywords.cs.{${searchTerm}}`)
        .order('site_name', { ascending: true })
        .limit(10),
      supabase
        .from('scraped_site_data')
        .select('site_domain')
        .contains('metadata', { temporarily_hidden: true }),
    ])

    if (scrapersResult.error) {
      return NextResponse.json({ error: scrapersResult.error.message }, { status: 500 })
    }

    const hiddenDomains = new Set(
      (hiddenResult.data || []).map((r: { site_domain: string }) => r.site_domain)
    )

    const scrapers = (scrapersResult.data || []).filter(
      (s: { site_domain: string }) => !hiddenDomains.has(s.site_domain)
    )

    return NextResponse.json({
      scrapers,
      count: scrapers.length,
      query: searchTerm
    })
  } catch (error: any) {
    console.error('Error searching shared scrapers:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
