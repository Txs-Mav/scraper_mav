export const DEFAULT_BUSINESS_TYPE = "recreational_vehicles" as const

export const BUSINESS_TYPES = [
  "recreational_vehicles",
  "automotive",
  "marine",
  "sports_outdoor",
  "fashion",
  "electronics",
  "other",
] as const

export type BusinessType = (typeof BUSINESS_TYPES)[number]

type DashboardCapabilities = {
  showDeveloperTools: boolean
}

const DASHBOARD_CAPABILITIES: Record<BusinessType, DashboardCapabilities> = {
  recreational_vehicles: { showDeveloperTools: false },
  automotive: { showDeveloperTools: false },
  marine: { showDeveloperTools: false },
  sports_outdoor: { showDeveloperTools: false },
  fashion: { showDeveloperTools: true },
  electronics: { showDeveloperTools: true },
  other: { showDeveloperTools: true },
}

export function normalizeBusinessType(value?: string | null): BusinessType {
  return BUSINESS_TYPES.includes(value as BusinessType)
    ? (value as BusinessType)
    : DEFAULT_BUSINESS_TYPE
}

export function getDashboardCapabilities(businessType?: string | null): DashboardCapabilities {
  return DASHBOARD_CAPABILITIES[normalizeBusinessType(businessType)]
}

/**
 * Catégorie pré-sélectionnée par défaut dans /dashboard/recherche pour
 * chaque type de commerce. Le chemin correspond à la taxonomie Python
 * (`scraper_ai/scraper_search/categories.py`).
 *
 * `null` = aucune pré-sélection (montre toutes les catégories).
 */
export const BUSINESS_TYPE_DEFAULT_CATEGORY: Record<BusinessType, string | null> = {
  recreational_vehicles: "vehicule.moto",
  automotive: "vehicule.auto",
  marine: "vehicule.nautique",
  sports_outdoor: "sport",
  fashion: "mode",
  electronics: "electronique",
  other: null,
}

/**
 * Catégories autorisées (visibles dans le `CategoryPicker`) pour chaque
 * type de commerce. Les valeurs sont des chemins de la taxonomie ; un
 * chemin "vehicule.moto" autorise toute la sous-arbre (`vehicule.moto.cross`,
 * etc.) ; un chemin "sport" autorise toute la branche sport.
 *
 * Pour `other`, on autorise tout (null = pas de filtre).
 */
export const BUSINESS_TYPE_ALLOWED_CATEGORIES: Record<BusinessType, string[] | null> = {
  recreational_vehicles: [
    // véhicules récréatifs : moto, vtt, motoneige, sxs, nautique, scooter
    "vehicule.moto",
    "vehicule.vtt",
    "vehicule.motoneige",
    "vehicule.sxs",
    "vehicule.nautique",
    "vehicule.scooter-vehicule",
    "vehicule.remorque",
    // accessoires & pièces pertinents
    "accessoire.accessoire-moto",
    "accessoire.accessoire-vtt",
    "accessoire.accessoire-motoneige",
    "piece.piece-moto",
    "piece.piece-vtt",
    "piece.piece-motoneige",
  ],
  automotive: [
    "vehicule.auto",
    "vehicule.vehicule-electrique",
    "vehicule.remorque",
    "accessoire.accessoire-auto",
    "piece.piece-auto",
    "service.service-auto",
  ],
  marine: [
    "vehicule.nautique",
  ],
  sports_outdoor: [
    "sport",
    "accessoire.accessoire-velo",
    "accessoire.accessoire-camping",
  ],
  fashion: [
    "mode",
  ],
  electronics: [
    "electronique",
  ],
  other: null,
}

/**
 * Renvoie l'union des chemins autorisés pour un ensemble de business_types.
 * Retourne `null` si l'un des types autorise tout (= pas de filtre global).
 * Retourne `[]` si aucun business_type sélectionné (= pas de filtre non plus).
 */
export function getAllowedCategoryPaths(
  raw: BusinessType | BusinessType[] | string | null | undefined,
): string[] | null {
  const parsed = parseBusinessTypes(raw)
  if (parsed.length === 0) return null
  const union = new Set<string>()
  for (const bt of parsed) {
    const allowed = BUSINESS_TYPE_ALLOWED_CATEGORIES[bt]
    if (allowed === null) return null // un seul "other" suffit à tout débloquer
    for (const p of allowed) union.add(p)
  }
  return Array.from(union)
}

export function getDefaultCategoryPath(businessType?: string | null): string | null {
  return BUSINESS_TYPE_DEFAULT_CATEGORY[normalizeBusinessType(businessType)]
}

// ---------------------------------------------------------------------------
// Support multi-valeurs (un utilisateur peut combiner plusieurs domaines).
// ---------------------------------------------------------------------------
//
// On stocke en DB sous forme de string comma-separated dans la colonne
// `business_type` existante, pour ne pas casser le schéma. Exemples :
//   "fashion"                          → mono-domaine
//   "fashion,electronics,sports_outdoor" → multi
//   ""                                 → aucun choix (utilise le défaut)
//
// L'API PUT /api/users/profile accepte aussi un array (`business_types`)
// qui est sérialisé automatiquement en string comma-separated.

/**
 * Parse une valeur brute (string comma-separated, array ou null) en liste
 * normalisée de BusinessType. Filtre les valeurs invalides, déduplique en
 * conservant l'ordre d'apparition.
 */
export function parseBusinessTypes(
  raw: BusinessType | BusinessType[] | string | null | undefined,
): BusinessType[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : String(raw).split(",")
  const seen = new Set<BusinessType>()
  const out: BusinessType[] = []
  for (const v of arr) {
    const trimmed = String(v).trim()
    if (!trimmed) continue
    if (!BUSINESS_TYPES.includes(trimmed as BusinessType)) continue
    const bt = trimmed as BusinessType
    if (seen.has(bt)) continue
    seen.add(bt)
    out.push(bt)
  }
  return out
}

/**
 * Sérialise une liste de BusinessType en string comma-separated pour la DB.
 */
export function serializeBusinessTypes(arr: BusinessType[]): string {
  return parseBusinessTypes(arr).join(",")
}

/**
 * Retourne le premier business_type valide (utile pour les fonctions legacy
 * qui n'attendent qu'une seule valeur, comme `getDashboardCapabilities`).
 */
export function getPrimaryBusinessType(
  raw: BusinessType | BusinessType[] | string | null | undefined,
): BusinessType {
  const parsed = parseBusinessTypes(raw)
  return parsed[0] ?? DEFAULT_BUSINESS_TYPE
}

/**
 * Retourne la catégorie pré-sélectionnée la plus pertinente pour un ensemble
 * de business_types :
 *   - 0 type → null (toutes les catégories)
 *   - 1 type → sa catégorie par défaut (peut être null pour `other`)
 *   - 2+     → null (pas de pré-sélection — l'utilisateur picore lui-même)
 */
export function getDefaultCategoryPathForMulti(
  raw: BusinessType | BusinessType[] | string | null | undefined,
): string | null {
  const parsed = parseBusinessTypes(raw)
  if (parsed.length === 1) return BUSINESS_TYPE_DEFAULT_CATEGORY[parsed[0]]
  return null
}
