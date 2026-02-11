"use client"

import { useMemo, useState, useEffect } from "react"
import Image from "next/image"
import { Info, X } from "lucide-react"
import BlocTemplate from "./ui/bloc-template"
import { createPortal } from "react-dom"
import { deepNormalize } from "@/lib/analytics-calculations"

type Product = {
  name: string
  modele?: string
  marque?: string
  image?: string
  prix?: number
  prixReference?: number | null
  sourceSite?: string
  siteReference?: string
  competitors?: Record<string, number | null>
}

type PriceComparisonTableProps = {
  products: Product[]
  competitorsUrls?: string[]
  ignoreColors?: boolean
}

function hostnameFromUrl(url: string) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "")
    return h || url
  } catch {
    return url
  }
}

// Extraire la marque depuis "Manufacturier :CFMOTO" → "CFMOTO"
function extractMarque(marqueField: string | undefined): string {
  if (!marqueField) return ""
  return marqueField.replace(/^Manufacturier\s*:\s*/i, "").trim()
}

// Extraire le modèle depuis "Modèle :CFORCE 800 TOURING" → "CFORCE 800 TOURING"
function extractModele(modeleField: string | undefined): string {
  if (!modeleField) return ""
  return modeleField.replace(/^Modèle\s*:\s*/i, "").trim()
}

// Liste de couleurs à ignorer (doit correspondre au backend Python)
const COLOR_KEYWORDS_NORMALIZED = new Set([
  'blanc', 'noir', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'rose', 'violet',
  'gris', 'argent', 'or', 'bronze', 'beige', 'marron', 'brun', 'turquoise',
  'brillant', 'mat', 'metallise', 'metallique',
  'perle', 'nacre', 'satin', 'chrome', 'carbone',
  'fonce', 'clair', 'fluo', 'neon',
  'combat', 'lime', 'sauge', 'cristal', 'obsidian', 'ebony', 'ivory',
  'petard', 'sommet', 'grisatre',
  'white', 'black', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
  'gray', 'grey', 'silver', 'gold', 'brown',
  'matte', 'glossy', 'metallic', 'pearl', 'carbon',
  'dark', 'light', 'neon', 'bright',
  'etincelle', 'velocite',
])

function removeColors(text: string): string {
  if (!text) return ''
  const normalized = deepNormalize(text)
  return normalized.split(' ')
    .filter(word => !COLOR_KEYWORDS_NORMALIZED.has(word))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Générer le nom complet du produit : Marque + Modèle
function getProductDisplayName(product: Product): string {
  const marque = extractMarque(product.marque)
  const modele = extractModele(product.modele)

  const genericNames = ["aperçu", "spécifications", "promotion", "specifications", "overview"]
  const isGenericName = genericNames.includes((product.name || "").toLowerCase())

  if (!isGenericName && product.name && !product.name.startsWith("Manufacturier")) {
    return product.name
  }

  if (marque && modele) return `${marque} ${modele}`
  if (modele) return modele
  if (marque) return marque
  return product.name || "Produit"
}

/**
 * Génère une clé de comparaison pour un produit.
 * Utilise deepNormalize pour aligner avec le backend Python.
 * Quand ignoreColors=true : retire aussi les couleurs.
 */
function cleanDealerNoise(text: string): string {
  const patterns = [
    /\b(?:en\s+vente|disponible|neuf|usage|usag[ée])\s+(?:a|à|chez|au)\b.*/i,
    /\b(?:mvm\s*motosport|morin\s*sports?|moto\s*thibault|moto\s*ducharme)\b.*/i,
    /\b(?:shawinigan|trois\s*[-\s]*rivi[eè]res|montr[ée]al|qu[ée]bec|laval|longueuil|sherbrooke|drummondville|victoriaville|b[ée]cancour)\b.*/i,
    /\b(?:concessionnaire|dealer|showroom|magasin|succursale)\b.*/i,
  ]
  let cleaned = text
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '').trim()
  }
  return cleaned
}

function getProductComparisonKey(product: Product, ignoreColors: boolean): string {
  let marque = deepNormalize(extractMarque(product.marque))
  let modele = deepNormalize(extractModele(product.modele))
  
  // Nettoyer les phrases parasites de concession/localisation
  modele = cleanDealerNoise(modele)
  
  if (marque && modele) {
    const finalMarque = ignoreColors ? removeColors(marque) : marque
    const finalModele = ignoreColors ? removeColors(modele) : modele
    return `${finalMarque}|${finalModele}`
  }
  
  // Fallback : nom complet normalisé (deepNormalize aligne avec Python)
  const displayName = getProductDisplayName(product)
  let key = deepNormalize(displayName)
  key = cleanDealerNoise(key)
  return ignoreColors ? removeColors(key) : key
}

function PriceCell({ price, delta }: { price: number | null; delta: number | null }) {
  const deltaTone =
    delta === null
      ? "text-gray-500 dark:text-gray-400"
      : delta > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : delta < 0
          ? "text-red-600 dark:text-red-400"
          : "text-gray-500 dark:text-gray-400"

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-sm text-gray-900 dark:text-gray-100">{price !== null ? `${price.toFixed(0)} $` : "—"}</span>
      <span className={`text-xs font-semibold ${deltaTone}`}>
        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)} $`}
      </span>
    </div>
  )
}

export default function PriceComparisonTable({ products, competitorsUrls = [], ignoreColors = false }: PriceComparisonTableProps) {
  const [showExample, setShowExample] = useState(false)
  const [loadingExample, setLoadingExample] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const competitors = useMemo(() => {
    const uniq = Array.from(new Set(competitorsUrls.filter(Boolean)))
    return uniq.map(url => ({
      id: url,
      label: hostnameFromUrl(url),
    }))
  }, [competitorsUrls])

  // Jeu de données exemple pour la modale
  const exampleProducts: Product[] = [
    {
      name: "Moto Trail 700",
      modele: "2024",
      prixReference: 12999,
      image: "",
      competitors: {
        "Concession Nova Motors": 13500,
        "Garage Altitude": 12700,
      },
    },
    {
      name: "Quad Trekker",
      modele: "XR",
      prixReference: 9999,
      image: "",
      competitors: {
        "Concession Nova Motors": 10500,
        "Garage Altitude": 9800,
      },
    },
  ]

  const tableData = useMemo(() => {
    // ── Regrouper les produits comparés par clé normalisée ──
    // Chaque produit concurrent a prixReference (prix du site de référence) et prix (prix du concurrent).
    // On regroupe pour créer UNE ligne par produit avec :
    //   - le prix de référence
    //   - le prix de chaque concurrent (par site)
    const groups = new Map<string, {
      displayName: string
      image?: string
      modele?: string
      marque?: string
      reference: number | null
      competitorPrices: Record<string, number>
    }>()

    let refOnlyIndex = 0
    for (const p of products) {
      const baseKey = getProductComparisonKey(p, ignoreColors)
      const hasComparison = p.prixReference !== null && p.prixReference !== undefined

      if (hasComparison) {
        // Produit comparé (concurrent avec prix de référence)
        const key = baseKey
        if (!groups.has(key)) {
          groups.set(key, {
            displayName: getProductDisplayName(p),
            image: p.image,
            modele: p.modele,
            marque: p.marque,
            reference: p.prixReference ?? null,
            competitorPrices: {},
          })
        }
        const group = groups.get(key)!
        const siteLabel = p.sourceSite ? hostnameFromUrl(p.sourceSite) : ''
        if (siteLabel && p.prix != null) {
          if (!group.competitorPrices[siteLabel] || !ignoreColors) {
            group.competitorPrices[siteLabel] = p.prix
          }
        }
        if (group.reference === null && p.prixReference != null) {
          group.reference = p.prixReference
        }
      } else {
        // Produit de référence seul (pas de concurrent) : une ligne par produit
        const refPrice = p.prix != null && p.prix > 0 ? p.prix : null
        if (refPrice === null) continue
        const key = `${baseKey}__ref_${refOnlyIndex++}`
        groups.set(key, {
          displayName: getProductDisplayName(p),
          image: p.image,
          modele: p.modele,
          marque: p.marque,
          reference: refPrice,
          competitorPrices: {},
        })
      }
    }

    return Array.from(groups.values()).map(g => {
      const prices = competitors.map(c => {
        const price = g.competitorPrices[c.label] ?? null
        const delta = g.reference !== null && price !== null ? price - g.reference : null
        return { dealer: c.label, price, delta }
      })

      return {
        name: g.displayName,
        displayName: g.displayName,
        image: g.image,
        modele: g.modele,
        marque: g.marque,
        reference: g.reference,
        prices,
      }
    })
  }, [products, competitors, ignoreColors])

  const exampleData = useMemo(() => {
    return exampleProducts.map(p => {
      const reference = p.prixReference ?? p.prix ?? null
      const compKeys = Object.keys(p.competitors || {})
      const prices = compKeys.map(k => {
        const price = p.competitors?.[k] ?? null
        const delta = reference !== null && price !== null ? price - reference : null
        return { dealer: k, price, delta }
      })
      return { ...p, reference, prices }
    })
  }, [])

  const exampleCompetitors = useMemo(() => {
    const labels = Array.from(new Set(exampleProducts.flatMap(p => Object.keys(p.competitors || {}))))
    return labels.map(id => ({ id, label: id }))
  }, [])

  const renderTable = (
    data: typeof tableData,
    emptyMessage?: string,
    overrideCompetitors?: { id: string; label: string }[]
  ) => {
    const cols = overrideCompetitors || competitors
    return (
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="sticky top-0 bg-white dark:bg-[#0F0F12]">
                <th className="sticky left-0 bg-white dark:bg-[#0F0F12] px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23]">
                  Image
                </th>
                <th className="sticky left-[80px] bg-white dark:bg-[#0F0F12] px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23] min-w-[280px]">
                  Produit
                </th>
                <th className="sticky left-[260px] bg-white dark:bg-[#0F0F12] px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23]">
                  Prix réf
                </th>
                {cols.map(c => (
                  <th key={c.id} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23]">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={3 + cols.length} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    {emptyMessage || "Aucun produit à afficher."}
                  </td>
                </tr>
              )}
              {data.map((p, idx) => (
                <tr
                  key={idx}
                  className="border-b border-gray-100 dark:border-[#1F1F23] hover:bg-gray-50 dark:hover:bg-[#111117] transition-colors"
                >
                  <td className="sticky left-0 bg-white dark:bg-[#0F0F12] px-3 py-2 align-middle">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 dark:bg-[#1F1F23] shadow-[0_8px_20px_-14px_rgba(0,0,0,0.4)]">
                      {p.image ? (
                        <Image src={p.image} alt={p.name} width={48} height={48} className="object-cover w-full h-full" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">Img</div>
                      )}
                    </div>
                  </td>
                  <td className="sticky left-[80px] bg-white dark:bg-[#0F0F12] px-3 py-2 min-w-[280px]">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-normal">
                        {p.displayName || p.name}
                      </span>
                      {p.modele && <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-normal">Modèle: {extractModele(p.modele)}</span>}
                    </div>
                  </td>
                  <td className="sticky left-[260px] bg-white dark:bg-[#0F0F12] px-3 py-2 text-right text-sm font-semibold text-gray-900 dark:text-white">
                    {p.reference !== null ? `${p.reference.toFixed(0)} $` : "—"}
                  </td>
                  {p.prices.map(priceEntry => (
                    <td key={priceEntry.dealer} className="px-3 py-2 text-right text-sm text-gray-900 dark:text-gray-200">
                      <PriceCell price={priceEntry.price} delta={priceEntry.delta} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <BlocTemplate className="hover-elevate" innerClassName="bg-white/95 dark:bg-[#0F0F12] p-5 border border-gray-100 dark:border-white/5 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Comparatif des prix</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Tous les produits scrappés, par concessionnaire
            {ignoreColors && <span className="ml-2 text-xs text-blue-500">(couleurs ignorées)</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoadingExample(true)
            setTimeout(() => {
              setLoadingExample(false)
              setShowExample(true)
            }, 300)
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 text-xs font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] transition"
        >
          <Info className="h-4 w-4" />
          Exemple
        </button>
      </div>

      {loadingExample && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white px-4 py-3 rounded-xl shadow-lg border border-gray-100 dark:border-[#1F1F23] flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
            <span className="text-sm font-medium">Chargement de l&apos;exemple…</span>
          </div>
        </div>
      )}

      {renderTable(tableData, "Aucun produit scrappé pour le moment.")}

      {mounted &&
        showExample &&
        createPortal(
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center px-4">
            <div className="bg-white dark:bg-[#0F0F12] rounded-2xl max-w-6xl w-full p-6 shadow-[0_24px_60px_-32px_rgba(0,0,0,0.55)] border border-gray-100 dark:border-[#1F1F23]">
              <div className="flex items-start justify-between mb-4">
                <h4 className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white">Exemple de tableau</h4>
                <button
                  type="button"
                  onClick={() => setShowExample(false)}
                  aria-label="Fermer la modale d'exemple"
                  className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" strokeWidth={2.25} />
                </button>
              </div>
              {renderTable(
                exampleData.map(p => ({
                  ...p,
                  prices: p.prices.map(pe => ({ ...pe })),
                })),
                "Exemple vide",
                exampleCompetitors
              )}
            </div>
          </div>,
          document.body
        )}
    </BlocTemplate>
  )
}
