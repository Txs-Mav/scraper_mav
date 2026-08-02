import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * PATCH /api/admin/promo-codes/[id]
 *
 * Interrupteur de campagne : { is_active: boolean }.
 * Désactiver un code stoppe immédiatement les NOUVELLES inscriptions
 * (/c/[code] et le champ code magique refusent) mais ne touche pas aux
 * comptes déjà créés — la rétrogradation reste une action séparée
 * (/api/promo-codes/revoke, par utilisateur).
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  const { id } = await ctx.params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON requis' }, { status: 400 })
  }
  if (typeof body?.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active (boolean) requis' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('promo_codes')
    .update({
      is_active: body.is_active,
      deactivated_at: body.is_active ? null : new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, code, is_active, deactivated_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Code introuvable' }, { status: 500 })
  }

  return NextResponse.json({ code: data })
}
