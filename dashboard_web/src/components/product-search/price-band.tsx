"use client"

import type { PricePosition } from "@/lib/search-valuation/types"
import { useLanguage } from "@/contexts/language-context"

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${Math.round(value * 100)}%`
}

// Les valeurs du type union `PricePosition["label"]` restent en français
// (source dans search-valuation/types.ts) — traduction au point d'affichage.
const POSITION_LABEL_KEYS: Record<string, string> = {
  "Sous le marché": "psc.belowMarket",
  "Aligné au marché": "psc.alignedMarket",
  "Au-dessus du marché": "psc.aboveMarket",
  "Hors marché": "psc.offMarket",
}

export default function PriceBand({ position }: { position: PricePosition }) {
  const { t } = useLanguage()
  return (
    <div className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-[var(--color-text-primary)]">
          {t(POSITION_LABEL_KEYS[position.label] ?? position.label)}
        </span>
        <span className="text-[var(--color-text-secondary)]">
          {t("psc.vsMedian").replace("{pct}", formatPercent(position.percentVsMedian))}
        </span>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-[var(--color-background-primary)] overflow-hidden">
        <div className="absolute inset-y-0 left-1/4 right-1/4 bg-[var(--color-text-primary)]/15" />
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-y-1/2 rounded-full bg-[var(--color-text-primary)]"
          style={{ left: `${position.markerPercent}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--color-text-tertiary)]">
        <span>{t("psc.bandBelow")}</span>
        <span>{t("psc.bandAligned")}</span>
        <span>{t("psc.bandAmbitious")}</span>
      </div>
    </div>
  )
}
