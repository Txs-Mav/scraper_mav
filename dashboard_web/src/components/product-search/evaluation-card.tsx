"use client"

import { Info } from "lucide-react"
import type { ValuationReliability, ValuationResult } from "@/lib/search-valuation/types"
import { cn } from "@/lib/utils"
import CompTable from "./comp-table"
import PriceBand from "./price-band"

function formatMoney(value: number | null): string {
  if (value == null) return "—"
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value)
}

function reliabilityLabel(reliability: ValuationReliability): string {
  if (reliability === "good") return "Fiable"
  if (reliability === "indicative") return "Indicatif"
  if (reliability === "low") return "Fragile"
  return "Trop peu de données"
}

function reliabilityTone(reliability: ValuationReliability): string {
  if (reliability === "good") return "bg-emerald-500"
  if (reliability === "indicative") return "bg-amber-500"
  return "bg-red-500"
}

function reliabilityTitle(result: ValuationResult): string {
  const signals = result.reliabilitySignals
  const dispersion =
    signals.dispersion == null ? "n/a" : `${Math.round(signals.dispersion * 100)}%`
  return [
    `${signals.compCount} comparables (${signals.compLevel})`,
    `dispersion ${dispersion} (${signals.dispersionLevel})`,
    `${signals.sourceDiversity} sources (${signals.sourceLevel})`,
  ].join(" · ")
}

function evaluationSpecChips(result: ValuationResult): string[] {
  const parsed = result.parsed
  const chips: string[] = []
  if (parsed.condition) chips.push(parsed.condition === "new" ? "Neuf" : "Usagé")
  if (parsed.mileage != null) chips.push(`${parsed.mileage.toLocaleString("fr-CA")} km`)
  if (parsed.priceTarget != null) chips.push(`Prix demandé ${formatMoney(parsed.priceTarget)}`)
  if (parsed.variantHints.length > 0) {
    chips.push(`${parsed.variantHints.length} option${parsed.variantHints.length > 1 ? "s" : ""}`)
  }
  return chips
}

function ValueStat({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string
  value: number | null
  hint: string
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--color-border-secondary)] p-3",
        emphasis ? "bg-emerald-50/70 dark:bg-emerald-500/10" : "bg-[var(--color-background-secondary)]",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-bold tabular-nums text-[var(--color-text-primary)]",
          emphasis ? "text-2xl text-emerald-700 dark:text-emerald-300" : "text-lg",
        )}
      >
        {formatMoney(value)}
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">{hint}</div>
    </div>
  )
}

export default function EvaluationCard({ result }: { result: ValuationResult }) {
  const specChips = evaluationSpecChips(result)

  if (result.status === "insufficient") {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-[var(--color-text-tertiary)] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              Échantillon insuffisant
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {result.message || "Affinez la recherche ou élargissez les sources pour obtenir au moins 3 comparables."}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Valeur estimée
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Fourchette calculée automatiquement à partir de {result.comps.length} comparables.
          </p>
          {specChips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {specChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
        <div
          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-secondary)] px-3 py-1 text-xs font-medium text-[var(--color-text-primary)]"
          title={reliabilityTitle(result)}
        >
          <span className={cn("h-2.5 w-2.5 rounded-full", reliabilityTone(result.reliability))} />
          {reliabilityLabel(result.reliability)}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ValueStat label="Bas" value={result.lowValue} hint="Vente rapide" />
        <ValueStat label="Prix juste" value={result.medianValue} hint="Référence principale" emphasis />
        <ValueStat label="Haut" value={result.highValue} hint="Prix ambitieux" />
      </div>

      {result.pricePosition && <PriceBand position={result.pricePosition} />}

      <CompTable comps={result.comps} />
    </div>
  )
}
