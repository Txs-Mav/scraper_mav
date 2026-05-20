"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

interface Retailer {
  site: string
  prixMoyen: number
  agressivite: number
  frequencePromotions: number
  nombreProduits: number
  produitsComparables: number
  isReference?: boolean
  categorieStats: Array<{
    categorie: string
    prixMoyen: number
    agressivite: number
    nombreProduits: number
  }>
}

interface RetailerAnalysisProps {
  detailleurs: Retailer[]
}

const categoryLabels: Record<string, string> = {
  moto: "Moto",
  motoneige: "Motoneige",
  motocross: "Motocross",
  scooter: "Scooter",
  quad: "Quad",
  "side-by-side": "Side-by-Side",
  vtt: "VTT",
  autre: "Autre",
}

const fmtPrice = (v: number) =>
  v.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '$'

function ecartTextColor(ecart: number): string {
  if (ecart > 0.5) return 'text-red-600 dark:text-red-400'
  if (ecart < -0.5) return 'text-emerald-600 dark:text-emerald-400'
  return 'text-[var(--color-text-secondary)]'
}

export default function RetailerAnalysis({ detailleurs }: RetailerAnalysisProps) {
  const { t } = useLanguage()
  const [expandedRetailer, setExpandedRetailer] = useState<string | null>(null)

  if (detailleurs.length === 0) {
    return (
      <SectionCard title={t("ap.retailerComparison")}>
        <p className="text-sm text-[var(--color-text-secondary)] text-center py-6">
          {t("ap.noRetailerData")}
        </p>
      </SectionCard>
    )
  }

  const refSite = detailleurs.find(d => d.isReference)
  const refEcart = refSite?.agressivite ?? 0
  const totalCompared = refSite?.produitsComparables
    ?? Math.max(0, ...detailleurs.map(d => d.produitsComparables))

  const rankedRetailers = detailleurs
    .filter(d => d.produitsComparables > 0)
    .map(d => ({
      site: d.site,
      ecart: d.agressivite,
      produitsComparables: d.produitsComparables,
      isReference: d.isReference,
    }))
    .sort((a, b) => a.ecart - b.ecart)

  return (
    <SectionCard
      title={t("ap.retailerComparison")}
      subtitle={t("ap.retailerDescNew")}
      meta={
        refSite ? (
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)] flex-wrap">
            <span>
              {t("ap.yourSitePosition")}:{" "}
              <span className={`tabular-nums font-semibold ${ecartTextColor(refEcart)}`}>
                {refEcart > 0 ? '+' : ''}{refEcart.toFixed(1)}%
              </span>
            </span>
            <span className="opacity-40">·</span>
            <span>
              <span className="tabular-nums font-semibold text-[var(--color-text-primary)]">
                {detailleurs.filter(d => d.produitsComparables > 0).length}
              </span>{" "}
              {t("ap.retailersCompared")}
            </span>
            <span className="opacity-40">·</span>
            <span>
              <span className="tabular-nums font-semibold text-[var(--color-text-primary)]">
                {totalCompared}
              </span>{" "}
              {t("ap.comparedCount").toLowerCase()}
            </span>
          </div>
        ) : undefined
      }
      bodyClassName="px-0 py-0"
    >
      <div className="px-5 py-2 grid grid-cols-[2rem_1fr_5rem_5rem_2rem] gap-3 items-center text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)]/40">
        <span>#</span>
        <span>{t("ap.retailer")}</span>
        <span className="text-right">{t("ap.avgGapShort")}</span>
        <span className="text-right">{t("ap.comparedCountShort")}</span>
        <span />
      </div>
      <ul>
        {rankedRetailers.map((d, i) => {
          const fullDet = detailleurs.find(det => det.site === d.site)
          const isExpanded = expandedRetailer === d.site
          const sign = d.ecart > 0 ? '+' : ''

          return (
            <li key={d.site} className="border-b last:border-b-0 border-[var(--color-border-tertiary)]/30">
              <button
                type="button"
                onClick={() => setExpandedRetailer(isExpanded ? null : d.site)}
                className="w-full grid grid-cols-[2rem_1fr_5rem_5rem_2rem] gap-3 items-center px-5 py-2.5 text-sm hover:bg-[var(--color-background-hover)]/40 transition-colors"
              >
                <span className="text-[11px] font-semibold tabular-nums text-[var(--color-text-secondary)] text-left">
                  {i + 1}
                </span>
                <span className="text-left text-[var(--color-text-primary)] truncate flex items-center gap-2">
                  {d.site}
                  {d.isReference && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-1.5 py-0.5">
                      {t("ap.yourSite")}
                    </span>
                  )}
                </span>
                <span className={`text-right tabular-nums font-semibold ${ecartTextColor(d.ecart)}`}>
                  {sign}{d.ecart.toFixed(1)}%
                </span>
                <span className="text-right tabular-nums text-[var(--color-text-secondary)]">
                  {d.produitsComparables}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[var(--color-text-secondary)] transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  } ${!fullDet?.categorieStats?.length ? 'opacity-20' : ''}`}
                />
              </button>

              {isExpanded && fullDet?.categorieStats && fullDet.categorieStats.length > 0 && (
                <div className="px-5 py-3 bg-[var(--color-background-secondary)]/30 border-t border-[var(--color-border-tertiary)]/30">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                    {t("ap.avgGapCategory")}
                  </p>
                  <ul className="divide-y divide-[var(--color-border-tertiary)]/40">
                    {fullDet.categorieStats.map((cs, ci) => (
                      <li
                        key={ci}
                        className="grid grid-cols-[1fr_6rem_4rem_3rem] gap-3 items-center py-1.5 text-xs"
                      >
                        <span className="text-[var(--color-text-primary)] truncate">
                          {categoryLabels[cs.categorie] || cs.categorie}
                        </span>
                        <span className="text-right tabular-nums text-[var(--color-text-secondary)]">
                          {fmtPrice(cs.prixMoyen)}
                        </span>
                        <span className={`text-right tabular-nums font-semibold ${ecartTextColor(cs.agressivite)}`}>
                          {cs.agressivite >= 0 ? '+' : ''}{cs.agressivite.toFixed(1)}%
                        </span>
                        <span className="text-right tabular-nums text-[var(--color-text-secondary)]">
                          {cs.nombreProduits}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}
