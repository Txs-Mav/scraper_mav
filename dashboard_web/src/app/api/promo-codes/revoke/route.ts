import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * API pour révoquer un code promo d'un utilisateur
 * Utilisé quand un code promo est désactivé
 * 
 * Cette API doit être appelée manuellement ou via un script cron
 * pour rétrograder les utilisateurs dont le code promo a été désactivé
 */
export async function POST(request: Request) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID requis' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Récupérer l'utilisateur
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('promo_code_id, subscription_plan')
      .eq('id', userId)
      .single()

    if (userError || !user || !user.promo_code_id) {
      return NextResponse.json(
        { error: 'Utilisateur non trouvé ou sans code promo' },
        { status: 404 }
      )
    }

    // Vérifier si le code promo est toujours actif
    const { data: promoCode } = await supabase
      .from('promo_codes')
      .select('is_active')
      .eq('id', user.promo_code_id)
      .single()

    if (promoCode && promoCode.is_active) {
      return NextResponse.json({
        message: 'Le code promo est toujours actif',
        revoked: false,
      })
    }

    // Rétrograder l'utilisateur au plan standard
    const { error: updateError } = await supabase
      .from('users')
      .update({
        subscription_plan: 'standard',
        promo_code_id: null,
      })
      .eq('id', userId)

    if (updateError) {
      return NextResponse.json(
        { error: 'Erreur lors de la révocation du code promo' },
        { status: 500 }
      )
    }

    // Mettre à jour la subscription
    await supabase
      .from('subscriptions')
      .update({
        plan: 'standard',
        status: 'active',
      })
      .eq('user_id', userId)

    return NextResponse.json({
      success: true,
      message: 'Code promo révoqué, utilisateur rétrogradé au plan standard',
      revoked: true,
    })
  } catch (error: any) {
    console.error('Error revoking promo code:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur lors de la révocation du code promo' },
      { status: 500 }
    )
  }
}
