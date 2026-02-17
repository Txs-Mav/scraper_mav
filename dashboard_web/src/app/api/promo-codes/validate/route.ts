import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { code } = await request.json()

    if (!code) {
      return NextResponse.json(
        { error: 'Code promo requis' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Rechercher le code promo
    const { data: promoCode, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .single()

    if (error || !promoCode) {
      return NextResponse.json(
        { error: 'Code promo invalide', valid: false },
        { status: 404 }
      )
    }

    // Vérifier si le code est actif
    if (!promoCode.is_active) {
      return NextResponse.json(
        { error: 'Ce code promo a été désactivé', valid: false },
        { status: 400 }
      )
    }

    // Vérifier si le code a atteint sa limite d'utilisation
    if (promoCode.max_uses !== null && promoCode.current_uses >= promoCode.max_uses) {
      return NextResponse.json(
        { error: 'Ce code promo a atteint sa limite d\'utilisation', valid: false },
        { status: 400 }
      )
    }

    return NextResponse.json({
      valid: true,
      code: promoCode.code,
      description: promoCode.description,
    })
  } catch (error: any) {
    console.error('Error validating promo code:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur lors de la validation du code promo', valid: false },
      { status: 500 }
    )
  }
}
