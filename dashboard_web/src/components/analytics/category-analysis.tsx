"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

interface CategoryStats {
  categorie: string
  nombreProduits: number
  prixMoyenReference: number
  prixMoyenConcurrents: number
  ecartMoyenPourcentage: number
  competitifs: number
  nonCompetitifs: number
  detailParDetaillant: Array<{
    site: string
    prixMoyen: number
    ecartPourcentage: number
    nombreProduits: number
  }>
}

interface CategoryAnalysisProps {
  categories: CategoryStats[]
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
  v.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "$"

export default function CategoryAnalysis({ categories }: CategoryAnalysisProps) {
  const { t } = useLanguage()
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const ecartColor = (ecart: number) => {
    if (ecart < -2) return 'text-emerald-600 dark:text-emerald-400'
    if (ecart > 2) return 'text-red-600 dark:text-red-400'
    return 'text-[var(--color-text-secondary)]'
  }

  return (
    <SectionCard
      title={t("ap.categoryAnalysis")}
      subtitle={t("ap.categoryDesc")}
      bodyClassName="px-0 py-0"
    >
      {categories.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[var(--color-text-secondary)] text-center">
          {t("ap.noCategoryData")}
        </p>
      ) : (
        <>
          <div className="px-5 py-2 grid grid-cols-[1fr_5rem_5rem_2rem] gap-3 items-center text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)]/40">
            <span>{t("ap.headerCategory")}</span>
            <span className="text-right">{t("ap.products").toLowerCase()}</span>
            <span className="text-right">{t("ap.gap")}</span>
            <span />
          </div>
          <ul>
            {categories.map(cat => {
              const isExpanded = expandedCategory === cat.categorie
              return (
                <li key={cat.categorie} className="border-b last:border-b-0 border-[var(--color-border-tertiary)]/30">
                  <button
                    type="button"
                    onClick={() => setExpandedCategory(isExpanded ? null : cat.categorie)}
                    className="w-full grid grid-cols-[1fr_5rem_5rem_2rem] gap-3 items-center px-5 py-2.5 text-sm hover:bg-[var(--color-background-hover)]/40 transition-colors"
                  >
                    <span className="text-[var(--color-text-primary)] text-left truncate">
                      {categoryLabels[cat.categorie] || cat.categorie}
                    </span>
                    <span className="text-right tabular-nums text-[var(--color-text-secondary)]">
                      {cat.nombreProduits}
                    </span>
                    <span className={`text-right tabular-nums font-semibold ${ecartColor(cat.ecartMoyenPourcentage)}`}>
                      {cat.ecartMoyenPourcentage >= 0 ? '+' : ''}{cat.ecartMoyenPourcentage.toFixed(1)}%
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-[var(--color-text-secondary)] transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {isExpanded && (
                    <div className="px-5 py-3 bg-[var(--color-background-secondary)]/30 border-t border-[var(--color-border-tertiary)]/30">
                      <div className="flex gap-5 mb-3 text-xs text-[var(--color-text-secondary)] flex-wrap">
                        <span>
                          {t("ap.yourAvgPrice")}{" "}
                          <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                            {cat.prixMoyenReference > 0 ? fmtPrice(cat.prixMoyenReference) : 'N/A'}
                          </span>
                        </span>
                        <span>
                          {t("ap.compAvgPrice")}{" "}
                          <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                            {cat.prixMoyenConcurrents > 0 ? fmtPrice(cat.prixMoyenConcurrents) : 'N/A'}
                          </span>
                        </span>
                      </div>

                      {cat.detailParDetaillant.length > 0 ? (
                        <ul className="divide-y divide-[var(--color-border-tertiary)]/40">
                          <li className="grid grid-cols-[1fr_6rem_4rem_3rem] gap-3 items-center py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                            <span>{t("ap.competitor")}</span>
                            <span className="text-right">{t("ap.avgPrice")}</span>
                            <span className="text-right">{t("ap.gap")}</span>
                            <span className="text-right">{t("ap.prod")}</span>
                          </li>
                          {cat.detailParDetaillant
                            .sort((a, b) => a.ecartPourcentage - b.ecartPourcentage)
                            .map((det, i) => (
                              <li
                                key={i}
                                className="grid grid-cols-[1fr_6rem_4rem_3rem] gap-3 items-center py-2 text-sm"
                              >
                                <span className="text-[var(--color-text-primary)] truncate">{det.site}</span>
                                <span className="text-right tabular-nums text-[var(--color-text-primary)]">
                                  {fmtPrice(det.prixMoyen)}
                                </span>
                                <span className={`text-right tabular-nums font-semibold ${ecartColor(det.ecartPourcentage)}`}>
                                  {det.ecartPourcentage >= 0 ? '+' : ''}{det.ecartPourcentage.toFixed(1)}%
                                </span>
                                <span className="text-right tabular-nums text-[var(--color-text-secondary)]">
                                  {det.nombreProduits}
                                </span>
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-[var(--color-text-secondary)]">—</p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </SectionCard>
  )
}
