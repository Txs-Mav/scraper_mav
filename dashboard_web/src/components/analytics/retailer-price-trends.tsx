"use client"

import { useMemo, useState } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts"
import { LineChart as LineChartIcon, Calendar } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

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

// Palette catégorielle (12 teintes distinctes, sans vert/rouge brand
// pour ne pas se confondre avec la sémantique compétitif/non compétitif)
const PALETTE = [
  "#60A5FA", // blue
  "#F472B6", // pink
  "#FBBF24", // amber
  "#A78BFA", // violet
  "#22D3EE", // cyan
  "#FB923C", // orange
  "#E879F9", // fuchsia
  "#FCD34D", // yellow
  "#2DD4BF", // teal
  "#818CF8", // indigo
  "#C084FC", // purple
  "#94A3B8", // slate
]

const REFERENCE_COLOR = "#3B82F6"
const MARKET_COLOR = "#9CA3AF"

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
  values: number[]
}

function PriceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const visible = payload.filter((e: any) => e.value !== null && e.value !== undefined)
  if (visible.length === 0) return null
  return (
    <div className="bg-[#1c1e20] border border-[#343638] rounded-xl px-4 py-3 shadow-2xl max-w-xs">
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <div className="space-y-1">
        {visible.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-400 truncate flex-1 min-w-0">{entry.name}</span>
            <span className="font-semibold text-white tabular-nums whitespace-nowrap">
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
      values: aggregated.map(b => b.retailers[site] ?? NaN),
    }))
  }, [allSites, aggregated])

  // Données prêtes pour Recharts: une entrée par bucket avec toutes les valeurs aplaties
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
    <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-2">
          <LineChartIcon className="h-5 w-5 text-[#3B6D11] mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">
              {t("ap.retailerTrends")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-[#B0B0B0] mt-0.5">
              {t("ap.retailerTrendsDesc")}
            </p>
          </div>
        </div>

        {/* Toggle granularité */}
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-gray-100 dark:bg-[#242628] border border-gray-200 dark:border-[#2a2c2e]">
          <Calendar className="h-3.5 w-3.5 text-gray-400 ml-1.5" />
          {granularityOptions.map(opt => (
            <button
              key={opt.id}
              onClick={() => setGranularity(opt.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                granularity === opt.id
                  ? "bg-white dark:bg-[#1c1e20] text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-[#B0B0B0] hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="text-center py-12 text-gray-500 dark:text-[#B0B0B0] text-sm">
          {t("ap.noTrendData")}
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="rgba(120,120,120,0.12)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="transparent"
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="transparent"
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
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
                iconSize={8}
              />

              {/* Référence (votre prix) */}
              <Line
                type="monotone"
                dataKey="__reference__"
                name={t("ap.yourPrice")}
                stroke={REFERENCE_COLOR}
                strokeWidth={2.5}
                connectNulls
                dot={{ fill: REFERENCE_COLOR, r: 3, strokeWidth: 0 }}
                activeDot={{ fill: REFERENCE_COLOR, r: 5, strokeWidth: 2, stroke: "#1c1e20" }}
              />

              {/* Moyenne marché */}
              <Line
                type="monotone"
                dataKey="__market__"
                name={t("ap.avgCompetitors")}
                stroke={MARKET_COLOR}
                strokeWidth={1.5}
                strokeDasharray="6 3"
                connectNulls
                dot={false}
              />

              {/* Concessionnaires */}
              {series.map(s => (
                <Line
                  key={s.site}
                  type="monotone"
                  dataKey={s.site}
                  name={s.site}
                  stroke={s.color}
                  strokeWidth={1.75}
                  connectNulls
                  hide={hiddenSeries.has(s.site)}
                  dot={{ fill: s.color, r: 2.5, strokeWidth: 0 }}
                  activeDot={{ fill: s.color, r: 5, strokeWidth: 2, stroke: "#1c1e20" }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Toggles concessionnaires */}
          {series.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 pt-4 border-t border-gray-100 dark:border-[#2a2c2e]">
              {series.map(s => {
                const hidden = hiddenSeries.has(s.site)
                return (
                  <button
                    key={s.site}
                    onClick={() => toggleSeries(s.site)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      hidden
                        ? "bg-gray-50 dark:bg-[#242628] text-gray-400 dark:text-[#B0B0B0]/60 line-through"
                        : "bg-gray-100 dark:bg-[#2a2c2e] text-gray-900 dark:text-white"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: hidden ? "#6B7280" : s.color }}
                    />
                    <span className="truncate max-w-[160px]">{s.site}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
