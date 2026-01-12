"use client"

import { ArrowRight, TrendingUp, TrendingDown, Minus, Target } from "lucide-react"

interface Opportunity {
  type: 'augmentation' | 'baisse' | 'marge'
  produit: string
  recommandation: string
  impactPotentiel: number
}

interface RecommendationsProps {
  opportunites: Opportunity[]
}

export default function ActionableRecommendations({ opportunites }: RecommendationsProps) {
  // Trier par impact potentiel
  const sortedRecommendations = [...opportunites]
    .sort((a, b) => b.impactPotentiel - a.impactPotentiel)
    .slice(0, 5) // Top 5 recommandations

  const getRecommendationIcon = (type: string) => {
    switch (type) {
      case 'augmentation':
        return <TrendingUp className="h-5 w-5 text-green-500" />
      case 'baisse':
        return <TrendingDown className="h-5 w-5 text-blue-500" />
      default:
        return <Target className="h-5 w-5 text-purple-500" />
    }
  }

  const getRecommendationColor = (type: string) => {
    switch (type) {
      case 'augmentation':
        return 'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-900/20'
      case 'baisse':
        return 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20'
      default:
        return 'border-purple-200 dark:border-purple-900 bg-purple-50 dark:bg-purple-900/20'
    }
  }

  if (sortedRecommendations.length === 0) {
    return (
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Recommandations Actionnables
        </h3>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Aucune recommandation pour le moment
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Recommandations Actionnables
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Recommandations priorisées par impact potentiel
      </p>
      <div className="space-y-4">
        {sortedRecommendations.map((rec, index) => (
          <div
            key={index}
            className={`border rounded-lg p-4 ${getRecommendationColor(rec.type)}`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                {getRecommendationIcon(rec.type)}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {rec.produit}
                  </span>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Impact: {rec.impactPotentiel.toFixed(0)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <ArrowRight className="h-4 w-4" />
                  <span>{rec.recommandation}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


