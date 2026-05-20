"use client"

import { useMemo, useState } from "react"
import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

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
}

const BUCKET_DEFS: Array<Omit<Bucket, "count">> = [
  { key: "lt-15", label: "< -15%", min: -Infinity, max: -15 },
  { key: "-15-10", label: "-15 à -10%", min: -15, max: -10 },
  { key: "-10-5", label: "-10 à -5%", min: -10, max: -5 },
  { key: "-5-0", label: "-5 à 0%", min: -5, max: 0 },
  { key: "0-5", label: "0 à +5%", min: 0, max: 5 },
  { key: "5-10", label: "+5 à +10%", min: 5, max: 10 },
  { key: "10-15", label: "+10 à +15%", min: 10, max: 15 },
  { key: "gt15", label: "> +15%", min: 15, max: Infinity },
]

const fmtPrice = (v: number) =>
  v.toLocaleString("fr-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + "$"

export default function Visualizations({ produits }: VisualizationsProps) {
  const { t } = useLanguage()
  const [view, setView] = useState<"cheapest" | "expensive">("cheapest")

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
        .slice(0, 8),
    [compared]
  )

  const topMostExpensive = useMemo(
    () =>
      [...compared]
        .filter(p => p.ecartPourcentage > 0)
        .sort((a, b) => b.ecartPourcentage - a.ecartPourcentage)
        .slice(0, 8),
    [compared]
  )

  if (total === 0) {
    return (
      <SectionCard
        title={t("ap.priceGapDistribution")}
        subtitle={t("ap.priceGapDistributionDesc")}
      >
        <p className="text-sm text-[var(--color-text-secondary)] text-center py-6">
          {t("ap.noPriceComparison")}
        </p>
      </SectionCard>
    )
  }

  const outliers = view === "cheapest" ? topCheapest : topMostExpensive

  return (
    <SectionCard
      title={t("ap.priceGapDistribution")}
      subtitle={t("ap.priceGapDistributionDesc")}
      meta={
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)] flex-wrap">
          <span>
            <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{cheaperCount}</span>{" "}
            {t("ap.cheaper").toLowerCase()}
          </span>
          <span className="opacity-40">·</span>
          <span>
            <span className="tabular-nums font-semibold text-[var(--color-text-primary)]">{alignedCount}</span>{" "}
            {t("ap.similar").toLowerCase()}
          </span>
          <span className="opacity-40">·</span>
          <span>
            <span className="tabular-nums font-semibold text-red-600 dark:text-red-400">{moreExpCount}</span>{" "}
            {t("ap.moreExpensiveShort").toLowerCase()}
          </span>
        </div>
      }
    >
      {/* Histogramme neutre */}
      <div className="mb-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
          {t("ap.distributionAxis")}
        </p>
        <div className="grid grid-cols-8 gap-1.5 items-end h-32">
          {buckets.map(b => {
            const heightPct = (b.count / maxCount) * 100
            const isEmpty = b.count === 0
            return (
              <div key={b.key} className="flex flex-col items-center justify-end h-full group">
                <span
                  className={`text-[11px] font-semibold tabular-nums mb-1 ${
                    isEmpty ? 'opacity-30 text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'
                  }`}
                >
                  {b.count}
                </span>
                <div
                  className={`w-full rounded-sm transition-opacity ${
                    isEmpty
                      ? 'bg-[var(--color-background-secondary)]/40'
                      : 'bg-[var(--color-text-primary)]/55 group-hover:bg-[var(--color-text-primary)]/75'
                  }`}
                  style={{ height: `${Math.max(2, heightPct)}%` }}
                  title={`${b.label}: ${b.count}`}
                />
              </div>
            )
          })}
        </div>
        <div className="grid grid-cols-8 gap-1.5 mt-2">
          {buckets.map(b => (
            <span
              key={b.key}
              className="text-[10px] text-center text-[var(--color-text-secondary)] tabular-nums truncate"
              title={b.label}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* Toggle outliers + liste */}
      <div className="border-t border-[var(--color-border-tertiary)]/40 pt-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
              {view === "cheapest" ? t("ap.topCheapest") : t("ap.topMostExpensive")}
            </p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              {view === "cheapest" ? t("ap.topCheapestDesc") : t("ap.topMostExpensiveDesc")}
            </p>
          </div>
          <div className="inline-flex items-center rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]/50 p-0.5">
            {(["cheapest", "expensive"] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  view === mode
                    ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {mode === 'cheapest' ? t("ap.cheaper") : t("ap.moreExpensiveShort")}
              </button>
            ))}
          </div>
        </div>

        {outliers.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)] text-center py-4">—</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-tertiary)]/40">
            {outliers.map((p, i) => (
              <li key={i} className="py-2 flex items-center gap-3">
                <span className="text-[11px] font-semibold tabular-nums text-[var(--color-text-secondary)] w-5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--color-text-primary)] truncate">{p.name}</p>
                  <p className="text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                    {fmtPrice(p.prix)}{" "}
                    <span className="opacity-50">/ {fmtPrice(p.prixMoyenMarche)}</span>
                  </p>
                </div>
                <span
                  className={`text-sm font-bold tabular-nums ${
                    p.ecartPourcentage < 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {p.ecartPourcentage > 0 ? '+' : ''}{p.ecartPourcentage.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}
