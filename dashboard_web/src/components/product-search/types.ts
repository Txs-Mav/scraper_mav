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
  /**
   * True quand ce hit vient du 2e pass relaxé (un veto strict aurait été
   * appliqué : marque manquante, année hors range, modèle précis incomplet).
   * Le frontend affiche un badge "Approchant" dans ce cas.
   */
  is_approximate?: boolean
}

export interface AdapterRunStats {
  name: string
  site: string
  duration_seconds: number
  hits_returned: number
  /**
   * Parmi `hits_returned`, combien viennent du 2e pass relaxé. Permet à l'UI
   * de distinguer "match exact" d'un "comparable approchant" par adapter.
   */
  approximate_returned?: number
  /**
   * Nb de produits effectivement scorés (après dédup). Utile pour distinguer
   * un cache vide d'un cache plein dont rien ne matche la requête.
   */
  products_scanned?: number
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
  /**
   * True quand l'agrégat global ne contient QUE des hits approximatifs (le
   * 1er pass strict a tout rejeté). Le frontend affiche une bannière
   * explicative au-dessus de la grille.
   */
  is_approximate?: boolean
  /**
   * Total cumulé de produits scannés à travers tous les adapters. Utile pour
   * le message "Aucun résultat" : on peut dire "127 produits scannés, aucun
   * ne correspond" vs "aucun produit dans le cache".
   */
  products_scanned?: number
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
