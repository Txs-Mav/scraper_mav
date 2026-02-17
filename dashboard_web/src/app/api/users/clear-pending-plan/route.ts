import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

/**
 * API pour supprimer le pending_plan après le paiement réussi
 */
export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const supabase = await createClient()

    // Supprimer le pending_plan
    const { error: updateError } = await supabase
      .from('users')
      .update({ pending_plan: null })
      .eq('id', user.id)

    if (updateError) {
      console.error('Error clearing pending_plan:', updateError)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression du plan en attente' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error clearing pending plan:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur lors de la suppression' },
      { status: 500 }
    )
  }
}
