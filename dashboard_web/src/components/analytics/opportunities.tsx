"use client"

import { useState } from "react"
import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

interface Opportunity {
  type: 'augmentation' | 'baisse' | 'marge'
  produit: string
  recommandation: string
  impactPotentiel: number
  categorie?: string
}

interface OpportunitiesProps {
  opportunites: Opportunity[]
}

export default function OpportunitiesDetection({ opportunites }: OpportunitiesProps) {
  const { t, locale } = useLanguage()
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const lc = locale === 'en' ? 'en-CA' : 'fr-CA'

  const getOpportunityLabel = (type: string) => {
    switch (type) {
      case 'augmentation':
        return t("ap.increaseLabel")
      case 'baisse':
        return t("ap.decreaseLabel")
      case 'marge':
        return t("ap.marginLabel")
      default:
        return t("ap.opportunityLabel")
    }
  }

  const sortedOpportunities = [...opportunites].sort(
    (a, b) => Math.abs(b.impactPotentiel) - Math.abs(a.impactPotentiel),
  )
  const top = sortedOpportunities.slice(0, 8)

  // Magnitude relative pour la mini-barre — basée sur le top affiché,
  // pas le total. Permet d'avoir un point de référence visuel cohérent.
  const maxImpact = top.length
    ? Math.max(1, ...top.map(o => Math.abs(o.impactPotentiel)))
    : 1

  // KPI dominant : impact total cumulé sur le top
  const totalImpact = top.reduce((sum, o) => sum + Math.abs(o.impactPotentiel), 0)
  const baisseCount = top.filter(o => o.type === 'baisse').length
  const hausseCount = top.filter(o => o.type === 'augmentation').length
  const margeCount = top.filter(o => o.type === 'marge').length

  return (
    <SectionCard
      title={t("ap.opportunityDetection")}
      meta={
        opportunites.length > 0 ? (
          <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
            <span className="font-semibold text-[var(--color-text-primary)]">{opportunites.length}</span>{" "}
            {opportunites.length > 1 ? "détectées" : "détectée"}
          </span>
        ) : undefined
      }
      bodyClassName="px-0 py-0"
    >
      {top.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[var(--color-text-secondary)] text-center">
          {t("ap.noOpportunities")}
        </p>
      ) : (
        <>
          {/* ── KPI dominant : impact cumulé ── */}
          <div className="px-5 py-4 flex items-end justify-between gap-4 border-b border-[var(--color-border-tertiary)]/40">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
                Impact cumulé
              </p>
              <p className="text-3xl font-extrabold tabular-nums leading-none mt-1.5 text-[var(--color-text-primary)] tracking-tight">
                {totalImpact.toLocaleString(lc, { maximumFractionDigits: 0 })}$
              </p>
            </div>
            {/* Mini-répartition par type, façon "stacked pill" */}
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)] tabular-nums flex-wrap justify-end">
              {baisseCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="font-semibold text-[var(--color-text-primary)]">{baisseCount}</span>
                  <span className="opacity-75">baisse{baisseCount > 1 ? 's' : ''}</span>
                </span>
              )}
              {hausseCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="font-semibold text-[var(--color-text-primary)]">{hausseCount}</span>
                  <span className="opacity-75">hausse{hausseCount > 1 ? 's' : ''}</span>
                </span>
              )}
              {margeCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-primary)]/60" />
                  <span className="font-semibold text-[var(--color-text-primary)]">{margeCount}</span>
                  <span className="opacity-75">marge{margeCount > 1 ? 's' : ''}</span>
                </span>
              )}
            </div>
          </div>

          {/* ── Liste ── */}
          <ul className="divide-y divide-[var(--color-border-tertiary)]/40">
            {top.map((opp, i) => {
              const isOpen = expandedIndex === i
              const magnitude = Math.abs(opp.impactPotentiel)
              const barPct = (magnitude / maxImpact) * 100
              const barColor =
                opp.type === 'baisse'
                  ? 'bg-emerald-500/70'
                  : opp.type === 'augmentation'
                    ? 'bg-red-500/70'
                    : 'bg-[var(--color-text-primary)]/55'

              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setExpandedIndex(isOpen ? null : i)}
                    className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-[var(--color-background-hover)]/50 transition-colors"
                  >
                    <span className="text-[10px] font-semibold tabular-nums text-[var(--color-text-secondary)] w-5 shrink-0">
                      #{i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                          {getOpportunityLabel(opp.type)}
                        </span>
                        {opp.categorie && (
                          <span className="text-[10px] text-[var(--color-text-secondary)] opacity-60">
                            · {opp.categorie}
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-medium text-[var(--color-text-primary)] mt-0.5 truncate">
                        {opp.produit}
                      </div>
                      {/* Mini-bar de magnitude */}
                      <div className="mt-1.5 h-1 w-full rounded-full bg-[var(--color-background-secondary)] overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor} transition-all`}
                          style={{ width: `${Math.max(2, barPct)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-[var(--color-text-primary)] shrink-0 whitespace-nowrap">
                      {opp.impactPotentiel > 0 ? '+' : ''}
                      {opp.impactPotentiel.toLocaleString(lc, { maximumFractionDigits: 0 })}$
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-3 pl-[2.75rem]">
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                        {opp.recommandation}
                      </p>
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
