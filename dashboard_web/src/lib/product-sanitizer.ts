/**
 * Sanitizer de produits — filet de sécurité final avant insertion en DB.
 *
 * Objectif : empêcher que des valeurs aberrantes extraites par erreur par
 * les scrapers (SKU, VIN, numéro de téléphone ou année concaténée parsé
 * comme un prix) polluent la base de données et faussent les statistiques
 * du dashboard (prix moyens en milliards, etc.).
 *
 * Appliqué par tous les endpoints qui persistent des produits :
 *   - POST /api/scrapings
 *   - POST /api/scrapings/save
 */

// Bornes de sanité (CAD). Les produits motorsport / véhicules récréatifs
// les plus chers plafonnent autour de 500 k$ ; on garde une marge
// conservatrice à 1 000 000 $ pour ne jamais exclure une donnée légitime.
export const PRICE_MIN = 1
export const PRICE_MAX = 1_000_000

/**
 * Nettoie une valeur de prix. Retourne `null` si la valeur est absente,
 * non numérique, ou hors des bornes de sanité.
 */
export function sanitizePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num < PRICE_MIN || num > PRICE_MAX) return null
  return num
}

/**
 * Nettoie les champs monétaires d'une liste de produits avant persistance.
 * Retourne la liste sanitizée et le nombre de prix rejetés (pour log).
 */
export function sanitizeProducts(products: unknown): {
  products: any[]
  rejected: number
} {
  if (!Array.isArray(products)) return { products: [], rejected: 0 }
  let rejected = 0

  const cleaned = products.map((p) => {
    if (!p || typeof p !== "object") return p
    const prod: Record<string, any> = { ...(p as Record<string, any>) }

    // Champ prix principal
    if ("prix" in prod) {
      const safe = sanitizePrice(prod.prix)
      if (safe === null && prod.prix != null && prod.prix !== "") rejected++
      prod.prix = safe
    }

    // Prix de référence (si déjà calculé côté scraper)
    if ("prixReference" in prod) {
      prod.prixReference = sanitizePrice(prod.prixReference)
    }

    // Prix original / prix barré
    if ("prixOriginal" in prod) {
      prod.prixOriginal = sanitizePrice(prod.prixOriginal)
    }

    return prod
  })

  return { products: cleaned, rejected }
}
