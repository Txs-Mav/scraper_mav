import type { ParsedEvaluationQuery } from "./types"

const VARIANT_KEYWORDS = [
  "grande roue",
  "petite roue",
  "premium",
  "eps",
  "xp",
  "xrt",
  "17/14",
  "19/16",
  "sport",
  "base",
  "crew",
  "ltd",
  "limited",
  "turbo",
  "rmax",
  "xmr",
  "tracker",
  "xt",
  "xtp",
]

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parseNumber(value: string): number {
  return Number.parseInt(value.replace(/[\s,]/g, ""), 10)
}

export function parseEvaluationQuery(input: string): ParsedEvaluationQuery {
  let text = ` ${normalizeText(input || "")} `
  const out: ParsedEvaluationQuery = { rawText: "", variantHints: [] }

  if (/\b(neuf|nouveau|new)\b/.test(text)) {
    out.condition = "new"
    text = text.replace(/\b(neuf|nouveau|new)\b/g, " ")
  } else if (/\b(usage|used|occasion)\b/.test(text)) {
    out.condition = "used"
    text = text.replace(/\b(usage|used|occasion)\b/g, " ")
  }

  const year = text.match(/\b(19[9]\d|20[0-3]\d)\b/)
  if (year) {
    out.year = Number.parseInt(year[1], 10)
    text = text.replace(year[0], " ")
  }

  // Usage moteur : km (auto/moto/scooter/motoneige) OU heures (bateau/VTT/SxS).
  // Le pré-filtrage textuel ne se soucie pas de l'unité, mais doit retirer le
  // suffixe pour ne pas le passer comme token dans `tokenizeCoreText`.
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

  for (const keyword of VARIANT_KEYWORDS) {
    if (text.includes(keyword)) {
      out.variantHints.push(keyword)
      text = text.split(keyword).join(" ")
    }
  }

  out.rawText = text.replace(/\s+/g, " ").trim()
  return out
}
