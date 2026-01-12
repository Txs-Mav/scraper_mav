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
      totalDetailleurs: 1,
      message: 'Aucune donnée disponible'
    }
  }

  // Filtrer les produits avec prix valides
  const validProducts = products.filter(p => p.prix > 0)

  if (!validProducts.length) {
    return {
      position: 'average',
      ecartPourcentage: 0,
      ecartValeur: 0,
      classement: 1,
      totalDetailleurs: 1,
      message: 'Aucun produit avec prix valide'
    }
  }

  // Grouper les produits par site
  const productsBySite: Record<string, Product[]> = {}
  validProducts.forEach(p => {
    const site = p.sourceSite || 'unknown'
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
  const referencePrixMoyen = prixMoyenParSite[referenceSite] || prixMoyenParSite[Object.keys(prixMoyenParSite)[0]]

  // Calculer la moyenne du marché (tous les sites sauf référence)
  const autresSites = Object.entries(prixMoyenParSite).filter(([site]) => site !== referenceSite)
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
  const classement = sitesTries.findIndex(([site]) => site === referenceSite) + 1
  const totalDetailleurs = sitesTries.length

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
  products: Product[]
): AnalyticsData['produits'] {
  if (!products.length) return []

  // Grouper les produits par nom (produits identiques)
  const productsByName: Record<string, Product[]> = {}
  products.forEach(p => {
    const key = p.name || `${p.marque} ${p.modele}`
    if (!productsByName[key]) {
      productsByName[key] = []
    }
    productsByName[key].push(p)
  })

  // Calculer pour chaque produit
  return Object.entries(productsByName).map(([name, prods]) => {
    const validProds = prods.filter(p => p.prix > 0)
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

    // Prix de référence (premier produit ou celui avec prixReference)
    const referenceProduct = validProds.find(p => p.prixReference) || validProds[0]
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
  products: Product[]
): AnalyticsData['opportunites'] {
  const opportunites: AnalyticsData['opportunites'] = []

  // Grouper par produit
  const productsByName: Record<string, Product[]> = {}
  products.forEach(p => {
    const key = p.name || `${p.marque} ${p.modele}`
    if (!productsByName[key]) {
      productsByName[key] = []
    }
    productsByName[key].push(p)
  })

  Object.entries(productsByName).forEach(([name, prods]) => {
    const validProds = prods.filter(p => p.prix > 0)
    if (validProds.length < 2) return // Besoin d'au moins 2 sites pour comparer

    const prixMoyenMarche = validProds.reduce((sum, p) => sum + p.prix, 0) / validProds.length
    const referenceProduct = validProds[0]
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

  // Grouper par site
  const productsBySite: Record<string, Product[]> = {}
  products.forEach(p => {
    const site = p.sourceSite || 'unknown'
    if (!productsBySite[site]) {
      productsBySite[site] = []
    }
    productsBySite[site].push(p)
  })

  return Object.entries(productsBySite).map(([site, prods]) => {
    const validProds = prods.filter(p => p.prix > 0)
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

  // Grouper par produit
  const productsByName: Record<string, Product[]> = {}
  products.forEach(p => {
    const key = p.name || `${p.marque} ${p.modele}`
    if (!productsByName[key]) {
      productsByName[key] = []
    }
    productsByName[key].push(p)
  })

  // Compter les produits non compétitifs
  let produitsNonCompetitifs = 0
  Object.values(productsByName).forEach(prods => {
    const validProds = prods.filter(p => p.prix > 0)
    if (validProds.length < 2) return

    const prixMoyenMarche = validProds.reduce((sum, p) => sum + p.prix, 0) / validProds.length
    const referenceProduct = validProds.find(p => p.sourceSite === referenceSite) || validProds[0]
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
  scrapesParJour: Array<{ date: string; count: number }>
): AnalyticsData['stats'] {
  const validProducts = products.filter(p => p.prix > 0)
  const prixMoyen = validProducts.length > 0
    ? validProducts.reduce((sum, p) => sum + p.prix, 0) / validProducts.length
    : 0

  // Heures économisées : 30 secondes par produit comparé
  // Un véhicule comparé = 30 secondes = 0.00833 heures
  const heuresEconomisees = validProducts.length * 30 / 3600

  return {
    prixMoyen,
    heuresEconomisees,
    nombreScrapes: scrapesParJour.reduce((sum, d) => sum + d.count, 0),
    scrapesParJour
  }
}

/**
 * Calcule l'évolution des prix dans le temps
 * Note: Nécessite des données historiques qui ne sont pas encore disponibles
 */
export function calculatePriceEvolution(
  products: Product[]
): AnalyticsData['evolutionPrix'] {
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

