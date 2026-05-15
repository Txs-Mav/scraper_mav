import { getDepreciationConfig } from "./depreciation-rates"
import { parseValuationQuery } from "./parse-query"
import { getVariantPremiums } from "./variant-premiums"
import type {
  AdjustedComparable,
  Adjustment,
  CategoryDepreciationConfig,
  DepreciationPhase,
  Hit,
  ParsedValuationQuery,
  PricePosition,
  ReliabilitySignals,
  ValuationReliability,
  ValuationResult,
  VehicleCondition,
} from "./types"

const CURRENT_YEAR = new Date().getFullYear()

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function money(value: number): string {
  return `${Math.round(value).toLocaleString("fr-CA")} $`
}

function formatFactor(factor: number): string {
  const delta = Math.round((factor - 1) * 100)
  if (delta === 0) return "±0%"
  return delta > 0 ? `+${delta}%` : `${delta}%`
}

function deriveCategoryKey(categoryPath: string | null | undefined): string {
  const leaf = (categoryPath || "").split(".").pop() || ""
  if (leaf.includes("moto") && !leaf.includes("motoneige")) return "moto"
  if (leaf.includes("motoneige")) return "motoneige"
  if (leaf.includes("sxs")) return "sxs"
  if (leaf.includes("vtt")) return "vtt"
  if (leaf.includes("nautique")) return "nautique"
  if (leaf.includes("pickup")) return "pickup"
  if (leaf.includes("vus")) return "vus"
  if (leaf.includes("auto")) return "auto"
  return leaf || "default"
}

function sourceDomain(hit: Hit): string {
  const raw = hit.source_site || hit.source_url || ""
  try {
    const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`
    return new URL(withProtocol).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase()
  }
}

function conditionOf(hit: Hit, quasiNewMileage: number): VehicleCondition | undefined {
  const etat = normalizeText(hit.etat || "")
  if (etat === "neuf" || etat === "new") return "new"
  if (etat.includes("usage") || etat.includes("occasion") || etat.includes("used")) return "used"
  if (hit.kilometrage != null && hit.kilometrage <= quasiNewMileage) return "new"
  return undefined
}

function plausibleMileage(hit: Hit, maxMileage: number): boolean {
  if (hit.kilometrage == null) return true
  return hit.kilometrage >= 0 && hit.kilometrage <= maxMileage
}

function dedupeHits(hits: Hit[]): Hit[] {
  const byKey = new Map<string, Hit>()
  for (const hit of hits) {
    const priceBucket = Math.round((hit.prix || 0) / 100) * 100
    const key = `${normalizeText(hit.name)}:${priceBucket}:${sourceDomain(hit)}`
    if (!byKey.has(key)) byKey.set(key, hit)
  }
  return [...byKey.values()]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function aliasMatches(haystack: string, alias: string): boolean {
  // On préserve les espaces de bordure explicites (" lt " ne doit pas matcher
  // "xlt"). Avant on faisait `normalizeText(alias)` qui supprimait les
  // espaces — résultat : le trim "lt" matchait toutes les variantes contenant
  // "xlt", "ltz", "blt"… et empilait des premiums fantômes.
  const wantsLeading = alias.startsWith(" ")
  const wantsTrailing = alias.endsWith(" ")
  const inner = normalizeText(alias) // strip casse + accents + tirets → espaces
  if (!inner) return false

  if (wantsLeading || wantsTrailing) {
    const needle = (wantsLeading ? " " : "") + inner + (wantsTrailing ? " " : "")
    return haystack.includes(needle)
  }
  // Pas de marqueur d'espace dans l'alias d'origine : on impose quand même
  // des word boundaries pour éviter les faux positifs entre alias courts.
  return new RegExp(`\\b${escapeRegExp(inner)}\\b`).test(haystack)
}

function detectVariantKeys(text: string, categoryKey: string): string[] {
  // Padding avec des espaces pour que les aliases qui dépendent d'un word
  // boundary explicite (ex: " lx " pour ne pas matcher "deluxe") fonctionnent
  // même en début/fin de chaîne.
  const normalized = ` ${normalizeText(text)} `
  return getVariantPremiums(categoryKey)
    .filter((variant) => variant.aliases.some((alias) => aliasMatches(normalized, alias)))
    .map((variant) => variant.key)
}

/**
 * Détecte les variantes en cumulant le nom du listing ET son URL source.
 * AutoTrader inclut souvent le trim dans le slug (`/offers/ford-f-150-lariat-…`)
 * sans le mettre dans le `name` court. Sans ça, le filtre par trim laisserait
 * passer tout le monde et la valuation continuerait à mélanger XLT / Lariat
 * / Platinum.
 */
function detectHitVariantKeys(hit: Hit, categoryKey: string): string[] {
  const haystack = [
    hit.name || "",
    hit.source_url || "",
    hit.source_site || "",
  ].join(" ")
  return detectVariantKeys(haystack, categoryKey)
}

function vehicleAgeYears(year: number | null | undefined): number {
  if (!year) return 0
  return Math.max(0, CURRENT_YEAR - year)
}

/**
 * Dépréciation cumulative non linéaire selon les phases de la catégorie.
 * Retourne le facteur (≤ 1) à appliquer au prix neuf pour estimer la valeur
 * à un âge donné.
 */
function cumulativeDepreciation(ageYears: number, phases: DepreciationPhase[]): number {
  let factor = 1
  let remaining = Math.max(0, ageYears)
  let cumulativeAge = 0
  for (const phase of phases) {
    const yearsAvailable = phase.untilYears - cumulativeAge
    if (yearsAvailable <= 0) continue
    const yearsInPhase = Math.min(yearsAvailable, remaining)
    factor *= Math.pow(1 - phase.yearlyRate, yearsInPhase)
    remaining -= yearsInPhase
    cumulativeAge += yearsInPhase
    if (remaining <= 0) break
  }
  return factor
}

/**
 * Convertit un ratio (km réel / km attendu) en facteur multiplicatif sur la
 * valeur. Non linéaire : bonus si faible km, pénalité accélérée au-delà de
 * 1.5×.
 */
function mileageFactorFromRatio(ratio: number): number {
  if (ratio <= 0.4) return 1.15
  if (ratio < 0.7) return 1.15 - ((ratio - 0.4) / 0.3) * 0.10
  if (ratio < 1.0) return 1.05 - ((ratio - 0.7) / 0.3) * 0.05
  if (ratio < 1.2) return 1.0 - ((ratio - 1.0) / 0.2) * 0.05
  if (ratio < 1.5) return 0.95 - ((ratio - 1.2) / 0.3) * 0.10
  if (ratio < 2.5) return 0.85 - ((ratio - 1.5) / 1.0) * 0.15
  return 0.70
}

function effectiveMileageRatio(
  mileage: number | null | undefined,
  ageYears: number,
  expectedKmPerYear: number,
): number | null {
  if (mileage == null) return null
  const ageFloor = Math.max(0.5, ageYears)
  const expected = ageFloor * expectedKmPerYear
  return mileage / Math.max(expected, expectedKmPerYear * 0.5)
}

/**
 * Retourne le kilométrage à utiliser pour le comparable. Un comparable
 * explicitement neuf et sans champ km est traité comme 0 km, sinon le bonus
 * "faible km" de la cible s'appliquerait sans contrepartie côté comparable.
 */
function comparableMileageForRatio(
  hit: Hit,
  quasiNewMileage: number,
): number | null {
  if (hit.kilometrage != null) return hit.kilometrage
  return conditionOf(hit, quasiNewMileage) === "new" ? 0 : null
}

function buildAdjustments(
  hit: Hit,
  parsed: ParsedValuationQuery,
  categoryKey: string,
): Adjustment[] {
  const config = getDepreciationConfig(categoryKey)
  const originalPrice = hit.prix || 0
  const adjustments: Adjustment[] = []

  // 1. Année — courbe multiplicative non linéaire
  if (parsed.year && hit.annee && parsed.year !== hit.annee) {
    const compAge = vehicleAgeYears(hit.annee)
    const targetAge = vehicleAgeYears(parsed.year)
    const compF = cumulativeDepreciation(compAge, config.phases)
    const targetF = cumulativeDepreciation(targetAge, config.phases)
    if (compF > 0) {
      const factor = targetF / compF
      const amount = originalPrice * (factor - 1)
      adjustments.push({
        type: "year",
        factor,
        amount,
        reason: `${hit.annee} → ${parsed.year} (${formatFactor(factor)})`,
      })
    }
  }

  // 2. Kilométrage — ratio km réel / km attendu
  if (parsed.mileage != null) {
    const targetAge = vehicleAgeYears(parsed.year ?? hit.annee ?? null)
    const compAge = vehicleAgeYears(hit.annee ?? null)
    const compMileage = comparableMileageForRatio(hit, config.quasiNewMileage)
    const targetRatio = effectiveMileageRatio(parsed.mileage, targetAge, config.expectedKmPerYear)
    const compRatio = effectiveMileageRatio(compMileage, compAge, config.expectedKmPerYear)
    const targetMileageFactor = targetRatio != null ? mileageFactorFromRatio(targetRatio) : 1
    const compMileageFactor = compRatio != null ? mileageFactorFromRatio(compRatio) : 1
    const factor = compMileageFactor > 0 ? targetMileageFactor / compMileageFactor : 1
    if (Math.abs(factor - 1) > 0.005) {
      const amount = originalPrice * (factor - 1)
      const reasonBits: string[] = []
      reasonBits.push(`${parsed.mileage.toLocaleString("fr-CA")} km`)
      if (compMileage != null) {
        reasonBits.push(`vs ${compMileage.toLocaleString("fr-CA")} km`)
      }
      reasonBits.push(`(${formatFactor(factor)})`)
      adjustments.push({
        type: "mileage",
        factor,
        amount,
        reason: reasonBits.join(" "),
      })
    }
  }

  // 3. État neuf/usagé — facteur multiplicatif anchored category
  const targetCondition = parsed.condition
  const compCondition = conditionOf(hit, config.quasiNewMileage)
  if (targetCondition && compCondition && compCondition !== targetCondition) {
    let factor: number
    if (compCondition === "new" && targetCondition === "used") {
      factor = config.newToUsedFactor
    } else {
      // comp usagé, cible neuve → on remonte (inversion)
      factor = 1 / config.newToUsedFactor
    }
    const amount = originalPrice * (factor - 1)
    adjustments.push({
      type: "condition",
      factor,
      amount,
      reason: `${compCondition === "new" ? "neuf" : "usagé"} → ${
        targetCondition === "new" ? "neuf" : "usagé"
      } (${formatFactor(factor)})`,
    })
  }

  // 4. Variantes / options — delta dollars ASYMÉTRIQUE :
  //
  //   - On bump POSITIVEMENT pour chaque option déclarée par l'utilisateur
  //     dans la cible mais absente du comparable (la cible est mieux équipée
  //     → vaut plus).
  //   - On ne déduit JAMAIS pour des options présentes dans le comp mais
  //     absentes de la cible. Pourquoi : l'utilisateur peut très bien avoir
  //     ces options sans les avoir déclarées (UI imparfaite, oubli, options
  //     non listées). Déduire systématiquement biaise la valuation TRÈS bas
  //     (ex: un Lariat 502A à 50k$ devient 24k$ parce que la cible n'a coché
  //     ni « 502A » ni « 3.5L » ni « cuir » qu'on détecte dans le slug du
  //     comparable).
  //
  //   Capé à +30% du prix du comparable pour rester raisonnable.
  const targetHintsSet = new Set(parsed.variantHints)
  const compHintsSet = new Set(detectHitVariantKeys(hit, categoryKey))
  const variants = getVariantPremiums(categoryKey)
  let bumpSum = 0
  for (const key of targetHintsSet) {
    if (compHintsSet.has(key)) continue
    const variant = variants.find((v) => v.key === key)
    if (variant && variant.premium > 0) bumpSum += variant.premium
  }
  if (bumpSum > 0) {
    const cap = originalPrice * 0.30
    const variantAmount = Math.min(cap, bumpSum)
    adjustments.push({
      type: "variant",
      amount: variantAmount,
      reason: "options en + sur la cible",
    })
  }

  // NOTE: l'ancien ajustement « source privée » (privateSourceFactor) a été
  // retiré. Il appliquait +2% à chaque comparable lespac/kijiji/facebook, ce
  // qui poussait artificiellement la valuation au-dessus du prix demandé,
  // alors que le prix demandé sur ces plateformes est déjà le prix de marché
  // (souvent négociable à la baisse, jamais à la hausse).

  return adjustments
}

function combineAdjustments(
  originalPrice: number,
  adjustments: Adjustment[],
  config: CategoryDepreciationConfig,
  parsed: ParsedValuationQuery,
  hit: Hit,
): number {
  let factorProduct = 1
  let dollarDelta = 0
  for (const adjustment of adjustments) {
    if (typeof adjustment.factor === "number") {
      factorProduct *= adjustment.factor
    } else {
      dollarDelta += adjustment.amount
    }
  }
  const raw = originalPrice * factorProduct + dollarDelta

  // Caps : on borne la valeur ajustée entre minPriceFactor et maxPriceFactor du
  // comparable, en serrant le plafond quand on dévalue un neuf vers un usagé.
  const compCondition = conditionOf(hit, config.quasiNewMileage)
  const isUsedFromNew =
    parsed.condition === "used" && compCondition === "new"
  const maxFactor = isUsedFromNew ? 0.95 : config.maxPriceFactor
  const minFactor = config.minPriceFactor
  const min = originalPrice * minFactor
  const max = originalPrice * maxFactor
  return Math.max(0, Math.max(min, Math.min(max, raw)))
}

function similarityScore(hit: Hit, parsed: ParsedValuationQuery, categoryKey: string): number {
  const config = getDepreciationConfig(categoryKey)
  const text = Math.max(0, Math.min(1, hit.score || 0))
  const year =
    parsed.year && hit.annee
      ? Math.max(0, 1 - Math.abs(parsed.year - hit.annee) / 3)
      : 0.5

  const targetAge = vehicleAgeYears(parsed.year ?? hit.annee ?? null)
  const compAge = vehicleAgeYears(hit.annee ?? null)
  const compMileage = comparableMileageForRatio(hit, config.quasiNewMileage)
  const targetRatio = effectiveMileageRatio(parsed.mileage, targetAge, config.expectedKmPerYear)
  const compRatio = effectiveMileageRatio(compMileage, compAge, config.expectedKmPerYear)
  const mileage =
    targetRatio != null && compRatio != null
      ? Math.max(0, 1 - Math.abs(targetRatio - compRatio) / 1.5)
      : 0.5

  const targetVariants = parsed.variantHints
  const compVariants = detectHitVariantKeys(hit, categoryKey)
  const variant =
    targetVariants.length === 0
      ? 0.5
      : targetVariants.filter((key) => compVariants.includes(key)).length / targetVariants.length

  const targetCondition = parsed.condition
  const compCondition = conditionOf(hit, config.quasiNewMileage)
  const condition =
    !targetCondition || !compCondition
      ? 0.75
      : targetCondition === compCondition
        ? 1
        : 0.65

  return Math.max(
    0.05,
    text * 0.42 + year * 0.23 + mileage * 0.15 + variant * 0.12 + condition * 0.08,
  )
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function weightedPercentile(comps: AdjustedComparable[], p: number): number {
  const sorted = [...comps].sort((a, b) => a.adjustedPrice - b.adjustedPrice)
  const totalWeight = sorted.reduce((sum, comp) => sum + comp.similarityScore, 0)
  const target = totalWeight * p
  let cumulative = 0
  for (const comp of sorted) {
    cumulative += comp.similarityScore
    if (cumulative >= target) return comp.adjustedPrice
  }
  return sorted[sorted.length - 1]?.adjustedPrice || 0
}

function reliabilitySignals(
  comps: AdjustedComparable[],
  low: number,
  median: number,
  high: number,
): ReliabilitySignals {
  const dispersion = median > 0 ? (high - low) / median : null
  const sourceDiversity = new Set(comps.map((comp) => comp.sourceDomain)).size
  return {
    compCount: comps.length,
    compLevel: comps.length >= 8 ? "good" : comps.length >= 4 ? "medium" : "weak",
    dispersion,
    dispersionLevel:
      dispersion == null ? "weak" : dispersion < 0.10 ? "good" : dispersion <= 0.25 ? "medium" : "weak",
    sourceDiversity,
    sourceLevel: sourceDiversity >= 4 ? "good" : sourceDiversity >= 2 ? "medium" : "weak",
  }
}

function reliabilityFromSignals(signals: ReliabilitySignals): ValuationReliability {
  if (
    signals.compLevel === "weak" ||
    signals.dispersionLevel === "weak" ||
    signals.sourceLevel === "weak"
  ) {
    return "low"
  }
  if (
    signals.compLevel === "good" &&
    signals.dispersionLevel === "good" &&
    signals.sourceLevel === "good"
  ) {
    return "good"
  }
  return "indicative"
}

function pricePosition(
  targetPrice: number | undefined,
  low: number,
  median: number,
  high: number,
): PricePosition | undefined {
  if (!targetPrice) return undefined
  const percentVsMedian = median > 0 ? targetPrice / median - 1 : 0
  const markerPercent = Math.max(0, Math.min(100, ((targetPrice - low) / Math.max(1, high - low)) * 100))
  let label: PricePosition["label"] = "Aligné au marché"
  if (targetPrice < low) label = "Sous le marché"
  else if (targetPrice > high * 1.15) label = "Hors marché"
  else if (targetPrice > high) label = "Au-dessus du marché"
  return { label, percentVsMedian, markerPercent }
}

function insufficient(
  parsed: ParsedValuationQuery,
  categoryKey: string,
  compCount: number,
): ValuationResult {
  return {
    status: "insufficient",
    parsed,
    categoryKey,
    lowValue: null,
    medianValue: null,
    highValue: null,
    reliability: "insufficient",
    reliabilitySignals: {
      compCount,
      compLevel: "weak",
      dispersion: null,
      dispersionLevel: "weak",
      sourceDiversity: 0,
      sourceLevel: "weak",
    },
    comps: [],
    targetPrice: parsed.priceTarget,
    message:
      "Échantillon insuffisant pour évaluer. Affinez la recherche ou élargissez les sources.",
  }
}

export function evaluateValue(
  queryText: string,
  categoryPath: string | null | undefined,
  hits: Hit[],
): ValuationResult {
  const categoryKey = deriveCategoryKey(categoryPath)
  const config = getDepreciationConfig(categoryKey)
  const parsed = parseValuationQuery(queryText, categoryKey)

  const baseFiltered = dedupeHits(hits)
    .filter((hit) => typeof hit.prix === "number" && hit.prix > 0)
    // Les hits passés ici sont déjà filtrés par pertinence textuelle côté
    // affichage. On garde des bornes raisonnables (année, km plausibles) sans
    // re-filtrer par score pour ne pas écarter des comparables visibles.
    .filter((hit) => {
      if (!parsed.year) return true
      if (hit.annee == null) return true
      return Math.abs(hit.annee - parsed.year) <= 3
    })
    .filter((hit) => plausibleMileage(hit, config.maxMileage))

  // Si l'utilisateur a précisé un trim/finition (Lariat, XLT, Platinum, etc.),
  // on ne garde QUE les comparables du même trim. Sinon on mélangerait un
  // F-150 XLT (50k$) avec un F-150 Platinum (100k$) et la fourchette n'a
  // aucun sens. Si rien ne reste, on retombe sur la liste non-filtrée mais
  // on signale via `reliabilitySignals` que la dispersion sera élevée.
  const targetTrimKeys = parsed.variantHints
  let filtered = baseFiltered
  let trimFilterApplied = false
  if (targetTrimKeys.length > 0) {
    const trimMatched = baseFiltered.filter((hit) => {
      const hitVariants = detectHitVariantKeys(hit, categoryKey)
      return targetTrimKeys.every((key) => hitVariants.includes(key))
    })
    if (trimMatched.length >= 3) {
      filtered = trimMatched
      trimFilterApplied = true
    }
    // Sinon (< 3 comparables avec ce trim) on garde la liste large pour ne
    // pas tomber en "insufficient" — l'utilisateur verra l'avertissement de
    // dispersion.
  }

  if (filtered.length < 3) return insufficient(parsed, categoryKey, filtered.length)

  const adjusted = filtered.map<AdjustedComparable>((hit) => {
    const adjustments = buildAdjustments(hit, parsed, categoryKey)
    const originalPrice = hit.prix || 0
    const adjustedPrice = combineAdjustments(originalPrice, adjustments, config, parsed, hit)
    return {
      ...hit,
      originalPrice,
      adjustedPrice,
      adjustments,
      similarityScore: similarityScore(hit, parsed, categoryKey),
      sourceDomain: sourceDomain(hit),
    }
  })

  // Filtre IQR adaptatif selon la taille de l'échantillon.
  //   - N < 6  : aucun filtre. Sur si peu de comparables, n'importe quel
  //              prix un peu décalé devient "outlier" alors qu'il représente
  //              probablement une vraie variation de marché (ex: dealer en
  //              liquidation, vendeur pressé) qu'on veut conserver.
  //   - 6 ≤ N < 10 : filtre permissif à 2.5×IQR. On commence à pouvoir
  //              détecter des vrais outliers (erreurs de saisie, modèles
  //              mal-taggés) mais on reste prudent.
  //   - N ≥ 10 : filtre standard à 1.5×IQR (Tukey).
  const prices = adjusted.map((comp) => comp.adjustedPrice)
  const rawMedian = percentile(prices, 0.5)
  const rawLow = percentile(prices, 0.25)
  const rawHigh = percentile(prices, 0.75)
  let withoutOutliers: AdjustedComparable[]
  if (adjusted.length < 6) {
    withoutOutliers = adjusted
  } else {
    const iqrMultiplier = adjusted.length < 10 ? 2.5 : 1.5
    const iqr = rawHigh - rawLow
    const outlierMin = rawMedian - iqrMultiplier * iqr
    const outlierMax = rawMedian + iqrMultiplier * iqr
    withoutOutliers = adjusted.filter(
      (comp) => comp.adjustedPrice >= outlierMin && comp.adjustedPrice <= outlierMax,
    )
  }

  if (withoutOutliers.length < 3) return insufficient(parsed, categoryKey, withoutOutliers.length)

  const rawLowValue = weightedPercentile(withoutOutliers, 0.25)
  const medianValue = weightedPercentile(withoutOutliers, 0.5)
  const rawHighValue = weightedPercentile(withoutOutliers, 0.75)

  // Spread minimum : on garantit que BAS ≤ médiane × 0.90 et HAUT ≥ médiane
  // × 1.10. Sans ça, quand tous les comparables sont tassés (ex: 4 annonces
  // du même modèle neuf au même prix de référence), le P25 et le P75
  // pondérés retombent sur la même valeur que la médiane et la fourchette
  // devient sémantiquement absurde (« vente rapide » = « prix juste » =
  // « prix ambitieux »). Le ±10% reflète la marge de négociation typique
  // sur du véhicule motorisé au Québec.
  const SPREAD_FLOOR = 0.10
  const lowValue = Math.min(rawLowValue, medianValue * (1 - SPREAD_FLOOR))
  const highValue = Math.max(rawHighValue, medianValue * (1 + SPREAD_FLOOR))
  const signals = reliabilitySignals(withoutOutliers, lowValue, medianValue, highValue)

  const baseMessage = `${withoutOutliers.length} comparables retenus, valeur estimée ${money(medianValue)}.`
  const trimNote = trimFilterApplied
    ? ` Filtré au trim demandé (${targetTrimKeys.join(", ")}).`
    : targetTrimKeys.length > 0
      ? ` Trim demandé non trouvé (${targetTrimKeys.join(", ")}) — comparables mélangés, fourchette indicative.`
      : ""

  return {
    status: "ok",
    parsed,
    categoryKey,
    lowValue,
    medianValue,
    highValue,
    reliability: reliabilityFromSignals(signals),
    reliabilitySignals: signals,
    comps: withoutOutliers,
    targetPrice: parsed.priceTarget,
    pricePosition: pricePosition(parsed.priceTarget, lowValue, medianValue, highValue),
    message: baseMessage + trimNote,
  }
}
