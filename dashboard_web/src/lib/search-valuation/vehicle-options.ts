/**
 * Catalogue d'options/équipements toggleables pour l'évaluation de véhicules.
 *
 * Ces options apparaissent comme des chips dans le bloc « Évaluer un véhicule »
 * et permettent à l'utilisateur de préciser le package (501A vs 502A), le
 * moteur (2.7L vs 3.5L vs 5.0L) et les équipements clés (cuir, toit ouvrant,
 * cruise adaptatif, attache-remorque…).
 *
 * Chaque option déclare un `alias` qui sera injecté dans le `valuationQueryText`
 * passé à `parseValuationQuery`. La détection automatique repose sur les
 * `aliases` déclarés dans `variant-premiums.ts` — il faut donc que les chaînes
 * cohérence soit conservée entre les deux fichiers.
 *
 * Le `premium` n'est PAS appliqué directement à la valuation (qui s'appuie
 * sur `variant-premiums.ts`) — il sert UNIQUEMENT à l'affichage du badge
 * « +X $ » à côté de chaque toggle dans l'UI.
 */

export type OptionGroup = "engine" | "package" | "drivetrain" | "equipment"

export interface VehicleOption {
  /** Identifiant unique stocké dans le state utilisateur. */
  key: string
  /** Libellé affiché dans le chip. */
  label: string
  /**
   * Texte injecté dans `valuationQueryText` quand l'option est cochée.
   * Doit correspondre à un alias dans `variant-premiums.ts` pour être pris en
   * compte par l'algo de valuation.
   */
  alias: string
  /** Ordre de grandeur du premium ($ CAD), pour affichage uniquement. */
  premium: number
  /** Catégorie pour le regroupement visuel. */
  group: OptionGroup
  /**
   * Préfixes de catégories où cette option apparaît (ex: `["vehicule.auto"]`).
   * Si vide ou non spécifié, l'option apparaît partout dans le scope véhicule.
   */
  appliesTo?: string[]
  /**
   * Marques auxquelles l'option s'applique (case-insensitive). Vide/absent
   * = option générique, visible pour toutes les marques détectées (ou aucune).
   * Exemple : packages 502A et FX4 → `["ford"]`, Z71 → `["chevrolet", "gmc"]`.
   */
  appliesToMakes?: string[]
}

export const OPTION_GROUP_LABELS: Record<OptionGroup, string> = {
  engine: "Moteur",
  package: "Package",
  drivetrain: "Drivetrain",
  equipment: "Équipement",
}

// ---------------------------------------------------------------------------
// AUTO / PICKUP / VUS
// ---------------------------------------------------------------------------
//
// Premiums calibrés sur le marché Québec/Canada (Ford F-150, Silverado,
// RAM 1500, Tundra…). On reste sur des ordres de grandeur — l'objectif est
// de matcher proprement les comparables, pas d'avoir une précision au $.

const AUTO_OPTIONS: VehicleOption[] = [
  // ════════════════════════════════════════════════════════════════════
  // FORD
  // ════════════════════════════════════════════════════════════════════
  // Moteurs Ford
  { key: "engine-2.7-ecoboost", label: "2.7L V6 EcoBoost", alias: "2 7l ecoboost", premium: 0, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "engine-3.5-ecoboost", label: "3.5L V6 EcoBoost", alias: "3 5l ecoboost", premium: 2000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "engine-5.0-v8", label: "5.0L V8 Coyote", alias: "5 0l v8", premium: 3000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "engine-powerboost", label: "PowerBoost Hybrid", alias: "powerboost", premium: 5000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "engine-7.3-godzilla", label: "7.3L V8 Godzilla", alias: "7 3l v8", premium: 4500, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "engine-powerstroke", label: "PowerStroke Diesel", alias: "powerstroke", premium: 9000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },

  // Packages Ford (101A→502A — différence majeure de valeur)
  { key: "pkg-101a", label: "Package 101A", alias: "101a", premium: 0, group: "package", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "pkg-201a", label: "Package 201A", alias: "201a", premium: 800, group: "package", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "pkg-301a", label: "Package 301A", alias: "301a", premium: 1500, group: "package", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "pkg-302a", label: "Package 302A", alias: "302a", premium: 2500, group: "package", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "pkg-401a", label: "Package 401A", alias: "401a", premium: 3500, group: "package", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "pkg-501a", label: "Package 501A", alias: "501a", premium: 5000, group: "package", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "pkg-502a", label: "Package 502A", alias: "502a", premium: 8000, group: "package", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "pkg-600a", label: "Package 600A", alias: "600a", premium: 6000, group: "package", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },

  // Drivetrain Ford
  { key: "fx4", label: "FX4 Off-Road", alias: "fx4", premium: 1500, group: "drivetrain", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "tremor-pkg", label: "Tremor Package", alias: "tremor", premium: 5000, group: "drivetrain", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },

  // Cabines Ford
  { key: "supercrew", label: "SuperCrew (4 portes)", alias: "supercrew", premium: 3000, group: "equipment", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },
  { key: "supercab", label: "SuperCab", alias: "supercab", premium: 1500, group: "equipment", appliesTo: ["vehicule.auto"], appliesToMakes: ["ford"] },

  // ════════════════════════════════════════════════════════════════════
  // CHEVROLET / GMC
  // ════════════════════════════════════════════════════════════════════
  { key: "engine-duramax", label: "Duramax Diesel", alias: "duramax", premium: 8000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["chevrolet", "chevy", "gmc"] },
  { key: "engine-5.3-v8", label: "5.3L V8", alias: "5 3l v8", premium: 2500, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["chevrolet", "chevy", "gmc"] },
  { key: "engine-6.2-v8", label: "6.2L V8", alias: "6 2l v8", premium: 4000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["chevrolet", "chevy", "gmc", "ford"] },
  { key: "z71", label: "Z71 Off-Road", alias: "z71", premium: 1500, group: "drivetrain", appliesTo: ["vehicule.auto"], appliesToMakes: ["chevrolet", "chevy", "gmc"] },
  { key: "crew-cab-gm", label: "Crew Cab", alias: "crew cab", premium: 2500, group: "equipment", appliesTo: ["vehicule.auto"], appliesToMakes: ["chevrolet", "chevy", "gmc"] },
  { key: "double-cab", label: "Double Cab", alias: "double cab", premium: 1500, group: "equipment", appliesTo: ["vehicule.auto"], appliesToMakes: ["chevrolet", "chevy", "gmc"] },

  // ════════════════════════════════════════════════════════════════════
  // RAM (Dodge)
  // ════════════════════════════════════════════════════════════════════
  { key: "engine-hemi", label: "Hemi 5.7L V8", alias: "hemi", premium: 3500, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ram", "dodge"] },
  { key: "engine-hemi-6-4", label: "Hemi 6.4L V8", alias: "6 4l hemi", premium: 5500, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ram", "dodge"] },
  { key: "engine-cummins", label: "Cummins Diesel", alias: "cummins", premium: 8000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ram", "dodge"] },
  { key: "engine-pentastar", label: "Pentastar 3.6L V6", alias: "pentastar", premium: 0, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ram", "dodge", "jeep"] },
  { key: "engine-ecodiesel", label: "EcoDiesel V6", alias: "ecodiesel", premium: 6000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["ram", "dodge", "jeep"] },
  { key: "quad-cab", label: "Quad Cab", alias: "quad cab", premium: 2000, group: "equipment", appliesTo: ["vehicule.auto"], appliesToMakes: ["ram", "dodge"] },
  { key: "mega-cab", label: "Mega Cab", alias: "mega cab", premium: 3000, group: "equipment", appliesTo: ["vehicule.auto"], appliesToMakes: ["ram", "dodge"] },

  // ════════════════════════════════════════════════════════════════════
  // TOYOTA
  // ════════════════════════════════════════════════════════════════════
  { key: "engine-i-force-max", label: "i-Force Max Hybrid", alias: "i force max", premium: 4000, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["toyota"] },
  { key: "engine-2gr-fks", label: "3.5L V6", alias: "3 5l v6 toyota", premium: 1500, group: "engine", appliesTo: ["vehicule.auto"], appliesToMakes: ["toyota"] },

  // ════════════════════════════════════════════════════════════════════
  // NISSAN
  // ════════════════════════════════════════════════════════════════════
  { key: "king-cab", label: "King Cab", alias: "king cab", premium: 1500, group: "equipment", appliesTo: ["vehicule.auto"], appliesToMakes: ["nissan"] },

  // ════════════════════════════════════════════════════════════════════
  // GÉNÉRIQUES (toutes marques)
  // ════════════════════════════════════════════════════════════════════
  // Drivetrain générique
  { key: "4x4", label: "4x4 / 4WD", alias: "4x4", premium: 2500, group: "drivetrain", appliesTo: ["vehicule.auto"] },
  { key: "awd", label: "AWD", alias: "awd", premium: 1800, group: "drivetrain", appliesTo: ["vehicule.auto"] },

  // Motorisations universelles
  { key: "engine-hybrid-generic", label: "Hybride", alias: "hybrid hybride", premium: 3000, group: "engine", appliesTo: ["vehicule.auto"] },
  { key: "engine-plug-in", label: "Plug-in Hybrid", alias: "plug in hybrid phev", premium: 5000, group: "engine", appliesTo: ["vehicule.auto"] },
  { key: "engine-electric", label: "Électrique (EV)", alias: "electric ev", premium: 6000, group: "engine", appliesTo: ["vehicule.auto"] },

  // Équipement intérieur (toutes marques)
  { key: "leather", label: "Cuir", alias: "cuir leather", premium: 1000, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "heated-seats", label: "Sièges chauffants", alias: "heated seats sieges chauffants", premium: 400, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "ventilated-seats", label: "Sièges ventilés", alias: "ventilated cooled seats", premium: 600, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "moonroof", label: "Toit ouvrant", alias: "moonroof sunroof toit ouvrant", premium: 1500, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "panoramic-roof", label: "Toit panoramique", alias: "panoramic roof toit panoramique", premium: 2200, group: "equipment", appliesTo: ["vehicule.auto"] },

  // Technologie universelle
  { key: "nav", label: "GPS Navigation", alias: "navigation nav", premium: 500, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "adaptive-cruise", label: "Cruise adaptatif", alias: "adaptive cruise", premium: 700, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "blind-spot", label: "Angles morts", alias: "blind spot bsm", premium: 400, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "360-camera", label: "Caméra 360°", alias: "360 camera", premium: 800, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "head-up", label: "Affichage tête haute", alias: "head up display", premium: 600, group: "equipment", appliesTo: ["vehicule.auto"] },

  // Utilitaire / remorquage générique
  { key: "tow-pkg", label: "Trailer Tow Package", alias: "tow trailer", premium: 1200, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "max-tow", label: "Max Tow Package", alias: "max tow", premium: 1800, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "bedliner", label: "Bedliner", alias: "bedliner spray", premium: 400, group: "equipment", appliesTo: ["vehicule.auto"] },
  { key: "running-boards", label: "Marchepieds", alias: "running boards marchepieds", premium: 500, group: "equipment", appliesTo: ["vehicule.auto"] },
]

// ---------------------------------------------------------------------------
// MOTO
// ---------------------------------------------------------------------------

const MOTO_OPTIONS: VehicleOption[] = [
  { key: "moto-grande-roue", label: "Grande roue 19/16", alias: "grande roue 19 16", premium: 300, group: "equipment", appliesTo: ["vehicule.moto"] },
  { key: "moto-factory", label: "Factory Edition", alias: "factory edition", premium: 1200, group: "package", appliesTo: ["vehicule.moto"] },
  { key: "moto-heritage", label: "Heritage", alias: "heritage", premium: 500, group: "package", appliesTo: ["vehicule.moto"] },
]

// ---------------------------------------------------------------------------
// VTT / SXS
// ---------------------------------------------------------------------------

const POWERSPORT_OPTIONS: VehicleOption[] = [
  { key: "ps-eps", label: "EPS (direction assistée)", alias: "eps", premium: 500, group: "equipment", appliesTo: ["vehicule.vtt", "vehicule.sxs"] },
  { key: "ps-winch", label: "Treuil", alias: "treuil winch", premium: 600, group: "equipment", appliesTo: ["vehicule.vtt", "vehicule.sxs"] },
  { key: "ps-roof", label: "Toit", alias: "toit roof", premium: 700, group: "equipment", appliesTo: ["vehicule.sxs"] },
  { key: "ps-windshield", label: "Pare-brise", alias: "pare brise windshield", premium: 400, group: "equipment", appliesTo: ["vehicule.vtt", "vehicule.sxs"] },
  { key: "ps-tracks", label: "Chenilles", alias: "chenilles tracks", premium: 2500, group: "equipment", appliesTo: ["vehicule.vtt", "vehicule.sxs"] },
  { key: "ps-turbo", label: "Turbo", alias: "turbo", premium: 2500, group: "engine", appliesTo: ["vehicule.vtt", "vehicule.sxs", "vehicule.motoneige"] },
]

// ---------------------------------------------------------------------------
// MOTONEIGE
// ---------------------------------------------------------------------------

const MOTONEIGE_OPTIONS: VehicleOption[] = [
  { key: "sled-turbo", label: "Turbo", alias: "turbo", premium: 2500, group: "engine", appliesTo: ["vehicule.motoneige"] },
  { key: "sled-xrs", label: "X-RS", alias: "x rs xrs", premium: 1200, group: "package", appliesTo: ["vehicule.motoneige"] },
  { key: "sled-adrenaline", label: "Adrenaline", alias: "adrenaline", premium: 1200, group: "package", appliesTo: ["vehicule.motoneige"] },
]

export const VEHICLE_OPTIONS: VehicleOption[] = [
  ...AUTO_OPTIONS,
  ...MOTO_OPTIONS,
  ...POWERSPORT_OPTIONS,
  ...MOTONEIGE_OPTIONS,
]

/**
 * Retourne la liste des options applicables à un chemin de catégorie donné.
 * Exemple : `optionsForCategory("vehicule.auto")` renvoie les options auto.
 */
export function optionsForCategory(categoryPath: string | null | undefined): VehicleOption[] {
  if (!categoryPath) return []
  return VEHICLE_OPTIONS.filter((opt) => {
    if (!opt.appliesTo || opt.appliesTo.length === 0) return true
    return opt.appliesTo.some(
      (prefix) => categoryPath === prefix || categoryPath.startsWith(prefix + "."),
    )
  })
}

/**
 * Marques connues. La 1re forme dans chaque tableau est la forme canonique
 * (utilisée pour le matching `appliesToMakes`), les suivantes sont des
 * alias/synonymes/erreurs courantes.
 *
 * L'ordre privilégie les marques les plus courantes au Québec pour
 * accélérer la détection sur les queries fréquentes.
 */
const KNOWN_MAKES: ReadonlyArray<readonly [string, ...string[]]> = [
  ["ford", "ford"],
  ["chevrolet", "chevrolet", "chevy"],
  ["gmc", "gmc"],
  ["ram", "ram"],
  ["dodge", "dodge"],
  ["toyota", "toyota"],
  ["honda", "honda"],
  ["hyundai", "hyundai"],
  ["kia", "kia"],
  ["nissan", "nissan"],
  ["mazda", "mazda"],
  ["subaru", "subaru"],
  ["jeep", "jeep"],
  ["volkswagen", "volkswagen", "vw"],
  ["audi", "audi"],
  ["bmw", "bmw"],
  ["mercedes", "mercedes", "mercedes-benz", "benz"],
  ["lexus", "lexus"],
  ["acura", "acura"],
  ["infiniti", "infiniti"],
  ["tesla", "tesla"],
  ["mitsubishi", "mitsubishi"],
  ["chrysler", "chrysler"],
  ["lincoln", "lincoln"],
  ["cadillac", "cadillac"],
  ["buick", "buick"],
  ["volvo", "volvo"],
  ["porsche", "porsche"],
  ["land rover", "land rover", "landrover", "range rover", "range-rover"],
  ["mini", "mini"],
  ["genesis", "genesis"],
  ["fiat", "fiat"],
]

function normalizeQueryText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Détecte la marque mentionnée dans une query libre. Renvoie la forme
 * canonique (ex: "ford", "chevrolet"), ou `null` si aucune marque connue
 * n'a été trouvée.
 *
 * L'utilité : afficher dynamiquement les chips d'options spécifiques à la
 * marque (packages Ford 502A / FX4, Z71 pour Chevrolet, Cummins pour RAM…)
 * au fur et à mesure que l'utilisateur tape sa recherche.
 */
export function detectMakeFromQuery(query: string | null | undefined): string | null {
  if (!query || !query.trim()) return null
  const text = ` ${normalizeQueryText(query)} `
  for (const [canonical, ...aliases] of KNOWN_MAKES) {
    for (const alias of aliases) {
      if (text.includes(` ${alias} `)) return canonical
    }
  }
  return null
}

/**
 * Variante de `optionsForCategory` qui filtre aussi par marque détectée.
 *
 * Règles d'affichage :
 *   1. Si AUCUNE marque n'est détectée → affiche uniquement les options
 *      génériques (sans `appliesToMakes`). Ainsi on ne pollue pas l'UI avec
 *      des packages Ford alors que l'utilisateur n'a pas encore tapé sa
 *      marque.
 *   2. Si UNE marque est détectée → affiche les options génériques + les
 *      options propres à cette marque.
 *
 * Les options déclarant `appliesToMakes` pour une autre marque sont
 * exclues.
 */
export function optionsForVehicle(
  categoryPath: string | null | undefined,
  query: string | null | undefined,
): VehicleOption[] {
  const baseOptions = optionsForCategory(categoryPath)
  const detectedMake = detectMakeFromQuery(query)

  return baseOptions.filter((opt) => {
    const makes = opt.appliesToMakes
    if (!makes || makes.length === 0) return true // générique → toujours visible
    if (!detectedMake) return false // marque-spécifique mais aucune marque détectée
    return makes.includes(detectedMake)
  })
}

/**
 * Concatène les alias des options sélectionnées en une chaîne à injecter
 * dans `valuationQueryText`. Chaque alias est entouré d'espaces pour que
 * la détection regex word-boundary fonctionne correctement.
 */
export function buildOptionAliases(selectedKeys: string[]): string {
  if (!selectedKeys || selectedKeys.length === 0) return ""
  const aliases: string[] = []
  for (const key of selectedKeys) {
    const opt = VEHICLE_OPTIONS.find((o) => o.key === key)
    if (opt?.alias) aliases.push(` ${opt.alias} `)
  }
  return aliases.join(" ")
}

/**
 * Lookup d'une option par sa clé. Renvoie null si inconnu.
 */
export function getOption(key: string): VehicleOption | null {
  return VEHICLE_OPTIONS.find((o) => o.key === key) || null
}
