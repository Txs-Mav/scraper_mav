import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const { code, plan } = await request.json()
    console.log('[Promo Apply] Request received:', { code, plan })

    if (!code) {
      return NextResponse.json(
        { error: 'Code promo requis' },
        { status: 400 }
      )
    }

    const user = await getCurrentUser()
    console.log('[Promo Apply] Current user:', user?.id, 'existing promo_code_id:', user?.promo_code_id)
    
    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const supabase = await createClient()
    const serviceSupabase = createServiceClient()

    // Rechercher le code promo
    const { data: promoCode, error: promoError } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .single()

    if (promoError || !promoCode) {
      return NextResponse.json(
        { error: 'Code promo invalide' },
        { status: 404 }
      )
    }

    // Vérifier si le code est actif
    if (!promoCode.is_active) {
      return NextResponse.json(
        { error: 'Ce code promo a été désactivé' },
        { status: 400 }
      )
    }

    // Vérifier si le code a atteint sa limite d'utilisation
    if (promoCode.max_uses !== null && promoCode.current_uses >= promoCode.max_uses) {
      return NextResponse.json(
        { error: 'Ce code promo a atteint sa limite d\'utilisation' },
        { status: 400 }
      )
    }

    // Vérifier si l'utilisateur a déjà un code promo
    if (user.promo_code_id) {
      return NextResponse.json(
        { error: 'Vous avez déjà utilisé un code promo' },
        { status: 400 }
      )
    }

    // Code promo = toujours plan Ultime gratuit
    const planToSet = plan || 'ultime'
    console.log('[Promo Apply] Plan to set:', planToSet)

    // Utiliser le service client pour bypasser les contraintes RLS
    // Essayer d'abord avec subscription_source (colonne ajoutée par migration)
    let updateError: any = null

    const { error: err1 } = await serviceSupabase
      .from('users')
      .update({
        promo_code_id: promoCode.id,
        subscription_plan: planToSet,
        subscription_source: 'promo',
        pending_plan: null, // Effacer le pending_plan car le promo code suffit
      })
      .eq('id', user.id)

    if (err1) {
      console.warn('[Promo Apply] Update with subscription_source failed, trying without:', err1.message)

      // Fallback: essayer sans subscription_source (colonne peut ne pas exister)
      const { error: err2 } = await serviceSupabase
        .from('users')
        .update({
          promo_code_id: promoCode.id,
          subscription_plan: planToSet,
          pending_plan: null,
        })
        .eq('id', user.id)

      if (err2) {
        console.error('[Promo Apply] Fallback update also failed:', err2)
        updateError = err2
      }
    }

    if (updateError) {
      console.error('[Promo Apply] Error updating user:', updateError)
      return NextResponse.json(
        { error: 'Erreur lors de l\'application du code promo: ' + updateError.message },
        { status: 500 }
      )
    }

    console.log('[Promo Apply] User updated successfully with plan:', planToSet)

    // Mettre à jour la subscription
    const { error: subError } = await serviceSupabase
      .from('subscriptions')
      .upsert({
        user_id: user.id,
        plan: planToSet,
        status: 'active',
        started_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (subError) {
      console.warn('[Promo Apply] Error updating subscription (non-fatal):', subError)
    }

    // Incrémenter le compteur d'utilisation
    const { error: incrementError } = await serviceSupabase
      .from('promo_codes')
      .update({ current_uses: promoCode.current_uses + 1 })
      .eq('id', promoCode.id)

    if (incrementError) {
      console.error('[Promo Apply] Error incrementing promo code uses:', incrementError)
    }

    // Supprimer le pending_plan des métadonnées auth aussi
    try {
      await supabase.auth.updateUser({
        data: { pending_plan: null }
      })
    } catch (e) {
      console.warn('[Promo Apply] Could not clear auth metadata pending_plan')
    }

    return NextResponse.json({
      success: true,
      message: 'Code promo appliqué avec succès. Votre plan Ultime est gratuit à vie.',
      plan: planToSet,
    })
  } catch (error: any) {
    console.error('[Promo Apply] Unexpected error:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur inattendue lors de l\'application du code promo' },
      { status: 500 }
    )
  }
}
