export interface CategoryNode {
  slug: string
  name: string
  path: string
  children: CategoryNode[]
}

export interface SearchHit {
  name: string
  prix: number | null
  annee: number | null
  marque: string | null
  modele: string | null
  kilometrage: number | null
  etat: string | null
  image: string
  source_site: string
  source_url: string
  score: number
  match_reason: string
}

export interface AdapterRunStats {
  name: string
  site: string
  duration_seconds: number
  hits_returned: number
  cache_hit: boolean
  error: string
}

export interface SearchResult {
  query: Record<string, unknown>
  total: number
  elapsed_seconds: number
  adapters_succeeded: number
  adapters_failed: string[]
  cache_hits: number
  adapters_run: AdapterRunStats[]
  hits: SearchHit[]
}

export interface AdapterToggles {
  amazon: boolean
  ebay: boolean
  kijiji: boolean
  bestbuy: boolean
  walmart: boolean
  costco: boolean
  lespac: boolean
  autotrader: boolean
  cycletrader: boolean
  facebook: boolean
  dedicated: boolean
  shopify: string[]
  /**
   * Liste de domaines de concessionnaires sans scraper dédié à interroger
   * en mode générique (on-site search + fallback Google).
   */
  genericDealers: string[]
  /**
   * Si true, le serveur récupère la liste des concurrents de l'utilisateur
   * (scraper_config.competitor_urls) et la fusionne avec `genericDealers`
   * avant de lancer la recherche.
   */
  includeMyCompetitors: boolean
}
