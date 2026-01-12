"use client"

import { Package, Truck, Tag, CheckCircle, XCircle } from "lucide-react"

interface Product {
  name: string
  prix: number
  disponibilite?: string
  sourceUrl?: string
  sourceSite?: string
}

interface ExplanatoryFactorsProps {
  produits: Product[]
}

const disponibiliteLabels: Record<string, string> = {
  en_stock: "En stock",
  sur_commande: "Sur commande",
  epuise: "Épuisé",
  non_disponible: "Non disponible"
}

const disponibiliteIcons: Record<string, any> = {
  en_stock: CheckCircle,
  sur_commande: Package,
  epuise: XCircle,
  non_disponible: XCircle
}

const disponibiliteColors: Record<string, string> = {
  en_stock: "text-green-600 dark:text-green-400",
  sur_commande: "text-yellow-600 dark:text-yellow-400",
  epuise: "text-red-600 dark:text-red-400",
  non_disponible: "text-gray-600 dark:text-gray-400"
}

export default function ExplanatoryFactors({ produits }: ExplanatoryFactorsProps) {
  // Compter les facteurs
  const stats = {
    enStock: produits.filter(p => p.disponibilite === 'en_stock').length,
    surCommande: produits.filter(p => p.disponibilite === 'sur_commande').length,
    epuise: produits.filter(p => p.disponibilite === 'epuise').length,
    total: produits.length
  }

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Facteurs Explicatifs
      </h3>

      {/* Statistiques globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span className="text-sm font-semibold text-green-800 dark:text-green-300">
              En stock
            </span>
          </div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {stats.enStock}
          </div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
              Sur commande
            </span>
          </div>
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            {stats.surCommande}
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <span className="text-sm font-semibold text-red-800 dark:text-red-300">
              Épuisé
            </span>
          </div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">
            {stats.epuise}
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-[#1F1F23] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">
              Total
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {stats.total}
          </div>
        </div>
      </div>

      {/* Liste des produits avec facteurs */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Détails par produit
        </h4>
        <div className="max-h-96 overflow-y-auto space-y-2">
          {produits.slice(0, 20).map((produit, index) => {
            const DisponibiliteIcon = produit.disponibilite 
              ? disponibiliteIcons[produit.disponibilite] || Package
              : Package
            const disponibiliteColor = produit.disponibilite
              ? disponibiliteColors[produit.disponibilite] || "text-gray-600 dark:text-gray-400"
              : "text-gray-600 dark:text-gray-400"
            
            return (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1F1F23] rounded-lg"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {produit.name}
                  </div>
                  {produit.sourceSite && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {produit.sourceSite}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {produit.disponibilite && (
                    <div className={`flex items-center gap-1 ${disponibiliteColor}`}>
                      <DisponibiliteIcon className="h-4 w-4" />
                      <span className="text-xs">
                        {disponibiliteLabels[produit.disponibilite] || produit.disponibilite}
                      </span>
                    </div>
                  )}
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                    {produit.prix.toFixed(2)}$
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {produits.length > 20 && (
          <div className="text-center text-sm text-gray-500 dark:text-gray-400 pt-2">
            ... et {produits.length - 20} autres produits
          </div>
        )}
      </div>
    </div>
  )
}


