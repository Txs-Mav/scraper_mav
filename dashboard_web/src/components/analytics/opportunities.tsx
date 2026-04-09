"use client"

import { TrendingUp, TrendingDown, DollarSign, Lightbulb } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface Opportunity {
  type: 'augmentation' | 'baisse' | 'marge'
  produit: string
  recommandation: string
  impactPotentiel: number
  categorie?: string
}

interface OpportunitiesProps {
  opportunites: Opportunity[]
}

export default function OpportunitiesDetection({ opportunites }: OpportunitiesProps) {
  const { t } = useLanguage()

  const getOpportunityIcon = (type: string) => {
    switch (type) {
      case 'augmentation':
        return <TrendingUp className="h-5 w-5 text-[#3B6D11]" />
      case 'baisse':
        return <TrendingDown className="h-5 w-5 text-emerald-500" />
      case 'marge':
        return <DollarSign className="h-5 w-5 text-emerald-500" />
      default:
        return <Lightbulb className="h-5 w-5 text-yellow-500" />
    }
  }

  const getOpportunityColor = (type: string) => {
    switch (type) {
      case 'augmentation':
        return 'border-[#3B6D11]/20 dark:border-[#3B6D11]/30 bg-[#EAF3DE] dark:bg-[#3B6D11]/15'
      case 'baisse':
        return 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20'
      case 'marge':
        return 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20'
      default:
        return 'border-gray-200 dark:border-[#3A3A3A] bg-gray-50 dark:bg-[#2A2A2A]'
    }
  }

  const getOpportunityLabel = (type: string) => {
    switch (type) {
      case 'augmentation':
        return t("ap.increaseLabel")
      case 'baisse':
        return t("ap.decreaseLabel")
      case 'marge':
        return t("ap.marginLabel")
      default:
        return t("ap.opportunityLabel")
    }
  }

  // Trier par impact potentiel (décroissant)
  const sortedOpportunities = [...opportunites].sort((a, b) => b.impactPotentiel - a.impactPotentiel)

  return (
    <div className="bg-white dark:bg-[#222222] rounded-2xl border border-gray-200 dark:border-[#3A3A3A] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {t("ap.opportunityDetection")}
      </h3>

      {sortedOpportunities.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-[#B0B0B0]">
          {t("ap.noOpportunities")}
        </div>
      ) : (
        <div className="space-y-4">
          {sortedOpportunities.slice(0, 10).map((opp, index) => (
            <div
              key={index}
              className={`border rounded-lg p-4 ${getOpportunityColor(opp.type)}`}
            >
              <div className="flex items-start gap-3">
                {getOpportunityIcon(opp.type)}
                <div className="flex-1">
                  <div className="mb-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {getOpportunityLabel(opp.type)}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                    {opp.produit}
                    {opp.categorie && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-50 dark:bg-[#2A2A2A] text-gray-500 dark:text-[#B0B0B0]">
                        {opp.categorie}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-[#B0B0B0]">
                    {opp.recommandation}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


