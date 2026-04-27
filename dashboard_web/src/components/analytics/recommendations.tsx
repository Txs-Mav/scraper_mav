"use client"

import { ArrowRight, TrendingUp, TrendingDown, Minus, Target } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface Opportunity {
  type: 'augmentation' | 'baisse' | 'marge'
  produit: string
  recommandation: string
  impactPotentiel: number
  categorie?: string
}

interface RecommendationsProps {
  opportunites: Opportunity[]
}

export default function ActionableRecommendations({ opportunites }: RecommendationsProps) {
  const { t } = useLanguage()
  // Trier par impact potentiel
  const sortedRecommendations = [...opportunites]
    .sort((a, b) => b.impactPotentiel - a.impactPotentiel)
    .slice(0, 5) // Top 5 recommandations

  const getRecommendationIcon = (type: string) => {
    switch (type) {
      case 'augmentation':
        return <TrendingUp className="h-5 w-5 text-[#3B6D11]" />
      case 'baisse':
        return <TrendingDown className="h-5 w-5 text-[#3B6D11]" />
      default:
        return <Target className="h-5 w-5 text-[#3B6D11]" />
    }
  }

  const getRecommendationColor = (type: string) => {
    switch (type) {
      case 'augmentation':
        return 'border-[#3B6D11]/20 dark:border-[#3B6D11]/30 bg-[#EAF3DE] dark:bg-[#3B6D11]/15'
      case 'baisse':
        return 'border-[#3B6D11]/20 dark:border-[#3B6D11]/30 bg-[#EAF3DE] dark:bg-[#3B6D11]/15'
      default:
        return 'border-[#3B6D11]/20 dark:border-[#3B6D11]/30 bg-[#EAF3DE] dark:bg-[#3B6D11]/15'
    }
  }

  if (sortedRecommendations.length === 0) {
    return (
      <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {t("ap.recommendations")}
        </h3>
        <div className="text-center py-8 text-gray-500 dark:text-[#B0B0B0]">
          {t("ap.noRecommendations")}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {t("ap.recommendations")}
      </h3>
      <p className="text-sm text-gray-500 dark:text-[#B0B0B0] mb-4">
        {t("ap.recommendationsDesc")}
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
                  <span className="text-xs text-gray-500 dark:text-[#B0B0B0]">
                    {t("ap.impact")} {rec.impactPotentiel.toFixed(0)}$
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
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


