"use client"

import { Package, Tag, BookOpen, Recycle } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface Product {
  name: string
  prix: number
  prixMoyenMarche: number
  ecartPourcentage: number
  competitif: boolean
  hasCompetitor: boolean
  categorie: string
  disponibilite?: string
  sourceUrl?: string
  sourceSite?: string
  etat?: string
  inventaire?: string
}

interface ExplanatoryFactorsProps {
  produits: Product[]
}

export default function ExplanatoryFactors({ produits }: ExplanatoryFactorsProps) {
  const { t } = useLanguage()

  const stats = {
    usage: produits.filter(p => {
      const etat = (p.etat || '').toLowerCase()
      return etat === 'usagé' || etat === 'usage' || etat === 'usagé' || etat === 'used'
    }).length,
    inventaire: produits.filter(p => {
      const inv = (p.inventaire || '').toLowerCase()
      const etat = (p.etat || '').toLowerCase()
      const isUsed = etat === 'usagé' || etat === 'usage' || etat === 'usagé' || etat === 'used'
      return !isUsed && (inv === 'inventaire' || inv === 'inventory' || inv === 'en_stock' || p.disponibilite === 'en_stock')
    }).length,
    catalogue: produits.filter(p => {
      const inv = (p.inventaire || '').toLowerCase()
      const etat = (p.etat || '').toLowerCase()
      const isUsed = etat === 'usagé' || etat === 'usage' || etat === 'usagé' || etat === 'used'
      const isInventaire = inv === 'inventaire' || inv === 'inventory' || inv === 'en_stock' || p.disponibilite === 'en_stock'
      return !isUsed && !isInventaire
    }).length,
    total: produits.length,
  }

  return (
    <div className="bg-white dark:bg-[#222222] rounded-2xl border border-gray-200 dark:border-[#3A3A3A] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {t("ap.factors")}
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Recycle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {t("ap.used")}
            </span>
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {stats.usage}
          </div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {t("ap.inventory")}
            </span>
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats.inventaire}
          </div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {t("ap.catalogue")}
            </span>
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats.catalogue}
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-[#2A2A2A] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="h-5 w-5 text-gray-500 dark:text-[#B0B0B0]" />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">
              {t("ap.total")}
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {stats.total}
          </div>
        </div>
      </div>
    </div>
  )
}
