"use client"

import { TrendingDown, TrendingUp, Minus, Award } from "lucide-react"

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
  const getPositionIcon = () => {
    switch (positionnement.position) {
      case 'lowest':
        return <TrendingDown className="h-8 w-8 text-green-500" />
      case 'above':
        return <TrendingUp className="h-8 w-8 text-red-500" />
      default:
        return <Minus className="h-8 w-8 text-gray-500" />
    }
  }

  const getPositionColor = () => {
    switch (positionnement.position) {
      case 'lowest':
        return 'text-green-600 dark:text-green-400'
      case 'above':
        return 'text-red-600 dark:text-red-400'
      default:
        return 'text-gray-600 dark:text-gray-400'
    }
  }

  const getPositionLabel = () => {
    switch (positionnement.position) {
      case 'lowest':
        return 'Prix le plus bas'
      case 'above':
        return 'Au-dessus du marché'
      default:
        return 'Dans la moyenne'
    }
  }

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Positionnement de Prix
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
          <div className="bg-gray-50 dark:bg-[#1F1F23] rounded-lg p-4">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Écart en %
            </div>
            <div className={`text-2xl font-bold ${getPositionColor()}`}>
              {positionnement.ecartPourcentage >= 0 ? '+' : ''}
              {positionnement.ecartPourcentage.toFixed(1)}%
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-[#1F1F23] rounded-lg p-4">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Écart en valeur
            </div>
            <div className={`text-2xl font-bold ${getPositionColor()}`}>
              {positionnement.ecartValeur >= 0 ? '+' : ''}
              {positionnement.ecartValeur.toFixed(2)}$
            </div>
          </div>
        </div>

        {/* Classement */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            Classement
          </div>
          <div className="text-xl font-semibold text-blue-600 dark:text-blue-400">
            {positionnement.classement}{getOrdinalSuffix(positionnement.classement)} moins cher sur {positionnement.totalDetailleurs} détaillants
          </div>
        </div>

        {/* Message résumé */}
        <div className="bg-gray-50 dark:bg-[#1F1F23] rounded-lg p-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
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


