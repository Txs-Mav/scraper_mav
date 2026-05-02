import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * GET /api/admin/scrapers
 * Liste les scrapers gérés par l'admin technique.
 *
 * Query params:
 *   - status: 'pending' (défaut) | 'approved' | 'rejected' | 'all'
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || 'pending'

  const supabase = createServiceClient()
  let query = supabase
    .from('shared_scrapers')
    .select(
      'id, site_name, site_slug, site_url, site_domain, scraper_module, ' +
      'is_active, validation_status, validation_score, validation_grade, ' +
      'validation_report, validated_by, validated_at, rejection_reason, ' +
      'submitted_by_pipeline, last_verified_at, created_at, updated_at, ' +
      'extracted_fields, categories'
    )
    .order('updated_at', { ascending: false })

  if (status !== 'all') {
    query = query.eq('validation_status', status)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    scrapers: data || [],
    count: (data || []).length,
    status,
  })
}
