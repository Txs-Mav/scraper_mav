"use client"

import { AlertCircle, Bell, Info } from "lucide-react"

interface Alert {
  type: 'concurrent' | 'ecart' | 'nouveau'
  message: string
  severite: 'low' | 'medium' | 'high'
  date: string
}

interface AlertsInsightsProps {
  alertes: Alert[]
  stats: {
    prixMoyen: number
    heuresEconomisees: number
    nombreScrapes: number
    scrapesParJour: Array<{ date: string; count: number }>
  }
}

export default function AlertsAndInsights({ alertes, stats }: AlertsInsightsProps) {
  const getSeverityColor = (severite: string) => {
    switch (severite) {
      case 'high':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900'
      case 'medium':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-900'
      default:
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-900'
    }
  }

  const getSeverityIcon = (severite: string) => {
    switch (severite) {
      case 'high':
        return <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
      case 'medium':
        return <Bell className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
      default:
        return <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
    }
  }

  // Calculer les insights automatiques
  const insights: Array<{ message: string; type: 'info' | 'warning' | 'success' }> = []

  // Produits non compétitifs
  const produitsNonCompetitifs = alertes.filter(a => a.type === 'ecart').length
  if (produitsNonCompetitifs > 0) {
    insights.push({
      message: `${produitsNonCompetitifs} produit(s) non compétitifs détectés`,
      type: 'warning'
    })
  }

  // Baisse moyenne du marché (à calculer si on a des données historiques)
  // Pour l'instant, on affiche juste les stats générales

  return (
    <div className="space-y-6">
      {/* Insights automatiques */}
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Insights Automatiques
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-50 dark:bg-[#1F1F23] rounded-lg p-4">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Prix moyen
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats.prixMoyen.toFixed(2)}$
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-[#1F1F23] rounded-lg p-4">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Heures économisées
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats.heuresEconomisees.toFixed(1)}h
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              (30s par véhicule comparé)
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-[#1F1F23] rounded-lg p-4">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Scrapes effectués
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats.nombreScrapes}
            </div>
          </div>
        </div>
        {insights.length > 0 && (
          <div className="mt-4 space-y-2">
            {insights.map((insight, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg border ${
                  insight.type === 'warning'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-900'
                    : insight.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900'
                    : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-900'
                }`}
              >
                <div className="text-sm text-gray-800 dark:text-gray-200">
                  {insight.message}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alertes */}
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Alertes et Notifications
        </h3>
        {alertes.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            Aucune alerte pour le moment
          </div>
        ) : (
          <div className="space-y-3">
            {alertes.map((alerte, index) => (
              <div
                key={index}
                className={`flex items-start gap-3 p-4 rounded-lg border ${getSeverityColor(alerte.severite)}`}
              >
                {getSeverityIcon(alerte.severite)}
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                    {alerte.message}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {new Date(alerte.date).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


