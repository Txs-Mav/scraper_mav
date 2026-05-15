import { getVariantPremiums } from "./variant-premiums"
import type { ParsedValuationQuery, VehicleCondition } from "./types"

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseNumber(value: string): number {
  return Number.parseInt(value.replace(/[\s,]/g, ""), 10)
}

function detectCondition(text: string): VehicleCondition | undefined {
  if (/\b(neuf|neuve|new)\b/.test(text)) return "new"
  if (/\b(usage|usagé|usagée|occasion|used|pre owned|preowned)\b/.test(text)) return "used"
  return undefined
}

export function parseValuationQuery(input: string, categoryKey: string): ParsedValuationQuery {
  let text = ` ${normalizeText(input || "")} `
  const out: ParsedValuationQuery = { rawText: input || "", modelText: "", variantHints: [] }

  const condition = detectCondition(text)
  if (condition) {
    out.condition = condition
    text = text.replace(/\b(neuf|neuve|new|usage|usagé|usagée|occasion|used|pre owned|preowned)\b/g, " ")
  }

  const year = text.match(/\b(19[9]\d|20[0-3]\d)\b/)
  if (year) {
    out.year = Number.parseInt(year[1], 10)
    text = text.replace(year[0], " ")
  }

  // Le champ "usage moteur" peut être exprimé en km (auto/moto/scooter/
  // motoneige) ou en heures (bateau/VTT/SxS). La valeur numérique stockée
  // dans `out.mileage` est neutre côté unité — c'est `evaluate-value.ts`
  // qui interprète selon `mileageUnit` de la config catégorie.
  //
  // Suffixes reconnus :
  //   - km  : "km", "kilometres", "kilomètres"
  //   - k   : "10k" → 10 000 (km uniquement, conservation du legacy)
  //   - h   : "h", "hr", "hrs", "hours", "heures"
  const mileage = text.match(
    /(\d[\d\s,]*)\s*(km|kilometres?|k\b|hours?|h\b|hrs?|heures?)/,
  )
  if (mileage) {
    const parsedMileage = parseNumber(mileage[1])
    out.mileage = mileage[2] === "k" ? parsedMileage * 1000 : parsedMileage
    text = text.replace(mileage[0], " ")
  }

  const price = text.match(/(\d[\d\s,]{2,})\s*\$|\$\s*(\d[\d\s,]{2,})/)
  if (price) {
    out.priceTarget = parseNumber(price[1] || price[2])
    text = text.replace(price[0], " ")
  }

  // Détection d'aliases avec word boundaries pour éviter les faux positifs
  // entre trims courts (`lt` ↔ `xlt`, `rs` ↔ rrs, `n` ↔ words contenant n).
  // Les alias avec espaces explicites (" lt ") sont matchés en préservant ces
  // espaces ; sinon on force `\b…\b`.
  const aliasMatches = (alias: string): boolean => {
    const wantsLeading = alias.startsWith(" ")
    const wantsTrailing = alias.endsWith(" ")
    const inner = normalizeText(alias)
    if (!inner) return false
    if (wantsLeading || wantsTrailing) {
      const needle = (wantsLeading ? " " : "") + inner + (wantsTrailing ? " " : "")
      return text.includes(needle)
    }
    const escaped = inner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`\\b${escaped}\\b`).test(text)
  }

  for (const variant of getVariantPremiums(categoryKey)) {
    if (variant.aliases.some((alias) => aliasMatches(alias))) {
      out.variantHints.push(variant.key)
      for (const alias of variant.aliases) {
        const inner = normalizeText(alias)
        if (inner) text = text.split(inner).join(" ")
      }
    }
  }

  if (!out.condition && out.mileage != null && out.mileage > 0) {
    out.condition = "used"
  }

  out.modelText = text.replace(/\s+/g, " ").trim()
  return out
}
