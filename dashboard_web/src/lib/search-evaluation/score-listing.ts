import type {
  EvaluationBreakdown,
  Hit,
  ParsedEvaluationQuery,
  ScoredHit,
  Weights,
} from "./types"
import { DEFAULT_WEIGHTS } from "./types"

const BREAKDOWN_KEYS: Array<keyof EvaluationBreakdown> = [
  "text",
  "year",
  "mileage",
  "price",
  "variant",
]

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeEtat(value?: string | null): string {
  return normalizeText(value || "")
}

function tokenizeCoreText(value: string): string[] {
  const tokens = normalizeText(value).match(/[a-z]+|\d+/g) || []
  return tokens.filter((token) => token.length >= 2)
}

function coreTextMatches(query: ParsedEvaluationQuery, hit: Hit): boolean {
  const queryTokens = tokenizeCoreText(query.rawText)
  if (queryTokens.length === 0) return true

  const haystack = normalizeText([
    hit.name,
    hit.marque,
    hit.modele,
  ].filter(Boolean).join(" "))
  const haystackCompact = haystack.replace(/\s+/g, "")

  const matched = queryTokens.filter((token) => {
    if (/^\d+$/.test(token)) {
      return new RegExp(`(^|\\D)${token}(\\D|$)`).test(haystack)
    }
    return haystack.includes(token) || haystackCompact.includes(token)
  }).length

  const hasNumericToken = queryTokens.some((token) => /^\d+$/.test(token))
  const requiredRatio = hasNumericToken && queryTokens.length <= 4 ? 1 : 0.6
  return matched / queryTokens.length >= requiredRatio
}

function scoreYear(target?: number, value?: number | null): number {
  if (!target) return 50
  if (value == null) return 30
  return clampScore(100 - Math.abs(target - value) * 15)
}

function scoreMileage(target?: number, value?: number | null, etat?: string | null): number {
  if (target == null) return 50
  const normalizedEtat = normalizeEtat(etat)
  if (normalizedEtat === "neuf" || normalizedEtat === "new") {
    return target < 500 ? 100 : 60
  }
  if (value == null) return target < 500 ? 90 : 60
  return clampScore(100 - Math.abs(target - value) / 500)
}

function scorePrice(target: number | undefined, price: number | null, median: number | null): number {
  if (!price || price <= 0) return 40
  if (target && target > 0) {
    const distance = Math.abs(target - price) / target
    return clampScore(100 - distance * 100)
  }
  if (!median || median <= 0) return 50
  const distance = Math.abs(1 - price / median)
  return clampScore(100 - distance * 100)
}

function scoreVariant(hints: string[], title: string): number {
  if (hints.length === 0) return 50
  const normalizedTitle = normalizeText(title)
  const compactTitle = normalizedTitle.replace(/\s+/g, "")
  const equivalents: Record<string, RegExp> = {
    "grande roue": /19\s*\/?\s*16|grande\s+roue/,
    "petite roue": /17\s*\/?\s*14|petite\s+roue/,
  }

  const matched = hints.filter((hint) => {
    const normalizedHint = normalizeText(hint)
    const compactHint = normalizedHint.replace(/\s+/g, "")
    const equivalent = equivalents[normalizedHint]
    if (equivalent?.test(normalizedTitle)) return true
    return normalizedTitle.includes(normalizedHint) || compactTitle.includes(compactHint)
  }).length

  return clampScore((matched / hints.length) * 100)
}

function median(nums: number[]): number | null {
  if (nums.length < 2) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function normalizeWeights(weights: Weights): Weights {
  const total = Math.max(
    0.001,
    BREAKDOWN_KEYS.reduce((sum, key) => sum + Math.max(0, weights[key] || 0), 0),
  )
  return {
    text: Math.max(0, weights.text || 0) / total,
    year: Math.max(0, weights.year || 0) / total,
    mileage: Math.max(0, weights.mileage || 0) / total,
    price: Math.max(0, weights.price || 0) / total,
    variant: Math.max(0, weights.variant || 0) / total,
  }
}

export function scoreHits(
  query: ParsedEvaluationQuery,
  hits: Hit[],
  weights: Weights = DEFAULT_WEIGHTS,
): ScoredHit[] {
  const relevantHits = hits.filter((hit) => coreTextMatches(query, hit))
  const prices = relevantHits
    .map((hit) => hit.prix)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0)
  const medianPrice = median(prices)
  const normalizedWeights = normalizeWeights({
    ...weights,
    // Le prix sert à l'évaluation de valeur, pas à la pertinence du listing.
    price: 0,
    mileage: query.condition === "used" && query.mileage != null ? weights.mileage : 0,
  })

  return relevantHits
    .map<ScoredHit>((hit) => {
      const breakdown: EvaluationBreakdown = {
        text: clampScore((hit.score ?? 0) * 100),
        year: scoreYear(query.year, hit.annee),
        mileage: scoreMileage(query.mileage, hit.kilometrage, hit.etat),
        price: scorePrice(query.priceTarget, hit.prix, medianPrice),
        variant: scoreVariant(query.variantHints, hit.name),
      }
      const evalScore = clampScore(
        breakdown.text * normalizedWeights.text +
        breakdown.year * normalizedWeights.year +
        breakdown.mileage * normalizedWeights.mileage +
        breakdown.price * normalizedWeights.price +
        breakdown.variant * normalizedWeights.variant,
      )
      const priceVsMedian = hit.prix && medianPrice ? hit.prix / medianPrice - 1 : 0
      const isDeal = evalScore >= 70 && Boolean(hit.prix && medianPrice && priceVsMedian <= -0.08)

      return { ...hit, evalScore, breakdown, isDeal, priceVsMedian }
    })
    .sort((a, b) => b.evalScore - a.evalScore)
}
