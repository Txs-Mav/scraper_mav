import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

/**
 * POST /api/dashboard/reset
 * Réinitialise les données affichées sur la page Dashboard (produits scrapés).
 * Supprime uniquement les scrapings de l'utilisateur.
 * Ne touche pas scraper_cache (utilisé par les alertes).
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

    const { error: scrapingsError } = await supabase
      .from('scrapings')
      .delete()
      .eq('user_id', user.id)

    if (scrapingsError) {
      console.error('Error deleting scrapings:', scrapingsError)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression des données' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Les données du dashboard ont été réinitialisées',
    })
  } catch (error: unknown) {
    console.error('Error resetting dashboard:', error)
    const message = error instanceof Error ? error.message : 'Erreur interne'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
