"use client"

import { useState, useMemo, useEffect } from "react"
import { Search, ChevronLeft, ChevronRight } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

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

  const ecartColor = (ecart: number, hasCompetitor: boolean) => {
    if (!hasCompetitor) return 'text-[var(--color-text-secondary)] opacity-60'
    if (ecart < -threshold) return 'text-emerald-600 dark:text-emerald-400'
    if (ecart >= threshold) return 'text-red-600 dark:text-red-400'
    return 'text-[var(--color-text-secondary)]'
  }

  return (
    <SectionCard
      title={t("ap.productAnalysis")}
      subtitle={t("ap.productAnalysisDesc")}
      meta={
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)] flex-wrap">
          <span>
            <span className="tabular-nums font-semibold text-[var(--color-text-primary)]">{counts.compared}</span>{" "}
            {t("ap.comparedProducts").toLowerCase()}
          </span>
          <span className="opacity-40">·</span>
          <span>
            <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{counts.competitifs}</span>{" "}
            {t("ap.competitiveProducts").toLowerCase()}
          </span>
          <span className="opacity-40">·</span>
          <span>
            <span className="tabular-nums font-semibold text-red-600 dark:text-red-400">{counts.nonCompetitifs}</span>{" "}
            {t("ap.notCompetitiveProducts").toLowerCase()}
          </span>
          <span className="opacity-40">·</span>
          <span>
            <span className="tabular-nums font-semibold text-[var(--color-text-primary)]">{counts.sansCompetitor}</span>{" "}
            {t("ap.noCompetitor").toLowerCase()}
          </span>
        </div>
      }
      actions={
        <div className="inline-flex items-center rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]/50 p-0.5">
          {(["avg", "min"] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setCompareMode(mode)}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                compareMode === mode
                  ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {mode === 'avg' ? t("ap.compareModeAvg") : t("ap.compareModeMin")}
            </button>
          ))}
        </div>
      }
    >
      {/* Filter toolbar — neutre, simple */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-secondary)] opacity-60" />
          <input
            type="text"
            placeholder={t("ap.searchProduct")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 border border-[var(--color-border-tertiary)] rounded-lg bg-[var(--color-background-primary)]/60 text-[var(--color-text-primary)] text-sm placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-secondary)]"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-3 py-1.5 border border-[var(--color-border-tertiary)] rounded-lg bg-[var(--color-background-primary)]/60 text-[var(--color-text-primary)] text-sm"
        >
          <option value="all">{t("ap.allCategories")}</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{categoryLabels[cat] || cat}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "name" | "prix" | "ecart")}
          className="px-3 py-1.5 border border-[var(--color-border-tertiary)] rounded-lg bg-[var(--color-background-primary)]/60 text-[var(--color-text-primary)] text-sm"
        >
          <option value="ecart">{t("ap.sortByGap")}</option>
          <option value="prix">{t("ap.sortByPrice")}</option>
          <option value="name">{t("ap.sortByName")}</option>
        </select>
        <div className="inline-flex items-center rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]/50 p-0.5">
          {(["compared", "all", "no-competitor"] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setShowFilter(mode)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                showFilter === mode
                  ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {mode === 'all' ? t("ap.filterAll") : mode === 'compared' ? t("ap.filterCompared") : t("ap.filterNoComp")}
            </button>
          ))}
        </div>
      </div>

      {/* Seuil */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] whitespace-nowrap">
          {t("ap.thresholdLabel")}
        </span>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={threshold}
          onChange={e => setThreshold(parseFloat(e.target.value))}
          className="flex-1 h-1 rounded-full appearance-none cursor-pointer bg-[var(--color-background-secondary)] accent-[var(--color-text-primary)]"
        />
        <span className="tabular-nums text-xs font-semibold text-[var(--color-text-primary)] min-w-[3rem] text-right">
          {threshold.toFixed(1)}%
        </span>
        {threshold !== DEFAULT_THRESHOLD && (
          <button
            type="button"
            onClick={() => setThreshold(DEFAULT_THRESHOLD)}
            className="text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {t("ap.thresholdReset")}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-5">
        <table className="w-full">
          <thead>
            <tr className="border-y border-[var(--color-border-tertiary)]/40">
              <th className="text-left py-2 px-5 text-[11px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                {t("ap.headerProduct")}
              </th>
              <th className="text-left py-2 px-3 text-[11px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                {t("ap.headerCategory")}
              </th>
              <th className="text-right py-2 px-3 text-[11px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                {t("ap.headerYourPrice")}
              </th>
              <th className="text-right py-2 px-3 text-[11px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                {compareMode === "min" ? t("ap.headerMinComp") : t("ap.headerAvgComp")}
              </th>
              <th className="text-right py-2 px-5 text-[11px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                {t("ap.headerGap")}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedProducts.map((produit, index) => (
              <tr
                key={index}
                className="border-b border-[var(--color-border-tertiary)]/25 hover:bg-[var(--color-background-hover)]/40 transition-colors"
              >
                <td className="py-2.5 px-5 text-sm text-[var(--color-text-primary)] truncate max-w-xs">
                  {produit.name}
                </td>
                <td className="py-2.5 px-3 text-sm text-[var(--color-text-secondary)]">
                  {categoryLabels[produit.categorie] || produit.categorie}
                </td>
                <td className="py-2.5 px-3 text-sm text-right font-medium text-[var(--color-text-primary)] tabular-nums">
                  {produit.prix.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}$
                </td>
                <td className="py-2.5 px-3 text-sm text-right text-[var(--color-text-secondary)] tabular-nums">
                  {produit.hasCompetitor
                    ? `${getCompPrice(produit).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}$`
                    : '—'}
                </td>
                <td className={`py-2.5 px-5 text-sm text-right font-semibold tabular-nums ${ecartColor(getEcart(produit), produit.hasCompetitor)}`}>
                  {produit.hasCompetitor
                    ? `${getEcart(produit) >= 0 ? '+' : ''}${getEcart(produit).toFixed(1)}%`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sortedProducts.length === 0 && (
        <p className="text-center py-6 text-sm text-[var(--color-text-secondary)]">
          {showFilter === "compared" ? t("ap.noCompetitorFound") : t("ap.noProductFound")}
        </p>
      )}

      {sortedProducts.length > ROWS_PER_PAGE && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
            {currentPage * ROWS_PER_PAGE + 1}–{Math.min((currentPage + 1) * ROWS_PER_PAGE, sortedProducts.length)} {t("ap.paginationOf")} {sortedProducts.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-30"
            >
              <ChevronLeft className="h-3 w-3" />
              {t("ap.paginationPrev")}
            </button>
            <span className="px-2 text-xs tabular-nums text-[var(--color-text-secondary)]">
              {currentPage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-30"
            >
              {t("ap.paginationNext")}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
