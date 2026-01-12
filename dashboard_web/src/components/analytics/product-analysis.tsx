"use client"

import { useState } from "react"
import { Search, Filter, ChevronDown } from "lucide-react"

interface Product {
  name: string
  prix: number
  prixMoyenMarche: number
  ecartPourcentage: number
  competitif: boolean
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
  autre: "Autre"
}

export default function ProductCategoryAnalysis({ produits }: ProductAnalysisProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"name" | "prix" | "ecart">("ecart")

  // Filtrer les produits
  const filteredProducts = produits.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === "all" || p.categorie === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Trier les produits
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

  // Obtenir les catégories uniques
  const categories = Array.from(new Set(produits.map(p => p.categorie))).filter(Boolean)

  // Compter les produits compétitifs vs non compétitifs
  const competitifs = sortedProducts.filter(p => p.competitif).length
  const nonCompetitifs = sortedProducts.filter(p => !p.competitif).length

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Analyse par Produit ou Catégorie
      </h3>

      {/* Filtres et recherche */}
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un produit..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-[#1F1F23] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-[#1F1F23] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
        >
          <option value="all">Toutes les catégories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{categoryLabels[cat] || cat}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "name" | "prix" | "ecart")}
          className="px-4 py-2 border border-gray-300 dark:border-[#1F1F23] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
        >
          <option value="ecart">Trier par écart</option>
          <option value="prix">Trier par prix</option>
          <option value="name">Trier par nom</option>
        </select>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-50 dark:bg-[#1F1F23] rounded-lg p-3">
          <div className="text-sm text-gray-600 dark:text-gray-400">Total produits</div>
          <div className="text-xl font-semibold text-gray-900 dark:text-white">
            {sortedProducts.length}
          </div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
          <div className="text-sm text-green-600 dark:text-green-400">Compétitifs</div>
          <div className="text-xl font-semibold text-green-600 dark:text-green-400">
            {competitifs}
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <div className="text-sm text-red-600 dark:text-red-400">Non compétitifs</div>
          <div className="text-xl font-semibold text-red-600 dark:text-red-400">
            {nonCompetitifs}
          </div>
        </div>
      </div>

      {/* Tableau des produits */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-[#1F1F23]">
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Produit
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Catégorie
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Prix
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Prix moyen marché
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Écart %
              </th>
              <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Statut
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((produit, index) => (
              <tr
                key={index}
                className="border-b border-gray-100 dark:border-[#1F1F23] hover:bg-gray-50 dark:hover:bg-[#1F1F23]"
              >
                <td className="py-3 px-4 text-sm text-gray-900 dark:text-white">
                  {produit.name}
                </td>
                <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">
                  {categoryLabels[produit.categorie] || produit.categorie}
                </td>
                <td className="py-3 px-4 text-sm text-right font-semibold text-gray-900 dark:text-white">
                  {produit.prix.toFixed(2)}$
                </td>
                <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                  {produit.prixMoyenMarche.toFixed(2)}$
                </td>
                <td className={`py-3 px-4 text-sm text-right font-semibold ${
                  produit.ecartPourcentage < 0
                    ? 'text-green-600 dark:text-green-400'
                    : produit.ecartPourcentage > 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`}>
                  {produit.ecartPourcentage >= 0 ? '+' : ''}
                  {produit.ecartPourcentage.toFixed(1)}%
                </td>
                <td className="py-3 px-4 text-center">
                  {produit.competitif ? (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      🟢 Compétitif
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                      🔴 Trop cher
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
          Aucun produit trouvé
        </div>
      )}
    </div>
  )
}


