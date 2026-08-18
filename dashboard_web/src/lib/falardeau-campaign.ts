/**
 * Campagne individuelle « Moto Falardeau » — données de la page publique
 * /falardeau (démo privée sans compte, envoyée par courriel à Miguel).
 *
 * - Le gate est le code magique FALARDEAU (table promo_codes) : le toggle
 *   de /admin/campagnes coupe ou rouvre la page instantanément.
 * - Les données viennent des tables partagées (scraped_site_data), lues en
 *   service role puisque le visiteur est anonyme. Le matching réutilise
 *   buildMatchKey d'analyze-from-cache, en variante LECTURE SEULE : aucun
 *   INSERT dans scrapings.
 * - Le référent est verrouillé sur motofalardeau.com ; les concurrents sont
 *   une liste fixe choisie pour le recouvrement de marques (Kawasaki,
 *   CFMOTO, Husqvarna, marine) et la proximité Laurentides.
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

export const FALARDEAU_CAMPAIGN_CODE = 'FALARDEAU'

export const FALARDEAU_REFERENCE = {
  name: 'Moto Falardeau',
  domain: 'motofalardeau.com',
  url: 'https://motofalardeau.com/fr/',
} as const

export const FALARDEAU_COMPETITORS = [
  { name: 'Nadon Sport', domain: 'nadonsport.com', url: 'https://nadonsport.com' },
  { name: 'Motoplex Mirabel', domain: 'motoplexmirabel.ca', url: 'https://motoplexmirabel.ca' },
  { name: 'Laval Moto', domain: 'lavalmoto.com', url: 'https://lavalmoto.com' },
  { name: 'Motos Illimitées', domain: 'motosillimitees.com', url: 'https://motosillimitees.com' },
  { name: 'Moto Pro Granby', domain: 'motoprogranby.com', url: 'https://motoprogranby.com' },
  { name: 'Mathias Sports', domain: 'mathiassports.com', url: 'https://mathiassports.com' },
] as const

export interface FalardeauAnalytics {
  positionnement: AnalyticsData['positionnement']
  produits: AnalyticsData['produits']
  opportunites: AnalyticsData['opportunites']
  detailleurs: AnalyticsData['detailleurs']
  categories: AnalyticsData['categories']
}

export interface FalardeauSiteInfo {
  name: string
  domain: string
  productCount: number
}

export interface FalardeauData {
  /** Produits référence + concurrents appariés (allégés pour le client). */
  products: Record<string, unknown>[]
  competitorUrls: string[]
  sites: FalardeauSiteInfo[]
  referenceCount: number
  matchedCount: number
  analytics: FalardeauAnalytics
  scrapedAt: string | null
}

/**
 * État de la campagne : la page n'existe que si le code FALARDEAU est actif.
 * Lu à CHAQUE requête (pas de cache) pour que le toggle admin agisse
 * immédiatement.
 */
export async function isFalardeauCampaignActive(): Promise<boolean> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('promo_codes')
    .select('is_active')
    .eq('code', FALARDEAU_CAMPAIGN_CODE)
    .maybeSingle()
  return data?.is_active === true
}

// Les lectures scraped_site_data pèsent plusieurs Mo : on garde le résultat
// calculé en mémoire d'instance (Fluid Compute réutilise les instances) et
// on rafraîchit au plus toutes les 10 min — le cron scrape aux 2 h de toute
// façon. Le gate, lui, reste par requête.
const DATA_TTL_MS = 10 * 60 * 1000
let dataCache: { at: number; data: FalardeauData | null } | null = null

export async function loadFalardeauData(): Promise<FalardeauData | null> {
  if (dataCache && Date.now() - dataCache.at < DATA_TTL_MS) {
    return dataCache.data
  }
  const data = await computeFalardeauData()
  dataCache = { at: Date.now(), data }
  return data
}

async function computeFalardeauData(): Promise<FalardeauData | null> {
  const supabase = createServiceClient()
  const domains = [FALARDEAU_REFERENCE.domain, ...FALARDEAU_COMPETITORS.map(c => c.domain)]

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

  const refRow = bySite.get(FALARDEAU_REFERENCE.domain)
  if (!refRow) return null

  // Même défaut que le produit : la référence ne garde que son inventaire
  // réel (pas le catalogue fabricant) ; les concurrents gardent tout.
  let referenceProducts = refRow.products.filter(
    (p: any) => (p.sourceCategorie || '').toLowerCase() !== 'catalogue'
  )
  if (referenceProducts.length === 0) referenceProducts = refRow.products

  referenceProducts = referenceProducts.map((p: any) => ({
    ...p,
    sourceSite: FALARDEAU_REFERENCE.url,
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
  // concurrentes sans correspondance n'apportent rien à Miguel et pèsent
  // plusieurs Mo).
  const allProducts: any[] = [...referenceProducts]
  const clientProducts: any[] = referenceProducts.map(slimProduct)
  let matchedCount = 0

  for (const comp of FALARDEAU_COMPETITORS) {
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
          product.siteReference = FALARDEAU_REFERENCE.url
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
          clientProducts.push(slimProduct(product))
        }
      }
      allProducts.push(product)
    }
  }

  const analytics: FalardeauAnalytics = {
    positionnement: calculatePricePositioning(allProducts, FALARDEAU_REFERENCE.domain, 'fr'),
    produits: calculateProductAnalysis(allProducts, FALARDEAU_REFERENCE.domain),
    opportunites: calculateOpportunities(allProducts, FALARDEAU_REFERENCE.domain, 'fr'),
    detailleurs: calculateRetailerAnalysis(allProducts, FALARDEAU_REFERENCE.domain),
    categories: calculateCategoryAnalysis(allProducts, FALARDEAU_REFERENCE.domain),
  }

  const sites: FalardeauSiteInfo[] = FALARDEAU_COMPETITORS
    .filter(c => bySite.has(c.domain))
    .map(c => ({
      name: c.name,
      domain: c.domain,
      productCount: bySite.get(c.domain)!.products.length,
    }))

  return {
    products: clientProducts,
    competitorUrls: FALARDEAU_COMPETITORS.map(c => c.url),
    sites,
    referenceCount: referenceProducts.length,
    matchedCount,
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
  // ~6 % des unités Falardeau n'ont pas de prix publié (pages rendues
  // client) : marquées « sur demande » pour que la table n'affiche pas 0 $.
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
