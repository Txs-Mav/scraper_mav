import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { canAccessAnalytics } from '@/lib/plan-restrictions'

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }
    const effectiveSource = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)
    if (!canAccessAnalytics(user.subscription_plan ?? 'standard', effectiveSource)) {
      return NextResponse.json(
        { error: 'Accès réservé aux plans Pro et Ultime' },
        { status: 403 }
      )
    }

    const supabase = await createClient()

    // Supprimer uniquement les scrapings (source des analytics)
    // Ne pas toucher scraper_cache (utilisé par les alertes)
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
      message: 'Les données de la page Analyse ont été réinitialisées',
    })
  } catch (error: any) {
    console.error('Error resetting analytics:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur interne' },
      { status: 500 }
    )
  }
}
