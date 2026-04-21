/**
 * Comparaison rapide des produits depuis le cache Supabase (scraped_site_data)
 * vers le site de référence de l'utilisateur. Produit un enregistrement
 * dans la table `scrapings` avec chaque produit concurrent enrichi de
 * `produitReference`, `prixReference` et `differencePrix` pour permettre
 * aux alertes/emails de montrer les correspondances avec la référence.
 *
 * Utilisé par `/api/products/analyze` (appel utilisateur) et par le cron
 * d'alertes (`/api/alerts/check`) en dernier recours.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { deepNormalize, KNOWN_BRANDS } from '@/lib/analytics-calculations'

// ─── Résultat ────────────────────────────────────────────────────────

export interface AnalyzeResult {
  ok: boolean
  error?: string
  message?: string
  stats?: {
    referenceProducts: number
    matchedProducts: number
    totalProducts: number
    cacheHits: number
    elapsed: number
  }
}

// ─── Extraction ──────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`
    return new URL(withProto).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url.toLowerCase().replace(/^www\./, '').split('/')[0]
  }
}

const BRAND_ALIASES: Record<string, string> = {
  'cf moto': 'cfmoto', 'harley davidson': 'harley davidson',
  'can am': 'can am', 'sea doo': 'sea doo', 'ski doo': 'ski doo',
  'gas gas': 'gasgas', 'sur ron': 'surron',
}
const NORMALIZED_BRANDS = KNOWN_BRANDS.map((b) => [deepNormalize(b), b] as const)

const CATEGORY_PREFIXES = [
  /^(?:c[oô]te\s+[aà]\s+c[oô]te|cote\s+a\s+cote|side\s*by\s*side|sxs)\s+/i,
  /^(?:vtt|atv|quad|motoneige|snowmobile|moto|scooter)\s+/i,
  /^(?:motomarine|watercraft|jet\s*ski|pwc)\s+/i,
  /^(?:ponton|pontoon|bateau|boat|embarcation)\s+/i,
  /^(?:moteur\s+hors[\s-]?bord|outboard|hors[\s-]?bord)\s+/i,
  /^(?:sportive|routiere|routière|touring|adventure|aventure|cruiser|custom|standard|naked|enduro|supermoto|trail|dual[\s-]?sport|double[\s-]?usage|sport[\s-]?touring|grand[\s-]?touring|retro)\s+/i,
  /^(?:3[\s-]?roues|three[\s-]?wheel|trike)\s+/i,
]

const COLOR_WORDS = new Set([
  'blanc', 'noir', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'rose', 'violet',
  'gris', 'argent', 'or', 'bronze', 'beige', 'marron', 'brun', 'turquoise',
  'kaki', 'sable', 'ivoire', 'creme',
  'brillant', 'mat', 'metallise', 'metallique', 'perle', 'nacre', 'satin',
  'chrome', 'carbone', 'fonce', 'clair', 'fluo', 'neon',
  'ebene', 'graphite', 'anthracite', 'platine', 'titane', 'cuivre', 'acier',
  'cobalt', 'corail', 'ardoise', 'bonbon', 'diablo', 'champagne',
  'phantom', 'fantome', 'combat', 'lime', 'sauge', 'cristal', 'obsidian',
  'etincelle', 'velocite',
  'white', 'black', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
  'gray', 'grey', 'silver', 'gold', 'brown',
  'matte', 'glossy', 'metallic', 'pearl', 'carbon',
  'dark', 'light', 'neon', 'bright',
  'ivory', 'charcoal', 'titanium', 'copper', 'steel', 'platinum',
  'racing', 'candy', 'midnight', 'cosmic', 'storm', 'crystal',
])

function removeColors(text: string): string {
  if (!text) return ''
  return text.split(' ').filter((w) => !COLOR_WORDS.has(w)).join(' ').replace(/\s+/g, ' ').trim() || text
}

function buildMatchKey(product: any): string {
  let rawMarque = String(product.marque || '').replace(/^(?:manufacturier|fabricant|marque)\s*:\s*/i, '').trim()
  const rawModele = String(product.modele || '').replace(/^(?:modèle|modele|model)\s*:\s*/i, '').trim()
  let annee = product.annee || 0

  if (!annee) {
    const nameYear = String(product.name || '').match(/\b(19|20)\d{2}\b/)
    if (nameYear) annee = parseInt(nameYear[0])
    if (!annee) {
      const urlYear = String(product.sourceUrl || '').match(/[/-](20[12]\d)(?:[/-]|\.html|$)/)
      if (urlYear) annee = parseInt(urlYear[1])
    }
  }

  let marque = deepNormalize(rawMarque)
  let modele = deepNormalize(rawModele)

  if (!marque || !modele) {
    const nameNorm = deepNormalize(product.name || '')
    let detectedBrand = ''
    let rest = nameNorm
    for (const [nb] of NORMALIZED_BRANDS) {
      if (nameNorm.startsWith(nb + ' ') || nameNorm === nb) {
        detectedBrand = nb
        rest = nameNorm.slice(nb.length).trim()
        break
      }
      const idx = nameNorm.indexOf(nb)
      if (idx >= 0) {
        detectedBrand = nb
        rest = (nameNorm.slice(0, idx) + ' ' + nameNorm.slice(idx + nb.length)).replace(/\s+/g, ' ').trim()
        break
      }
    }
    if (detectedBrand) {
      if (!marque) marque = detectedBrand
      if (!modele) {
        rest = rest.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim()
        modele = rest
      }
    } else if (!modele) {
      let cleaned = nameNorm.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim()
      if (marque) {
        const mNorm = deepNormalize(marque)
        if (cleaned.startsWith(mNorm + ' ')) cleaned = cleaned.slice(mNorm.length).trim()
      }
      modele = cleaned
    }
  }

  marque = BRAND_ALIASES[marque] || marque

  modele = modele.replace(/\b(?:en\s+vente|disponible|neuf|usage|usagee?|occasion)\s+(?:a|chez|au)\b.*/i, '').trim()
  modele = modele.replace(/\bd'?occasion\s+(?:a|chez|au)\b.*/i, '').trim()
  modele = modele.replace(/\b(?:a)\s+vendre\s+(?:a|chez|au)\b.*/i, '').trim()
  modele = modele.replace(/\b(?:concessionnaire|dealer|showroom|magasin|succursale)\b.*/i, '').trim()
  modele = modele.replace(/\b\w+\s+(?:motosport|motorsport|powersports?)\s*$/i, '').trim()

  for (const rx of CATEGORY_PREFIXES) modele = modele.replace(rx, '').trim()
  modele = modele.replace(/\b(?:neuf|new|usage|usagee?|occasion|used|demo|demonstrateur|preowned|pre\s*owned|certifie|certified)\b/gi, '').trim()
  modele = modele.replace(/\bpre\s*commande\b/gi, '').replace(/\bpre\s*order\b/gi, '').trim()
  modele = removeColors(modele)
  modele = modele.replace(/\s+/g, ' ').trim()

  return `${marque}|${modele}|${annee}`
}

// ─── Fonction principale ─────────────────────────────────────────────

export async function analyzeFromCache(userId: string): Promise<AnalyzeResult> {
  const serviceSupabase = createServiceClient()
  const startTime = Date.now()

  const { data: config } = await serviceSupabase
    .from('scraper_config')
    .select('reference_url, competitor_urls, ignore_colors, match_mode, filter_catalogue_reference')
    .eq('user_id', userId)
    .maybeSingle()

  if (!config?.reference_url) {
    return { ok: false, error: 'no_config', message: 'Aucune configuration de surveillance trouvée.' }
  }

  const referenceUrl = config.reference_url
  const competitorUrls: string[] = config.competitor_urls || []
  const refDomain = extractDomain(referenceUrl)

  const allDomains = new Map<string, string>()
  allDomains.set(refDomain, referenceUrl)
  for (const url of competitorUrls) {
    const d = extractDomain(url)
    if (!allDomains.has(d)) allDomains.set(d, url)
  }

  const domains = [...allDomains.keys()]
  const { data: cachedSites } = await serviceSupabase
    .from('scraped_site_data')
    .select('site_domain, products, product_count, status')
    .in('site_domain', domains)
    .eq('status', 'success')

  const siteProducts = new Map<string, any[]>()
  for (const row of cachedSites || []) {
    if (row.products?.length > 0) {
      siteProducts.set(row.site_domain, row.products)
    }
  }

  const referenceProducts = siteProducts.get(refDomain)
  if (!referenceProducts || referenceProducts.length === 0) {
    return {
      ok: false,
      error: 'no_reference_cache',
      message: `Aucun produit pré-scrapé pour le site de référence (${refDomain}).`,
    }
  }

  for (const p of referenceProducts) {
    p.sourceSite = referenceUrl
    p.isReferenceProduct = true
  }

  const refIndex = new Map<string, any[]>()
  for (const rp of referenceProducts) {
    const key = buildMatchKey(rp)
    const modele = key.split('|')[1]
    if (!modele) continue
    if (!refIndex.has(key)) refIndex.set(key, [])
    refIndex.get(key)!.push(rp)
  }

  const allProducts = [...referenceProducts]
  const addedUrls = new Set(referenceProducts.map((p: any) => p.sourceUrl).filter(Boolean))
  let matchedCount = 0

  for (const compUrl of competitorUrls) {
    const domain = extractDomain(compUrl)
    const products = siteProducts.get(domain) || []

    for (const product of products) {
      if (!product.sourceSite) product.sourceSite = compUrl

      const key = buildMatchKey(product)
      const modele = key.split('|')[1]
      if (!modele) {
        const sourceUrl = product.sourceUrl
        if (sourceUrl && addedUrls.has(sourceUrl)) continue
        allProducts.push(product)
        if (sourceUrl) addedUrls.add(sourceUrl)
        continue
      }

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
        product.siteReference = referenceUrl
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
      }

      const sourceUrl = product.sourceUrl
      if (sourceUrl && addedUrls.has(sourceUrl)) continue
      allProducts.push(product)
      if (sourceUrl) addedUrls.add(sourceUrl)
    }
  }

  const elapsed = (Date.now() - startTime) / 1000

  const scrapingRow = {
    user_id: userId,
    reference_url: referenceUrl,
    competitor_urls: competitorUrls,
    products: allProducts,
    metadata: {
      reference_url: referenceUrl,
      reference_products_count: referenceProducts.length,
      competitor_urls: competitorUrls,
      total_matched_products: matchedCount,
      total_products: allProducts.length,
      scraping_time_seconds: Math.round(elapsed * 10) / 10,
      mode: 'from_cache',
      source: 'direct_supabase_with_comparison',
      cache_hits: siteProducts.size,
    },
    scraping_time_seconds: Math.round(elapsed * 10) / 10,
    mode: 'from_cache',
  }

  const { error: saveError } = await serviceSupabase.from('scrapings').insert(scrapingRow)

  if (saveError) {
    console.error('[analyze-from-cache] Save error:', saveError.message)
    return { ok: false, error: 'save_error', message: `Erreur lors de la sauvegarde: ${saveError.message}` }
  }

  console.log(
    `[analyze-from-cache] user=${userId}: ${matchedCount} matches, ${allProducts.length} total, ${elapsed.toFixed(1)}s`
  )

  return {
    ok: true,
    message: `Comparaison terminée: ${matchedCount} correspondances trouvées`,
    stats: {
      referenceProducts: referenceProducts.length,
      matchedProducts: matchedCount,
      totalProducts: allProducts.length,
      cacheHits: siteProducts.size,
      elapsed: Math.round(elapsed * 10) / 10,
    },
  }
}
