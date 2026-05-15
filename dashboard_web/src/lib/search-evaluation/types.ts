import type { SearchHit } from "@/components/product-search/types"

export type Hit = SearchHit

export interface ParsedEvaluationQuery {
  rawText: string
  year?: number
  mileage?: number
  priceTarget?: number
  condition?: "new" | "used"
  variantHints: string[]
}

export interface EvaluationBreakdown {
  text: number
  year: number
  mileage: number
  price: number
  variant: number
}

export interface ScoredHit extends Hit {
  evalScore: number
  breakdown: EvaluationBreakdown
  isDeal: boolean
  priceVsMedian: number
}

export interface Weights {
  text: number
  year: number
  mileage: number
  price: number
  variant: number
}

export const DEFAULT_WEIGHTS: Weights = {
  text: 0.35,
  year: 0.20,
  mileage: 0.15,
  price: 0.15,
  variant: 0.15,
}
