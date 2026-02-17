import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * API pour synchroniser le pending_plan depuis les métadonnées auth vers la table users
 * Appelée après la première connexion de l'utilisateur
 */
export async function POST() {
  try {
    const supabase = await createClient()

    // Récupérer l'utilisateur authentifié
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()

    if (authError || !authUser) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    // Récupérer le pending_plan depuis les métadonnées auth
    const pendingPlan = authUser.user_metadata?.pending_plan

    if (!pendingPlan) {
      return NextResponse.json({
        has_pending_plan: false,
        pending_plan: null,
      })
    }

    // Mettre à jour la table users avec le pending_plan
    const { error: updateError } = await supabase
      .from('users')
      .update({ pending_plan: pendingPlan })
      .eq('id', authUser.id)

    if (updateError) {
      console.error('Error updating pending_plan:', updateError)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du plan en attente' },
        { status: 500 }
      )
    }

    // Supprimer le pending_plan des métadonnées auth (déjà synchronisé)
    await supabase.auth.updateUser({
      data: { pending_plan: null }
    })

    return NextResponse.json({
      has_pending_plan: true,
      pending_plan: pendingPlan,
    })
  } catch (error: any) {
    console.error('Error syncing pending plan:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur lors de la synchronisation' },
      { status: 500 }
    )
  }
}
