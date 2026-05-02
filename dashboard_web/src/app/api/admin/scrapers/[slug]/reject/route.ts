import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * POST /api/admin/scrapers/[slug]/reject
 *
 * Rejette un scraper en attente. Conserve l'enregistrement (utile pour
 * tracer les tentatives de scraper_usine) mais le retire du cron.
 *
 * Body : { reason?: string }
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  const { slug } = await context.params
  let reason: string | null = null
  try {
    const body = await req.json()
    if (body && typeof body.reason === 'string') {
      reason = body.reason.trim().slice(0, 500) || null
    }
  } catch {
    // body optionnel
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('shared_scrapers')
    .update({
      validation_status: 'rejected',
      is_active: false,
      validated_by: user.id,
      validated_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('site_slug', slug)
    .select('id, site_slug, validation_status, is_active, rejection_reason')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Scraper introuvable' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    scraper: data,
    message: `${slug} rejeté.`,
  })
}
