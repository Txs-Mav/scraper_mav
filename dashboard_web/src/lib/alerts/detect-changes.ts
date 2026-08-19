/**
 * Détection des changements produits par unité physique.
 *
 * Extrait de /api/alerts/check pour être testable (Next interdit les exports
 * annexes dans un fichier route). Issue Txs-Mav/scraper_mav#1.
 */
import { createHash } from 'crypto'

// ─── Types ──────────────────────────────────────────────────────────

export interface Product {
  name: string
  prix: number
  disponibilite?: string
  sourceUrl?: string
  sourceSite?: string
  marque?: string
  modele?: string
  image?: string
  // Multi-unités (scraper_ai/grouping.py) : présent quand quantity >= 2
  multi_unit?: boolean
  units?: Array<{
    unit_key?: string
    inventaire?: string
    prix?: number
    sourceUrl?: string
    couleur?: string
    vin?: string
  }>

  // Champs enrichis par /api/products/analyze (matching vs référence)
  prixReference?: number
  differencePrix?: number | null
  produitReference?: {
    name?: string
    sourceUrl?: string
    prix?: number
    image?: string
  } | null
  matchLevel?: string
  [key: string]: any
}

export interface Change {
  change_type: string
  product_name: string
  old_value: string | null
  new_value: string | null
  percentage_change: number | null
  details: Record<string, any>
  source_site: string
}

export interface AlertConfig {
  watch_price_increase: boolean
  watch_price_decrease: boolean
  watch_new_products: boolean
  watch_removed_products: boolean
  watch_stock_changes: boolean
  min_price_change_pct: number
  min_price_change_abs: number
}

export const MIN_VALID_PRICE = 1

// ─── Normalisation ──────────────────────────────────────────────────

export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ')
    .replace(/[""''«»]/g, '')
    .replace(/\s+/g, ' ')
}

export function formatPrice(price: number): string {
  return `${price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`
}

function matchInfoFromProduct(p: Product): Record<string, any> {
  const matched = !!p.produitReference || typeof p.prixReference === 'number'
  if (!matched) return { is_matched_with_reference: false }
  return {
    is_matched_with_reference: true,
    reference_product_name: p.produitReference?.name || null,
    reference_product_url: p.produitReference?.sourceUrl || null,
    reference_price: typeof p.prixReference === 'number' ? p.prixReference : (p.produitReference?.prix ?? null),
    price_diff_vs_reference: typeof p.differencePrix === 'number' ? p.differencePrix : null,
    match_level: p.matchLevel || 'exact',
  }
}

// ─── Identité par unité physique ─────────────────────────────────────
// Cascade IDENTIQUE à scraper_ai/grouping.py::compute_unit_key et au trigger
// SQL fn_pph_expand_units (migration_product_price_history.sql) :
// vin (≥10 car.) → inventaire → ID de fin d'URL → URL → md5(nom|couleur)[:12]

const URL_ID_RE = /-([a-z]{0,8}\d{1,10})$/i

export function computeUnitKey(p: {
  vin?: any; inventaire?: any; sourceUrl?: any; name?: any; couleur?: any
}): string {
  const vin = String(p.vin ?? '').trim().toUpperCase()
  if (vin.length >= 10) return vin
  const inv = String(p.inventaire ?? '').trim()
  if (inv) return inv
  const url = String(p.sourceUrl ?? '').replace(/\/+$/, '')
  if (url) {
    const m = url.match(URL_ID_RE)
    if (m) return m[1].toLowerCase()
    return url
  }
  const base = `${String(p.name ?? '').toLowerCase().trim()}|${String(p.couleur ?? '').toLowerCase().trim()}`
  return createHash('md5').update(base).digest('hex').slice(0, 12)
}

interface UnitEntry {
  key: string
  prix: number | null
  sourceUrl: string | null
  unitPosition: string | null // « 2/3 » pour les multi-unités
  product: Product
}

/**
 * Éclate les produits en unités physiques : un produit avec `units[]`
 * (multi-unités, posé par scraper_ai/grouping.py) donne une entrée par
 * unité ; un produit sans `units[]` EST sa propre unité.
 */
function expandToUnits(products: Product[]): Map<string, UnitEntry> {
  const units = new Map<string, UnitEntry>()
  for (const p of products) {
    if (!p.name) continue
    const list: any[] = Array.isArray(p.units) && p.units.length > 0 ? p.units : []
    if (list.length > 0) {
      list.forEach((u, i) => {
        const key = u.unit_key || computeUnitKey(u)
        if (!units.has(key)) {
          units.set(key, {
            key,
            prix: typeof u.prix === 'number' ? u.prix : null,
            sourceUrl: u.sourceUrl || p.sourceUrl || null,
            unitPosition: `${i + 1}/${list.length}`,
            product: p,
          })
        }
      })
    } else {
      const key = computeUnitKey(p)
      if (!units.has(key)) {
        units.set(key, {
          key,
          prix: typeof p.prix === 'number' ? p.prix : null,
          sourceUrl: p.sourceUrl || null,
          unitPosition: null,
          product: p,
        })
      }
    }
  }
  return units
}

function unitDetails(entry: UnitEntry): Record<string, any> {
  return {
    sourceUrl: entry.sourceUrl,
    image: entry.product.image || null,
    unit_key: entry.key,
    multi_unit: entry.unitPosition !== null,
    unit_position: entry.unitPosition,
    ...matchInfoFromProduct(entry.product),
  }
}

/**
 * Détection par unité physique (fin du ping-pong multi-unités) :
 * - prix : alerte seulement si LA MÊME unité (unit_key) change de prix ;
 * - retrait : avec 3 scrapings, absence confirmée sur 2 scrapes consécutifs
 *   (présent dans prevPrevious, absent de previous ET current) — un scrape
 *   partiel qui rate une page ne fabrique plus d'alerte ;
 * - nouveauté : avec 3 scrapings, absent des DEUX scrapes passés ;
 * - produits sans units[] des deux côtés : repli par nom (marketplace,
 *   scrapers non migrés).
 */
export function detectChanges(
  previous: Product[],
  current: Product[],
  config: AlertConfig,
  sourceSite: string,
  prevPrevious: Product[] | null = null,
): Change[] {
  const changes: Change[] = []

  const prevUnits = expandToUnits(previous)
  const currUnits = expandToUnits(current)
  const prevPrevUnits = prevPrevious ? expandToUnits(prevPrevious) : null

  const prevByName = new Map<string, Product>()
  for (const p of previous) {
    if (p.name) prevByName.set(normalizeProductName(p.name), p)
  }
  const currNames = new Set<string>()
  for (const p of current) {
    if (p.name) currNames.add(normalizeProductName(p.name))
  }

  const matchedPrevUnitKeys = new Set<string>()
  const stockEmittedFor = new Set<string>()

  for (const [key, curr] of currUnits) {
    let prev = prevUnits.get(key)

    // Repli par nom : uniquement quand aucun des deux côtés ne porte units[]
    // (marketplace, scrapers non migrés) — jamais entre deux unités distinctes.
    if (!prev && curr.unitPosition === null) {
      const nameKey = normalizeProductName(curr.product.name)
      const prevProduct = prevByName.get(nameKey)
      if (prevProduct && !(Array.isArray(prevProduct.units) && prevProduct.units.length > 0)) {
        const prevKey = computeUnitKey(prevProduct)
        if (!currUnits.has(prevKey)) {
          prev = prevUnits.get(prevKey)
        }
      }
    }

    if (!prev) {
      // Nouveauté : avec 3 scrapings, exiger l'absence des DEUX scrapes passés
      // (une unité ratée par un scrape partiel « réapparaît » sinon en alerte).
      const seenBefore = prevPrevUnits?.has(key) ?? false
      // Transition : le scraping précédent date d'avant units[] — le modèle
      // existait déjà sous forme fusionnée, ses unités ne sont pas nouvelles.
      const prevProductSameName = prevByName.get(normalizeProductName(curr.product.name))
      const preMigrationSibling =
        curr.unitPosition !== null &&
        !!prevProductSameName &&
        !(Array.isArray(prevProductSameName.units) && prevProductSameName.units.length > 0)

      if (
        config.watch_new_products &&
        !seenBefore &&
        !preMigrationSibling &&
        curr.prix && curr.prix >= MIN_VALID_PRICE
      ) {
        changes.push({
          change_type: 'new_product',
          product_name: curr.product.name,
          old_value: null,
          new_value: formatPrice(curr.prix),
          percentage_change: null,
          details: {
            prix: curr.prix,
            disponibilite: curr.product.disponibilite,
            ...unitDetails(curr),
          },
          source_site: sourceSite,
        })
      }
      continue
    }

    matchedPrevUnitKeys.add(prev.key)

    // Transition format fusionné → units[] : le prix pré-migration est un
    // MIN sur toutes les unités porté par la clé du leader — le comparer au
    // prix réel de l'unité fabriquerait une fausse variation. On saute UN
    // cycle de comparaison pour ces paires.
    const preMigrationPair =
      curr.unitPosition !== null &&
      !(Array.isArray(prev.product.units) && prev.product.units.length > 0)

    if (
      !preMigrationPair &&
      prev.prix && curr.prix &&
      prev.prix >= MIN_VALID_PRICE && curr.prix >= MIN_VALID_PRICE &&
      prev.prix !== curr.prix
    ) {
      const diff = curr.prix - prev.prix
      const pct = (diff / prev.prix) * 100

      if (
        Math.abs(pct) >= config.min_price_change_pct &&
        Math.abs(diff) >= config.min_price_change_abs
      ) {
        const isIncrease = pct > 0
        const changeType = isIncrease ? 'price_increase' : 'price_decrease'

        if ((isIncrease && config.watch_price_increase) || (!isIncrease && config.watch_price_decrease)) {
          changes.push({
            change_type: changeType,
            product_name: curr.product.name,
            old_value: formatPrice(prev.prix),
            new_value: formatPrice(curr.prix),
            percentage_change: Math.round(pct * 100) / 100,
            details: {
              old_prix: prev.prix,
              new_prix: curr.prix,
              diff: Math.round(diff * 100) / 100,
              ...unitDetails(curr),
            },
            source_site: sourceSite,
          })
        }
      }
    }

    // Disponibilité : portée produit, émise une seule fois par modèle
    // (les unités d'un même produit groupé partagent la valeur).
    const prodNameKey = normalizeProductName(curr.product.name)
    if (
      config.watch_stock_changes &&
      !stockEmittedFor.has(prodNameKey) &&
      prev.product.disponibilite && curr.product.disponibilite &&
      prev.product.disponibilite.toLowerCase().trim() !== curr.product.disponibilite.toLowerCase().trim()
    ) {
      stockEmittedFor.add(prodNameKey)
      changes.push({
        change_type: 'stock_change',
        product_name: curr.product.name,
        old_value: prev.product.disponibilite,
        new_value: curr.product.disponibilite,
        percentage_change: null,
        details: { ...unitDetails(curr) },
        source_site: sourceSite,
      })
    }
  }

  if (config.watch_removed_products) {
    if (prevPrevUnits) {
      // Absence confirmée : présent avant-hier, absent hier ET aujourd'hui.
      for (const [key, past] of prevPrevUnits) {
        if (currUnits.has(key) || prevUnits.has(key)) continue
        // Mono-unité dont le nom vit encore côté courant : annonce re-postée
        // sous une autre URL (marketplace) — pas un vrai retrait. Une unité
        // d'un modèle multi reste un vrai retrait même si ses jumelles restent.
        if (past.unitPosition === null && currNames.has(normalizeProductName(past.product.name))) continue
        if (past.prix && past.prix >= MIN_VALID_PRICE) {
          changes.push({
            change_type: 'removed_product',
            product_name: past.product.name,
            old_value: formatPrice(past.prix),
            new_value: null,
            percentage_change: null,
            details: { prix: past.prix, ...unitDetails(past) },
            source_site: sourceSite,
          })
        }
      }
    } else {
      // Repli 2 scrapings : comportement historique (absence immédiate),
      // en ignorant les unités appariées par le repli nom.
      for (const [key, prev] of prevUnits) {
        if (currUnits.has(key) || matchedPrevUnitKeys.has(key)) continue
        // Même règle mono-unité que ci-dessus (couvre aussi la transition
        // format fusionné → units[] : le modèle existe encore côté courant).
        if (prev.unitPosition === null && currNames.has(normalizeProductName(prev.product.name))) continue
        if (prev.prix && prev.prix >= MIN_VALID_PRICE) {
          changes.push({
            change_type: 'removed_product',
            product_name: prev.product.name,
            old_value: formatPrice(prev.prix),
            new_value: null,
            percentage_change: null,
            details: { prix: prev.prix, ...unitDetails(prev) },
            source_site: sourceSite,
          })
        }
      }
    }
  }

  return changes
}
