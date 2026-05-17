"use client"

/**
 * Section "Passé" du rapport.
 *
 * On documente ce qui a déjà été collecté :
 *   - chiffres cumulés depuis le démarrage ;
 *   - historique des scrapings ;
 *   - timeline d'accumulation des données.
 *
 * Le but est de rappeler que le rapport s'enrichit dans le temps
 * (« Il faut que les données s'accumulent pour pouvoir créer des
 * rapports »). Aucun avis, uniquement des chiffres.
 */

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Database, Tag, History, Globe } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import type {
  ReportPast,
  ReportMeta,
} from "@/lib/reports-calculations"

interface DataAccumulationProps {
  past: ReportPast
  meta: ReportMeta
}

function formatNumber(value: number, locale: string): string {
  return value.toLocaleString(locale === "en" ? "en-CA" : "fr-CA")
}

function formatDate(date: string | null, locale: string): string {
  if (!date) return "—"
  return new Date(date).toLocaleDateString(
    locale === "en" ? "en-CA" : "fr-CA",
    { day: "numeric", month: "short", year: "numeric" },
  )
}

interface AccumulationTooltipPayload {
  value?: number | string
  payload?: { date?: string }
}

function AccumulationTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: AccumulationTooltipPayload[]
  label?: string
}) {
  if (!active || !payload?.[0]) return null
  return (
    <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 shadow-lg">
      <p className="text-[11px] text-[var(--color-text-secondary)]">{label}</p>
      <p className="text-sm font-bold text-[var(--color-text-primary)] tabular-nums mt-0.5">
        {payload[0].value}
      </p>
    </div>
  )
}

export default function DataAccumulation({
  past,
  meta,
}: DataAccumulationProps) {
  const { t, locale } = useLanguage()

  const cumulativeData = past.cumulativeDataPoints.map((p) => ({
    date: new Date(p.date).toLocaleDateString(
      locale === "en" ? "en-CA" : "fr-CA",
      { day: "numeric", month: "short" },
    ),
    total: p.total,
  }))

  const cards = [
    {
      label: t("reports.past.totalScrapings"),
      value: formatNumber(meta.totalScrapings, locale),
      icon: History,
      caption: t("reports.past.totalScrapingsDesc"),
    },
    {
      label: t("reports.past.totalDataPoints"),
      value: formatNumber(past.totalDataPoints, locale),
      icon: Database,
      caption: t("reports.past.totalDataPointsDesc"),
    },
    {
      label: t("reports.past.uniqueProducts"),
      value: formatNumber(past.uniqueProductsTracked, locale),
      icon: Tag,
      caption: t("reports.past.uniqueProductsDesc"),
    },
    {
      label: t("reports.past.uniqueSites"),
      value: formatNumber(past.uniqueSitesObserved, locale),
      icon: Globe,
      caption: t("reports.past.uniqueSitesDesc"),
    },
  ]

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
          {t("reports.past.title")}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {t("reports.past.subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <div
              key={c.label}
              className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                  {c.label}
                </p>
                <Icon className="h-3.5 w-3.5 text-[var(--color-text-secondary)] opacity-40" />
              </div>
              <p className="text-3xl font-extrabold text-[var(--color-text-primary)] tabular-nums leading-none">
                {c.value}
              </p>
              <p className="text-[11px] text-[var(--color-text-secondary)] mt-2 leading-snug">
                {c.caption}
              </p>
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t("reports.past.coverage")}
            </h3>
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              {t("reports.past.coverageDesc")}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <span className="text-[var(--color-text-secondary)]">
              {t("reports.past.firstCapture")}{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                {formatDate(meta.firstScrapingDate, locale)}
              </span>
            </span>
            <span className="text-[var(--color-text-secondary)]">
              {t("reports.past.lastCapture")}{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                {formatDate(meta.lastScrapingDate, locale)}
              </span>
            </span>
            <span className="text-[var(--color-text-secondary)]">
              {t("reports.past.daysCovered")}{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                {meta.daysCovered}
              </span>
            </span>
          </div>
        </div>

        {cumulativeData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart
              data={cumulativeData}
              margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
            >
              <defs>
                <linearGradient id="accGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B6D11" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3B6D11" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                stroke="transparent"
                tick={{ fill: "#6B7280", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="transparent"
                tick={{ fill: "#6B7280", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<AccumulationTooltip />} />
              <Area
                type="monotone"
                dataKey="total"
                stroke="#3B6D11"
                strokeWidth={2}
                fill="url(#accGradient)"
                dot={false}
                activeDot={{
                  fill: "#3B6D11",
                  r: 4,
                  strokeWidth: 2,
                  stroke: "var(--color-background-primary)",
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-10 text-center text-sm text-[var(--color-text-secondary)]">
            {t("reports.past.noData")}
          </div>
        )}
      </div>

      {past.scrapingsTimeline.length > 0 && (
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border-tertiary)]">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t("reports.past.timelineTitle")}
            </h3>
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              {t("reports.past.timelineDesc")}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)]/40">
                <tr>
                  <th className="text-left px-5 py-2 font-semibold">
                    {t("reports.past.col.date")}
                  </th>
                  <th className="text-right px-5 py-2 font-semibold">
                    {t("reports.past.col.products")}
                  </th>
                  <th className="text-right px-5 py-2 font-semibold">
                    {t("reports.past.col.sites")}
                  </th>
                  <th className="text-right px-5 py-2 font-semibold">
                    {t("reports.past.col.avgPrice")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-tertiary)]">
                {past.scrapingsTimeline
                  .slice()
                  .reverse()
                  .slice(0, 12)
                  .map((row) => (
                    <tr key={row.date}>
                      <td className="px-5 py-2.5 text-[var(--color-text-primary)] tabular-nums">
                        {new Date(row.date).toLocaleString(
                          locale === "en" ? "en-CA" : "fr-CA",
                          {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] tabular-nums">
                        {formatNumber(row.productsCollected, locale)}
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] tabular-nums">
                        {row.distinctSites}
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] tabular-nums">
                        {row.averagePrice > 0
                          ? `${row.averagePrice.toLocaleString(
                              locale === "en" ? "en-CA" : "fr-CA",
                              { maximumFractionDigits: 0 },
                            )} $`
                          : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {past.scrapingsTimeline.length > 12 && (
            <div className="px-5 py-2 border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]/40 text-[11px] text-[var(--color-text-secondary)]">
              {t("reports.past.moreEntries").replace(
                "{n}",
                String(past.scrapingsTimeline.length - 12),
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
