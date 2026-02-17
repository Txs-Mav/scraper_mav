import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * API pour récupérer le pending_plan de l'utilisateur connecté
 */
export async function GET() {
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

    // Récupérer le pending_plan depuis la table users
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('pending_plan')
      .eq('id', authUser.id)
      .single()

    if (userError) {
      // Si l'utilisateur n'existe pas encore dans la table, vérifier les métadonnées auth
      const pendingPlan = authUser.user_metadata?.pending_plan
      return NextResponse.json({
        pending_plan: pendingPlan || null,
      })
    }

    return NextResponse.json({
      pending_plan: userData?.pending_plan || null,
    })
  } catch (error: any) {
    console.error('Error getting pending plan:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur lors de la récupération' },
      { status: 500 }
    )
  }
}
