"use client"

import type { PricePosition } from "@/lib/search-valuation/types"

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${Math.round(value * 100)}%`
}

export default function PriceBand({ position }: { position: PricePosition }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-[var(--color-text-primary)]">{position.label}</span>
        <span className="text-[var(--color-text-secondary)]">
          {formatPercent(position.percentVsMedian)} vs médiane
        </span>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-[var(--color-background-primary)] overflow-hidden">
        <div className="absolute inset-y-0 left-1/4 right-1/4 bg-emerald-500/25" />
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-y-1/2 rounded-full bg-emerald-600"
          style={{ left: `${position.markerPercent}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--color-text-tertiary)]">
        <span>Sous marché</span>
        <span>Aligné</span>
        <span>Ambitieux</span>
      </div>
    </div>
  )
}
