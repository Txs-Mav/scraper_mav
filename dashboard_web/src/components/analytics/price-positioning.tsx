"use client"

import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

interface PricePositioningProps {
  positionnement: {
    position: 'lowest' | 'average' | 'above'
    ecartPourcentage: number
    ecartValeur: number
    classement: number
    totalDetailleurs: number
    message: string
  }
}

export default function PricePositioningCard({ positionnement }: PricePositioningProps) {
  const { t } = useLanguage()

  const getPositionLabel = () => {
    switch (positionnement.position) {
      case 'lowest':
        return t("ap.lowest")
      case 'above':
        return t("ap.above")
      default:
        return t("ap.average")
    }
  }

  const ecartPct = positionnement.ecartPourcentage
  const ecartValeur = positionnement.ecartValeur
  const ecartSign = ecartPct >= 0 ? '+' : ''

  // Couleur sémantique uniquement sur la valeur d'écart, jamais sur un fond.
  const ecartColor =
    ecartPct < -0.5
      ? 'text-emerald-600 dark:text-emerald-400'
      : ecartPct > 0.5
        ? 'text-red-600 dark:text-red-400'
        : 'text-[var(--color-text-primary)]'

  // Jauge horizontale du classement (1er en bas = vert / dernier = rouge).
  // On ne montre la jauge que si totalDetailleurs >= 2.
  const total = Math.max(0, positionnement.totalDetailleurs)
  const rank = Math.max(1, Math.min(total, positionnement.classement || 1))
  // Position normalisée de la flèche : 1er => 0%, dernier => 100%.
  const arrowPct = total > 1 ? ((rank - 1) / (total - 1)) * 100 : 50

  return (
    <SectionCard
      title={t("ap.positioning")}
      subtitle={getPositionLabel()}
      details={
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
          {positionnement.message}
        </p>
      }
      detailsLabel={t("ap.detailsToggle")}
    >
      {/* ── Chiffre dominant — l'écart en % ── */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={`text-5xl font-extrabold tabular-nums leading-none tracking-tight ${ecartColor}`}>
          {ecartSign}{ecartPct.toFixed(1)}%
        </span>
        <span className="text-sm text-[var(--color-text-secondary)] tabular-nums">
          {ecartSign}{ecartValeur.toFixed(2)}$
        </span>
      </div>
      <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] mt-1.5 font-medium">
        {t("ap.gapPercent")} · {t("ap.gapValue").toLowerCase()}
      </p>

      {/* ── Jauge classement ── */}
      {total >= 2 && (
        <div className="mt-5 pt-4 border-t border-[var(--color-border-tertiary)]/40">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
              {t("ap.ranking")}
            </span>
            <span className="tabular-nums text-sm font-semibold text-[var(--color-text-primary)]">
              {rank}<span className="text-[var(--color-text-secondary)] font-normal text-xs">{getOrdinalSuffix(rank)} / {total}</span>
            </span>
          </div>
          <div className="relative h-1.5 rounded-full bg-[var(--color-background-secondary)] overflow-visible">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-text-primary)]/70"
              style={{ width: `${100 - arrowPct}%` }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-[var(--color-text-primary)] border-2 border-[var(--color-background-primary)] shadow-md"
              style={{ left: `calc(${arrowPct}% - 6px)` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[10px] tabular-nums text-[var(--color-text-secondary)]">
            <span>1er · {t("ap.lowest").toLowerCase()}</span>
            <span>{total}{getOrdinalSuffix(total)}</span>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function getOrdinalSuffix(n: number): string {
  if (n === 1) return 'er'
  return 'e'
}
