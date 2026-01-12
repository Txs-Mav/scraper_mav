"use client"

import { useMemo, useState, useEffect } from "react"
import Image from "next/image"
import { Info, X } from "lucide-react"
import BlocTemplate from "./ui/bloc-template"
import { createPortal } from "react-dom"

type Product = {
  name: string
  modele?: string
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
}

function hostnameFromUrl(url: string) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "")
    return h || url
  } catch {
    return url
  }
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

export default function PriceComparisonTable({ products, competitorsUrls = [] }: PriceComparisonTableProps) {
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
    return products.map(p => {
      const reference = p.prixReference ?? p.prix ?? null
      const prices = competitors.map(c => {
        const price = p.competitors?.[c.label] ?? null
        const delta = reference !== null && price !== null ? price - reference : null
        return { dealer: c.label, price, delta }
      })
      return { ...p, reference, prices }
    })
  }, [products, competitors])

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
                <th className="sticky left-[80px] bg-white dark:bg-[#0F0F12] px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23]">
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
                  <td className="sticky left-[80px] bg-white dark:bg-[#0F0F12] px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{p.name}</span>
                      {p.modele && <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.modele}</span>}
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
          <p className="text-sm text-gray-600 dark:text-gray-400">Tous les produits scrappés, par concessionnaire</p>
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
            <span className="text-sm font-medium">Chargement de l’exemple…</span>
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

