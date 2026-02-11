/**
 * Utilitaires pour calculer les métriques Analytics
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
// Doit correspondre à la logique Python dans scraper_ai/main.py

/**
 * Retire les accents (é→e, è→e, etc.)
 */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Normalisation profonde : minuscules, sans accents, sans ponctuation,
 * espaces insérés entre lettres et chiffres collés (ninja500 → ninja 500).
 */
export function deepNormalize(text: string): string {
  if (!text) return ''
  let t = text.toLowerCase().trim()
  t = stripAccents(t)
  // Insérer espace entre lettres/chiffres collés
  t = t.replace(/([a-z])(\d)/g, '$1 $2')
  t = t.replace(/(\d)([a-z])/g, '$1 $2')
  // Retirer tout sauf lettres, chiffres, espaces
  t = t.replace(/[^a-z0-9\s]/g, ' ')
  // Unifier espaces
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

/**
 * Génère une clé normalisée (marque, modele) pour un produit.
 * Identique à la logique Python `normalize_product_key` mais retourne un string unique.
 */
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
          // Retirer l'année
          rest = rest.replace(/\b(20[12]\d)\b/g, '').replace(/\s+/g, ' ').trim()
          modele = rest
        }
      } else if (!modele) {
        modele = nameNorm.replace(/\b(20[12]\d)\b/g, '').replace(/\s+/g, ' ').trim()
      }
    }
  }

  marque = BRAND_ALIASES[marque] ?? marque

  // Nettoyer les phrases parasites de localisation/concession dans le modèle
  const DEALER_NOISE_PATTERNS = [
    /\b(?:en\s+vente|disponible|neuf|usage|usag[ée])\s+(?:a|à|chez|au)\b.*/i,
    /\b(?:mvm\s*motosport|morin\s*sports?|moto\s*thibault|moto\s*ducharme)\b.*/i,
    /\b(?:shawinigan|trois\s*[-\s]*rivi[eè]res|montr[ée]al|qu[ée]bec|laval|longueuil|sherbrooke|drummondville|victoriaville|b[ée]cancour)\b.*/i,
    /\b(?:concessionnaire|dealer|showroom|magasin|succursale)\b.*/i,
  ]
  for (const pattern of DEALER_NOISE_PATTERNS) {
    modele = modele.replace(pattern, '').trim()
  }

  // Clé unique: "marque|modele"
  return `${marque}|${modele}`
}

export interface ScrapeMetadata {
  reference_url?: string
  reference_products_count?: number
  competitor_urls?: string[]
  total_matched_products?: number
  scraping_time_seconds?: number
  mode?: string
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
    categorie: string
    sourceSite?: string
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
  }>
  detailleurs: Array<{
    site: string
    prixMoyen: number
    agressivite: number
    frequencePromotions: number
    nombreProduits: number
  }>
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

/**
 * Calcule le positionnement de prix par rapport au marché
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
      message: 'Aucune donnée disponible - effectuez un scraping pour voir les analyses.'
    }
  }

  // Filtrer les produits avec prix valides (prix > 0 et < 500k pour éviter les IDs/erreurs)
  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)

  if (!validProducts.length) {
    return {
      position: 'average',
      ecartPourcentage: 0,
      ecartValeur: 0,
      classement: 1,
      totalDetailleurs: 1,
      message: 'Aucun produit avec prix valide détecté.'
    }
  }

  // Grouper les produits par site
  const productsBySite: Record<string, Product[]> = {}
  validProducts.forEach(p => {
    const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
    if (!productsBySite[site]) {
      productsBySite[site] = []
    }
    productsBySite[site].push(p)
  })

  // Calculer le prix moyen par site
  const prixMoyenParSite: Record<string, number> = {}
  Object.entries(productsBySite).forEach(([site, prods]) => {
    const total = prods.reduce((sum, p) => sum + p.prix, 0)
    prixMoyenParSite[site] = total / prods.length
  })

  // Identifier le site de référence
  const normalizedReference = normalizeSiteKey(referenceSite)
  const referencePrixMoyen = prixMoyenParSite[normalizedReference] || prixMoyenParSite[Object.keys(prixMoyenParSite)[0]]

  // Calculer la moyenne du marché (tous les sites sauf référence)
  const autresSites = Object.entries(prixMoyenParSite).filter(([site]) => site !== normalizedReference)
  const prixMoyenMarche = autresSites.length > 0
    ? autresSites.reduce((sum, [, prix]) => sum + prix, 0) / autresSites.length
    : referencePrixMoyen

  // Calculer l'écart
  const ecartValeur = referencePrixMoyen - prixMoyenMarche
  const ecartPourcentage = prixMoyenMarche > 0
    ? (ecartValeur / prixMoyenMarche) * 100
    : 0

  // Trier les sites par prix moyen (du moins cher au plus cher)
  const sitesTries = Object.entries(prixMoyenParSite).sort(([, a], [, b]) => a - b)
  const indexTrouve = sitesTries.findIndex(([site]) => site === normalizedReference)
  const classement = indexTrouve >= 0 ? indexTrouve + 1 : 1  // Si non trouvé, défaut à 1
  const totalDetailleurs = Math.max(sitesTries.length, 1)  // Au minimum 1

  // Déterminer la position
  let position: 'lowest' | 'average' | 'above'
  if (ecartPourcentage < -2) {
    position = 'lowest'
  } else if (ecartPourcentage > 2) {
    position = 'above'
  } else {
    position = 'average'
  }

  // Formater le message
  const signe = ecartPourcentage >= 0 ? 'supérieur' : 'inférieur'
  const valeurAbs = Math.abs(ecartPourcentage)
  const message = `Notre prix est ${signe} de ${valeurAbs.toFixed(1)}% à la moyenne du marché et se situe au ${classement}${getOrdinalSuffix(classement)} rang sur ${totalDetailleurs} détaillants.`

  return {
    position,
    ecartPourcentage,
    ecartValeur,
    classement,
    totalDetailleurs,
    message
  }
}

/**
 * Calcule l'analyse par produit
 */
export function calculateProductAnalysis(
  products: Product[],
  referenceSite: string
): AnalyticsData['produits'] {
  if (!products.length) return []

  // Filtrer les produits avec prix valides (pas d'IDs ou valeurs aberrantes)
  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)
  if (!validProducts.length) return []

  // Grouper les produits par clé normalisée (marque + modèle)
  const productsByKey: Record<string, { name: string; products: Product[] }> = {}
  validProducts.forEach(p => {
    const key = normalizeProductGroupKey(p)
    if (!productsByKey[key]) {
      productsByKey[key] = { name: p.name || `${p.marque} ${p.modele}`, products: [] }
    }
    productsByKey[key].products.push(p)
  })

  // Calculer pour chaque produit
  return Object.entries(productsByKey).map(([, group]) => {
    const name = group.name
    const prods = group.products
    const validProds = prods.filter(p => p.prix > 0 && p.prix < 500000)
    if (!validProds.length) {
      return {
        name,
        prix: 0,
        prixMoyenMarche: 0,
        ecartPourcentage: 0,
        competitif: false,
        categorie: prods[0]?.category || 'autre',
        sourceSite: prods[0]?.sourceSite
      }
    }

    // Prix moyen du produit sur tous les sites
    const prixMoyenMarche = validProds.reduce((sum, p) => sum + p.prix, 0) / validProds.length

    const normalizedReference = normalizeSiteKey(referenceSite)
    // Prix de référence: produit du site de référence, sinon fallback existant
    const referenceProduct =
      validProds.find(p => normalizeSiteKey(p.sourceSite || p.sourceUrl) === normalizedReference) ||
      validProds.find(p => p.prixReference) ||
      validProds[0]
    const prix = referenceProduct.prix

    const ecartPourcentage = prixMoyenMarche > 0
      ? ((prix - prixMoyenMarche) / prixMoyenMarche) * 100
      : 0

    // Compétitif si prix < moyenne ou écart < 5%
    const competitif = prix < prixMoyenMarche || Math.abs(ecartPourcentage) < 5

    return {
      name,
      prix,
      prixMoyenMarche,
      ecartPourcentage,
      competitif,
      categorie: referenceProduct.category || 'autre',
      sourceSite: referenceProduct.sourceSite
    }
  })
}

/**
 * Calcule les opportunités
 */
export function calculateOpportunities(
  products: Product[],
  referenceSite: string
): AnalyticsData['opportunites'] {
  const opportunites: AnalyticsData['opportunites'] = []

  // Filtrer les produits avec prix valides
  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)
  if (!validProducts.length) return []

  // Grouper par produit (clé normalisée)
  const productsByKey: Record<string, { name: string; products: Product[] }> = {}
  validProducts.forEach(p => {
    const key = normalizeProductGroupKey(p)
    if (!productsByKey[key]) {
      productsByKey[key] = { name: p.name || `${p.marque} ${p.modele}`, products: [] }
    }
    productsByKey[key].products.push(p)
  })

  Object.entries(productsByKey).forEach(([, group]) => {
    const name = group.name
    const prods = group.products
    const validProds = prods.filter(p => p.prix > 0 && p.prix < 500000)
    if (validProds.length < 2) return // Besoin d'au moins 2 sites pour comparer

    const prixMoyenMarche = validProds.reduce((sum, p) => sum + p.prix, 0) / validProds.length
    const normalizedReference = normalizeSiteKey(referenceSite)
    const referenceProduct =
      validProds.find(p => normalizeSiteKey(p.sourceSite || p.sourceUrl) === normalizedReference) ||
      validProds[0]
    const prixReference = referenceProduct.prix
    const ecartPourcentage = prixMoyenMarche > 0
      ? ((prixReference - prixMoyenMarche) / prixMoyenMarche) * 100
      : 0

    // Opportunité d'augmentation : prix < moyenne mais proche
    if (prixReference < prixMoyenMarche && Math.abs(ecartPourcentage) < 10) {
      const augmentationPossible = prixMoyenMarche - prixReference
      opportunites.push({
        type: 'augmentation',
        produit: name,
        recommandation: `Augmenter le prix de ${augmentationPossible.toFixed(2)}$ pour se rapprocher de la moyenne du marché`,
        impactPotentiel: augmentationPossible * validProds.length
      })
    }

    // Opportunité de baisse : prix > moyenne + 10% et volume élevé
    if (prixReference > prixMoyenMarche && ecartPourcentage > 10 && validProds.length >= 3) {
      const baisseRecommandee = (prixReference - prixMoyenMarche) * 0.5 // Baisser de 50% de l'écart
      opportunites.push({
        type: 'baisse',
        produit: name,
        recommandation: `Baisser le prix de ${baisseRecommandee.toFixed(2)}$ pour redevenir compétitif`,
        impactPotentiel: baisseRecommandee * validProds.length
      })
    }

    // Opportunité de marge : concurrents régulièrement plus chers
    const concurrentsPlusChers = validProds.filter(p => p.prix > prixReference + prixReference * 0.1)
    if (concurrentsPlusChers.length >= validProds.length * 0.5) {
      opportunites.push({
        type: 'marge',
        produit: name,
        recommandation: `Marge potentielle détectée : ${concurrentsPlusChers.length} concurrents sont plus chers`,
        impactPotentiel: validProds.length * 100 // Impact estimé
      })
    }
  })

  // Trier par impact potentiel
  return opportunites.sort((a, b) => b.impactPotentiel - a.impactPotentiel)
}

/**
 * Calcule l'analyse par détaillant
 */
export function calculateRetailerAnalysis(
  products: Product[]
): AnalyticsData['detailleurs'] {
  if (!products.length) return []

  // Filtrer les produits avec prix valides
  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)
  if (!validProducts.length) return []

  // Grouper par site
  const productsBySite: Record<string, Product[]> = {}
  validProducts.forEach(p => {
    const site = normalizeSiteKey(p.sourceSite || p.sourceUrl)
    if (!productsBySite[site]) {
      productsBySite[site] = []
    }
    productsBySite[site].push(p)
  })

  return Object.entries(productsBySite).map(([site, prods]) => {
    const validProds = prods.filter(p => p.prix > 0 && p.prix < 500000)
    const prixMoyen = validProds.length > 0
      ? validProds.reduce((sum, p) => sum + p.prix, 0) / validProds.length
      : 0

    // Calculer l'agressivité (écart moyen par rapport à la moyenne du marché)
    const prixMoyenMarche = products
      .filter(p => p.prix > 0)
      .reduce((sum, p) => sum + p.prix, 0) / products.filter(p => p.prix > 0).length

    const agressivite = prixMoyenMarche > 0
      ? ((prixMoyenMarche - prixMoyen) / prixMoyenMarche) * 100
      : 0

    // Fréquence des promotions (estimation basée sur prix < moyenne)
    const promotions = validProds.filter(p => p.prix < prixMoyenMarche * 0.9).length
    const frequencePromotions = validProds.length > 0
      ? (promotions / validProds.length) * 100
      : 0

    return {
      site,
      prixMoyen,
      agressivite,
      frequencePromotions,
      nombreProduits: validProds.length
    }
  }).sort((a, b) => a.prixMoyen - b.prixMoyen) // Trier du moins cher au plus cher
}

/**
 * Calcule les alertes automatiques
 */
export function calculateAlerts(
  products: Product[],
  referenceSite: string
): AnalyticsData['alertes'] {
  const alertes: AnalyticsData['alertes'] = []

  // Grouper par produit (clé normalisée)
  const productsByKey: Record<string, Product[]> = {}
  products.forEach(p => {
    const key = normalizeProductGroupKey(p)
    if (!productsByKey[key]) {
      productsByKey[key] = []
    }
    productsByKey[key].push(p)
  })

  const normalizedReference = normalizeSiteKey(referenceSite)
  // Compter les produits non compétitifs
  let produitsNonCompetitifs = 0
  Object.values(productsByKey).forEach(prods => {
    const validProds = prods.filter(p => p.prix > 0)
    if (validProds.length < 2) return

    const prixMoyenMarche = validProds.reduce((sum, p) => sum + p.prix, 0) / validProds.length
    const referenceProduct =
      validProds.find(p => normalizeSiteKey(p.sourceSite || p.sourceUrl) === normalizedReference) ||
      validProds[0]
    if (referenceProduct.prix > prixMoyenMarche * 1.1) {
      produitsNonCompetitifs++
    }
  })

  if (produitsNonCompetitifs > 0) {
    alertes.push({
      type: 'ecart',
      message: `${produitsNonCompetitifs} produit(s) non compétitifs détectés`,
      severite: produitsNonCompetitifs > 10 ? 'high' : produitsNonCompetitifs > 5 ? 'medium' : 'low',
      date: new Date().toISOString()
    })
  }

  // Détecter les écarts importants
  products.forEach(p => {
    if (p.differencePrix && Math.abs(p.differencePrix) > p.prix * 0.05) {
      alertes.push({
        type: 'ecart',
        message: `Écart de prix important pour ${p.name}: ${p.differencePrix > 0 ? '+' : ''}${p.differencePrix.toFixed(2)}$`,
        severite: Math.abs(p.differencePrix) > p.prix * 0.1 ? 'high' : 'medium',
        date: new Date().toISOString()
      })
    }
  })

  return alertes.slice(0, 10) // Limiter à 10 alertes
}

/**
 * Calcule les statistiques générales
 */
export function calculateStats(
  products: Product[],
  scrapesParJour: Array<{ date: string; count: number }>,
  totalScrapes?: number
): AnalyticsData['stats'] {
  // Filtrer les prix valides (exclure les IDs et valeurs aberrantes)
  const validProducts = products.filter(p => p.prix > 0 && p.prix < 500000)
  const prixMoyen = validProducts.length > 0
    ? validProducts.reduce((sum, p) => sum + p.prix, 0) / validProducts.length
    : 0

  // Heures économisées : 30 secondes par produit comparé
  // Un véhicule comparé = 30 secondes = 0.00833 heures
  const heuresEconomisees = validProducts.length * 30 / 3600

  return {
    prixMoyen,
    heuresEconomisees,
    nombreScrapes: totalScrapes ?? scrapesParJour.reduce((sum, d) => sum + d.count, 0),
    scrapesParJour
  }
}

/**
 * Calcule l'évolution des prix dans le temps
 * Note: Nécessite des données historiques qui ne sont pas encore disponibles
 */
export function calculatePriceEvolution(
  _products: Product[]
): AnalyticsData['evolutionPrix'] {
  void _products
  // Pour l'instant, retourner des données vides car on n'a pas d'historique
  // Cette fonction sera implémentée quand on aura des données temporelles
  return []
}

/**
 * Helper pour obtenir le suffixe ordinal (1er, 2e, 3e, etc.)
 */
function getOrdinalSuffix(n: number): string {
  if (n === 1) return 'er'
  return 'e'
}

