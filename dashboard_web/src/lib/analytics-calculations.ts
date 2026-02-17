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
  disponibilite?: string
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
  return t
}

const KNOWN_BRANDS = [
  'kawasaki', 'honda', 'yamaha', 'suzuki', 'ktm', 'husqvarna',
  'triumph', 'cfmoto', 'cf moto', 'aprilia', 'vespa', 'piaggio', 'ducati',
  'bmw', 'harley-davidson', 'harley davidson', 'indian', 'royal enfield',
  'can-am', 'can am', 'polaris', 'arctic cat', 'sea-doo', 'sea doo',
  'ski-doo', 'ski doo', 'brp', 'segway', 'kymco', 'adly', 'beta',
  'cub cadet', 'john deere', 'gas gas', 'gasgas', 'sherco', 'benelli',
  'mv agusta', 'moto guzzi', 'zero', 'energica', 'sur-ron', 'surron',
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
          rest = rest.replace(/\b(20[12]\d)\b/g, '').replace(/\s+/g, ' ').trim()
          modele = rest
        }
      } else if (!modele) {
        modele = nameNorm.replace(/\b(20[12]\d)\b/g, '').replace(/\s+/g, ' ').trim()
      }
    }
  }

  marque = BRAND_ALIASES[marque] ?? marque

  const DEALER_NOISE_PATTERNS = [
    /\b(?:en\s+vente|disponible|neuf|usage|usag[ée])\s+(?:a|à|chez|au)\b.*/i,
    /\b(?:mvm\s*motosport|morin\s*sports?|moto\s*thibault|moto\s*ducharme)\b.*/i,
    /\b(?:shawinigan|trois\s*[-\s]*rivi[eè]res|montr[ée]al|qu[ée]bec|laval|longueuil|sherbrooke|drummondville|victoriaville|b[ée]cancour)\b.*/i,
    /\b(?:concessionnaire|dealer|showroom|magasin|succursale)\b.*/i,
  ]
  for (const pattern of DEALER_NOISE_PATTERNS) {
    modele = modele.replace(pattern, '').trim()
  }

  return `${marque}|${modele}`
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
    ecartPourcentage: number
    competitif: boolean
    hasCompetitor: boolean
    categorie: string
    sourceSite?: string
    disponibilite?: string
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

function buildMatchedProducts(
  products: Product[],
  referenceSite: string
): MatchedProductGroup[] {
  const normalizedReference = normalizeSiteKey(referenceSite)
  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)

  const groups: Record<string, MatchedProductGroup> = {}

  for (const p of validProducts) {
    const key = normalizeProductGroupKey(p)
    if (!groups[key]) {
      groups[key] = {
        key,
        name: p.name || `${p.marque || ''} ${p.modele || ''}`.trim(),
        categorie: p.category || 'autre',
        referenceProducts: [],
        competitorProducts: [],
        competitorsBySite: {},
        allProducts: [],
      }
    }

    const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
    if (site === normalizedReference) {
      groups[key].referenceProducts.push(p)
    } else {
      groups[key].competitorProducts.push(p)
      if (!groups[key].competitorsBySite[site]) {
        groups[key].competitorsBySite[site] = []
      }
      groups[key].competitorsBySite[site].push(p)
    }
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

  const groups = buildMatchedProducts(products, referenceSite)

  // Ne garder que les groupes avec au moins 1 produit référence ET 1 concurrent
  const matched = groups.filter(
    g => g.referenceProducts.length > 0 && g.competitorProducts.length > 0
  )

  if (matched.length === 0) {
    // Pas de produits matchés — soit un seul site, soit pas de correspondances
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

  // Pour chaque produit matché, calculer l'écart référence vs moyenne concurrents
  let totalEcartPct = 0
  let totalEcartVal = 0

  for (const g of matched) {
    const prixRef = avgPrice(g.referenceProducts)
    const prixComp = avgPrice(g.competitorProducts)
    if (prixRef > 0 && prixComp > 0) {
      totalEcartPct += ((prixRef - prixComp) / prixRef) * 100
      totalEcartVal += prixRef - prixComp
    }
  }

  const ecartPourcentage = totalEcartPct / matched.length
  const ecartValeur = totalEcartVal / matched.length

  // Classement: calculer le prix moyen par site (seulement produits matchés)
  const normalizedReference = normalizeSiteKey(referenceSite)
  const sitePriceSums: Record<string, { total: number; count: number }> = {}

  for (const g of matched) {
    for (const p of g.allProducts) {
      const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
      if (!sitePriceSums[site]) sitePriceSums[site] = { total: 0, count: 0 }
      sitePriceSums[site].total += p.prix
      sitePriceSums[site].count++
    }
  }

  const siteAvgs = Object.entries(sitePriceSums)
    .map(([site, { total, count }]) => ({ site, avg: total / count }))
    .sort((a, b) => a.avg - b.avg)

  const indexTrouve = siteAvgs.findIndex(s => s.site === normalizedReference)
  const classement = indexTrouve >= 0 ? indexTrouve + 1 : 1
  const totalDetailleurs = Math.max(siteAvgs.length, 1)

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
  const message = `Votre prix est ${signe} de ${valeurAbs.toFixed(1)}% à la moyenne des concurrents (basé sur ${matched.length} produit(s) comparable(s)). Classement: ${classement}${getOrdinalSuffix(classement)} sur ${totalDetailleurs} détaillant(s).`

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
    .filter(g => g.referenceProducts.length > 0) // N'inclure que VOS produits
    .map(g => {
      const hasComp = g.competitorProducts.length > 0

      // Prix de référence (notre prix)
      const prix = avgPrice(g.referenceProducts)

      // Prix moyen du marché = moyenne des concurrents SEULEMENT
      const prixMoyenMarche = hasComp
        ? avgPrice(g.competitorProducts)
        : 0

      const ecartPourcentage =
        prix > 0 && hasComp && prixMoyenMarche > 0
          ? ((prix - prixMoyenMarche) / prix) * 100
          : 0

      // Compétitif: uniquement parmi les produits qui ONT des concurrents
      const competitif = hasComp
        ? (prix <= prixMoyenMarche || Math.abs(ecartPourcentage) < 5)
        : true // Sans concurrent = neutre, pas "compétitif"

      const refProd = g.referenceProducts[0]

      return {
        name: g.name,
        prix,
        prixMoyenMarche,
        ecartPourcentage,
        competitif,
        hasCompetitor: hasComp,
        categorie: g.categorie,
        sourceSite: refProd?.sourceSite,
        disponibilite: refProd?.disponibilite,
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
 * Analyse par détaillant: compare chaque site concurrent au site de référence
 * uniquement via les produits matchés. Inclut un breakdown par catégorie.
 */
export function calculateRetailerAnalysis(
  products: Product[],
  referenceSite: string
): AnalyticsData['detailleurs'] {
  if (!products.length) return []

  const groups = buildMatchedProducts(products, referenceSite)
  const normalizedReference = normalizeSiteKey(referenceSite)

  // Collecter tous les sites concurrents
  const competitorSites = new Set<string>()
  for (const g of groups) {
    for (const site of Object.keys(g.competitorsBySite)) {
      competitorSites.add(site)
    }
  }

  // Inclure le site de référence aussi
  const allSites = [normalizedReference, ...Array.from(competitorSites)]

  const results: AnalyticsData['detailleurs'] = []

  for (const site of allSites) {
    const isRef = site === normalizedReference

    // Produits de ce site avec un match (présent sur ≥2 sites)
    let ecartTotal = 0
    let ecartCount = 0
    let promoCount = 0
    let totalProduits = 0
    let prixTotal = 0

    // Par catégorie
    const catStats: Record<string, { prixTotal: number; count: number; ecartTotal: number; ecartCount: number }> = {}

    for (const g of groups) {
      let siteProds: Product[]
      let compareProds: Product[]

      if (isRef) {
        siteProds = g.referenceProducts
        compareProds = g.competitorProducts
      } else {
        siteProds = g.competitorsBySite[site] || []
        compareProds = g.referenceProducts
      }

      if (siteProds.length === 0) continue

      const sitePrix = avgPrice(siteProds)
      const comparePrix = compareProds.length > 0 ? avgPrice(compareProds) : 0

      // Prix de référence pour ce groupe — TOUJOURS utilisé comme dénominateur
      const refPrixForGroup = g.referenceProducts.length > 0 ? avgPrice(g.referenceProducts) : 0

      totalProduits += siteProds.length
      prixTotal += sitePrix * siteProds.length

      if (refPrixForGroup > 0 && comparePrix > 0 && compareProds.length > 0) {
        // Écart: (prixComparaison - prixSite) / prixRéférence
        // Toujours relatif au prix de référence pour cohérence
        const ecart = ((comparePrix - sitePrix) / refPrixForGroup) * 100
        ecartTotal += ecart
        ecartCount++

        // Promo = prix significativement sous le prix de référence
        if (sitePrix < refPrixForGroup * 0.92) {
          promoCount++
        }
      }

      // Stats par catégorie
      const cat = g.categorie
      if (!catStats[cat]) {
        catStats[cat] = { prixTotal: 0, count: 0, ecartTotal: 0, ecartCount: 0 }
      }
      catStats[cat].prixTotal += sitePrix * siteProds.length
      catStats[cat].count += siteProds.length
      if (refPrixForGroup > 0 && comparePrix > 0 && compareProds.length > 0) {
        const ecart = ((comparePrix - sitePrix) / refPrixForGroup) * 100
        catStats[cat].ecartTotal += ecart
        catStats[cat].ecartCount++
      }
    }

    if (totalProduits === 0) continue

    const prixMoyen = prixTotal / totalProduits
    const agressivite = ecartCount > 0 ? ecartTotal / ecartCount : 0
    const frequencePromotions = ecartCount > 0 ? (promoCount / ecartCount) * 100 : 0

    const categorieStats = Object.entries(catStats)
      .filter(([, s]) => s.count > 0)
      .map(([cat, s]) => ({
        categorie: cat,
        prixMoyen: s.prixTotal / s.count,
        agressivite: s.ecartCount > 0 ? s.ecartTotal / s.ecartCount : 0,
        nombreProduits: s.count,
      }))
      .sort((a, b) => b.agressivite - a.agressivite)

    results.push({
      site,
      prixMoyen,
      agressivite,
      frequencePromotions,
      nombreProduits: totalProduits,
      produitsComparables: ecartCount,
      categorieStats,
    })
  }

  // Trier par écart moyen décroissant (le plus compétitif en premier)
  return results.sort((a, b) => b.agressivite - a.agressivite)
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
        if (prixRef <= prixComp || Math.abs(ecart) < 5) {
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

  // Compter les produits non compétitifs (écart > 10%)
  let produitsNonCompetitifs = 0
  let produitsTresCher = 0

  for (const g of groups) {
    if (g.referenceProducts.length === 0 || g.competitorProducts.length === 0) continue
    const prixRef = avgPrice(g.referenceProducts)
    const prixComp = avgPrice(g.competitorProducts)
    if (prixRef <= 0 || prixComp <= 0) continue

    const ecart = ((prixRef - prixComp) / prixRef) * 100
    if (ecart > 5) produitsNonCompetitifs++
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
      message: `${produitsNonCompetitifs} produit(s) non compétitifs (>5% plus chers que la moyenne concurrente)`,
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
