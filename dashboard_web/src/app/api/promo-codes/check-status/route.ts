import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient } from '@/lib/supabase/server'

/**
 * API pour vérifier le statut du code promo d'un utilisateur
 * Utile pour vérifier si un code promo a été désactivé
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    if (!user.promo_code_id) {
      return NextResponse.json({
        has_promo: false,
        is_active: false,
      })
    }

    const supabase = await createClient()

    // Vérifier le statut du code promo
    const { data: promoCode, error } = await supabase
      .from('promo_codes')
      .select('is_active, code')
      .eq('id', user.promo_code_id)
      .single()

    if (error || !promoCode) {
      return NextResponse.json({
        has_promo: false,
        is_active: false,
      })
    }

    return NextResponse.json({
      has_promo: true,
      is_active: promoCode.is_active,
      code: promoCode.code,
    })
  } catch (error: any) {
    console.error('Error checking promo code status:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur lors de la vérification du code promo' },
      { status: 500 }
    )
  }
}
