import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const user_id = searchParams.get('user_id')

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

    const [scrapersResult, scrapedResult] = await Promise.all([
      supabase
        .from('shared_scrapers')
        .select('id, site_name, site_slug, site_url, site_domain, search_keywords, scraper_module, description, categories, vehicle_types, extracted_fields, is_active, logo_url, version, last_verified_at')
        .eq('is_active', true)
        .order('site_name', { ascending: true }),
      // Un scraper n'apparaît dans la recherche que s'il a déjà au moins
      // une ligne dans scraped_site_data avec product_count > 0 ET sans
      // flag temporarily_hidden. Tant que le cron ne lui a rien remonté
      // (ex: scraper fraîchement approuvé par l'admin), il reste invisible
      // côté utilisateur.
      supabase
        .from('scraped_site_data')
        .select('site_domain, metadata')
        .gt('product_count', 0),
    ])

    if (scrapersResult.error) {
      return NextResponse.json({ error: scrapersResult.error.message }, { status: 500 })
    }

    const readyDomains = new Set(
      (scrapedResult.data || [])
        .filter((r: { metadata: Record<string, unknown> | null }) => !r.metadata?.temporarily_hidden)
        .map((r: { site_domain: string }) => r.site_domain)
    )

    const scrapers = (scrapersResult.data || []).filter(
      (s: { site_domain: string }) => readyDomains.has(s.site_domain)
    )

    return NextResponse.json({
      scrapers,
      count: scrapers.length
    })
  } catch (error: any) {
    console.error('Error fetching shared scrapers:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
