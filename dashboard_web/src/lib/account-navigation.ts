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
