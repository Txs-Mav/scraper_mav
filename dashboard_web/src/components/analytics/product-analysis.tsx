"use client"

import { useState, useMemo } from "react"
import { Search, Filter } from "lucide-react"

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

export default function ProductCategoryAnalysis({ produits }: ProductAnalysisProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"name" | "prix" | "ecart">("ecart")
  const [showFilter, setShowFilter] = useState<"compared" | "all" | "no-competitor">("compared")

  // Compteurs globaux (avant filtrage recherche/catégorie)
  const counts = useMemo(() => {
    const compared = produits.filter(p => p.hasCompetitor)
    return {
      total: produits.length,
      compared: compared.length,
      competitifs: compared.filter(p => p.competitif).length,
      nonCompetitifs: compared.filter(p => !p.competitif).length,
      sansCompetitor: produits.filter(p => !p.hasCompetitor).length,
    }
  }, [produits])

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
      if (p.competitif) summary[cat].competitif++
    }
    return Object.entries(summary)
      .map(([cat, s]) => ({
        categorie: cat,
        total: s.total,
        competitif: s.competitif,
        ecartMoyen: s.total > 0 ? s.ecartSum / s.total : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [produits])

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        Analyse par Produit
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
        Comparaison de vos prix avec la moyenne des concurrents sur les produits identiques
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
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400">Produits comparés</div>
          <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{counts.compared}</div>
        </button>
        <div className="rounded-lg p-3 bg-green-50 dark:bg-green-900/20">
          <div className="text-xs font-medium text-green-600 dark:text-green-400">Compétitifs</div>
          <div className="text-xl font-bold text-green-700 dark:text-green-300">{counts.competitifs}</div>
        </div>
        <div className="rounded-lg p-3 bg-red-50 dark:bg-red-900/20">
          <div className="text-xs font-medium text-red-600 dark:text-red-400">Non compétitifs</div>
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
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Sans concurrent</div>
          <div className="text-xl font-bold text-gray-600 dark:text-gray-300">{counts.sansCompetitor}</div>
        </button>
      </div>

      {/* Résumé par catégorie (seulement produits comparés) */}
      {categorySummary.length > 1 && showFilter !== "no-competitor" && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
            Écart moyen par catégorie (produits comparés)
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
            placeholder="Rechercher un produit..."
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
          <option value="all">Toutes les catégories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{categoryLabels[cat] || cat}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "name" | "prix" | "ecart")}
          className="px-3 py-2 border border-gray-300 dark:border-[#1F1F23] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white text-sm"
        >
          <option value="ecart">Trier par écart</option>
          <option value="prix">Trier par prix</option>
          <option value="name">Trier par nom</option>
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
          {showFilter === "all" ? "Tout" : showFilter === "compared" ? "Comparés" : "Sans concurrent"}
        </button>
      </div>

      {/* Tableau des produits */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-[#1F1F23]">
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                Produit
              </th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                Catégorie
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                Votre prix
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                Moy. concurrents
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                Écart
              </th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                Statut
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((produit, index) => (
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
                    : produit.ecartPourcentage < -0.5
                    ? 'text-green-600 dark:text-green-400'
                    : produit.ecartPourcentage > 0.5
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
                      Aucun concurrent
                    </span>
                  ) : produit.competitif ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      Compétitif
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                      Trop cher
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
            ? "Aucun produit avec des concurrents trouvé. Vérifiez que les noms de produits correspondent entre les sites."
            : "Aucun produit trouvé"
          }
        </div>
      )}
    </div>
  )
}
