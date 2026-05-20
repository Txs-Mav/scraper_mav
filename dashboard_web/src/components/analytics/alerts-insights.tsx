"use client"

import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

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

// Sparkline ultra-compact, sans dépendance Recharts (vectoriel pur).
function Sparkline({ data, className = "" }: { data: number[]; className?: string }) {
  if (!data.length) return null
  const w = 80
  const h = 24
  const max = Math.max(1, ...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const stepX = data.length > 1 ? w / (data.length - 1) : w
  const points = data
    .map((v, i) => {
      const x = i * stepX
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  const areaPoints = `0,${h} ${points} ${w},${h}`
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`text-[var(--color-text-primary)] ${className}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={areaPoints} fill="currentColor" fillOpacity="0.1" />
      <polyline points={points} fill="none" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function AlertsAndInsights({ alertes, stats }: AlertsInsightsProps) {
  const { t, locale } = useLanguage()
  const lc = locale === 'en' ? 'en-CA' : 'fr-CA'

  const scrapeCounts = stats.scrapesParJour.map(d => d.count)
  const totalScrapes = stats.nombreScrapes

  // 3 KPI principaux — chiffres XL, hiérarchie claire
  const kpis: Array<{ label: string; value: string; hint?: string; sparkline?: number[] }> = [
    {
      label: t("ap.avgPriceStat"),
      value: stats.prixMoyen > 0
        ? `${stats.prixMoyen.toLocaleString(lc, { maximumFractionDigits: 0 })}$`
        : '—',
    },
    {
      label: t("ap.hoursSaved"),
      value: `${stats.heuresEconomisees.toFixed(1)}h`,
      hint: t("ap.perVehicle"),
    },
    {
      label: t("ap.scrapesDone"),
      value: totalScrapes.toLocaleString(lc),
      sparkline: scrapeCounts.length > 1 ? scrapeCounts : undefined,
    },
  ]

  return (
    <SectionCard
      title={t("ap.insights")}
      meta={
        alertes.length > 0 ? (
          <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
            <span className="font-semibold text-[var(--color-text-primary)]">{alertes.length}</span>{" "}
            {t("ap.alertsNotif").toLowerCase()}
          </span>
        ) : undefined
      }
      details={
        alertes.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)] text-center py-2">
            {t("ap.noAlerts")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-tertiary)]/40">
            {alertes.slice(0, 8).map((alerte, index) => (
              <li key={index} className="py-2.5 flex items-start gap-3">
                <span
                  className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${
                    alerte.severite === 'high'
                      ? 'bg-red-500'
                      : alerte.severite === 'medium'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--color-text-primary)] leading-snug">
                    {alerte.message}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5 tabular-nums">
                    {new Date(alerte.date).toLocaleDateString(lc, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )
      }
      detailsLabel={
        alertes.length > 0 ? `${t("ap.alertsNotif")} (${alertes.length})` : t("ap.alertsNotif")
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-5 gap-y-4">
        {kpis.map((k, i) => (
          <div
            key={i}
            className={`flex flex-col ${i > 0 ? 'sm:pl-5 sm:border-l border-[var(--color-border-tertiary)]/40' : ''}`}
          >
            <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
              {k.label}
            </span>
            <span className="text-3xl font-extrabold tabular-nums leading-none mt-1.5 text-[var(--color-text-primary)] tracking-tight">
              {k.value}
            </span>
            {k.hint && (
              <span className="text-[11px] text-[var(--color-text-secondary)] mt-1 opacity-75">
                {k.hint}
              </span>
            )}
            {k.sparkline && (
              <Sparkline data={k.sparkline} className="mt-2 h-6 w-full" />
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
