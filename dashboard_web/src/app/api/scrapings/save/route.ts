import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * API route pour sauvegarder un scraping depuis le scraper Python
 * Accepte soit l'authentification par cookie (dashboard) soit user_id dans le body (script Python)
 */
export async function POST(request: Request) {
  try {
    const scrapingData = await request.json()

    // ------------------------------------------------------------
    // Compatibilité: certains appels (legacy) envoient site_url au lieu de reference_url
    // ou mettent reference_url dans metadata.
    // ------------------------------------------------------------
    if (!scrapingData.reference_url) {
      scrapingData.reference_url =
        scrapingData.site_url ||
        scrapingData.referenceUrl ||
        (scrapingData.metadata as any)?.reference_url ||
        (scrapingData.metadata as any)?.referenceUrl
    }

    // Normaliser certaines clés optionnelles
    if (scrapingData.execution_time_seconds != null && scrapingData.scraping_time_seconds == null) {
      scrapingData.scraping_time_seconds = scrapingData.execution_time_seconds
    }

    // PRIORITÉ 1: Authentification par cookie (appel depuis le dashboard)
    let userId: string | null = null
    const sessionUser = await getCurrentUser()

    if (sessionUser) {
      userId = sessionUser.id
    }
    // PRIORITÉ 2: user_id dans le body (appel depuis le script Python)
    else if (scrapingData.user_id) {
      userId = scrapingData.user_id
    }

    // Si pas d'authentification, retourner les données pour sauvegarde locale
    if (!userId) {
      return NextResponse.json({
        success: true,
        scraping: scrapingData,
        isLocal: true,
        message: 'Scraping sauvegardé localement. Connectez-vous pour sauvegarder dans le cloud.'
      })
    }

    if (!scrapingData.reference_url) {
      return NextResponse.json(
        { error: 'reference_url is required' },
        { status: 400 }
      )
    }

    // Utiliser le service role pour les appels depuis Python (pas de cookie)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    // Si on a le service role key et pas de session (appel Python), utiliser le service client
    let supabase
    if (!sessionUser && serviceRoleKey) {
      supabase = createServiceClient(supabaseUrl, serviceRoleKey)
    } else {
      supabase = await createClient()
    }

    // Récupérer les infos utilisateur pour vérifier le plan
    const { data: user } = await supabase
      .from('users')
      .select('subscription_plan, subscription_source')
      .eq('id', userId)
      .single()

    const isPaid = user?.subscription_source === 'stripe' || user?.subscription_source === 'promo'
    const limit = isPaid ? Infinity : 6

    // Vérifier la limite pour plan standard / non confirmé
    if (limit !== Infinity) {
      const { count } = await supabase
        .from('scrapings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)

      // Vérifier si on met à jour un scraping existant ou on en crée un nouveau
      const { data: existingCheck } = await supabase
        .from('scrapings')
        .select('id')
        .eq('user_id', userId)
        .eq('reference_url', scrapingData.reference_url)
        .single()

      // Si c'est un nouveau scraping et qu'on a atteint la limite
      if (!existingCheck && (count || 0) >= limit) {
        return NextResponse.json(
          { error: 'Limite de 6 scrapings atteinte. Passez au plan Pro ou Ultime pour des scrapings illimités.' },
          { status: 403 }
        )
      }
    }

    // Vérifier si un scraping existe déjà pour cette référence et cet utilisateur
    const { data: existing } = await supabase
      .from('scrapings')
      .select('id')
      .eq('user_id', userId)
      .eq('reference_url', scrapingData.reference_url)
      .single()

    let result

    if (existing) {
      // Mettre à jour le scraping existant
      const { data, error } = await supabase
        .from('scrapings')
        .update({
          competitor_urls: scrapingData.competitor_urls || [],
          products: scrapingData.products || [],
          metadata: scrapingData.metadata || {},
          scraping_time_seconds: scrapingData.scraping_time_seconds,
          mode: scrapingData.mode || (scrapingData.competitor_urls?.length ? 'comparison' : 'reference_only'),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }

      result = data
    } else {
      // Créer un nouveau scraping
      const { data, error } = await supabase
        .from('scrapings')
        .insert({
          user_id: userId,
          reference_url: scrapingData.reference_url,
          competitor_urls: scrapingData.competitor_urls || [],
          products: scrapingData.products || [],
          metadata: scrapingData.metadata || {},
          scraping_time_seconds: scrapingData.scraping_time_seconds,
          mode: scrapingData.mode || (scrapingData.competitor_urls?.length ? 'comparison' : 'reference_only'),
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }

      result = data
    }

    return NextResponse.json({
      success: true,
      scraping: result,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

