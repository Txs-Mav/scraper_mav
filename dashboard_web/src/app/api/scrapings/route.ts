import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { PLAN_FEATURES } from '@/lib/plan-restrictions'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ scrapings: [], count: 0, site_count: 0, limit: 6, isLocal: true })
    }

    const supabase = await createClient()

    const { searchParams } = new URL(request.url)
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const pageSize = Math.max(Math.min(parseInt(searchParams.get('limit') || '50', 10), 200), 1)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('scrapings')
      .select('id, user_id, reference_url, competitor_urls, metadata, scraping_time_seconds, mode, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    let userFilter: string[] = [user.id]

    if (user.role === 'main') {
      const { data: employees } = await supabase
        .from('employees')
        .select('employee_id')
        .eq('main_account_id', user.id)

      const employeeIds = employees?.map(e => e.employee_id) || []
      userFilter = [user.id, ...employeeIds]
      query = query.in('user_id', userFilter)
    } else {
      query = query.eq('user_id', user.id)
    }

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    const effectiveSource = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)
    const limit = PLAN_FEATURES.scrapingLimit(user.subscription_plan, effectiveSource)

    // Compter les SITES DISTINCTS (reference_urls uniques) pour la limite
    let siteCount = 0
    if (limit !== Infinity) {
      let distinctQuery = supabase
        .from('scrapings')
        .select('reference_url')

      if (userFilter.length > 1) {
        distinctQuery = distinctQuery.in('user_id', userFilter)
      } else {
        distinctQuery = distinctQuery.eq('user_id', user.id)
      }

      const { data: allUrls } = await distinctQuery
      siteCount = new Set((allUrls || []).map(s => s.reference_url)).size
    } else {
      siteCount = new Set((data || []).map(s => s.reference_url)).size
    }

    const scrapings = (data || []).map(scraping => ({
      ...scraping,
      product_count: scraping.metadata?.product_count ?? scraping.metadata?.products_count ?? null,
    }))

    return NextResponse.json({
      scrapings,
      count: siteCount,
      total_rows: count || 0,
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

    if (!user) {
      return NextResponse.json({ 
        scraping: scrapingData,
        isLocal: true,
        message: 'Scraping sauvegardé localement'
      })
    }

    const supabase = await createClient()

    const effectiveSource = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)
    const limit = PLAN_FEATURES.scrapingLimit(user.subscription_plan, effectiveSource)
    if (limit !== Infinity) {
      const { data: allUrls } = await supabase
        .from('scrapings')
        .select('reference_url')
        .eq('user_id', user.id)

      const uniqueUrls = new Set((allUrls || []).map(s => s.reference_url))

      if (!uniqueUrls.has(scrapingData.reference_url) && uniqueUrls.size >= limit) {
        return NextResponse.json(
          { error: 'Limite de 6 scrapings atteinte. Passez au plan Pro ou Ultime pour des scrapings illimités.' },
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
