/**
 * Utilitaires pour calculer les métriques Analytics
 *
 * Principe: on regroupe les produits par clé normalisée (marque+modèle)
 * puis on sépare site de référence vs concurrents pour chaque groupe.
 * Seuls les produits "matchés" (présents sur ≥2 sites) sont comparés.
 */

export interface Product {
  name: string
  prix: number
  prixReference?: number | null
  differencePrix?: number | null
  siteReference?: string
  sourceSite?: string
  sourceUrl?: string
  category?: string
  marque?: string
  modele?: string
  annee?: number | null
  disponibilite?: string
  etat?: string
  quantity?: number
  inventaire?: string
  groupedUrls?: string[]
}

function normalizeSiteKey(site?: string): string {
  if (!site) return 'unknown'
  try {
    const value = site.startsWith('http') ? site : `https://${site}`
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return site.replace(/^www\./, '').toLowerCase()
  }
}

// ─── Normalisation unifiée des produits ──────────────────────────────

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function deepNormalize(text: string): string {
  if (!text) return ''
  let t = text.toLowerCase().trim()
  t = stripAccents(t)
  t = t.replace(/([a-z])(\d)/g, '$1 $2')
  t = t.replace(/(\d)([a-z])/g, '$1 $2')
  t = t.replace(/[^a-z0-9\s]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()

  // Fusionner les lettres simples consecutives: "r l" -> "rl", "s x f" -> "sxf"
  // Aligne avec le Python _deep_normalize() pour que les cles soient identiques
  const words = t.split(' ')
  const merged: string[] = []
  let i = 0
  while (i < words.length) {
    if (words[i].length === 1 && /^[a-z]$/.test(words[i])) {
      const letters = [words[i]]
      let j = i + 1
      while (j < words.length && words[j].length === 1 && /^[a-z]$/.test(words[j])) {
        letters.push(words[j])
        j++
      }
      merged.push(letters.length > 1 ? letters.join('') : words[i])
      i = j
    } else {
      merged.push(words[i])
      i++
    }
  }
  return merged.join(' ')
}

export const KNOWN_BRANDS = [
  // Powersports / Moto
  'kawasaki', 'honda', 'yamaha', 'suzuki', 'ktm', 'husqvarna',
  'triumph', 'cfmoto', 'cf moto', 'aprilia', 'vespa', 'piaggio', 'ducati',
  'bmw', 'harley-davidson', 'harley davidson', 'indian', 'royal enfield',
  'can-am', 'can am', 'polaris', 'arctic cat', 'sea-doo', 'sea doo',
  'ski-doo', 'ski doo', 'brp', 'segway', 'kymco', 'adly', 'beta',
  'cub cadet', 'john deere', 'gas gas', 'gasgas', 'sherco', 'benelli',
  'mv agusta', 'moto guzzi', 'zero', 'energica', 'sur-ron', 'surron',
  // Auto
  'ford', 'toyota', 'chevrolet', 'gmc', 'ram', 'jeep', 'dodge', 'chrysler',
  'nissan', 'hyundai', 'kia', 'subaru', 'mazda', 'volkswagen', 'audi',
  'mercedes-benz', 'mercedes benz', 'lexus', 'acura', 'infiniti',
  'lincoln', 'buick', 'cadillac', 'tesla', 'mitsubishi', 'volvo',
  'land rover', 'jaguar', 'porsche', 'mini', 'fiat', 'alfa romeo',
  'genesis', 'rivian', 'lucid', 'polestar',
].sort((a, b) => b.length - a.length)

const NORMALIZED_BRANDS = KNOWN_BRANDS.map(b => [deepNormalize(b), b] as const)

const BRAND_ALIASES: Record<string, string> = {
  'cf moto': 'cfmoto',
  'harley davidson': 'harley davidson',
  'can am': 'can am',
  'sea doo': 'sea doo',
  'ski doo': 'ski doo',
  'gas gas': 'gasgas',
  'sur ron': 'surron',
  'mercedes benz': 'mercedes benz',
  'land rover': 'land rover',
  'alfa romeo': 'alfa romeo',
}

const COLOR_KEYWORDS = new Set([
  'blanc', 'noir', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'rose', 'violet',
  'gris', 'argent', 'or', 'bronze', 'beige', 'marron', 'brun', 'turquoise',
  'brillant', 'mat', 'metallise', 'metallique', 'perle', 'nacre', 'satin', 'chrome', 'carbone',
  'fonce', 'clair', 'fluo', 'neon', 'combat', 'lime', 'sauge', 'cristal', 'obsidian',
  'acide', 'crystal', 'racing',
  'ebene', 'graphite', 'anthracite', 'platine', 'titane',
  'phantom', 'midnight', 'cosmic', 'storm',
  'white', 'black', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
  'gray', 'grey', 'silver', 'gold', 'brown', 'matte', 'glossy', 'pearl', 'carbon',
  'dark', 'light', 'bright', 'etincelle', 'velocite',
].map(w => deepNormalize(w)))

function removeColors(text: string): string {
  if (!text) return ''
  const words = deepNormalize(text).split(/\s+/)
  return words.filter(w => !COLOR_KEYWORDS.has(w)).join(' ').replace(/\s+/g, ' ').trim()
}

function extractYearFromText(text: string): number {
  if (!text) return 0
  const match = text.match(/\b(19|20)\d{2}\b/)
  if (match) {
    const year = parseInt(match[0], 10)
    if (year >= 1900 && year <= 2100) return year
  }
  return 0
}

function extractYearFromUrl(url: string): number {
  if (!url) return 0
  const match = url.match(/[/-](20[12]\d)(?:[/-]|\.html|$)/)
  if (match) return parseInt(match[1], 10)
  const fallback = url.match(/[/-](19\d{2}|20\d{2})(?:[/-]|\.html|$)/)
  if (fallback) {
    const year = parseInt(fallback[1], 10)
    if (year >= 1990 && year <= 2100) return year
  }
  return 0
}

function resolveProductYear(p: Product): number {
  if (p.annee) return p.annee
  const fromName = extractYearFromText(p.name || '')
  if (fromName) return fromName
  return extractYearFromUrl(p.sourceUrl || '')
}

export function normalizeProductGroupKey(p: Product): string {
  let marque = deepNormalize(
    (p.marque || '')
      .replace(/^(manufacturier|fabricant|marque|brand)\s*:\s*/i, '')
  )
  let modele = deepNormalize(
    (p.modele || '')
      .replace(/^(modèle|modele|model)\s*:\s*/i, '')
  )

  const annee = resolveProductYear(p)

  if (!marque || !modele) {
    const nameNorm = deepNormalize(p.name || '')
    if (nameNorm) {
      let detectedBrand = ''
      let rest = nameNorm

      for (const [normBrand] of NORMALIZED_BRANDS) {
        if (nameNorm.startsWith(normBrand + ' ') || nameNorm === normBrand) {
          detectedBrand = normBrand
          rest = nameNorm.slice(normBrand.length).trim()
          break
        }
        const idx = nameNorm.indexOf(normBrand)
        if (idx >= 0) {
          detectedBrand = normBrand
          rest = (nameNorm.slice(0, idx) + ' ' + nameNorm.slice(idx + normBrand.length)).replace(/\s+/g, ' ').trim()
          break
        }
      }

      if (detectedBrand) {
        if (!marque) marque = detectedBrand
        if (!modele) {
          rest = rest.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim()
          modele = rest
        }
      } else if (!modele) {
        modele = nameNorm.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim()
      }
    }
  }

  marque = BRAND_ALIASES[marque] ?? marque

  const DEALER_NOISE_PATTERNS = [
    /\b(?:en\s+vente|disponible|neuf|usage|usag[ée]|occasion)\s+(?:a|à|chez|au)\b.*/i,
    /\bd['\u2019]?occasion\s+(?:a|à|chez|au)\b.*/i,
    /\b(?:a|à)\s+vendre\s+(?:a|à|chez|au)\b.*/i,
    /\b(?:concessionnaire|dealer|showroom|magasin|succursale)\b.*/i,
    /\b\w+\s+(?:motosport|motorsport|powersports?)\s*$/i,
    /\b(?:moto|motos|auto|autos)\s+\w+\s*$/i,
    /\b\w+\s+(?:moto|motos|sport[s]?|auto[s]?|motors?|marine|performance|center|centre)\s*$/i,
  ]
  for (const pattern of DEALER_NOISE_PATTERNS) {
    modele = modele.replace(pattern, '').trim()
  }

  modele = modele.replace(/^(?:c[oô]te\s+[aà]\s+c[oô]te|cote\s+a\s+cote|side\s*by\s*side|sxs)\s+/i, '').trim()
  modele = modele.replace(/^(?:vtt|atv|quad|motoneige|snowmobile|moto|scooter)\s+/i, '').trim()
  modele = modele.replace(/^(?:motomarine|watercraft|jet\s*ski|personal\s+watercraft|pwc)\s+/i, '').trim()
  modele = modele.replace(/^(?:ponton|pontoon|bateau|boat|embarcation)\s+/i, '').trim()
  modele = modele.replace(/^(?:moteur\s+hors[\s-]?bord|outboard|hors[\s-]?bord)\s+/i, '').trim()
  modele = modele.replace(/^(?:sportive|routiere|routière|touring|adventure|aventure|cruiser|custom|standard|naked|enduro|supermoto|trail|dual[\s-]?sport|double[\s-]?usage|sport[\s-]?touring|grand[\s-]?touring|retro)\s+/i, '').trim()
  modele = modele.replace(/^(?:3[\s-]?roues|three[\s-]?wheel|trike)\s+/i, '').trim()
  modele = modele.replace(/^(?:velo[\s-]?electrique|e[\s-]?bike|ebike)\s+/i, '').trim()

  modele = removeColors(modele)
  marque = removeColors(marque)

  modele = modele.replace(/\bpre\s*commande\b/gi, '').replace(/\bpre\s*order\b/gi, '').trim()

  modele = modele.replace(
    /(\d+)\s+(?:th|st|nd|rd|e|eme)\s+(?:annivers\w*|anniv)\b/gi,
    '$1 anniversaire',
  )

  modele = modele.replace(/\s+/g, ' ').trim()

  return `${marque}|${modele}|${annee || 0}|${p.etat || 'neuf'}`
}

export type MatchMode = 'exact' | 'base' | 'no_year' | 'flexible'

const TRIM_SUFFIXES = /\b(?:abs|cbs|tcs|ktrc|eps|dps|ps|se|le|dx|lx|sx|ex|sr|gt|st|rs|ss|rr|limited|ltd|sport|touring|trail|adventure|explore|premium|deluxe|elite|plus|pro|base|standard|special|4x4|awd|2wd|4wd|xt|xt-p|x-tp)\b/gi

function stripModelSuffixes(modele: string): string {
  return modele.replace(TRIM_SUFFIXES, '').replace(/\s+/g, ' ').trim()
}

export function normalizeProductGroupKeyWithMode(p: Product, mode: MatchMode = 'exact'): string {
  const fullKey = normalizeProductGroupKey(p)
  const [marque, modele, annee] = fullKey.split('|')
  const m = (mode === 'base' || mode === 'flexible') ? stripModelSuffixes(modele) : modele
  const y = (mode === 'no_year' || mode === 'flexible') ? '0' : annee
  return `${marque}|${m}|${y}`
}

export { stripModelSuffixes }

function extractModelCore(modele: string): string {
  if (!modele) return modele
  const match = modele.match(/^(.*?\b\d+)\b/)
  if (match) return match[1].replace(/\s+/g, ' ').trim()
  return modele.split(/\s+/)[0] || modele
}

export function getProductFamilyKey(p: Product): string {
  const fullKey = normalizeProductGroupKey(p)
  const [marque, modele] = fullKey.split('|')
  return `${marque}|${extractModelCore(modele)}`
}

// ─── Interfaces ─────────────────────────────────────────────────────

export interface ScrapeMetadata {
  reference_url?: string
  reference_products_count?: number
  competitor_urls?: string[]
  total_matched_products?: number
  scraping_time_seconds?: number
  mode?: string
}

export interface CategoryStats {
  categorie: string
  nombreProduits: number
  prixMoyenReference: number
  prixMoyenConcurrents: number
  ecartMoyenPourcentage: number
  competitifs: number
  nonCompetitifs: number
  detailParDetaillant: Array<{
    site: string
    prixMoyen: number
    ecartPourcentage: number
    nombreProduits: number
  }>
}

export interface AnalyticsData {
  positionnement: {
    position: 'lowest' | 'average' | 'above'
    ecartPourcentage: number
    ecartValeur: number
    classement: number
    totalDetailleurs: number
    message: string
  }
  produits: Array<{
    name: string
    prix: number
    prixMoyenMarche: number
    prixMinMarche: number
    ecartPourcentage: number
    ecartPourcentageMin: number
    competitif: boolean
    hasCompetitor: boolean
    categorie: string
    sourceSite?: string
    disponibilite?: string
    etat?: string
    inventaire?: string
  }>
  evolutionPrix: Array<{
    date: string
    prixReference: number
    prixMoyenMarche: number
    prixConcurrents: Record<string, number>
  }>
  opportunites: Array<{
    type: 'augmentation' | 'baisse' | 'marge'
    produit: string
    recommandation: string
    impactPotentiel: number
    categorie?: string
  }>
  detailleurs: Array<{
    site: string
    prixMoyen: number
    agressivite: number
    frequencePromotions: number
    nombreProduits: number
    produitsComparables: number
    isReference: boolean
    categorieStats: Array<{
      categorie: string
      prixMoyen: number
      agressivite: number
      nombreProduits: number
    }>
  }>
  categories: CategoryStats[]
  alertes: Array<{
    type: 'concurrent' | 'ecart' | 'nouveau'
    message: string
    severite: 'low' | 'medium' | 'high'
    date: string
  }>
  stats: {
    prixMoyen: number
    heuresEconomisees: number
    nombreScrapes: number
    scrapesParJour: Array<{ date: string; count: number }>
  }
}

// ─── Helper: groupement de produits matchés ─────────────────────────

interface MatchedProductGroup {
  key: string
  name: string
  categorie: string
  referenceProducts: Product[]
  competitorProducts: Product[]
  competitorsBySite: Record<string, Product[]>
  allProducts: Product[]
}

/**
 * Construit les groupes de produits matchés en se basant sur prixReference
 * (le matching déjà effectué par le scraper Python) pour garantir la
 * cohérence avec le Comparatif du dashboard.
 *
 * Seuls les produits avec prixReference (effectivement matchés) sont inclus.
 * Le prix de référence (« Votre Prix ») provient de prixReference, pas
 * d'une moyenne recalculée côté frontend.
 */
function buildMatchedProducts(
  products: Product[],
  referenceSite: string
): MatchedProductGroup[] {
  const normalizedReference = normalizeSiteKey(referenceSite)
  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)

  // Indexer les produits du site de référence par clé pour enrichir les groupes
  const refProductsByKey: Record<string, Product> = {}
  for (const p of validProducts) {
    const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
    if (site === normalizedReference) {
      const key = normalizeProductGroupKey(p)
      if (!refProductsByKey[key]) refProductsByKey[key] = p
    }
  }

  // Grouper les produits concurrents matchés (ceux avec prixReference)
  const groups: Record<string, MatchedProductGroup> = {}

  for (const p of validProducts) {
    if (p.prixReference == null || p.prixReference <= 0) continue

    const key = normalizeProductGroupKey(p)
    if (!groups[key]) {
      const refProduct = refProductsByKey[key]
      // Créer un produit synthétique « référence » avec le prix prixReference
      const syntheticRef: Product = refProduct
        ? { ...refProduct, prix: p.prixReference }
        : { name: p.name || '', prix: p.prixReference, category: p.category, sourceSite: referenceSite }
      groups[key] = {
        key,
        name: syntheticRef.name || `${p.marque || ''} ${p.modele || ''}`.trim(),
        categorie: syntheticRef.category || p.category || 'autre',
        referenceProducts: [syntheticRef],
        competitorProducts: [],
        competitorsBySite: {},
        allProducts: [syntheticRef],
      }
    }

    const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
    groups[key].competitorProducts.push(p)
    if (!groups[key].competitorsBySite[site]) {
      groups[key].competitorsBySite[site] = []
    }
    groups[key].competitorsBySite[site].push(p)
    groups[key].allProducts.push(p)
  }

  return Object.values(groups)
}

/**
 * Retourne le prix moyen d'une liste de produits.
 */
function avgPrice(prods: Product[]): number {
  if (!prods.length) return 0
  return prods.reduce((s, p) => s + p.prix, 0) / prods.length
}

// ─── Calculs ────────────────────────────────────────────────────────

/**
 * Positionnement de prix : compare le prix de référence aux concurrents
 * uniquement pour les produits matchés (présents sur ≥2 sites).
 *
 * Cohérence : on s'appuie sur exactement le même calcul que
 * `calculateRetailerAnalysis` afin que la carte « Positionnement de Prix »
 * affiche le même % et le même classement que le tableau « Position de
 * votre site ». L'écart est pondéré par site (et non par produit) et le
 * classement est tiré du tri par agressivité.
 */
export function calculatePricePositioning(
  products: Product[],
  referenceSite: string
): AnalyticsData['positionnement'] {
  if (!products.length) {
    return {
      position: 'average',
      ecartPourcentage: 0,
      ecartValeur: 0,
      classement: 1,
      totalDetailleurs: 0,
      message: 'Aucune donnée disponible — effectuez un scraping pour voir les analyses.',
    }
  }

  const detailleurs = calculateRetailerAnalysis(products, referenceSite)
  const comparableDetailleurs = detailleurs.filter(d => d.produitsComparables > 0)
  const refSite = detailleurs.find(d => d.isReference)

  if (!refSite || refSite.produitsComparables === 0) {
    const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)
    const sites = new Set(validProducts.map(p => normalizeSiteKey(p.sourceSite || p.sourceUrl)))

    if (sites.size <= 1) {
      return {
        position: 'average',
        ecartPourcentage: 0,
        ecartValeur: 0,
        classement: 1,
        totalDetailleurs: 1,
        message: 'Un seul site analysé. Ajoutez des concurrents pour obtenir des comparaisons.',
      }
    }

    return {
      position: 'average',
      ecartPourcentage: 0,
      ecartValeur: 0,
      classement: 1,
      totalDetailleurs: sites.size,
      message: 'Aucun produit identique trouvé entre votre site et les concurrents. Vérifiez que les noms de produits correspondent.',
    }
  }

  // % d'écart de la référence vs moyenne des autres sites (pondéré par site)
  // — strictement aligné avec la valeur affichée dans RetailerAnalysis.
  const ecartPourcentage = refSite.agressivite

  // Écart moyen en valeur ($) calculé sur la même base : prixRef vs moyenne
  // des autres sites présents dans chaque groupe matché.
  const normalizedReference = normalizeSiteKey(referenceSite)
  const groups = buildMatchedProducts(products, referenceSite)
  let valSum = 0
  let valCount = 0
  for (const g of groups) {
    if (g.referenceProducts.length === 0) continue
    const prixRef = avgPrice(g.referenceProducts)
    const otherSitePrices: number[] = []
    for (const [site, prods] of Object.entries(g.competitorsBySite)) {
      if (site !== normalizedReference && prods.length > 0) {
        otherSitePrices.push(avgPrice(prods))
      }
    }
    if (otherSitePrices.length === 0 || prixRef <= 0) continue
    const avgOthers = otherSitePrices.reduce((s, v) => s + v, 0) / otherSitePrices.length
    valSum += prixRef - avgOthers
    valCount++
  }
  const ecartValeur = valCount > 0 ? valSum / valCount : 0

  // Classement = rang dans la liste triée par agressivité (asc), strictement
  // identique au rang affiché dans le tableau « Position de votre site ».
  const indexRef = comparableDetailleurs.findIndex(d => d.isReference)
  const classement = indexRef >= 0 ? indexRef + 1 : 1
  const totalDetailleurs = Math.max(comparableDetailleurs.length, 1)

  let position: 'lowest' | 'average' | 'above'
  if (ecartPourcentage < -2) {
    position = 'lowest'
  } else if (ecartPourcentage > 2) {
    position = 'above'
  } else {
    position = 'average'
  }

  const signe = ecartPourcentage >= 0 ? 'supérieur' : 'inférieur'
  const valeurAbs = Math.abs(ecartPourcentage)
  const message = `Votre prix est ${signe} de ${valeurAbs.toFixed(1)}% à la moyenne des concurrents (basé sur ${refSite.produitsComparables} produit(s) comparable(s)). Classement: ${classement}${getOrdinalSuffix(classement)} sur ${totalDetailleurs} détaillant(s).`

  return {
    position,
    ecartPourcentage,
    ecartValeur,
    classement,
    totalDetailleurs,
    message,
  }
}

/**
 * Analyse par produit : pour chaque produit groupé, compare prix référence
 * vs moyenne des concurrents (excluant la référence).
 */
export function calculateProductAnalysis(
  products: Product[],
  referenceSite: string
): AnalyticsData['produits'] {
  if (!products.length) return []

  const groups = buildMatchedProducts(products, referenceSite)
  if (!groups.length) return []

  return groups
    .filter(g => g.referenceProducts.length > 0)
    .map(g => {
      const hasComp = g.competitorProducts.length > 0

      const prix = avgPrice(g.referenceProducts)

      const prixMoyenMarche = hasComp
        ? avgPrice(g.competitorProducts)
        : 0

      const prixMinMarche = hasComp
        ? Math.min(...g.competitorProducts.map(p => p.prix))
        : 0

      const ecartPourcentage =
        prix > 0 && hasComp && prixMoyenMarche > 0
          ? ((prix - prixMoyenMarche) / prix) * 100
          : 0

      const ecartPourcentageMin =
        prix > 0 && hasComp && prixMinMarche > 0
          ? ((prix - prixMinMarche) / prix) * 100
          : 0

      const competitif = hasComp
        ? (prix <= prixMoyenMarche || Math.abs(ecartPourcentage) < 0.5)
        : true

      const refProd = g.referenceProducts[0]

      return {
        name: g.name,
        prix,
        prixMoyenMarche,
        prixMinMarche,
        ecartPourcentage,
        ecartPourcentageMin,
        competitif,
        hasCompetitor: hasComp,
        categorie: g.categorie,
        sourceSite: refProd?.sourceSite,
        disponibilite: refProd?.disponibilite,
        etat: refProd?.etat,
        inventaire: refProd?.inventaire,
      }
    })
    .filter(p => p.prix > 0)
}

/**
 * Opportunités: détecte les écarts exploitables.
 * Utilise la moyenne des concurrents (excluant la référence).
 */
export function calculateOpportunities(
  products: Product[],
  referenceSite: string
): AnalyticsData['opportunites'] {
  const opportunites: AnalyticsData['opportunites'] = []

  const groups = buildMatchedProducts(products, referenceSite)

  for (const g of groups) {
    if (g.referenceProducts.length === 0 || g.competitorProducts.length === 0) {
      continue
    }

    const prixRef = avgPrice(g.referenceProducts)
    const prixMoyenComp = avgPrice(g.competitorProducts)

    if (prixMoyenComp <= 0 || prixRef <= 0) continue

    const ecartPct = ((prixRef - prixMoyenComp) / prixRef) * 100

    // Opportunité d'augmentation: notre prix est nettement inférieur aux concurrents
    if (prixRef < prixMoyenComp && Math.abs(ecartPct) >= 3 && Math.abs(ecartPct) < 15) {
      const augmentationPossible = prixMoyenComp - prixRef
      opportunites.push({
        type: 'augmentation',
        produit: g.name,
        categorie: g.categorie,
        recommandation: `Augmenter le prix de ${augmentationPossible.toFixed(2)}$ pour se rapprocher de la moyenne des concurrents (${prixMoyenComp.toFixed(2)}$)`,
        impactPotentiel: augmentationPossible,
      })
    }

    // Opportunité de baisse: notre prix est nettement supérieur aux concurrents
    if (prixRef > prixMoyenComp && ecartPct > 8) {
      const baisseRecommandee = (prixRef - prixMoyenComp) * 0.5
      opportunites.push({
        type: 'baisse',
        produit: g.name,
        categorie: g.categorie,
        recommandation: `Baisser le prix de ${baisseRecommandee.toFixed(2)}$ pour redevenir compétitif (concurrents à ${prixMoyenComp.toFixed(2)}$ en moyenne)`,
        impactPotentiel: prixRef - prixMoyenComp,
      })
    }

    // Opportunité de marge: majorité des concurrents sont plus chers
    const sitesCherCount = Object.values(g.competitorsBySite).filter(prods => {
      const avg = avgPrice(prods)
      return avg > prixRef * 1.08
    }).length
    const totalCompSites = Object.keys(g.competitorsBySite).length
    if (totalCompSites >= 2 && sitesCherCount >= Math.ceil(totalCompSites * 0.6)) {
      opportunites.push({
        type: 'marge',
        produit: g.name,
        categorie: g.categorie,
        recommandation: `Marge potentielle: ${sitesCherCount}/${totalCompSites} concurrents sont plus chers de >8%`,
        impactPotentiel: prixRef * 0.05,
      })
    }
  }

  return opportunites.sort((a, b) => b.impactPotentiel - a.impactPotentiel)
}

/**
 * Analyse par détaillant: chaque site est comparé à la moyenne de TOUS les
 * autres sites sur les produits matchés.
 *
 * Résultat: agressivite > 0 = plus cher que la moyenne, < 0 = moins cher.
 */
export function calculateRetailerAnalysis(
  products: Product[],
  referenceSite: string
): AnalyticsData['detailleurs'] {
  if (!products.length) return []

  const groups = buildMatchedProducts(products, referenceSite)
  const normalizedReference = normalizeSiteKey(referenceSite)

  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)
  const totalProductsBySite: Record<string, number> = {}
  for (const p of validProducts) {
    const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
    totalProductsBySite[site] = (totalProductsBySite[site] || 0) + 1
  }

  const allSitesSet = new Set<string>()
  allSitesSet.add(normalizedReference)
  for (const g of groups) {
    for (const site of Object.keys(g.competitorsBySite)) {
      allSitesSet.add(site)
    }
  }

  type SiteAcc = { ecartTotal: number; ecartCount: number; priceTotal: number; priceCount: number }
  const siteAcc: Record<string, SiteAcc> = {}
  const siteCatAcc: Record<string, Record<string, SiteAcc>> = {}

  for (const site of allSitesSet) {
    siteAcc[site] = { ecartTotal: 0, ecartCount: 0, priceTotal: 0, priceCount: 0 }
    siteCatAcc[site] = {}
  }

  for (const g of groups) {
    if (g.referenceProducts.length === 0 && g.competitorProducts.length === 0) continue

    const pricesBySite: Record<string, number> = {}

    if (g.referenceProducts.length > 0) {
      pricesBySite[normalizedReference] = avgPrice(g.referenceProducts)
    }
    for (const [site, prods] of Object.entries(g.competitorsBySite)) {
      if (prods.length > 0) {
        pricesBySite[site] = avgPrice(prods)
      }
    }

    const sitesInGroup = Object.keys(pricesBySite)
    if (sitesInGroup.length < 2) continue

    for (const site of sitesInGroup) {
      const otherPrices = sitesInGroup.filter(s => s !== site).map(s => pricesBySite[s])
      const avgOthers = otherPrices.reduce((s, v) => s + v, 0) / otherPrices.length
      if (avgOthers <= 0) continue

      const ecart = ((pricesBySite[site] - avgOthers) / avgOthers) * 100

      siteAcc[site].ecartTotal += ecart
      siteAcc[site].ecartCount++
      siteAcc[site].priceTotal += pricesBySite[site]
      siteAcc[site].priceCount++

      const cat = g.categorie
      if (!siteCatAcc[site][cat]) {
        siteCatAcc[site][cat] = { ecartTotal: 0, ecartCount: 0, priceTotal: 0, priceCount: 0 }
      }
      siteCatAcc[site][cat].ecartTotal += ecart
      siteCatAcc[site][cat].ecartCount++
      siteCatAcc[site][cat].priceTotal += pricesBySite[site]
      siteCatAcc[site][cat].priceCount++
    }
  }

  const results: AnalyticsData['detailleurs'] = []

  for (const site of allSitesSet) {
    const acc = siteAcc[site]
    if (acc.ecartCount === 0 && !totalProductsBySite[site]) continue

    const agressivite = acc.ecartCount > 0 ? acc.ecartTotal / acc.ecartCount : 0
    const prixMoyen = acc.priceCount > 0 ? acc.priceTotal / acc.priceCount : 0

    const categorieStats = Object.entries(siteCatAcc[site] || {})
      .filter(([, s]) => s.ecartCount > 0)
      .map(([cat, s]) => ({
        categorie: cat,
        prixMoyen: s.priceTotal / s.priceCount,
        agressivite: s.ecartTotal / s.ecartCount,
        nombreProduits: s.priceCount,
      }))
      .sort((a, b) => a.agressivite - b.agressivite)

    results.push({
      site,
      prixMoyen,
      agressivite,
      frequencePromotions: 0,
      nombreProduits: totalProductsBySite[site] || 0,
      produitsComparables: acc.ecartCount,
      isReference: site === normalizedReference,
      categorieStats,
    })
  }

  return results.sort((a, b) => a.agressivite - b.agressivite)
}

/**
 * Analyse par catégorie: pour chaque catégorie, prix moyen de référence
 * vs concurrents, avec détail par détaillant.
 */
export function calculateCategoryAnalysis(
  products: Product[],
  referenceSite: string
): CategoryStats[] {
  if (!products.length) return []

  const groups = buildMatchedProducts(products, referenceSite)
  const normalizedReference = normalizeSiteKey(referenceSite)

  // Grouper par catégorie
  const catGroups: Record<string, MatchedProductGroup[]> = {}
  for (const g of groups) {
    const cat = g.categorie
    if (!catGroups[cat]) catGroups[cat] = []
    catGroups[cat].push(g)
  }

  const results: CategoryStats[] = []

  for (const [cat, catProductGroups] of Object.entries(catGroups)) {
    // Filtrer les groupes matchés (référence + concurrent)
    const matched = catProductGroups.filter(
      g => g.referenceProducts.length > 0 && g.competitorProducts.length > 0
    )

    // Tous les produits de référence de cette catégorie
    const allRefProds = catProductGroups.flatMap(g => g.referenceProducts)
    const allCompProds = catProductGroups.flatMap(g => g.competitorProducts)

    const prixMoyenReference = allRefProds.length > 0 ? avgPrice(allRefProds) : 0
    const prixMoyenConcurrents = allCompProds.length > 0 ? avgPrice(allCompProds) : prixMoyenReference

    // Écart moyen basé sur produits matchés uniquement
    let ecartTotal = 0
    let compCount = 0
    let nonCompCount = 0

    for (const g of matched) {
      const prixRef = avgPrice(g.referenceProducts)
      const prixComp = avgPrice(g.competitorProducts)
      if (prixRef > 0 && prixComp > 0) {
        const ecart = ((prixRef - prixComp) / prixRef) * 100
        ecartTotal += ecart
        if (prixRef <= prixComp || Math.abs(ecart) < 0.5) {
          compCount++
        } else {
          nonCompCount++
        }
      }
    }
    const ecartMoyenPourcentage = matched.length > 0 ? ecartTotal / matched.length : 0

    // Détail par détaillant concurrent
    const competitorSites = new Set<string>()
    for (const g of catProductGroups) {
      for (const site of Object.keys(g.competitorsBySite)) {
        competitorSites.add(site)
      }
    }

    const detailParDetaillant: CategoryStats['detailParDetaillant'] = []

    for (const site of competitorSites) {
      let siteEcartTotal = 0
      let siteEcartCount = 0
      let sitePrixTotal = 0
      let siteProdCount = 0

      for (const g of catProductGroups) {
        const siteProds = g.competitorsBySite[site] || []
        if (siteProds.length === 0 || g.referenceProducts.length === 0) continue

        const sitePrix = avgPrice(siteProds)
        const refPrix = avgPrice(g.referenceProducts)

        sitePrixTotal += sitePrix * siteProds.length
        siteProdCount += siteProds.length

        if (refPrix > 0) {
          siteEcartTotal += ((sitePrix - refPrix) / refPrix) * 100
          siteEcartCount++
        }
      }

      if (siteProdCount > 0) {
        detailParDetaillant.push({
          site,
          prixMoyen: sitePrixTotal / siteProdCount,
          ecartPourcentage: siteEcartCount > 0 ? siteEcartTotal / siteEcartCount : 0,
          nombreProduits: siteProdCount,
        })
      }
    }

    detailParDetaillant.sort((a, b) => a.ecartPourcentage - b.ecartPourcentage)

    results.push({
      categorie: cat,
      nombreProduits: allRefProds.length + allCompProds.length,
      prixMoyenReference,
      prixMoyenConcurrents,
      ecartMoyenPourcentage,
      competitifs: compCount,
      nonCompetitifs: nonCompCount,
      detailParDetaillant,
    })
  }

  // Trier par nombre de produits décroissant
  return results.sort((a, b) => b.nombreProduits - a.nombreProduits)
}

/**
 * Alertes automatiques basées sur les produits matchés.
 */
export function calculateAlerts(
  products: Product[],
  referenceSite: string
): AnalyticsData['alertes'] {
  const alertes: AnalyticsData['alertes'] = []
  const groups = buildMatchedProducts(products, referenceSite)
  const now = new Date().toISOString()

  // Compter les produits non compétitifs (écart > 0.5%)
  let produitsNonCompetitifs = 0
  let produitsTresCher = 0

  for (const g of groups) {
    if (g.referenceProducts.length === 0 || g.competitorProducts.length === 0) continue
    const prixRef = avgPrice(g.referenceProducts)
    const prixComp = avgPrice(g.competitorProducts)
    if (prixRef <= 0 || prixComp <= 0) continue

    const ecart = ((prixRef - prixComp) / prixRef) * 100
    if (ecart > 0.5) produitsNonCompetitifs++
    if (ecart > 15) produitsTresCher++
  }

  if (produitsTresCher > 0) {
    alertes.push({
      type: 'ecart',
      message: `${produitsTresCher} produit(s) sont >15% plus chers que les concurrents`,
      severite: 'high',
      date: now,
    })
  }

  if (produitsNonCompetitifs > produitsTresCher && produitsNonCompetitifs > 0) {
    alertes.push({
      type: 'ecart',
      message: `${produitsNonCompetitifs} produit(s) non compétitifs (>0.5% plus chers que la moyenne concurrente)`,
      severite: produitsNonCompetitifs > 10 ? 'high' : produitsNonCompetitifs > 5 ? 'medium' : 'low',
      date: now,
    })
  }

  // Produits sans correspondance (référence seulement)
  const refOnlyCount = groups.filter(
    g => g.referenceProducts.length > 0 && g.competitorProducts.length === 0
  ).length
  if (refOnlyCount > 0) {
    alertes.push({
      type: 'nouveau',
      message: `${refOnlyCount} produit(s) de votre site n'ont aucune correspondance chez les concurrents`,
      severite: 'low',
      date: now,
    })
  }

  // Produits concurrents non sur le site de référence
  const compOnlyCount = groups.filter(
    g => g.referenceProducts.length === 0 && g.competitorProducts.length > 0
  ).length
  if (compOnlyCount > 0) {
    alertes.push({
      type: 'concurrent',
      message: `${compOnlyCount} produit(s) trouvés chez les concurrents mais absents de votre site`,
      severite: compOnlyCount > 5 ? 'medium' : 'low',
      date: now,
    })
  }

  return alertes.slice(0, 10)
}

/**
 * Statistiques générales.
 */
export function calculateStats(
  products: Product[],
  scrapesParJour: Array<{ date: string; count: number }>,
  totalScrapes?: number
): AnalyticsData['stats'] {
  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)
  const prixMoyen =
    validProducts.length > 0
      ? validProducts.reduce((sum, p) => sum + p.prix, 0) / validProducts.length
      : 0

  // Heures économisées: estimation basée sur le nombre de comparaisons effectives
  // Comparer 1 produit manuellement ≈ 2 minutes (chercher, noter, comparer)
  const heuresEconomisees = (validProducts.length * 2) / 60

  return {
    prixMoyen,
    heuresEconomisees,
    nombreScrapes:
      totalScrapes ?? scrapesParJour.reduce((sum, d) => sum + d.count, 0),
    scrapesParJour,
  }
}

/**
 * Évolution des prix dans le temps.
 * Nécessite des données historiques multi-scraping (pas encore implémenté).
 */
export function calculatePriceEvolution(
  _products: Product[]
): AnalyticsData['evolutionPrix'] {
  void _products
  return []
}

function getOrdinalSuffix(n: number): string {
  if (n === 1) return 'er'
  return 'e'
}
