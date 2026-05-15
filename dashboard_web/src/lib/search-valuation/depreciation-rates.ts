import type { CategoryDepreciationConfig, DepreciationPhase } from "./types"

// Phases standard "berline / véhicule courant" : descente brutale la 1re année,
// stabilisation rapide ensuite, plateau après ~15 ans.
const STANDARD_PHASES: DepreciationPhase[] = [
  { untilYears: 1, yearlyRate: 0.25 },
  { untilYears: 3, yearlyRate: 0.15 },
  { untilYears: 7, yearlyRate: 0.10 },
  { untilYears: 15, yearlyRate: 0.06 },
  { untilYears: 100, yearlyRate: 0.03 },
]

// Phases motorisé sport (motocross, moto, motoneige) : 1re année moins brutale
// que pour une auto, ralentissement net après 3 ans.
const POWERSPORT_PHASES: DepreciationPhase[] = [
  { untilYears: 1, yearlyRate: 0.15 },
  { untilYears: 3, yearlyRate: 0.12 },
  { untilYears: 7, yearlyRate: 0.08 },
  { untilYears: 15, yearlyRate: 0.05 },
  { untilYears: 100, yearlyRate: 0.03 },
]

// Phases pickup / VUS : tiennent mieux leur valeur dans la première année.
const TRUCK_SUV_PHASES: DepreciationPhase[] = [
  { untilYears: 1, yearlyRate: 0.18 },
  { untilYears: 3, yearlyRate: 0.12 },
  { untilYears: 7, yearlyRate: 0.08 },
  { untilYears: 15, yearlyRate: 0.05 },
  { untilYears: 100, yearlyRate: 0.03 },
]

export const DEFAULT_DEPRECIATION_CONFIG: CategoryDepreciationConfig = {
  phases: STANDARD_PHASES,
  mileageUnit: "km",
  expectedKmPerYear: 18_000,
  quasiNewMileage: 500,
  maxMileage: 400_000,
  newToUsedFactor: 0.78,
  minPriceFactor: 0.10,
  maxPriceFactor: 1.20,
}

export const DEPRECIATION_CONFIGS: Record<string, CategoryDepreciationConfig> = {
  // ───── Catégories mesurées en KILOMÈTRES ─────
  moto: {
    ...DEFAULT_DEPRECIATION_CONFIG,
    phases: POWERSPORT_PHASES,
    mileageUnit: "km",
    expectedKmPerYear: 5_000,
    maxMileage: 200_000,
    newToUsedFactor: 0.82,
  },
  motoneige: {
    ...DEFAULT_DEPRECIATION_CONFIG,
    phases: POWERSPORT_PHASES,
    mileageUnit: "km",
    expectedKmPerYear: 4_000,
    maxMileage: 60_000,
    newToUsedFactor: 0.80,
  },
  auto: {
    ...DEFAULT_DEPRECIATION_CONFIG,
    phases: STANDARD_PHASES,
    mileageUnit: "km",
    expectedKmPerYear: 18_000,
    maxMileage: 500_000,
    newToUsedFactor: 0.75,
  },
  pickup: {
    ...DEFAULT_DEPRECIATION_CONFIG,
    phases: TRUCK_SUV_PHASES,
    mileageUnit: "km",
    expectedKmPerYear: 20_000,
    maxMileage: 500_000,
    newToUsedFactor: 0.82,
  },
  vus: {
    ...DEFAULT_DEPRECIATION_CONFIG,
    phases: TRUCK_SUV_PHASES,
    mileageUnit: "km",
    expectedKmPerYear: 18_000,
    maxMileage: 500_000,
    newToUsedFactor: 0.82,
  },

  // ───── Catégories mesurées en HEURES MOTEUR ─────
  // Hypothèses calibrées sur le marché Québec/Canada :
  //   - VTT/SxS : usage récréatif 80–120 h/an typique, quasi-neuf < 20 h,
  //     plafond 3 000 h (au-delà = usage commercial atypique).
  //   - Bateau : 40–80 h/an typique (saison courte 5 mois), quasi-neuf < 15 h,
  //     plafond 3 000 h.
  vtt: {
    ...DEFAULT_DEPRECIATION_CONFIG,
    phases: POWERSPORT_PHASES,
    mileageUnit: "h",
    expectedKmPerYear: 100,
    quasiNewMileage: 20,
    maxMileage: 3_000,
    newToUsedFactor: 0.80,
  },
  sxs: {
    ...DEFAULT_DEPRECIATION_CONFIG,
    phases: POWERSPORT_PHASES,
    mileageUnit: "h",
    expectedKmPerYear: 100,
    quasiNewMileage: 20,
    maxMileage: 3_000,
    newToUsedFactor: 0.80,
  },
  nautique: {
    ...DEFAULT_DEPRECIATION_CONFIG,
    phases: POWERSPORT_PHASES,
    mileageUnit: "h",
    expectedKmPerYear: 60,
    quasiNewMileage: 15,
    maxMileage: 3_000,
    newToUsedFactor: 0.82,
  },
}

export function getDepreciationConfig(categoryKey: string): CategoryDepreciationConfig {
  return DEPRECIATION_CONFIGS[categoryKey] || DEFAULT_DEPRECIATION_CONFIG
}

/**
 * Extrait la clé courte depuis un `categoryPath` complet
 * (ex: `"vehicule.moto"` → `"moto"`, `"vehicule.auto.pickup"` → `"pickup"`).
 * Identique à `deriveCategoryKey()` de `evaluate-value.ts` mais exposé ici
 * pour les composants UI qui n'ont pas besoin de toute la logique de valuation.
 */
export function categoryKeyFromPath(
  categoryPath: string | null | undefined,
): string {
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

/**
 * Retourne l'unité d'usage moteur pour une catégorie donnée.
 *   `"vehicule.moto"` → `"km"`
 *   `"vehicule.nautique"` → `"h"`
 *   `null` / catégorie inconnue → `"km"` (défaut)
 */
export function mileageUnitForCategory(
  categoryPath: string | null | undefined,
): "km" | "h" {
  return getDepreciationConfig(categoryKeyFromPath(categoryPath)).mileageUnit
}
