"use client"

import { TrendingUp, TrendingDown, DollarSign, Lightbulb } from "lucide-react"

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
  const getOpportunityIcon = (type: string) => {
    switch (type) {
      case 'augmentation':
        return <TrendingUp className="h-5 w-5 text-green-500" />
      case 'baisse':
        return <TrendingDown className="h-5 w-5 text-blue-500" />
      case 'marge':
        return <DollarSign className="h-5 w-5 text-purple-500" />
      default:
        return <Lightbulb className="h-5 w-5 text-yellow-500" />
    }
  }

  const getOpportunityColor = (type: string) => {
    switch (type) {
      case 'augmentation':
        return 'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-900/20'
      case 'baisse':
        return 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20'
      case 'marge':
        return 'border-purple-200 dark:border-purple-900 bg-purple-50 dark:bg-purple-900/20'
      default:
        return 'border-gray-200 dark:border-gray-900 bg-gray-50 dark:bg-gray-900/20'
    }
  }

  const getOpportunityLabel = (type: string) => {
    switch (type) {
      case 'augmentation':
        return 'Augmentation possible'
      case 'baisse':
        return 'Baisse recommandée'
      case 'marge':
        return 'Marge potentielle'
      default:
        return 'Opportunité'
    }
  }

  // Trier par impact potentiel (décroissant)
  const sortedOpportunities = [...opportunites].sort((a, b) => b.impactPotentiel - a.impactPotentiel)

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Détection d'Opportunités
      </h3>

      {sortedOpportunities.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Aucune opportunité détectée pour le moment
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
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {getOpportunityLabel(opp.type)}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      Impact: {opp.impactPotentiel.toFixed(0)}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {opp.produit}
                    {opp.categorie && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        {opp.categorie}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
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


