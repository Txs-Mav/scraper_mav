"use client"

import { useMemo } from "react"
import { TrendingDown, TrendingUp } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface Product {
  name: string
  prix: number
  prixMoyenMarche: number
  ecartPourcentage: number
  competitif: boolean
  hasCompetitor: boolean
  categorie: string
}

interface Retailer {
  site: string
  prixMoyen: number
  agressivite: number
  frequencePromotions: number
  nombreProduits: number
  produitsComparables: number
  categorieStats: Array<{
    categorie: string
    prixMoyen: number
    agressivite: number
    nombreProduits: number
  }>
}

interface VisualizationsProps {
  produits: Product[]
  detailleurs: Retailer[]
}

interface Bucket {
  key: string
  label: string
  min: number
  max: number
  count: number
  side: "below" | "above" | "neutral"
  shade: number
}

const BUCKET_DEFS: Array<Omit<Bucket, "count">> = [
  { key: "lt-15", label: "< -15%", min: -Infinity, max: -15, side: "below", shade: 4 },
  { key: "-15-10", label: "-15 à -10%", min: -15, max: -10, side: "below", shade: 3 },
  { key: "-10-5", label: "-10 à -5%", min: -10, max: -5, side: "below", shade: 2 },
  { key: "-5-0", label: "-5 à 0%", min: -5, max: 0, side: "below", shade: 1 },
  { key: "0-5", label: "0 à +5%", min: 0, max: 5, side: "above", shade: 1 },
  { key: "5-10", label: "+5 à +10%", min: 5, max: 10, side: "above", shade: 2 },
  { key: "10-15", label: "+10 à +15%", min: 10, max: 15, side: "above", shade: 3 },
  { key: "gt15", label: "> +15%", min: 15, max: Infinity, side: "above", shade: 4 },
]

function bucketColor(b: Bucket): string {
  if (b.side === "below") {
    return [
      "bg-[#3B6D11]/20",
      "bg-[#3B6D11]/40",
      "bg-[#3B6D11]/70",
      "bg-[#3B6D11]",
    ][b.shade - 1]
  }
  return [
    "bg-[#A32D2D]/20",
    "bg-[#A32D2D]/40",
    "bg-[#A32D2D]/70",
    "bg-[#A32D2D]",
  ][b.shade - 1]
}

const fmtPrice = (v: number) =>
  v.toLocaleString("fr-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + "$"

export default function Visualizations({ produits, detailleurs: _detailleurs }: VisualizationsProps) {
  const { t } = useLanguage()

  const compared = useMemo(
    () => produits.filter(p => p.hasCompetitor && p.prix > 0 && Math.abs(p.ecartPourcentage) > 0.1),
    [produits]
  )

  const buckets: Bucket[] = useMemo(() => {
    return BUCKET_DEFS.map(def => ({
      ...def,
      count: compared.filter(p => p.ecartPourcentage >= def.min && p.ecartPourcentage < def.max).length,
    }))
  }, [compared])

  const maxCount = Math.max(1, ...buckets.map(b => b.count))
  const total = compared.length
  const cheaperCount = compared.filter(p => p.ecartPourcentage < -0.5).length
  const moreExpCount = compared.filter(p => p.ecartPourcentage > 0.5).length
  const alignedCount = total - cheaperCount - moreExpCount

  const topCheapest = useMemo(
    () =>
      [...compared]
        .filter(p => p.ecartPourcentage < 0)
        .sort((a, b) => a.ecartPourcentage - b.ecartPourcentage)
        .slice(0, 5),
    [compared]
  )

  const topMostExpensive = useMemo(
    () =>
      [...compared]
        .filter(p => p.ecartPourcentage > 0)
        .sort((a, b) => b.ecartPourcentage - a.ecartPourcentage)
        .slice(0, 5),
    [compared]
  )

  return (
    <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t("ap.priceGapDistribution")}
          </h3>
          <p className="text-sm text-gray-500 dark:text-[#B0B0B0] mt-1">
            {t("ap.priceGapDistributionDesc")}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 text-[#3B6D11] font-semibold">
            <TrendingDown className="h-3.5 w-3.5" />
            <span className="tabular-nums">{cheaperCount}</span>
            <span className="text-gray-500 dark:text-[#B0B0B0] font-normal">{t("ap.cheaper")}</span>
          </span>
          <span className="text-gray-400">·</span>
          <span className="inline-flex items-center gap-1.5 text-gray-500 dark:text-[#B0B0B0] font-semibold">
            <span className="tabular-nums">{alignedCount}</span>
            <span className="font-normal">{t("ap.similar")}</span>
          </span>
          <span className="text-gray-400">·</span>
          <span className="inline-flex items-center gap-1.5 text-[#A32D2D] font-semibold">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="tabular-nums">{moreExpCount}</span>
            <span className="text-gray-500 dark:text-[#B0B0B0] font-normal">{t("ap.moreExpensiveShort")}</span>
          </span>
        </div>
      </div>

      {total === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-[#B0B0B0] text-sm">
          {t("ap.noPriceComparison")}
        </div>
      ) : (
        <>
          {/* Histogramme */}
          <div className="rounded-xl border border-gray-200 dark:border-[#2a2c2e] bg-gray-50/40 dark:bg-[#161819]/40 p-4 mb-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#B0B0B0]/70 mb-3">
              {t("ap.distributionAxis")}
            </p>
            <div className="grid grid-cols-8 gap-2 items-end h-40">
              {buckets.map(b => {
                const heightPct = (b.count / maxCount) * 100
                const isEmpty = b.count === 0
                return (
                  <div key={b.key} className="flex flex-col items-center justify-end h-full group">
                    <span
                      className={`text-[11px] font-bold tabular-nums mb-1 transition-opacity ${
                        isEmpty ? "text-gray-300 dark:text-[#3a3c3e]" : "text-gray-700 dark:text-white"
                      }`}
                    >
                      {b.count}
                    </span>
                    <div
                      className={`w-full rounded-t-md transition-all ${
                        isEmpty ? "bg-gray-100 dark:bg-[#2a2c2e]/40" : bucketColor(b)
                      } group-hover:opacity-80`}
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                      title={`${b.label}: ${b.count} produit(s)`}
                    />
                  </div>
                )
              })}
            </div>
            <div className="grid grid-cols-8 gap-2 mt-2">
              {buckets.map(b => (
                <span
                  key={b.key}
                  className="text-[10px] text-center text-gray-500 dark:text-[#B0B0B0]/80 tabular-nums truncate"
                  title={b.label}
                >
                  {b.label}
                </span>
              ))}
            </div>
          </div>

          {/* Top outliers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <OutliersCard
              title={t("ap.topCheapest")}
              description={t("ap.topCheapestDesc")}
              icon={<TrendingDown className="h-4 w-4" />}
              tone="below"
              products={topCheapest}
            />
            <OutliersCard
              title={t("ap.topMostExpensive")}
              description={t("ap.topMostExpensiveDesc")}
              icon={<TrendingUp className="h-4 w-4" />}
              tone="above"
              products={topMostExpensive}
            />
          </div>
        </>
      )}
    </div>
  )
}

function OutliersCard({
  title,
  description,
  icon,
  tone,
  products,
}: {
  title: string
  description: string
  icon: React.ReactNode
  tone: "below" | "above"
  products: Product[]
}) {
  const accent =
    tone === "below"
      ? "text-[#27500A] dark:text-[#3B6D11] bg-[#EAF3DE] dark:bg-[#3B6D11]/15 border-[#3B6D11]/20 dark:border-[#3B6D11]/30"
      : "text-[#791F1F] dark:text-[#A32D2D] bg-[#FCEBEB] dark:bg-[#A32D2D]/15 border-[#A32D2D]/20 dark:border-[#A32D2D]/30"

  const badgeColor =
    tone === "below"
      ? "bg-[#EAF3DE] text-[#27500A] dark:bg-[#3B6D11]/30 dark:text-[#3B6D11]"
      : "bg-[#FCEBEB] text-[#791F1F] dark:bg-[#A32D2D]/30 dark:text-[#A32D2D]"

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2a2c2e] overflow-hidden">
      <div className={`px-4 py-3 border-b border-gray-200 dark:border-[#2a2c2e] flex items-start gap-2 ${accent}`}>
        <span className="mt-0.5 flex-shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{title}</div>
          <div className="text-[11px] opacity-80 mt-0.5 leading-snug">{description}</div>
        </div>
      </div>
      {products.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-gray-500 dark:text-[#B0B0B0]">—</div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-[#2a2c2e]">
          {products.map((p, i) => (
            <li key={i} className="px-4 py-2.5 flex items-center gap-3">
              <span className="text-[11px] font-semibold tabular-nums text-gray-400 dark:text-[#B0B0B0]/70 w-5">
                #{i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {p.name}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-[#B0B0B0]/80 tabular-nums">
                  {fmtPrice(p.prix)} <span className="text-gray-300 dark:text-[#3a3c3e]">/</span>{" "}
                  {fmtPrice(p.prixMoyenMarche)}
                </div>
              </div>
              <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-md ${badgeColor}`}>
                {p.ecartPourcentage > 0 ? "+" : ""}
                {p.ecartPourcentage.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
