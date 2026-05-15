import type { SearchHit } from "@/components/product-search/types"

export type Hit = SearchHit

export type VehicleCondition = "new" | "used"
export type ValuationReliability = "good" | "indicative" | "low" | "insufficient"
export type AdjustmentType = "year" | "mileage" | "variant" | "condition" | "dealer"

/**
 * Unité d'usage moteur pour une catégorie de véhicule.
 *  - "km" : voitures, motos, scooters, motoneiges (au Québec, mesuré en km)
 *  - "h"  : bateaux, VTT, SxS (mesuré en heures moteur)
 */
export type MileageUnit = "km" | "h"

export interface ParsedValuationQuery {
  rawText: string
  modelText: string
  year?: number
  mileage?: number
  priceTarget?: number
  variantHints: string[]
  condition?: VehicleCondition
}

export interface DepreciationPhase {
  // Phase s'applique jusqu'à cet âge (en années depuis neuf)
  untilYears: number
  // Taux de dépréciation annuel multiplicatif (ex: 0.20 = -20%/an dans la phase)
  yearlyRate: number
}

export interface CategoryDepreciationConfig {
  // Phases de dépréciation temporelle non linéaires (multiplicatives)
  phases: DepreciationPhase[]
  // Unité d'usage moteur : "km" pour auto/moto/scooter/motoneige,
  // "h" pour bateau/VTT/SxS. Définit comment afficher et parser la valeur
  // "mileage" — la valeur numérique reste neutre (ratio target/comp).
  mileageUnit: MileageUnit
  // Usage moteur typique par an pour un usage "normal" (Canada).
  // En km/an pour les catégories "km", en heures/an pour les catégories "h".
  expectedKmPerYear: number
  // En-dessous, on traite le véhicule comme quasi-neuf (pas de pénalité usage)
  quasiNewMileage: number
  // Plafond plausible pour rejeter les valeurs aberrantes
  maxMileage: number
  // Facteur appliqué quand comp est neuf et cible usagée (perte garantie/incertitude)
  newToUsedFactor: number
  // Plancher de valeur résiduelle (ratio du prix comparable)
  minPriceFactor: number
  // Plafond de valeur (ratio du prix comparable)
  maxPriceFactor: number
}

export interface Adjustment {
  type: AdjustmentType
  // Facteur multiplicatif appliqué au prix comparable (1.0 = neutre).
  // Optionnel pour les ajustements purement additifs (ex: variantes).
  factor?: number
  // Impact en dollars signé (positif = augmente la valeur cible)
  amount: number
  reason: string
}

export interface AdjustedComparable extends Hit {
  adjustedPrice: number
  originalPrice: number
  adjustments: Adjustment[]
  similarityScore: number
  sourceDomain: string
}

export interface ReliabilitySignals {
  compCount: number
  compLevel: "good" | "medium" | "weak"
  dispersion: number | null
  dispersionLevel: "good" | "medium" | "weak"
  sourceDiversity: number
  sourceLevel: "good" | "medium" | "weak"
}

export interface PricePosition {
  label: "Sous le marché" | "Aligné au marché" | "Au-dessus du marché" | "Hors marché"
  percentVsMedian: number
  markerPercent: number
}

export interface ValuationResult {
  status: "ok" | "insufficient"
  parsed: ParsedValuationQuery
  categoryKey: string
  lowValue: number | null
  medianValue: number | null
  highValue: number | null
  reliability: ValuationReliability
  reliabilitySignals: ReliabilitySignals
  comps: AdjustedComparable[]
  targetPrice?: number
  pricePosition?: PricePosition
  message?: string
}
