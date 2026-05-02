import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * GET /api/admin/cron
 *
 * Détail complet du dernier run du cron horaire :
 *   - statut du verrou (running / idle)
 *   - liste de tous les sites scrapés avec leur status, durée, dernière maj
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scraped_site_data')
    .select('site_domain, site_url, status, scraped_at, updated_at, product_count, error_message, scrape_duration_seconds, metadata')
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const cronLockDomain = '__cron_lock__'
  const lockRow = (data || []).find((r: any) => r.site_domain === cronLockDomain)
  const sites = (data || []).filter((r: any) => r.site_domain !== cronLockDomain)

  return NextResponse.json({
    lock: lockRow ? {
      status: lockRow.status,
      updated_at: lockRow.updated_at,
    } : { status: 'idle', updated_at: null },
    sites: sites.map((r: any) => ({
      site_domain: r.site_domain,
      site_url: r.site_url,
      status: r.status,
      scraped_at: r.scraped_at,
      updated_at: r.updated_at,
      product_count: r.product_count,
      scrape_duration_seconds: r.scrape_duration_seconds,
      error_message: r.error_message,
      temporarily_hidden: r.metadata?.temporarily_hidden === true,
    })),
    count: sites.length,
  })
}
