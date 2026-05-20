"use client"

import { useMemo, useState } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts"
import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

interface EvolutionEntry {
  date: string
  prixReference: number
  prixMoyenMarche: number
  prixConcurrents: Record<string, number>
}

interface RetailerPriceTrendsProps {
  evolutionPrix: EvolutionEntry[]
}

type Granularity = "day" | "week" | "month"

// Palette neutre (12 teintes désaturées). On évite les saturations
// brand pour ne pas concurrencer la couleur de la « référence ».
const PALETTE = [
  "#94a3b8", // slate-400
  "#a8a29e", // stone-400
  "#9ca3af", // gray-400
  "#71717a", // zinc-500
  "#6b7280", // gray-500
  "#78716c", // stone-500
  "#737373", // neutral-500
  "#64748b", // slate-500
  "#525b6f", // mid slate
  "#5e5e5e", // mid neutral
  "#4b5563", // gray-600
  "#57534e", // stone-600
]

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function bucketKey(date: Date, gran: Granularity): string {
  if (gran === "day") return date.toISOString().slice(0, 10)
  if (gran === "week") return isoWeekKey(date)
  return monthKey(date)
}

function formatLabel(key: string, gran: Granularity, locale: string): string {
  const lc = locale === "en" ? "en-CA" : "fr-CA"
  if (gran === "day") {
    const d = new Date(key + "T00:00:00")
    return d.toLocaleDateString(lc, { day: "numeric", month: "short" })
  }
  if (gran === "week") {
    const [y, w] = key.split("-W")
    return `S${w} ${y.slice(-2)}`
  }
  const [y, m] = key.split("-")
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString(lc, { month: "short", year: "2-digit" })
}

interface RetailerSeries {
  site: string
  color: string
}

function PriceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const visible = payload.filter((e: any) => e.value !== null && e.value !== undefined)
  if (visible.length === 0) return null
  return (
    <div className="bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] rounded-xl px-3 py-2 shadow-2xl max-w-xs text-xs">
      <p className="text-[var(--color-text-secondary)] mb-1.5">{label}</p>
      <div className="space-y-1">
        {visible.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-[var(--color-text-secondary)] truncate flex-1 min-w-0">{entry.name}</span>
            <span className="font-semibold text-[var(--color-text-primary)] tabular-nums whitespace-nowrap">
              {Number(entry.value).toLocaleString("fr-CA", { maximumFractionDigits: 0 })}$
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RetailerPriceTrends({ evolutionPrix }: RetailerPriceTrendsProps) {
  const { t, locale } = useLanguage()
  const [granularity, setGranularity] = useState<Granularity>("day")
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const allSites = useMemo(() => {
    const set = new Set<string>()
    for (const ev of evolutionPrix) {
      Object.keys(ev.prixConcurrents || {}).forEach(s => set.add(s))
    }
    return Array.from(set).sort()
  }, [evolutionPrix])

  const aggregated = useMemo(() => {
    if (evolutionPrix.length === 0) return [] as Array<{
      key: string
      label: string
      reference: number | null
      market: number | null
      retailers: Record<string, number | null>
    }>

    interface Bucket {
      sumRef: number
      countRef: number
      sumMarket: number
      countMarket: number
      retailers: Map<string, { sum: number; count: number }>
    }

    const buckets = new Map<string, Bucket>()
    for (const ev of evolutionPrix) {
      const d = new Date(ev.date)
      if (isNaN(d.getTime())) continue
      const k = bucketKey(d, granularity)
      let b = buckets.get(k)
      if (!b) {
        b = { sumRef: 0, countRef: 0, sumMarket: 0, countMarket: 0, retailers: new Map() }
        buckets.set(k, b)
      }
      if (typeof ev.prixReference === "number" && ev.prixReference > 0) {
        b.sumRef += ev.prixReference
        b.countRef += 1
      }
      if (typeof ev.prixMoyenMarche === "number" && ev.prixMoyenMarche > 0) {
        b.sumMarket += ev.prixMoyenMarche
        b.countMarket += 1
      }
      for (const [site, prix] of Object.entries(ev.prixConcurrents || {})) {
        if (typeof prix !== "number" || prix <= 0) continue
        let r = b.retailers.get(site)
        if (!r) {
          r = { sum: 0, count: 0 }
          b.retailers.set(site, r)
        }
        r.sum += prix
        r.count += 1
      }
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, b]) => {
        const retailers: Record<string, number | null> = {}
        for (const site of allSites) {
          const r = b.retailers.get(site)
          retailers[site] = r && r.count > 0 ? r.sum / r.count : null
        }
        return {
          key: k,
          label: formatLabel(k, granularity, locale),
          reference: b.countRef > 0 ? b.sumRef / b.countRef : null,
          market: b.countMarket > 0 ? b.sumMarket / b.countMarket : null,
          retailers,
        }
      })
  }, [evolutionPrix, granularity, allSites, locale])

  const series: RetailerSeries[] = useMemo(() => {
    return allSites.map((site, i) => ({
      site,
      color: PALETTE[i % PALETTE.length],
    }))
  }, [allSites])

  const chartData = useMemo(() => {
    return aggregated.map(b => {
      const row: Record<string, string | number | null> = {
        label: b.label,
        __reference__: b.reference,
        __market__: b.market,
      }
      for (const s of allSites) {
        row[s] = b.retailers[s]
      }
      return row
    })
  }, [aggregated, allSites])

  const toggleSeries = (site: string) => {
    setHiddenSeries(prev => {
      const next = new Set(prev)
      if (next.has(site)) next.delete(site)
      else next.add(site)
      return next
    })
  }

  const hasData = chartData.length > 0 && (allSites.length > 0 || chartData.some(c => c.__reference__ != null))

  const granularityOptions: Array<{ id: Granularity; label: string }> = [
    { id: "day", label: t("ap.granularityDay") },
    { id: "week", label: t("ap.granularityWeek") },
    { id: "month", label: t("ap.granularityMonth") },
  ]

  return (
    <SectionCard
      title={t("ap.retailerTrends")}
      subtitle={t("ap.retailerTrendsDesc")}
      actions={
        <div className="inline-flex items-center rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]/50 p-0.5">
          {granularityOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setGranularity(opt.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                granularity === opt.id
                  ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      }
    >
      {!hasData ? (
        <p className="text-sm text-[var(--color-text-secondary)] text-center py-6">
          {t("ap.noTrendData")}
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="transparent"
                tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.6 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="transparent"
                tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.6 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k$` : `${v}$`
                }
              />
              <Tooltip content={<PriceTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: 8, fontSize: 11 }}
                iconType="circle"
                iconSize={6}
              />

              <Line
                type="monotone"
                dataKey="__reference__"
                name={t("ap.yourPrice")}
                stroke="currentColor"
                strokeWidth={2}
                connectNulls
                dot={{ r: 2.5, strokeWidth: 0, fill: 'currentColor' }}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />

              <Line
                type="monotone"
                dataKey="__market__"
                name={t("ap.avgCompetitors")}
                stroke="currentColor"
                strokeOpacity={0.4}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                connectNulls
                dot={false}
              />

              {series.map(s => (
                <Line
                  key={s.site}
                  type="monotone"
                  dataKey={s.site}
                  name={s.site}
                  stroke={s.color}
                  strokeWidth={1.25}
                  connectNulls
                  hide={hiddenSeries.has(s.site)}
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 0 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {series.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 pt-3 border-t border-[var(--color-border-tertiary)]/40">
              {series.map(s => {
                const hidden = hiddenSeries.has(s.site)
                return (
                  <button
                    key={s.site}
                    type="button"
                    onClick={() => toggleSeries(s.site)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      hidden
                        ? 'bg-transparent text-[var(--color-text-secondary)] opacity-50 line-through'
                        : 'bg-[var(--color-background-secondary)]/60 text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: hidden ? 'currentColor' : s.color }}
                    />
                    <span className="truncate max-w-[160px]">{s.site}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}
