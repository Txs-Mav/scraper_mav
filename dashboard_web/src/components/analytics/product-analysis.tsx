"use client"

import { useState, useMemo, useEffect } from "react"
import { Search, Filter, SlidersHorizontal, ChevronLeft, ChevronRight } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface Product {
  name: string
  prix: number
  prixMoyenMarche: number
  ecartPourcentage: number
  competitif: boolean
  hasCompetitor: boolean
  categorie: string
  sourceSite?: string
}

interface ProductAnalysisProps {
  produits: Product[]
}

const categoryLabels: Record<string, string> = {
  moto: "Moto",
  motoneige: "Motoneige",
  motocross: "Motocross",
  scooter: "Scooter",
  quad: "Quad",
  "side-by-side": "Side-by-Side",
  vtt: "VTT",
  autre: "Autre",
}

const DEFAULT_THRESHOLD = 0.5
const ROWS_PER_PAGE = 25

export default function ProductCategoryAnalysis({ produits }: ProductAnalysisProps) {
  const { t } = useLanguage()
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"name" | "prix" | "ecart">("ecart")
  const [showFilter, setShowFilter] = useState<"compared" | "all" | "no-competitor">("compared")
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [currentPage, setCurrentPage] = useState(0)

  const isCompetitif = (p: Product) =>
    p.hasCompetitor ? p.ecartPourcentage < threshold : true

  // Compteurs globaux (avant filtrage recherche/catégorie)
  const counts = useMemo(() => {
    const compared = produits.filter(p => p.hasCompetitor)
    return {
      total: produits.length,
      compared: compared.length,
      competitifs: compared.filter(p => p.ecartPourcentage < threshold).length,
      nonCompetitifs: compared.filter(p => p.ecartPourcentage >= threshold).length,
      sansCompetitor: produits.filter(p => !p.hasCompetitor).length,
    }
  }, [produits, threshold])

  const filteredProducts = produits.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === "all" || p.categorie === selectedCategory
    const matchesFilter =
      showFilter === "all" ? true
        : showFilter === "compared" ? p.hasCompetitor
          : !p.hasCompetitor
    return matchesSearch && matchesCategory && matchesFilter
  })

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name)
      case "prix":
        return b.prix - a.prix
      case "ecart":
        return Math.abs(b.ecartPourcentage) - Math.abs(a.ecartPourcentage)
      default:
        return 0
    }
  })

  useEffect(() => { setCurrentPage(0) }, [searchTerm, selectedCategory, showFilter, sortBy])

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / ROWS_PER_PAGE))
  const paginatedProducts = sortedProducts.slice(
    currentPage * ROWS_PER_PAGE,
    (currentPage + 1) * ROWS_PER_PAGE
  )

  const categories = Array.from(new Set(produits.map(p => p.categorie))).filter(Boolean)

  // Résumé par catégorie (seulement les produits comparés)
  const categorySummary = useMemo(() => {
    const compared = produits.filter(p => p.hasCompetitor)
    const summary: Record<string, { total: number; competitif: number; ecartSum: number }> = {}
    for (const p of compared) {
      const cat = p.categorie || 'autre'
      if (!summary[cat]) {
        summary[cat] = { total: 0, competitif: 0, ecartSum: 0 }
      }
      summary[cat].total++
      summary[cat].ecartSum += p.ecartPourcentage
      if (p.ecartPourcentage < threshold) summary[cat].competitif++
    }
    return Object.entries(summary)
      .map(([cat, s]) => ({
        categorie: cat,
        total: s.total,
        competitif: s.competitif,
        ecartMoyen: s.total > 0 ? s.ecartSum / s.total : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [produits, threshold])

  return (
    <div className="bg-white/70 dark:bg-white/[0.025] backdrop-blur-sm rounded-lg border border-gray-200/60 dark:border-white/[0.06] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        {t("ap.productAnalysis")}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
        {t("ap.productAnalysisDesc")}
      </p>

      {/* Statistiques — 4 blocs distincts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <button
          onClick={() => setShowFilter("compared")}
          className={`rounded-lg p-3 text-left transition-all border ${
            showFilter === "compared"
              ? "ring-2 ring-blue-500 border-blue-200 dark:border-blue-800"
              : "border-transparent"
          } bg-blue-50 dark:bg-blue-900/20`}
        >
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400">{t("ap.comparedProducts")}</div>
          <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{counts.compared}</div>
        </button>
        <div className="rounded-lg p-3 bg-green-50 dark:bg-green-900/20">
          <div className="text-xs font-medium text-green-600 dark:text-green-400">{t("ap.competitiveProducts")}</div>
          <div className="text-xl font-bold text-green-700 dark:text-green-300">{counts.competitifs}</div>
        </div>
        <div className="rounded-lg p-3 bg-red-50 dark:bg-red-900/20">
          <div className="text-xs font-medium text-red-600 dark:text-red-400">{t("ap.notCompetitiveProducts")}</div>
          <div className="text-xl font-bold text-red-700 dark:text-red-300">{counts.nonCompetitifs}</div>
        </div>
        <button
          onClick={() => setShowFilter(showFilter === "no-competitor" ? "compared" : "no-competitor")}
          className={`rounded-lg p-3 text-left transition-all border ${
            showFilter === "no-competitor"
              ? "ring-2 ring-gray-400 border-gray-300 dark:border-gray-600"
              : "border-transparent"
          } bg-gray-50 dark:bg-[#1F1F23]`}
        >
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("ap.noCompetitor")}</div>
          <div className="text-xl font-bold text-gray-600 dark:text-gray-300">{counts.sansCompetitor}</div>
        </button>
      </div>

      {/* Seuil de compétitivité */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-400">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>{t("ap.thresholdLabel")}</span>
        </div>
        <div className="flex items-center gap-3 flex-1 min-w-[200px]">
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-gray-200 dark:bg-gray-700 accent-violet-600 dark:accent-violet-500"
          />
          <span className="tabular-nums text-sm font-bold text-gray-900 dark:text-white min-w-[52px] text-right">
            {threshold.toFixed(1)}%
          </span>
        </div>
        {threshold !== DEFAULT_THRESHOLD && (
          <button
            onClick={() => setThreshold(DEFAULT_THRESHOLD)}
            className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
          >
            {t("ap.thresholdReset")}
          </button>
        )}
      </div>

      {/* Résumé par catégorie (seulement produits comparés) */}
      {categorySummary.length > 1 && showFilter !== "no-competitor" && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
            {t("ap.avgGapByCategory")}
          </div>
          <div className="flex flex-wrap gap-2">
            {categorySummary.map(cs => {
              const ecartColor = cs.ecartMoyen < -2
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                : cs.ecartMoyen > 2
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                : 'bg-gray-50 dark:bg-[#1F1F23] border-gray-200 dark:border-[#2B2B30] text-gray-700 dark:text-gray-300'
              return (
                <button
                  key={cs.categorie}
                  onClick={() => setSelectedCategory(
                    selectedCategory === cs.categorie ? 'all' : cs.categorie
                  )}
                  className={`rounded-lg px-3 py-2 border text-xs font-medium transition-all ${ecartColor} ${
                    selectedCategory === cs.categorie ? 'ring-2 ring-blue-500' : ''
                  }`}
                >
                  <span className="font-semibold">{categoryLabels[cs.categorie] || cs.categorie}</span>
                  <span className="ml-2">
                    {cs.ecartMoyen >= 0 ? '+' : ''}{cs.ecartMoyen.toFixed(1)}%
                  </span>
                  <span className="ml-1 text-gray-500 dark:text-gray-500">
                    ({cs.competitif}/{cs.total})
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filtres et recherche */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={t("ap.searchProduct")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-[#1F1F23] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white text-sm"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-[#1F1F23] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white text-sm"
        >
          <option value="all" style={{ backgroundColor: "#ffffff", color: "#111827" }}>{t("ap.allCategories")}</option>
          {categories.map(cat => (
            <option key={cat} value={cat} style={{ backgroundColor: "#ffffff", color: "#111827" }}>{categoryLabels[cat] || cat}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "name" | "prix" | "ecart")}
          className="px-3 py-2 border border-gray-300 dark:border-[#1F1F23] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white text-sm"
        >
          <option value="ecart" style={{ backgroundColor: "#ffffff", color: "#111827" }}>{t("ap.sortByGap")}</option>
          <option value="prix" style={{ backgroundColor: "#ffffff", color: "#111827" }}>{t("ap.sortByPrice")}</option>
          <option value="name" style={{ backgroundColor: "#ffffff", color: "#111827" }}>{t("ap.sortByName")}</option>
        </select>
        <button
          onClick={() => setShowFilter(showFilter === "all" ? "compared" : "all")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
            showFilter === "all"
              ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
              : "border-gray-300 dark:border-[#1F1F23] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#1F1F23]"
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          {showFilter === "all" ? t("ap.filterAll") : showFilter === "compared" ? t("ap.filterCompared") : t("ap.filterNoComp")}
        </button>
      </div>

      {/* Tableau des produits */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-[#1F1F23]">
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                {t("ap.headerProduct")}
              </th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                {t("ap.headerCategory")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                {t("ap.headerYourPrice")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                {t("ap.headerAvgComp")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                {t("ap.headerGap")}
              </th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                {t("ap.headerStatus")}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedProducts.map((produit, index) => (
              <tr
                key={index}
                className="border-b border-gray-100 dark:border-[#1F1F23] hover:bg-gray-50 dark:hover:bg-[#1A1A1E] transition-colors"
              >
                <td className="py-3 px-4 text-sm text-gray-900 dark:text-white">
                  {produit.name}
                </td>
                <td className="py-3 px-4 text-sm text-gray-500 dark:text-gray-400">
                  {categoryLabels[produit.categorie] || produit.categorie}
                </td>
                <td className="py-3 px-4 text-sm text-right font-semibold text-gray-900 dark:text-white tabular-nums">
                  {produit.prix.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}$
                </td>
                <td className="py-3 px-4 text-sm text-right text-gray-500 dark:text-gray-400 tabular-nums">
                  {produit.hasCompetitor
                    ? `${produit.prixMoyenMarche.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}$`
                    : '—'
                  }
                </td>
                <td className={`py-3 px-4 text-sm text-right font-semibold tabular-nums ${
                  !produit.hasCompetitor
                    ? 'text-gray-400 dark:text-gray-600'
                    : produit.ecartPourcentage < -threshold
                    ? 'text-green-600 dark:text-green-400'
                    : produit.ecartPourcentage >= threshold
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`}>
                  {produit.hasCompetitor
                    ? `${produit.ecartPourcentage >= 0 ? '+' : ''}${produit.ecartPourcentage.toFixed(1)}%`
                    : '—'
                  }
                </td>
                <td className="py-3 px-4 text-center">
                  {!produit.hasCompetitor ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      {t("ap.noCompetitorBadge")}
                    </span>
                  ) : isCompetitif(produit) ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      {t("ap.competitiveBadge")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                      {t("ap.tooExpensive")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sortedProducts.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {showFilter === "compared"
            ? t("ap.noCompetitorFound")
            : t("ap.noProductFound")
          }
        </div>
      )}

      {sortedProducts.length > ROWS_PER_PAGE && (
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
            {currentPage * ROWS_PER_PAGE + 1} – {Math.min((currentPage + 1) * ROWS_PER_PAGE, sortedProducts.length)} {t("ap.paginationOf")} {sortedProducts.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.03] hover:bg-gray-50 dark:hover:bg-white/[0.06] transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-3 w-3" />
              {t("ap.paginationPrev")}
            </button>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: totalPages }, (_, i) => i).map(page => {
                if (totalPages <= 7 || page === 0 || page === totalPages - 1 || Math.abs(page - currentPage) <= 1) {
                  return (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[28px] h-7 rounded-md text-xs font-medium transition ${
                        page === currentPage
                          ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
                      }`}
                    >
                      {page + 1}
                    </button>
                  )
                }
                if (page === 1 && currentPage > 3) return <span key="start-dots" className="px-1 text-xs text-gray-400">…</span>
                if (page === totalPages - 2 && currentPage < totalPages - 4) return <span key="end-dots" className="px-1 text-xs text-gray-400">…</span>
                return null
              })}
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.03] hover:bg-gray-50 dark:hover:bg-white/[0.06] transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t("ap.paginationNext")}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
