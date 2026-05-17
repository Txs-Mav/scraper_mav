// Calculs pour la page Rapports.

import {
  normalizeProductGroupKey,
  type Product,
} from './analytics-calculations'

// ─── Types externes ─────────────────────────────────────────────────

/**
 * Représentation minimale d'un scraping historique tel que stocké en
 * base. Seuls les champs strictement nécessaires aux calculs du rapport
 * sont consommés ici afin de garder la fonction agnostique de la
 * couche de stockage.
 */
export interface ScrapingSnapshot {
  id?: string
  created_at: string
  reference_url?: string | null
  products: Product[]
  metadata?: {
    reference_url?: string | null
    reference_products_count?: number
    competitor_urls?: string[]
    scraping_time_seconds?: number
    [key: string]: unknown
  } | null
}

// ─── Types de sortie ────────────────────────────────────────────────

export interface ReportMeta {
  firstScrapingDate: string | null
  lastScrapingDate: string | null
  totalScrapings: number
  daysCovered: number
  referenceUrl: string | null
  hasEnoughHistory: boolean
}

export interface ReportPresent {
  totalProducts: number
  productsWithPrice: number
  averagePrice: number
  medianPrice: number
  minPrice: number
  maxPrice: number
  sitesCount: number
  categoriesCount: number
  productsByCategory: Array<{
    category: string
    count: number
    averagePrice: number
  }>
  productsBySite: Array<{
    site: string
    count: number
    averagePrice: number
    isReference: boolean
  }>
  productsByCondition: Array<{
    etat: string
    count: number
  }>
}

export interface ReportPast {
  /** Historique d'activité : un point par scraping. */
  scrapingsTimeline: Array<{
    date: string
    productsCollected: number
    averagePrice: number
    distinctSites: number
  }>
  /** Cumul croissant du nombre de scrapings dans le temps. */
  cumulativeScrapings: Array<{
    date: string
    total: number
  }>
  /** Cumul croissant du nombre total de prix collectés. */
  cumulativeDataPoints: Array<{
    date: string
    total: number
  }>
  /** Nombre total de points de prix collectés depuis le début. */
  totalDataPoints: number
  /** Nombre de produits distincts identifiés depuis le début. */
  uniqueProductsTracked: number
  /** Nombre de sites distincts vus au moins une fois. */
  uniqueSitesObserved: number
}

export interface PeriodComparison {
  current: number
  previous: number
  delta: number
  deltaPct: number
  available: boolean
}

export interface ProductTrend {
  product: string
  site: string
  firstPrice: number
  lastPrice: number
  delta: number
  deltaPct: number
  firstSeen: string
  lastSeen: string
}

export interface SiteTrend {
  site: string
  firstAveragePrice: number
  lastAveragePrice: number
  delta: number
  deltaPct: number
  productsCount: number
  isReference: boolean
}

export interface CategoryTrend {
  category: string
  firstAveragePrice: number
  lastAveragePrice: number
  delta: number
  deltaPct: number
  productsCount: number
}

export interface ReportTrends {
  /** Variation du prix moyen entre les 7 derniers jours et la période précédente. */
  averagePrice7d: PeriodComparison
  /** Variation du prix moyen entre les 30 derniers jours et la période précédente. */
  averagePrice30d: PeriodComparison
  /** Variation du nombre de produits suivis (présent vs il y a 7 jours). */
  productsCount7d: PeriodComparison
  /** Variation du nombre de produits suivis (présent vs il y a 30 jours). */
  productsCount30d: PeriodComparison
  /** Top baisses de prix par produit (entre première et dernière observation). */
  biggestPriceDrops: ProductTrend[]
  /** Top hausses de prix par produit. */
  biggestPriceIncreases: ProductTrend[]
  /** Tendance par site (prix moyen entre 1er et dernier scraping). */
  siteTrends: SiteTrend[]
  /** Tendance par catégorie. */
  categoryTrends: CategoryTrend[]
}

export interface ReportData {
  meta: ReportMeta
  present: ReportPresent
  past: ReportPast
  trends: ReportTrends
}

// ─── Helpers internes ───────────────────────────────────────────────

function normalizeSiteKey(site?: string | null): string {
  if (!site) return 'unknown'
  try {
    const value = site.startsWith('http') ? site : `https://${site}`
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return site.replace(/^www\./, '').toLowerCase()
  }
}

function isValidPrice(price: number | null | undefined): price is number {
  return typeof price === 'number' && price > 0 && price < 500000
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function dayKey(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString().split('T')[0]
}

function diffDays(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.max(0, Math.round(ms / 86400000))
}

// ─── Présent ────────────────────────────────────────────────────────

function buildPresent(
  latest: ScrapingSnapshot | null,
  referenceSite: string,
): ReportPresent {
  const empty: ReportPresent = {
    totalProducts: 0,
    productsWithPrice: 0,
    averagePrice: 0,
    medianPrice: 0,
    minPrice: 0,
    maxPrice: 0,
    sitesCount: 0,
    categoriesCount: 0,
    productsByCategory: [],
    productsBySite: [],
    productsByCondition: [],
  }

  if (!latest) return empty

  const products = latest.products || []
  const valid = products.filter((p) => isValidPrice(p.prix))
  const prices = valid.map((p) => p.prix)

  if (prices.length === 0) {
    return { ...empty, totalProducts: products.length }
  }

  // Groupement par catégorie
  const byCategory = new Map<string, number[]>()
  for (const p of valid) {
    const cat = (p.category || 'autre').toLowerCase()
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(p.prix)
  }

  // Groupement par site
  const bySite = new Map<string, number[]>()
  for (const p of valid) {
    const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
    if (!bySite.has(site)) bySite.set(site, [])
    bySite.get(site)!.push(p.prix)
  }

  // Groupement par état
  const byEtat = new Map<string, number>()
  for (const p of valid) {
    const etat = (p.etat || 'inconnu').toLowerCase()
    byEtat.set(etat, (byEtat.get(etat) || 0) + 1)
  }

  const normalizedRef = normalizeSiteKey(referenceSite)

  return {
    totalProducts: products.length,
    productsWithPrice: valid.length,
    averagePrice: average(prices),
    medianPrice: median(prices),
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    sitesCount: bySite.size,
    categoriesCount: byCategory.size,
    productsByCategory: Array.from(byCategory.entries())
      .map(([category, list]) => ({
        category,
        count: list.length,
        averagePrice: average(list),
      }))
      .sort((a, b) => b.count - a.count),
    productsBySite: Array.from(bySite.entries())
      .map(([site, list]) => ({
        site,
        count: list.length,
        averagePrice: average(list),
        isReference: site === normalizedRef,
      }))
      .sort((a, b) => b.count - a.count),
    productsByCondition: Array.from(byEtat.entries())
      .map(([etat, count]) => ({ etat, count }))
      .sort((a, b) => b.count - a.count),
  }
}

// ─── Passé ──────────────────────────────────────────────────────────

function buildPast(scrapings: ScrapingSnapshot[]): ReportPast {
  const ordered = [...scrapings].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  const timeline: ReportPast['scrapingsTimeline'] = []
  const cumulativeScrapings: ReportPast['cumulativeScrapings'] = []
  const cumulativeDataPoints: ReportPast['cumulativeDataPoints'] = []

  const uniqueProductKeys = new Set<string>()
  const uniqueSites = new Set<string>()
  let totalDataPoints = 0

  for (let i = 0; i < ordered.length; i++) {
    const snap = ordered[i]
    const valid = (snap.products || []).filter((p) => isValidPrice(p.prix))
    const prices = valid.map((p) => p.prix)
    const sitesInSnap = new Set<string>()

    for (const p of valid) {
      const key = normalizeProductGroupKey(p)
      uniqueProductKeys.add(key)
      const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
      uniqueSites.add(site)
      sitesInSnap.add(site)
    }

    totalDataPoints += valid.length

    timeline.push({
      date: snap.created_at,
      productsCollected: valid.length,
      averagePrice: average(prices),
      distinctSites: sitesInSnap.size,
    })

    cumulativeScrapings.push({
      date: snap.created_at,
      total: i + 1,
    })

    cumulativeDataPoints.push({
      date: snap.created_at,
      total: totalDataPoints,
    })
  }

  return {
    scrapingsTimeline: timeline,
    cumulativeScrapings,
    cumulativeDataPoints,
    totalDataPoints,
    uniqueProductsTracked: uniqueProductKeys.size,
    uniqueSitesObserved: uniqueSites.size,
  }
}

// ─── Tendances ──────────────────────────────────────────────────────

interface PriceObservation {
  price: number
  site: string
  date: string
  productName: string
  category: string
}

function indexByGroup(
  scrapings: ScrapingSnapshot[],
): Map<string, PriceObservation[]> {
  const grouped = new Map<string, PriceObservation[]>()

  for (const snap of scrapings) {
    for (const p of snap.products || []) {
      if (!isValidPrice(p.prix)) continue
      const key = normalizeProductGroupKey(p)
      if (!key) continue
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push({
        price: p.prix,
        site: normalizeSiteKey(p.sourceSite || p.sourceUrl),
        date: snap.created_at,
        productName: p.name || '',
        category: (p.category || 'autre').toLowerCase(),
      })
    }
  }

  return grouped
}

function pricesBetween(
  scrapings: ScrapingSnapshot[],
  start: Date,
  end: Date,
): number[] {
  const prices: number[] = []
  for (const snap of scrapings) {
    const at = new Date(snap.created_at)
    if (at < start || at > end) continue
    for (const p of snap.products || []) {
      if (isValidPrice(p.prix)) prices.push(p.prix)
    }
  }
  return prices
}

function productCountsBetween(
  scrapings: ScrapingSnapshot[],
  start: Date,
  end: Date,
): number {
  // Nombre moyen de produits collectés par scraping sur la fenêtre,
  // exprimé en entier (présent vs passé pour faire un % parlant).
  const counts: number[] = []
  for (const snap of scrapings) {
    const at = new Date(snap.created_at)
    if (at < start || at > end) continue
    const valid = (snap.products || []).filter((p) => isValidPrice(p.prix))
    counts.push(valid.length)
  }
  if (!counts.length) return 0
  return Math.round(average(counts))
}

function compareWindow(
  scrapings: ScrapingSnapshot[],
  windowDays: number,
  mode: 'price' | 'count',
): PeriodComparison {
  if (!scrapings.length) {
    return { current: 0, previous: 0, delta: 0, deltaPct: 0, available: false }
  }

  const now = new Date(scrapings[scrapings.length - 1].created_at)
  const currentStart = new Date(now.getTime() - windowDays * 86400000)
  const previousStart = new Date(
    currentStart.getTime() - windowDays * 86400000,
  )

  const currentValue =
    mode === 'price'
      ? average(pricesBetween(scrapings, currentStart, now))
      : productCountsBetween(scrapings, currentStart, now)

  const previousValue =
    mode === 'price'
      ? average(pricesBetween(scrapings, previousStart, currentStart))
      : productCountsBetween(scrapings, previousStart, currentStart)

  const available = previousValue > 0 && currentValue > 0
  const delta = currentValue - previousValue
  const deltaPct = previousValue > 0 ? (delta / previousValue) * 100 : 0

  return {
    current: currentValue,
    previous: previousValue,
    delta,
    deltaPct,
    available,
  }
}

function buildProductTrends(
  scrapings: ScrapingSnapshot[],
): { drops: ProductTrend[]; increases: ProductTrend[] } {
  const grouped = indexByGroup(scrapings)
  const drops: ProductTrend[] = []
  const increases: ProductTrend[] = []

  for (const [, observations] of grouped) {
    if (observations.length < 2) continue

    // Trier les observations par date pour récupérer les bornes.
    observations.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )

    // Garder la plus ancienne et la plus récente, en se restreignant au
    // même site quand c'est possible pour comparer des prix réellement
    // comparables. Sinon on prend la première et la dernière observation
    // toutes sites confondus.
    const byKey = new Map<string, PriceObservation[]>()
    for (const obs of observations) {
      if (!byKey.has(obs.site)) byKey.set(obs.site, [])
      byKey.get(obs.site)!.push(obs)
    }

    let first: PriceObservation | null = null
    let last: PriceObservation | null = null

    for (const [, list] of byKey) {
      if (list.length < 2) continue
      first = list[0]
      last = list[list.length - 1]
      break
    }

    if (!first || !last) {
      first = observations[0]
      last = observations[observations.length - 1]
    }

    if (first.price <= 0 || last.price <= 0) continue
    if (first.date === last.date) continue

    const delta = last.price - first.price
    const deltaPct = (delta / first.price) * 100
    if (Math.abs(deltaPct) < 1) continue

    const entry: ProductTrend = {
      product: last.productName || first.productName,
      site: last.site,
      firstPrice: first.price,
      lastPrice: last.price,
      delta,
      deltaPct,
      firstSeen: first.date,
      lastSeen: last.date,
    }

    if (delta < 0) drops.push(entry)
    else increases.push(entry)
  }

  drops.sort((a, b) => a.deltaPct - b.deltaPct)
  increases.sort((a, b) => b.deltaPct - a.deltaPct)

  return {
    drops: drops.slice(0, 10),
    increases: increases.slice(0, 10),
  }
}

function buildSiteTrends(
  scrapings: ScrapingSnapshot[],
  referenceSite: string,
): SiteTrend[] {
  if (scrapings.length < 2) return []

  const ordered = [...scrapings].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const first = ordered[0]
  const last = ordered[ordered.length - 1]

  const pricesPerSite = (snap: ScrapingSnapshot): Map<string, number[]> => {
    const map = new Map<string, number[]>()
    for (const p of snap.products || []) {
      if (!isValidPrice(p.prix)) continue
      const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
      if (!map.has(site)) map.set(site, [])
      map.get(site)!.push(p.prix)
    }
    return map
  }

  const firstPrices = pricesPerSite(first)
  const lastPrices = pricesPerSite(last)
  const sites = new Set<string>([...firstPrices.keys(), ...lastPrices.keys()])

  const normalizedRef = normalizeSiteKey(referenceSite)
  const results: SiteTrend[] = []

  for (const site of sites) {
    const firstList = firstPrices.get(site) || []
    const lastList = lastPrices.get(site) || []
    if (firstList.length === 0 || lastList.length === 0) continue

    const firstAvg = average(firstList)
    const lastAvg = average(lastList)
    if (firstAvg <= 0 || lastAvg <= 0) continue

    const delta = lastAvg - firstAvg
    const deltaPct = (delta / firstAvg) * 100

    results.push({
      site,
      firstAveragePrice: firstAvg,
      lastAveragePrice: lastAvg,
      delta,
      deltaPct,
      productsCount: lastList.length,
      isReference: site === normalizedRef,
    })
  }

  // Site de référence en premier, puis tri par |variation| décroissante.
  return results.sort((a, b) => {
    if (a.isReference && !b.isReference) return -1
    if (!a.isReference && b.isReference) return 1
    return Math.abs(b.deltaPct) - Math.abs(a.deltaPct)
  })
}

function buildCategoryTrends(scrapings: ScrapingSnapshot[]): CategoryTrend[] {
  if (scrapings.length < 2) return []

  const ordered = [...scrapings].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const first = ordered[0]
  const last = ordered[ordered.length - 1]

  const pricesPerCategory = (snap: ScrapingSnapshot): Map<string, number[]> => {
    const map = new Map<string, number[]>()
    for (const p of snap.products || []) {
      if (!isValidPrice(p.prix)) continue
      const cat = (p.category || 'autre').toLowerCase()
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(p.prix)
    }
    return map
  }

  const firstPrices = pricesPerCategory(first)
  const lastPrices = pricesPerCategory(last)
  const categories = new Set<string>([
    ...firstPrices.keys(),
    ...lastPrices.keys(),
  ])

  const results: CategoryTrend[] = []

  for (const category of categories) {
    const firstList = firstPrices.get(category) || []
    const lastList = lastPrices.get(category) || []
    if (firstList.length === 0 || lastList.length === 0) continue

    const firstAvg = average(firstList)
    const lastAvg = average(lastList)
    if (firstAvg <= 0 || lastAvg <= 0) continue

    const delta = lastAvg - firstAvg
    const deltaPct = (delta / firstAvg) * 100

    results.push({
      category,
      firstAveragePrice: firstAvg,
      lastAveragePrice: lastAvg,
      delta,
      deltaPct,
      productsCount: lastList.length,
    })
  }

  return results.sort(
    (a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct),
  )
}

function buildTrends(
  scrapings: ScrapingSnapshot[],
  referenceSite: string,
): ReportTrends {
  const empty: PeriodComparison = {
    current: 0,
    previous: 0,
    delta: 0,
    deltaPct: 0,
    available: false,
  }

  if (scrapings.length < 2) {
    return {
      averagePrice7d: empty,
      averagePrice30d: empty,
      productsCount7d: empty,
      productsCount30d: empty,
      biggestPriceDrops: [],
      biggestPriceIncreases: [],
      siteTrends: [],
      categoryTrends: [],
    }
  }

  const ordered = [...scrapings].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  const { drops, increases } = buildProductTrends(ordered)

  return {
    averagePrice7d: compareWindow(ordered, 7, 'price'),
    averagePrice30d: compareWindow(ordered, 30, 'price'),
    productsCount7d: compareWindow(ordered, 7, 'count'),
    productsCount30d: compareWindow(ordered, 30, 'count'),
    biggestPriceDrops: drops,
    biggestPriceIncreases: increases,
    siteTrends: buildSiteTrends(ordered, referenceSite),
    categoryTrends: buildCategoryTrends(ordered),
  }
}

// ─── Construction principale ────────────────────────────────────────

export function buildReport(
  scrapings: ScrapingSnapshot[],
  referenceSiteHint?: string | null,
): ReportData {
  // Trier du plus récent au plus ancien pour identifier le présent.
  const sortedDesc = [...scrapings].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  const latest = sortedDesc[0] || null
  const oldest = sortedDesc[sortedDesc.length - 1] || null

  // Résolution du site de référence : metadata > param > 1er produit.
  let referenceUrl: string | null =
    referenceSiteHint || latest?.reference_url ||
    (latest?.metadata?.reference_url ?? null) || null
  if (!referenceUrl && latest?.products?.length) {
    referenceUrl = latest.products[0].sourceSite || null
  }
  const referenceSite = referenceUrl || ''

  const totalScrapings = scrapings.length
  const firstDate = oldest?.created_at || null
  const lastDate = latest?.created_at || null
  const daysCovered =
    firstDate && lastDate
      ? diffDays(new Date(firstDate), new Date(lastDate)) + 1
      : 0

  const meta: ReportMeta = {
    firstScrapingDate: firstDate,
    lastScrapingDate: lastDate,
    totalScrapings,
    daysCovered,
    referenceUrl,
    hasEnoughHistory: totalScrapings >= 2,
  }

  return {
    meta,
    present: buildPresent(latest, referenceSite),
    past: buildPast(scrapings),
    trends: buildTrends(scrapings, referenceSite),
  }
}

export function emptyReport(): ReportData {
  return {
    meta: {
      firstScrapingDate: null,
      lastScrapingDate: null,
      totalScrapings: 0,
      daysCovered: 0,
      referenceUrl: null,
      hasEnoughHistory: false,
    },
    present: {
      totalProducts: 0,
      productsWithPrice: 0,
      averagePrice: 0,
      medianPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      sitesCount: 0,
      categoriesCount: 0,
      productsByCategory: [],
      productsBySite: [],
      productsByCondition: [],
    },
    past: {
      scrapingsTimeline: [],
      cumulativeScrapings: [],
      cumulativeDataPoints: [],
      totalDataPoints: 0,
      uniqueProductsTracked: 0,
      uniqueSitesObserved: 0,
    },
    trends: {
      averagePrice7d: {
        current: 0,
        previous: 0,
        delta: 0,
        deltaPct: 0,
        available: false,
      },
      averagePrice30d: {
        current: 0,
        previous: 0,
        delta: 0,
        deltaPct: 0,
        available: false,
      },
      productsCount7d: {
        current: 0,
        previous: 0,
        delta: 0,
        deltaPct: 0,
        available: false,
      },
      productsCount30d: {
        current: 0,
        previous: 0,
        delta: 0,
        deltaPct: 0,
        available: false,
      },
      biggestPriceDrops: [],
      biggestPriceIncreases: [],
      siteTrends: [],
      categoryTrends: [],
    },
  }
}
