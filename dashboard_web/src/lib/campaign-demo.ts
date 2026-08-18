/**
 * Pages campagne « démo privée » par concessionnaire — go-data.co/<slug>.
 * (Falardeau/Miguel, SM Sport/Dave, …)
 *
 * - Chaque page est gardée par son code magique (table promo_codes) : le
 *   toggle de /admin/campagnes coupe ou rouvre la page instantanément.
 * - Les données viennent des tables partagées (scraped_site_data), lues en
 *   service role puisque le visiteur est anonyme. Le matching réutilise
 *   buildMatchKey d'analyze-from-cache, en variante LECTURE SEULE : aucun
 *   INSERT dans scrapings.
 * - Le référent est verrouillé sur le domaine du concessionnaire ; les
 *   concurrents sont choisis PAR LES DONNÉES : max de correspondances
 *   exactes + max d'unités du référent non compétitives (concurrent moins
 *   cher) — c'est l'argumentaire de vente de la page.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { buildMatchKey } from '@/lib/analyze-from-cache'
import {
  calculatePricePositioning,
  calculateProductAnalysis,
  calculateOpportunities,
  calculateRetailerAnalysis,
  calculateCategoryAnalysis,
  type AnalyticsData,
} from '@/lib/analytics-calculations'

// ─── Configuration des campagnes ─────────────────────────────────────

export interface CampaignSite {
  name: string
  domain: string
  url: string
}

export interface DealerCampaignConfig {
  /** Slug de la route publique (go-data.co/<slug>) et clé de cache. */
  slug: string
  /** Code magique promo_codes qui gouverne la page (toggle admin). */
  code: string
  /** Prénom du contact salué dans le héro. */
  contactName: string
  /** Chemin du logo dans /public. */
  logo: string
  reference: CampaignSite
  competitors: readonly CampaignSite[]
}

export const DEALER_CAMPAIGNS: Record<string, DealerCampaignConfig> = {
  falardeau: {
    slug: 'falardeau',
    code: 'FALARDEAU',
    contactName: 'Miguel',
    logo: '/dealers/moto-falardeau.png',
    reference: { name: 'Moto Falardeau', domain: 'motofalardeau.com', url: 'https://motofalardeau.com/fr/' },
    // Sélection 2026-08-18 : 282 prix appariés, 17 unités non compétitives.
    competitors: [
      { name: 'Motos Illimitées', domain: 'motosillimitees.com', url: 'https://motosillimitees.com' },
      { name: 'Mathias Sports', domain: 'mathiassports.com', url: 'https://mathiassports.com' },
      { name: 'Moto Pro Granby', domain: 'motoprogranby.com', url: 'https://motoprogranby.com' },
      { name: 'Motoplex Mirabel', domain: 'motoplexmirabel.ca', url: 'https://motoplexmirabel.ca' },
      { name: 'DB Moto', domain: 'dbmoto.ca', url: 'https://dbmoto.ca' },
      { name: 'Motoplex St-Eustache', domain: 'motoplex.ca', url: 'https://motoplex.ca' },
      { name: 'Centre du Sport Lac-St-Jean', domain: 'centredusportlacstjean.com', url: 'https://centredusportlacstjean.com' },
      { name: 'SM Sport', domain: 'smsport.ca', url: 'https://smsport.ca' },
    ],
  },
  smsport: {
    slug: 'smsport',
    code: 'SMSPORT',
    contactName: 'Dave',
    logo: '/dealers/sm-sport.png',
    reference: { name: 'SM Sport', domain: 'smsport.ca', url: 'https://smsport.ca/fr/' },
    // Sélection 2026-08-18 : les 8 concessionnaires qui battent le plus
    // SM Sport — 519 lignes appariées, 84 unités non compétitives (dont 58
    // rien que chez Motos Illimitées).
    competitors: [
      { name: 'Motos Illimitées', domain: 'motosillimitees.com', url: 'https://motosillimitees.com' },
      { name: 'Mathias Sports', domain: 'mathiassports.com', url: 'https://mathiassports.com' },
      { name: 'Moto Ducharme', domain: 'motoducharme.com', url: 'https://motoducharme.com' },
      { name: 'Motoplex St-Eustache', domain: 'motoplex.ca', url: 'https://motoplex.ca' },
      { name: 'Motoplex Mirabel', domain: 'motoplexmirabel.ca', url: 'https://motoplexmirabel.ca' },
      { name: 'Motosport 4 Saisons', domain: 'motosport4saisons.com', url: 'https://motosport4saisons.com' },
      { name: 'Centre du Sport Lac-St-Jean', domain: 'centredusportlacstjean.com', url: 'https://centredusportlacstjean.com' },
      { name: 'Grégoire Sport', domain: 'gregoiresport.com', url: 'https://gregoiresport.com' },
    ],
  },
}

// ─── Types de données ────────────────────────────────────────────────

export interface CampaignAnalytics {
  positionnement: AnalyticsData['positionnement']
  produits: AnalyticsData['produits']
  opportunites: AnalyticsData['opportunites']
  detailleurs: AnalyticsData['detailleurs']
  categories: AnalyticsData['categories']
}

export interface CampaignSiteInfo {
  name: string
  domain: string
  productCount: number
}

export interface CampaignDemoData {
  /** Produits référence + concurrents appariés (allégés pour le client). */
  products: Record<string, unknown>[]
  competitorUrls: string[]
  sites: CampaignSiteInfo[]
  referenceCount: number
  matchedCount: number
  /** Unités distinctes du référent où au moins un concurrent est moins cher. */
  nonCompetitiveCount: number
  analytics: CampaignAnalytics
  scrapedAt: string | null
}

// ─── Gate campagne ───────────────────────────────────────────────────

/**
 * Lu à CHAQUE requête (pas de cache) pour que le toggle admin agisse
 * immédiatement.
 */
export async function isCampaignActive(code: string): Promise<boolean> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('promo_codes')
    .select('is_active')
    .eq('code', code)
    .maybeSingle()
  return data?.is_active === true
}

// ─── Chargement des données ──────────────────────────────────────────

// Les lectures scraped_site_data pèsent plusieurs Mo : on garde le résultat
// calculé en mémoire d'instance (Fluid Compute réutilise les instances) et
// on rafraîchit au plus toutes les 10 min — le cron scrape aux 2 h de toute
// façon. Le gate, lui, reste par requête.
const DATA_TTL_MS = 10 * 60 * 1000
const dataCache = new Map<string, { at: number; data: CampaignDemoData | null }>()

export async function loadCampaignData(config: DealerCampaignConfig): Promise<CampaignDemoData | null> {
  const cached = dataCache.get(config.slug)
  if (cached && Date.now() - cached.at < DATA_TTL_MS) {
    return cached.data
  }
  const data = await computeCampaignData(config)
  dataCache.set(config.slug, { at: Date.now(), data })
  return data
}

async function computeCampaignData(config: DealerCampaignConfig): Promise<CampaignDemoData | null> {
  const supabase = createServiceClient()
  const domains = [config.reference.domain, ...config.competitors.map(c => c.domain)]

  const { data: rows } = await supabase
    .from('scraped_site_data')
    .select('site_domain, products, product_count, scraped_at, status')
    .in('site_domain', domains)
    .eq('status', 'success')

  const bySite = new Map<string, { products: any[]; scraped_at: string | null }>()
  for (const row of rows || []) {
    if (row.products?.length > 0) {
      bySite.set(row.site_domain, { products: row.products, scraped_at: row.scraped_at })
    }
  }

  const refRow = bySite.get(config.reference.domain)
  if (!refRow) return null

  // Même défaut que le produit : la référence ne garde que son inventaire
  // réel (pas le catalogue fabricant) ; les concurrents gardent tout.
  let referenceProducts = refRow.products.filter(
    (p: any) => (p.sourceCategorie || '').toLowerCase() !== 'catalogue'
  )
  if (referenceProducts.length === 0) referenceProducts = refRow.products

  referenceProducts = referenceProducts.map((p: any) => ({
    ...p,
    sourceSite: config.reference.url,
    isReferenceProduct: true,
  }))

  const refIndex = new Map<string, any[]>()
  for (const rp of referenceProducts) {
    const key = buildMatchKey(rp, false)
    if (!key.split('|')[1]) continue
    if (!refIndex.has(key)) refIndex.set(key, [])
    refIndex.get(key)!.push(rp)
  }

  // allProducts (complet) sert aux analytics ; le client ne reçoit que la
  // référence + les concurrents appariés, allégés (les milliers d'unités
  // concurrentes sans correspondance pèsent plusieurs Mo pour rien).
  const allProducts: any[] = [...referenceProducts]
  const clientProducts: any[] = referenceProducts.map(slimProduct)
  const nonCompetitiveRefs = new Set<string>()
  let matchedCount = 0

  for (const comp of config.competitors) {
    const siteRow = bySite.get(comp.domain)
    if (!siteRow) continue

    for (const raw of siteRow.products) {
      const product: any = { ...raw, sourceSite: raw.sourceSite || comp.url }
      const key = buildMatchKey(product, false)

      if (key.split('|')[1]) {
        const refs = refIndex.get(key)
        if (refs && refs.length > 0) {
          const currentPrice = parseFloat(product.prix) || 0
          let bestRef = refs[0]
          let minDiff = Infinity
          for (const r of refs) {
            const rp = parseFloat(r.prix) || 0
            if (rp > 0 && currentPrice > 0) {
              const d = Math.abs(currentPrice - rp)
              if (d < minDiff) { minDiff = d; bestRef = r }
            }
          }
          const refPrice = parseFloat(bestRef.prix) || 0
          product.prixReference = refPrice
          product.differencePrix = currentPrice > 0 && refPrice > 0 ? currentPrice - refPrice : null
          product.siteReference = config.reference.url
          product.matchLevel = 'exact'
          product.produitReference = {
            name: bestRef.name,
            sourceUrl: bestRef.sourceUrl,
            prix: refPrice,
            image: bestRef.image,
            inventaire: bestRef.inventaire,
            kilometrage: bestRef.kilometrage,
            annee: bestRef.annee,
            etat: bestRef.etat,
            sourceCategorie: bestRef.sourceCategorie,
          }
          matchedCount++
          // Concurrent moins cher → le référent est non compétitif sur
          // cette unité (l'argument central de la démo).
          if (product.differencePrix != null && product.differencePrix < 0 && bestRef.sourceUrl) {
            nonCompetitiveRefs.add(String(bestRef.sourceUrl))
          }
          clientProducts.push(slimProduct(product))
        }
      }
      allProducts.push(product)
    }
  }

  const analytics: CampaignAnalytics = {
    positionnement: calculatePricePositioning(allProducts, config.reference.domain, 'fr'),
    produits: calculateProductAnalysis(allProducts, config.reference.domain),
    opportunites: calculateOpportunities(allProducts, config.reference.domain, 'fr'),
    detailleurs: calculateRetailerAnalysis(allProducts, config.reference.domain),
    categories: calculateCategoryAnalysis(allProducts, config.reference.domain),
  }

  const sites: CampaignSiteInfo[] = config.competitors
    .filter(c => bySite.has(c.domain))
    .map(c => ({
      name: c.name,
      domain: c.domain,
      productCount: bySite.get(c.domain)!.products.length,
    }))

  return {
    products: clientProducts,
    competitorUrls: config.competitors.map(c => c.url),
    sites,
    referenceCount: referenceProducts.length,
    matchedCount,
    nonCompetitiveCount: nonCompetitiveRefs.size,
    analytics,
    scrapedAt: refRow.scraped_at,
  }
}

/** Ne garde que les champs consommés par la table de comparaison, la
    stratégie de pricing et les fiches — description et champs lourds exclus. */
function slimProduct(p: any): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: p.name,
    marque: p.marque,
    modele: p.modele,
    annee: p.annee,
    prix: p.prix,
    image: p.image,
    sourceUrl: p.sourceUrl,
    sourceSite: p.sourceSite,
    sourceCategorie: p.sourceCategorie,
    etat: p.etat,
  }
  // Unités sans prix publié : marquées « sur demande » pour que la table
  // n'affiche pas 0 $.
  if (!(typeof p.prix === 'number' && p.prix > 0) && p.price_on_request == null) {
    out.price_on_request = true
  }
  if (p.prix_original != null) out.prix_original = p.prix_original
  if (p.inventaire != null) out.inventaire = p.inventaire
  if (p.kilometrage != null) out.kilometrage = p.kilometrage
  if (p.vehicule_type != null) out.vehicule_type = p.vehicule_type
  if (p.price_on_request != null) out.price_on_request = p.price_on_request
  if (p.isReferenceProduct) out.isReferenceProduct = true
  if (p.prixReference != null) {
    out.prixReference = p.prixReference
    out.differencePrix = p.differencePrix
    out.siteReference = p.siteReference
    out.matchLevel = p.matchLevel
    out.produitReference = p.produitReference
  }
  return out
}
