import { normalizeProductGroupKeyWithMode, type MatchMode, type Product as AnalyticsProduct } from "@/lib/analytics-calculations"

export type VehicleType =
  | "moto"
  | "vtt"
  | "cote-a-cote"
  | "motoneige"
  | "motomarine"
  | "3-roues"
  | "ponton"
  | "bateau"
  | "moteur-hors-bord"
  | "equipement"
  | "remorque"
  | "velo-electrique"
  | "autre"

export type PricingStrategyKey = "lowest_minus_amount" | "market_average" | "match_lowest"

export type PricingStrategyRule = {
  key: PricingStrategyKey
  amount?: number
}

export type PricingStrategySettings = {
  apply_enabled: boolean
  default_strategy: PricingStrategyRule
  vehicle_type_strategies: Partial<Record<VehicleType, PricingStrategyRule>>
}

export type PricingRowInput = {
  name: string
  productKey?: string
  reference: number | null
  referenceUrl?: string
  vehicleType?: VehicleType
  prices: Array<{ dealer: string; price: number | null; url?: string }>
}

export type PricingProduct = {
  name?: string
  modele?: string
  marque?: string
  prix?: number | null
  price_on_request?: boolean
  prixReference?: number | null
  sourceSite?: string
  sourceUrl?: string
  produitReference?: { sourceUrl?: string; name?: string; prix?: number | null }
}

export type PricingRecommendation = {
  productKey: string
  productName: string
  referenceUrl?: string
  vehicleType: VehicleType
  oldPrice: number
  recommendedPrice: number
  difference: number
  strategy: PricingStrategyRule
  strategyLabel: string
  basis: {
    competitorPrices: Array<{ dealer: string; price: number; url?: string }>
    minimum: number
    average: number
    amount?: number
  }
}

export type AppliedPricingUpdate = {
  id?: string
  product_key: string
  product_name?: string
  old_price?: number | null
  recommended_price: number
  strategy_key?: string
  status?: "pending" | "applied" | "rejected"
  applied_at?: string | null
}

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  moto: "Moto",
  vtt: "VTT / Quad",
  "cote-a-cote": "Côte-à-côte",
  motoneige: "Motoneige",
  motomarine: "Motomarine",
  "3-roues": "3 roues",
  ponton: "Ponton",
  bateau: "Bateau",
  "moteur-hors-bord": "Moteur hors-bord",
  equipement: "Équipement",
  remorque: "Remorque",
  "velo-electrique": "Vélo électrique",
  autre: "Autre",
}

export const VEHICLE_TYPES = Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]

export const PRICING_STRATEGY_OPTIONS: Array<{ key: PricingStrategyKey; label: string; description: string }> = [
  {
    key: "lowest_minus_amount",
    label: "Prix le plus bas moins X $",
    description: "Positionne votre prix juste sous le meilleur prix concurrent.",
  },
  {
    key: "market_average",
    label: "Moyenne du marché",
    description: "Recommande la moyenne des prix concurrents disponibles.",
  },
  {
    key: "match_lowest",
    label: "Égaler le prix le plus bas",
    description: "S'aligne sur le meilleur prix concurrent sans descendre plus bas.",
  },
]

export const DEFAULT_PRICING_STRATEGY: PricingStrategyRule = {
  key: "lowest_minus_amount",
  amount: 1,
}

export const DEFAULT_PRICING_SETTINGS: PricingStrategySettings = {
  apply_enabled: false,
  default_strategy: DEFAULT_PRICING_STRATEGY,
  vehicle_type_strategies: {},
}

export function inferVehicleType(product: { sourceUrl?: string; name?: string }): VehicleType {
  const url = (product.sourceUrl || "").toLowerCase()
  const name = (product.name || "").toLowerCase()

  if (/\/velos?-electriques?/.test(url)) return "velo-electrique"
  if (/\/moto-trois-roues|\/three-wheel/.test(url)) return "3-roues"
  if (/\/motocyclette|\/motorcycle|\/motocyclettes-/.test(url)) return "moto"
  if (/\/vtt[/-]|\/atv[/-]/.test(url)) return "vtt"
  if (/\/cote-a-cote|\/side-by-side/.test(url)) return "cote-a-cote"
  if (/\/motoneige|\/snowmobile/.test(url)) return "motoneige"
  if (/\/motomarine|\/watercraft/.test(url)) return "motomarine"
  if (/\/ponton|\/pontoon/.test(url)) return "ponton"
  if (/\/bateau|\/boat/.test(url)) return "bateau"
  if (/\/moteur-hors-bord|\/outboard/.test(url)) return "moteur-hors-bord"
  if (/\/equipement-mecanique|\/power-equipment/.test(url)) return "equipement"
  if (/\/remorque|\/trailer/.test(url)) return "remorque"
  if (/\/argo\//.test(url) || /\bargo\b/.test(name)) return "vtt"

  if (/\b(?:ninja|z900|versys|klx|klr|vulcan|kx\d|scrambler|duke|ibex|street|bonneville)\b/.test(name)) return "moto"
  if (/\b(?:brute force|cforce|kfx|outlander|kingquad)\b/.test(name)) return "vtt"
  if (/\b(?:teryx|mule|uforce|zforce|maverick|ranger|rzr|defender)\b/.test(name)) return "cote-a-cote"
  if (/\b(?:jet ski|ultra 310)\b/.test(name)) return "motomarine"

  return "autre"
}

export function normalizePricingSettings(raw?: Partial<PricingStrategySettings> | null): PricingStrategySettings {
  return {
    apply_enabled: Boolean(raw?.apply_enabled),
    default_strategy: normalizeStrategyRule(raw?.default_strategy),
    vehicle_type_strategies: normalizeVehicleStrategies(raw?.vehicle_type_strategies),
  }
}

export function normalizeStrategyRule(raw?: Partial<PricingStrategyRule> | null): PricingStrategyRule {
  const allowed = new Set<PricingStrategyKey>(["lowest_minus_amount", "market_average", "match_lowest"])
  const key = raw?.key && allowed.has(raw.key) ? raw.key : DEFAULT_PRICING_STRATEGY.key
  const amount = typeof raw?.amount === "number" && Number.isFinite(raw.amount) ? raw.amount : DEFAULT_PRICING_STRATEGY.amount
  return key === "lowest_minus_amount" ? { key, amount: Math.max(0, amount ?? 0) } : { key }
}

export function getStrategyForVehicleType(settings: PricingStrategySettings, vehicleType: VehicleType): PricingStrategyRule {
  return normalizeStrategyRule(settings.vehicle_type_strategies[vehicleType] || settings.default_strategy)
}

export function getStrategyLabel(rule: PricingStrategyRule): string {
  const option = PRICING_STRATEGY_OPTIONS.find(item => item.key === rule.key)
  if (rule.key === "lowest_minus_amount") {
    return `${option?.label || "Prix le plus bas"} (${rule.amount ?? 0} $)`
  }
  return option?.label || rule.key
}

export function buildPricingProductKey(row: Pick<PricingRowInput, "name" | "referenceUrl" | "productKey">): string {
  if (row.productKey) return row.productKey
  if (row.referenceUrl) return row.referenceUrl.toLowerCase().replace(/\/+$/, "")
  return row.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export function hostnameFromPricingUrl(url: string) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "")
    return h || url
  } catch {
    return url
  }
}

export function buildPricingRowsFromProducts(
  products: PricingProduct[],
  competitorUrls: string[] = [],
  matchMode: MatchMode = "exact"
): PricingRowInput[] {
  const competitors = Array.from(
    new Set([
      ...competitorUrls.filter(Boolean).map(hostnameFromPricingUrl),
      ...products
        .filter(product => product.prixReference != null && product.sourceSite)
        .map(product => hostnameFromPricingUrl(product.sourceSite || "")),
    ].filter(Boolean))
  )

  const groups = new Map<string, {
    productKey: string
    displayName: string
    referenceUrl?: string
    reference: number | null
    vehicleType: VehicleType
    competitorPrices: Record<string, { price: number; url?: string }>
  }>()

  const toAnalyticsProduct = (product: PricingProduct): AnalyticsProduct => ({
    name: product.name || "",
    prix: !product.price_on_request && typeof product.prix === "number" ? product.prix : 0,
    prixReference: product.prixReference,
    sourceSite: product.sourceSite,
    sourceUrl: product.sourceUrl,
    marque: product.marque,
    modele: product.modele,
  })

  const productsWithComparison = products.filter(product => product.prixReference != null)
  const productsRefOnly = products.filter(product => product.prixReference == null)
  const refInfoByKey = new Map<string, { sourceUrl?: string; name?: string; price: number | null }>()

  for (const product of productsRefOnly) {
    const key = normalizeProductGroupKeyWithMode(toAnalyticsProduct(product), matchMode)
    if (!refInfoByKey.has(key)) {
      refInfoByKey.set(key, {
        sourceUrl: product.sourceUrl,
        name: product.name,
        price: !product.price_on_request && typeof product.prix === "number" && product.prix > 0 ? product.prix : null,
      })
    }
  }

  for (const product of productsWithComparison) {
    const key = normalizeProductGroupKeyWithMode(toAnalyticsProduct(product), matchMode)
    if (!groups.has(key)) {
      const refInfo = refInfoByKey.get(key)
      const displayName = product.produitReference?.name || refInfo?.name || product.name || "Produit"
      const referenceUrl = product.produitReference?.sourceUrl || refInfo?.sourceUrl
      const reference = product.prixReference ?? product.produitReference?.prix ?? refInfo?.price ?? null
      groups.set(key, {
        productKey: key,
        displayName,
        referenceUrl,
        reference,
        vehicleType: inferVehicleType({ sourceUrl: referenceUrl || product.sourceUrl, name: displayName }),
        competitorPrices: {},
      })
    }

    const siteLabel = product.sourceSite ? hostnameFromPricingUrl(product.sourceSite) : ""
    if (siteLabel && !product.price_on_request && typeof product.prix === "number" && product.prix > 0) {
      const group = groups.get(key)!
      if (!group.competitorPrices[siteLabel]) {
        group.competitorPrices[siteLabel] = {
          price: product.prix,
          url: product.sourceUrl,
        }
      }
    }
  }

  return Array.from(groups.values()).map(group => ({
    name: group.displayName,
    productKey: group.productKey,
    reference: group.reference,
    referenceUrl: group.referenceUrl,
    vehicleType: group.vehicleType,
    prices: competitors.map(dealer => ({
      dealer,
      price: group.competitorPrices[dealer]?.price ?? null,
      url: group.competitorPrices[dealer]?.url,
    })),
  }))
}

export function calculatePricingRecommendation(
  row: PricingRowInput,
  settings: PricingStrategySettings
): PricingRecommendation | null {
  if (row.reference === null || row.reference <= 0) return null

  const competitorPrices = row.prices
    .filter((entry): entry is { dealer: string; price: number; url?: string } => typeof entry.price === "number" && entry.price > 0)
    .map(entry => ({ dealer: entry.dealer, price: entry.price, url: entry.url }))

  if (competitorPrices.length === 0) return null

  const vehicleType = row.vehicleType || "autre"
  const strategy = getStrategyForVehicleType(settings, vehicleType)
  const minimum = Math.min(...competitorPrices.map(entry => entry.price))
  const average = competitorPrices.reduce((sum, entry) => sum + entry.price, 0) / competitorPrices.length
  const amount = strategy.key === "lowest_minus_amount" ? strategy.amount ?? DEFAULT_PRICING_STRATEGY.amount ?? 1 : undefined

  let recommendedPrice: number
  if (strategy.key === "market_average") {
    recommendedPrice = average
  } else if (strategy.key === "match_lowest") {
    recommendedPrice = minimum
  } else {
    recommendedPrice = minimum - (amount ?? 0)
  }

  recommendedPrice = Math.max(0, Math.round(recommendedPrice))

  return {
    productKey: buildPricingProductKey(row),
    productName: row.name,
    referenceUrl: row.referenceUrl,
    vehicleType,
    oldPrice: row.reference,
    recommendedPrice,
    difference: recommendedPrice - row.reference,
    strategy,
    strategyLabel: getStrategyLabel(strategy),
    basis: {
      competitorPrices,
      minimum,
      average,
      amount,
    },
  }
}

function normalizeVehicleStrategies(
  raw?: Partial<Record<VehicleType, Partial<PricingStrategyRule>>> | null
): Partial<Record<VehicleType, PricingStrategyRule>> {
  const result: Partial<Record<VehicleType, PricingStrategyRule>> = {}
  if (!raw || typeof raw !== "object") return result

  for (const vehicleType of VEHICLE_TYPES) {
    const rule = raw[vehicleType]
    if (rule?.key) {
      result[vehicleType] = normalizeStrategyRule(rule)
    }
  }

  return result
}
