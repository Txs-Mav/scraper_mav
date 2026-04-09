"use client"

import { useState, useMemo, useEffect } from "react"
import { Search, Filter, SlidersHorizontal, ChevronLeft, ChevronRight } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface Product {
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
  const [compareMode, setCompareMode] = useState<"avg" | "min">("avg")

  const getEcart = (p: Product) =>
    compareMode === "min" ? p.ecartPourcentageMin : p.ecartPourcentage
  const getCompPrice = (p: Product) =>
    compareMode === "min" ? p.prixMinMarche : p.prixMoyenMarche
  const isCompetitif = (p: Product) =>
    p.hasCompetitor ? getEcart(p) < threshold : true

  const counts = useMemo(() => {
    const compared = produits.filter(p => p.hasCompetitor)
    return {
      total: produits.length,
      compared: compared.length,
      competitifs: compared.filter(p => (compareMode === "min" ? p.ecartPourcentageMin : p.ecartPourcentage) < threshold).length,
      nonCompetitifs: compared.filter(p => (compareMode === "min" ? p.ecartPourcentageMin : p.ecartPourcentage) >= threshold).length,
      sansCompetitor: produits.filter(p => !p.hasCompetitor).length,
    }
  }, [produits, threshold, compareMode])

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
        return Math.abs(getEcart(b)) - Math.abs(getEcart(a))
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

  const categorySummary = useMemo(() => {
    const compared = produits.filter(p => p.hasCompetitor)
    const summary: Record<string, { total: number; competitif: number; ecartSum: number }> = {}
    for (const p of compared) {
      const cat = p.categorie || 'autre'
      if (!summary[cat]) {
        summary[cat] = { total: 0, competitif: 0, ecartSum: 0 }
      }
      summary[cat].total++
      const ecart = compareMode === "min" ? p.ecartPourcentageMin : p.ecartPourcentage
      summary[cat].ecartSum += ecart
      if (ecart < threshold) summary[cat].competitif++
    }
    return Object.entries(summary)
      .map(([cat, s]) => ({
        categorie: cat,
        total: s.total,
        competitif: s.competitif,
        ecartMoyen: s.total > 0 ? s.ecartSum / s.total : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [produits, threshold, compareMode])

  return (
    <div className="bg-white dark:bg-[#222222] rounded-2xl border border-gray-200 dark:border-[#3A3A3A] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        {t("ap.productAnalysis")}
      </h3>
      <p className="text-sm text-gray-500 dark:text-[#B0B0B0] mb-4">
        {t("ap.productAnalysisDesc")}
      </p>

      {/* Toggle: Moyenne vs Prix le plus bas */}
      <div className="mb-4 flex items-center gap-1 rounded-xl border border-gray-200 dark:border-[#3A3A3A] bg-gray-50 dark:bg-[#2A2A2A] p-1 w-fit">
        <button
          onClick={() => setCompareMode("avg")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            compareMode === "avg"
              ? "bg-white dark:bg-[#3A3A3A] text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-[#B0B0B0] hover:text-gray-700 dark:hover:text-white"
          }`}
        >
          {t("ap.compareModeAvg")}
        </button>
        <button
          onClick={() => setCompareMode("min")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            compareMode === "min"
              ? "bg-white dark:bg-[#3A3A3A] text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-[#B0B0B0] hover:text-gray-700 dark:hover:text-white"
          }`}
        >
          {t("ap.compareModeMin")}
        </button>
      </div>

      {/* Statistiques — 4 blocs distincts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <button
          onClick={() => setShowFilter("compared")}
          className={`rounded-lg p-3 text-left transition-all border ${
            showFilter === "compared"
              ? "ring-2 ring-emerald-500 border-emerald-200 dark:border-emerald-800"
              : "border-transparent"
          } bg-emerald-50 dark:bg-emerald-900/20`}
        >
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("ap.comparedProducts")}</div>
          <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{counts.compared}</div>
        </button>
        <div className="rounded-lg p-3 bg-[#EAF3DE] dark:bg-[#3B6D11]/15">
          <div className="text-xs font-medium text-[#3B6D11] dark:text-[#3B6D11]">{t("ap.competitiveProducts")}</div>
          <div className="text-xl font-bold text-[#27500A] dark:text-[#3B6D11]">{counts.competitifs}</div>
        </div>
        <div className="rounded-lg p-3 bg-[#FCEBEB] dark:bg-[#A32D2D]/15">
          <div className="text-xs font-medium text-[#A32D2D] dark:text-[#A32D2D]">{t("ap.notCompetitiveProducts")}</div>
          <div className="text-xl font-bold text-[#791F1F] dark:text-[#A32D2D]">{counts.nonCompetitifs}</div>
        </div>
        <button
          onClick={() => setShowFilter(showFilter === "no-competitor" ? "compared" : "no-competitor")}
          className={`rounded-lg p-3 text-left transition-all border ${
            showFilter === "no-competitor"
              ? "ring-2 ring-gray-400 border-gray-200 dark:border-[#3A3A3A]"
              : "border-transparent"
          } bg-gray-50 dark:bg-[#2A2A2A]`}
        >
          <div className="text-xs font-medium text-gray-500 dark:text-[#B0B0B0]">{t("ap.noCompetitor")}</div>
          <div className="text-xl font-bold text-gray-500 dark:text-[#B0B0B0]">{counts.sansCompetitor}</div>
        </button>
      </div>

      {/* Seuil de compétitivité */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-[#B0B0B0]">
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
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-gray-200 dark:bg-[#3A3A3A] accent-emerald-600 dark:accent-emerald-500"
          />
          <span className="tabular-nums text-sm font-bold text-gray-900 dark:text-white min-w-[52px] text-right">
            {threshold.toFixed(1)}%
          </span>
        </div>
        {threshold !== DEFAULT_THRESHOLD && (
          <button
            onClick={() => setThreshold(DEFAULT_THRESHOLD)}
            className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
          >
            {t("ap.thresholdReset")}
          </button>
        )}
      </div>

      {/* Résumé par catégorie (seulement produits comparés) */}
      {categorySummary.length > 1 && showFilter !== "no-competitor" && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 dark:text-[#B0B0B0] mb-2 uppercase tracking-wide">
            {t("ap.avgGapByCategory")}
          </div>
          <div className="flex flex-wrap gap-2">
            {categorySummary.map(cs => {
              const ecartColor = cs.ecartMoyen < -2
                ? 'bg-[#EAF3DE] dark:bg-[#3B6D11]/15 border-[#3B6D11]/20 dark:border-[#3B6D11]/30 text-[#27500A] dark:text-[#3B6D11]'
                : cs.ecartMoyen > 2
                ? 'bg-[#FCEBEB] dark:bg-[#A32D2D]/15 border-[#A32D2D]/20 dark:border-[#A32D2D]/30 text-[#791F1F] dark:text-[#A32D2D]'
                : 'bg-gray-50 dark:bg-[#2A2A2A] border-gray-200 dark:border-[#3A3A3A] text-gray-900 dark:text-white'
              return (
                <button
                  key={cs.categorie}
                  onClick={() => setSelectedCategory(
                    selectedCategory === cs.categorie ? 'all' : cs.categorie
                  )}
                  className={`rounded-lg px-3 py-2 border text-xs font-medium transition-all ${ecartColor} ${
                    selectedCategory === cs.categorie ? 'ring-2 ring-emerald-500' : ''
                  }`}
                >
                  <span className="font-semibold">{categoryLabels[cs.categorie] || cs.categorie}</span>
                  <span className="ml-2">
                    {cs.ecartMoyen >= 0 ? '+' : ''}{cs.ecartMoyen.toFixed(1)}%
                  </span>
                  <span className="ml-1 text-gray-500 dark:text-[#B0B0B0]">
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
            className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-[#3A3A3A] rounded-lg bg-white dark:bg-[#222222] text-gray-900 dark:text-white text-sm"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-[#3A3A3A] rounded-lg bg-white dark:bg-[#222222] text-gray-900 dark:text-white text-sm"
        >
          <option value="all" style={{ backgroundColor: "#ffffff", color: "#111827" }}>{t("ap.allCategories")}</option>
          {categories.map(cat => (
            <option key={cat} value={cat} style={{ backgroundColor: "#ffffff", color: "#111827" }}>{categoryLabels[cat] || cat}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "name" | "prix" | "ecart")}
          className="px-3 py-2 border border-gray-200 dark:border-[#3A3A3A] rounded-lg bg-white dark:bg-[#222222] text-gray-900 dark:text-white text-sm"
        >
          <option value="ecart" style={{ backgroundColor: "#ffffff", color: "#111827" }}>{t("ap.sortByGap")}</option>
          <option value="prix" style={{ backgroundColor: "#ffffff", color: "#111827" }}>{t("ap.sortByPrice")}</option>
          <option value="name" style={{ backgroundColor: "#ffffff", color: "#111827" }}>{t("ap.sortByName")}</option>
        </select>
        <button
          onClick={() => setShowFilter(showFilter === "all" ? "compared" : "all")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
            showFilter === "all"
              ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
              : "border-gray-200 dark:border-[#3A3A3A] text-gray-500 dark:text-[#B0B0B0] hover:hover:bg-gray-50 dark:hover:bg-[#333333]"
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
            <tr className="border-b border-gray-200 dark:border-[#3A3A3A]">
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-[#B0B0B0] uppercase tracking-wider">
                {t("ap.headerProduct")}
              </th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-[#B0B0B0] uppercase tracking-wider">
                {t("ap.headerCategory")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-[#B0B0B0] uppercase tracking-wider">
                {t("ap.headerYourPrice")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-[#B0B0B0] uppercase tracking-wider">
                {compareMode === "min" ? t("ap.headerMinComp") : t("ap.headerAvgComp")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-[#B0B0B0] uppercase tracking-wider">
                {t("ap.headerGap")}
              </th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 dark:text-[#B0B0B0] uppercase tracking-wider">
                {t("ap.headerStatus")}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedProducts.map((produit, index) => (
              <tr
                key={index}
                className="border-b border-gray-100 dark:border-[#2E2E2E] hover:hover:bg-gray-50 dark:hover:bg-[#333333] transition-colors"
              >
                <td className="py-3 px-4 text-sm text-gray-900 dark:text-white">
                  {produit.name}
                </td>
                <td className="py-3 px-4 text-sm text-gray-500 dark:text-[#B0B0B0]">
                  {categoryLabels[produit.categorie] || produit.categorie}
                </td>
                <td className="py-3 px-4 text-sm text-right font-semibold text-gray-900 dark:text-white tabular-nums">
                  {produit.prix.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}$
                </td>
                <td className="py-3 px-4 text-sm text-right text-gray-500 dark:text-[#B0B0B0] tabular-nums">
                  {produit.hasCompetitor
                    ? `${getCompPrice(produit).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}$`
                    : '—'
                  }
                </td>
                <td className={`py-3 px-4 text-sm text-right font-semibold tabular-nums ${
                  !produit.hasCompetitor
                    ? 'text-gray-400 dark:text-gray-600'
                    : getEcart(produit) < -threshold
                    ? 'text-[#3B6D11] dark:text-[#3B6D11]'
                    : getEcart(produit) >= threshold
                    ? 'text-[#A32D2D] dark:text-[#A32D2D]'
                    : 'text-gray-500 dark:text-[#B0B0B0]'
                }`}>
                  {produit.hasCompetitor
                    ? `${getEcart(produit) >= 0 ? '+' : ''}${getEcart(produit).toFixed(1)}%`
                    : '—'
                  }
                </td>
                <td className="py-3 px-4 text-center">
                  {!produit.hasCompetitor ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 dark:bg-[#2A2A2A] text-gray-500 dark:text-[#B0B0B0]">
                      {t("ap.noCompetitorBadge")}
                    </span>
                  ) : isCompetitif(produit) ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#EAF3DE] text-[#27500A] dark:bg-[#3B6D11]/20 dark:text-[#3B6D11]">
                      {t("ap.competitiveBadge")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#FCEBEB] text-[#791F1F] dark:bg-[#A32D2D]/20 dark:text-[#A32D2D]">
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
        <div className="text-center py-8 text-gray-500 dark:text-[#B0B0B0]">
          {showFilter === "compared"
            ? t("ap.noCompetitorFound")
            : t("ap.noProductFound")
          }
        </div>
      )}

      {sortedProducts.length > ROWS_PER_PAGE && (
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-xs text-gray-500 dark:text-[#B0B0B0] tabular-nums">
            {currentPage * ROWS_PER_PAGE + 1} – {Math.min((currentPage + 1) * ROWS_PER_PAGE, sortedProducts.length)} {t("ap.paginationOf")} {sortedProducts.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-[#B0B0B0] border border-gray-200 dark:border-[#3A3A3A] bg-white dark:bg-white/[0.03] hover:hover:bg-gray-50 dark:hover:bg-[#333333] transition disabled:opacity-30 disabled:cursor-not-allowed"
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
                          : "text-gray-500 dark:text-[#B0B0B0] hover:hover:bg-gray-50 dark:hover:bg-[#333333]"
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
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-[#B0B0B0] border border-gray-200 dark:border-[#3A3A3A] bg-white dark:bg-white/[0.03] hover:hover:bg-gray-50 dark:hover:bg-[#333333] transition disabled:opacity-30 disabled:cursor-not-allowed"
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
