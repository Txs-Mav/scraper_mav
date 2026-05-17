/**
 * Sources de marché préconfigurées pour la surveillance.
 *
 * Ces sources sont des marketplaces génériques (annonces multi-vendeurs)
 * ajoutables d'un clic comme concurrents dans `scraper_config.competitor_urls`.
 *
 * Contrairement aux concessionnaires individuels listés via `shared_scrapers`,
 * elles sont toujours visibles dans l'UI même si `scraped_site_data` n'a pas
 * encore de produits pour leur domaine — l'utilisateur peut donc les activer
 * avant que le cache soit rempli.
 *
 * Pour qu'elles produisent réellement des produits comparés, un scraper côté
 * Python doit alimenter `scraped_site_data` avec le même `site_domain`
 * (cf. scripts/scraper_cron.py et scraper_ai/dedicated_scrapers/registry.py).
 */
export interface MarketplaceSource {
  id: string
  site_name: string
  site_slug: string
  site_url: string
  site_domain: string
  description: string
  vehicle_types: string[]
}

export const MARKETPLACE_SOURCES: MarketplaceSource[] = [
  {
    id: 'marketplace-autotrader-ca',
    site_name: 'AutoTrader.ca',
    site_slug: 'autotrader-ca',
    site_url: 'https://www.autotrader.ca',
    site_domain: 'autotrader.ca',
    description: 'Annonces véhicules motorisés au Canada',
    vehicle_types: ['auto', 'moto', 'vtt'],
  },
  {
    id: 'marketplace-kijiji-ca',
    site_name: 'Kijiji',
    site_slug: 'kijiji-ca',
    site_url: 'https://www.kijiji.ca',
    site_domain: 'kijiji.ca',
    description: 'Petites annonces locales au Canada',
    vehicle_types: ['auto', 'moto', 'vtt', 'motoneige', 'sxs'],
  },
  {
    id: 'marketplace-lespac',
    site_name: 'LesPAC',
    site_slug: 'lespac',
    site_url: 'https://www.lespac.com',
    site_domain: 'lespac.com',
    description: 'Petites annonces québécoises',
    vehicle_types: ['auto', 'moto', 'vtt', 'motoneige'],
  },
  {
    id: 'marketplace-cycletrader',
    site_name: 'CycleTrader.com',
    site_slug: 'cycletrader',
    site_url: 'https://www.cycletrader.com',
    site_domain: 'cycletrader.com',
    description: 'Powersports : moto, VTT, motoneige, SXS',
    vehicle_types: ['moto', 'vtt', 'motoneige', 'sxs'],
  },
  {
    id: 'marketplace-motorcycledealers-ca',
    site_name: 'MotorcycleDealers.ca',
    site_slug: 'motorcycledealers-ca',
    site_url: 'https://www.motorcycledealers.ca',
    site_domain: 'motorcycledealers.ca',
    description: 'Annuaire de concessionnaires moto au Canada',
    vehicle_types: ['moto'],
  },
]

export function isMarketplaceDomain(domain: string): boolean {
  if (!domain) return false
  const normalized = domain.replace(/^www\./, '').toLowerCase()
  return MARKETPLACE_SOURCES.some((s) => s.site_domain === normalized)
}

export function getMarketplaceByDomain(domain: string): MarketplaceSource | null {
  if (!domain) return null
  const normalized = domain.replace(/^www\./, '').toLowerCase()
  return MARKETPLACE_SOURCES.find((s) => s.site_domain === normalized) || null
}
