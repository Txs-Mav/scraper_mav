"use client"

import { TrendingDown, TrendingUp, Minus, Award } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface PricePositioningProps {
  positionnement: {
    position: 'lowest' | 'average' | 'above'
    ecartPourcentage: number
    ecartValeur: number
    classement: number
    totalDetailleurs: number
    message: string
  }
}

export default function PricePositioningCard({ positionnement }: PricePositioningProps) {
  const { t } = useLanguage()

  const getPositionIcon = () => {
    switch (positionnement.position) {
      case 'lowest':
        return <TrendingDown className="h-8 w-8 text-[#3B6D11]" />
      case 'above':
        return <TrendingUp className="h-8 w-8 text-[#A32D2D]" />
      default:
        return <Minus className="h-8 w-8 text-gray-500" />
    }
  }

  const getPositionColor = () => {
    switch (positionnement.position) {
      case 'lowest':
        return 'text-[#3B6D11] dark:text-[#3B6D11]'
      case 'above':
        return 'text-[#A32D2D] dark:text-[#A32D2D]'
      default:
        return 'text-gray-500 dark:text-[#B0B0B0]'
    }
  }

  const getPositionLabel = () => {
    switch (positionnement.position) {
      case 'lowest':
        return t("ap.lowest")
      case 'above':
        return t("ap.above")
      default:
        return t("ap.average")
    }
  }

  return (
    <div className="bg-white dark:bg-[#222222] rounded-2xl border border-gray-200 dark:border-[#3A3A3A] p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("ap.positioning")}
        </h3>
        {getPositionIcon()}
      </div>

      <div className="space-y-4">
        {/* Position globale */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Award className="h-5 w-5 text-gray-500" />
            <span className={`text-xl font-bold ${getPositionColor()}`}>
              {getPositionLabel()}
            </span>
          </div>
        </div>

        {/* Écart */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 dark:bg-[#2A2A2A] rounded-lg p-4">
            <div className="text-sm text-gray-500 dark:text-[#B0B0B0] mb-1">
              {t("ap.gapPercent")}
            </div>
            <div className={`text-2xl font-bold ${getPositionColor()}`}>
              {positionnement.ecartPourcentage >= 0 ? '+' : ''}
              {positionnement.ecartPourcentage.toFixed(1)}%
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-[#2A2A2A] rounded-lg p-4">
            <div className="text-sm text-gray-500 dark:text-[#B0B0B0] mb-1">
              {t("ap.gapValue")}
            </div>
            <div className={`text-2xl font-bold ${getPositionColor()}`}>
              {positionnement.ecartValeur >= 0 ? '+' : ''}
              {positionnement.ecartValeur.toFixed(2)}$
            </div>
          </div>
        </div>

        {/* Classement */}
        <div className="bg-[#EAF3DE] dark:bg-[#3B6D11]/15 rounded-lg p-4">
          <div className="text-sm text-[#27500A] dark:text-gray-500 dark:text-[#B0B0B0] mb-1">
              {t("ap.ranking")}
          </div>
          <div className="text-xl font-semibold text-[#3B6D11] dark:text-[#3B6D11]">
            {positionnement.classement}{getOrdinalSuffix(positionnement.classement)} {t("ap.cheapestOf")} {positionnement.totalDetailleurs} {t("ap.retailers")}
          </div>
        </div>

        {/* Message résumé */}
        <div className="bg-gray-50 dark:bg-[#2A2A2A] rounded-lg p-4">
          <p className="text-sm text-gray-900 dark:text-white">
            {positionnement.message}
          </p>
        </div>
      </div>
    </div>
  )
}

function getOrdinalSuffix(n: number): string {
  if (n === 1) return 'er'
  return 'e'
}


