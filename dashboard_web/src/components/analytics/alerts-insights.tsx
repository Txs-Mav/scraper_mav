"use client"

import { AlertCircle, Bell, Info } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

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
  const { t, locale } = useLanguage()

  const getSeverityColor = (severite: string) => {
    switch (severite) {
      case 'high':
        return 'bg-[#FCEBEB] dark:bg-[#A32D2D]/15 border-[#A32D2D]/20 dark:border-[#A32D2D]/30'
      case 'medium':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-900'
      default:
        return 'bg-[#EAF3DE] dark:bg-[#3B6D11]/15 border-[#3B6D11]/20 dark:border-[#3B6D11]/30'
    }
  }

  const getSeverityIcon = (severite: string) => {
    switch (severite) {
      case 'high':
        return <AlertCircle className="h-5 w-5 text-[#A32D2D] dark:text-[#A32D2D]" />
      case 'medium':
        return <Bell className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
      default:
        return <Info className="h-5 w-5 text-[#3B6D11]" />
    }
  }

  const insights: Array<{ message: string; type: 'info' | 'warning' | 'success' }> = []

  return (
    <div className="space-y-6">
      {/* Insights automatiques */}
      <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {t("ap.insights")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-50 dark:bg-[#242628] rounded-lg p-4">
            <div className="text-sm text-gray-500 dark:text-[#B0B0B0] mb-1">
              {t("ap.avgPriceStat")}
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats.prixMoyen.toFixed(2)}$
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-[#242628] rounded-lg p-4">
            <div className="text-sm text-gray-500 dark:text-[#B0B0B0] mb-1">
              {t("ap.hoursSaved")}
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats.heuresEconomisees.toFixed(1)}h
            </div>
            <div className="text-xs text-gray-500 dark:text-[#B0B0B0] mt-1">
              {t("ap.perVehicle")}
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-[#242628] rounded-lg p-4">
            <div className="text-sm text-gray-500 dark:text-[#B0B0B0] mb-1">
              {t("ap.scrapesDone")}
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
                    ? 'bg-[#EAF3DE] dark:bg-[#3B6D11]/15 border-[#3B6D11]/20 dark:border-[#3B6D11]/30'
                    : 'bg-[#EAF3DE] dark:bg-[#3B6D11]/15 border-[#3B6D11]/20 dark:border-[#3B6D11]/30'
                }`}
              >
                <div className="text-sm text-gray-900 dark:text-white">
                  {insight.message}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alertes */}
      <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {t("ap.alertsNotif")}
        </h3>
        {alertes.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-[#B0B0B0]">
            {t("ap.noAlerts")}
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
                  <div className="text-xs text-gray-500 dark:text-[#B0B0B0]">
                    {new Date(alerte.date).toLocaleDateString(locale === 'en' ? 'en-CA' : 'fr-CA', {
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


