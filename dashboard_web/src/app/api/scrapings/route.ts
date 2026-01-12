import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()

    // Si non connecté, retourner un tableau vide (les scrapings locaux sont gérés côté client)
    if (!user) {
      return NextResponse.json({ scrapings: [], count: 0, limit: 10, isLocal: true })
    }

    const supabase = await createClient()

    // Si c'est un compte principal, récupérer aussi les scrapings des employés
    const { searchParams } = new URL(request.url)
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const pageSize = Math.max(Math.min(parseInt(searchParams.get('limit') || '50', 10), 200), 1)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    // Ne sélectionner que les métadonnées (pas les products volumineux)
    let query = supabase
      .from('scrapings')
      .select('id, user_id, reference_url, competitor_urls, metadata, scraping_time_seconds, mode, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (user.role === 'main') {
      // Récupérer les IDs de tous les employés
      const { data: employees } = await supabase
        .from('employees')
        .select('employee_id')
        .eq('main_account_id', user.id)

      const employeeIds = employees?.map(e => e.employee_id) || []
      const allUserIds = [user.id, ...employeeIds]

      query = query.in('user_id', allUserIds)
    } else {
      // Employé : seulement ses propres scrapings
      query = query.eq('user_id', user.id)
    }

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Déterminer la limite selon le plan
    const limit = user.subscription_plan === 'free' ? 10 : Infinity

    const scrapings = (data || []).map(scraping => ({
      ...scraping,
      product_count: scraping.metadata?.product_count ?? scraping.metadata?.products_count ?? null,
    }))

    return NextResponse.json({
      scrapings,
      count: count || 0,
      limit,
      page,
      pageSize,
      isLocal: false
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    const scrapingData = await request.json()

    // Si non connecté, retourner les données pour sauvegarde locale
    if (!user) {
      return NextResponse.json({ 
        scraping: scrapingData,
        isLocal: true,
        message: 'Scraping sauvegardé localement'
      })
    }

    const supabase = await createClient()

    // Vérifier la limite pour plan gratuit
    if (user.subscription_plan === 'free') {
      const { count } = await supabase
        .from('scrapings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)

      if ((count || 0) >= 10) {
        return NextResponse.json(
          { error: 'Limite de 10 scrapings atteinte. Passez au plan Standard ou Premium pour des scrapings illimités.' },
          { status: 403 }
        )
      }
    }

    const { data, error } = await supabase
      .from('scrapings')
      .insert({
        user_id: user.id,
        reference_url: scrapingData.reference_url,
        competitor_urls: scrapingData.competitor_urls || [],
        products: scrapingData.products || [],
        metadata: scrapingData.metadata || {},
        scraping_time_seconds: scrapingData.scraping_time_seconds,
        mode: scrapingData.mode,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ scraping: data, isLocal: false })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

