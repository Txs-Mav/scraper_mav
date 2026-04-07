import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { hasBackend, proxyToBackend } from '@/lib/backend-proxy'

/**
 * POST /api/products/analyze
 *
 * Comparaison rapide depuis les données pré-scrapées (scraped_site_data).
 * Tente d'abord le backend Railway, puis fallback direct via Supabase.
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const userId = user.id

    // Try backend first (Railway)
    if (hasBackend()) {
      try {
        const backendRes = await proxyToBackend('/products/analyze', {
          body: { userId },
          timeout: 120_000,
        })
        const data = await backendRes.json()
        return NextResponse.json(data, { status: backendRes.status })
      } catch (err) {
        console.warn('[analyze] Backend failed, falling back to direct Supabase:', err)
      }
    }

    // Fallback: direct comparison via Supabase (no backend needed)
    return await analyzeFromCache(userId)

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[analyze] Error:', message)
    return NextResponse.json(
      { error: 'internal_error', message },
      { status: 500 }
    )
  }
}

function extractDomain(url: string): string {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`
    return new URL(withProto).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url.toLowerCase().replace(/^www\./, '').split('/')[0]
  }
}

async function analyzeFromCache(userId: string) {
  const serviceSupabase = createServiceClient()
  const startTime = Date.now()

  // 1. Read user config
  const { data: config } = await serviceSupabase
    .from('scraper_config')
    .select('reference_url, competitor_urls, ignore_colors, match_mode, filter_catalogue_reference')
    .eq('user_id', userId)
    .maybeSingle()

  if (!config?.reference_url) {
    return NextResponse.json({
      success: false,
      error: 'no_config',
      message: 'Aucune configuration de surveillance trouvée.',
    }, { status: 404 })
  }

  const referenceUrl = config.reference_url
  const competitorUrls: string[] = config.competitor_urls || []
  const refDomain = extractDomain(referenceUrl)

  const allDomains = new Map<string, string>()
  allDomains.set(refDomain, referenceUrl)
  for (const url of competitorUrls) {
    const d = extractDomain(url)
    if (!allDomains.has(d)) allDomains.set(d, url)
  }

  // 2. Fetch cached products for all domains
  const domains = [...allDomains.keys()]
  const { data: cachedSites } = await serviceSupabase
    .from('scraped_site_data')
    .select('site_domain, products, product_count, status')
    .in('site_domain', domains)
    .eq('status', 'success')

  const siteProducts = new Map<string, any[]>()
  for (const row of cachedSites || []) {
    if (row.products?.length > 0) {
      siteProducts.set(row.site_domain, row.products)
    }
  }

  // 3. Reference products
  const referenceProducts = siteProducts.get(refDomain)
  if (!referenceProducts || referenceProducts.length === 0) {
    return NextResponse.json({
      success: false,
      error: 'no_reference_cache',
      message: `Aucun produit pré-scrapé pour le site de référence (${refDomain}).`,
    }, { status: 404 })
  }

  // Mark reference products
  for (const p of referenceProducts) {
    p.sourceSite = referenceUrl
    p.isReferenceProduct = true
  }

  // 4. Gather all products (reference + competitors)
  const allProducts = [...referenceProducts]
  const addedUrls = new Set(referenceProducts.map((p: any) => p.sourceUrl).filter(Boolean))

  for (const url of competitorUrls) {
    const domain = extractDomain(url)
    const products = siteProducts.get(domain) || []
    for (const product of products) {
      if (!product.sourceSite) product.sourceSite = url
      const sourceUrl = product.sourceUrl
      if (sourceUrl && addedUrls.has(sourceUrl)) continue
      allProducts.push(product)
      if (sourceUrl) addedUrls.add(sourceUrl)
    }
  }

  const elapsed = (Date.now() - startTime) / 1000

  // 5. Save to scrapings
  const scrapingRow = {
    user_id: userId,
    reference_url: referenceUrl,
    competitor_urls: competitorUrls,
    products: allProducts,
    metadata: {
      reference_url: referenceUrl,
      reference_products_count: referenceProducts.length,
      competitor_urls: competitorUrls,
      total_products: allProducts.length,
      scraping_time_seconds: Math.round(elapsed * 10) / 10,
      mode: 'from_cache',
      source: 'direct_supabase_fallback',
      cache_hits: siteProducts.size,
    },
    scraping_time_seconds: Math.round(elapsed * 10) / 10,
    mode: 'from_cache',
  }

  const { error: saveError } = await serviceSupabase
    .from('scrapings')
    .insert(scrapingRow)

  if (saveError) {
    console.error('[analyze] Save error:', saveError.message)
    return NextResponse.json({
      success: false,
      error: 'save_error',
      message: `Erreur lors de la sauvegarde: ${saveError.message}`,
    }, { status: 500 })
  }

  console.log(`[analyze] Direct Supabase OK: ${allProducts.length} produits, ${elapsed.toFixed(1)}s`)

  return NextResponse.json({
    success: true,
    message: 'Comparaison terminée depuis les données pré-scrapées',
    source: 'direct_supabase',
    stats: {
      referenceProducts: referenceProducts.length,
      totalProducts: allProducts.length,
      cacheHits: siteProducts.size,
      elapsed: Math.round(elapsed * 10) / 10,
    },
  })
}
