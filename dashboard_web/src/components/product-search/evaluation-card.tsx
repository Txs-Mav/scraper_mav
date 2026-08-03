"use client"

import { Info } from "lucide-react"
import type { ValuationReliability, ValuationResult } from "@/lib/search-valuation/types"
import { cn } from "@/lib/utils"
import { useLanguage } from "@/contexts/language-context"
import CompTable from "./comp-table"
import PriceBand from "./price-band"

function formatMoney(value: number | null, lc: string): string {
  if (value == null) return "—"
  return new Intl.NumberFormat(lc, {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value)
}

function reliabilityLabelKey(reliability: ValuationReliability): string {
  if (reliability === "good") return "psc.reliabilityGood"
  if (reliability === "indicative") return "psc.reliabilityIndicative"
  if (reliability === "low") return "psc.reliabilityLow"
  return "psc.reliabilityInsufficient"
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

function evaluationSpecChips(
  result: ValuationResult,
  t: (key: string) => string,
  lc: string,
): string[] {
  const parsed = result.parsed
  const chips: string[] = []
  if (parsed.condition) chips.push(parsed.condition === "new" ? t("psc.newCondition") : t("psc.usedCondition"))
  if (parsed.mileage != null) chips.push(`${parsed.mileage.toLocaleString(lc)} km`)
  if (parsed.priceTarget != null) {
    chips.push(t("psc.askingPriceChip").replace("{price}", formatMoney(parsed.priceTarget, lc)))
  }
  if (parsed.variantHints.length > 0) {
    chips.push(
      parsed.variantHints.length > 1
        ? t("psc.nOptionsChip").replace("{n}", String(parsed.variantHints.length))
        : t("psc.oneOptionChip"),
    )
  }
  return chips
}

function ValueStat({
  label,
  value,
  hint,
  lc,
  emphasis = false,
}: {
  label: string
  value: number | null
  hint: string
  lc: string
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        emphasis
          ? "border-[var(--color-text-primary)]/15 bg-[var(--color-background-secondary)]"
          : "border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]/60",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-bold tabular-nums text-[var(--color-text-primary)]",
          emphasis ? "text-2xl" : "text-lg",
        )}
      >
        {formatMoney(value, lc)}
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">{hint}</div>
    </div>
  )
}

export default function EvaluationCard({ result }: { result: ValuationResult }) {
  const { t, locale } = useLanguage()
  const lc = locale === "en" ? "en-CA" : "fr-CA"
  const specChips = evaluationSpecChips(result, t, lc)

  if (result.status === "insufficient") {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-[var(--color-text-tertiary)] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t("psc.insufficientSample")}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {result.message || t("psc.refineSearchHint")}
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
            {t("psc.estimatedValue")}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {t("psc.rangeFromComps").replace("{n}", String(result.comps.length))}
          </p>
          {specChips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {specChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]"
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
          {t(reliabilityLabelKey(result.reliability))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ValueStat label={t("psc.low")} value={result.lowValue} hint={t("psc.quickSale")} lc={lc} />
        <ValueStat label={t("psc.fairPrice")} value={result.medianValue} hint={t("psc.mainReference")} lc={lc} emphasis />
        <ValueStat label={t("psc.high")} value={result.highValue} hint={t("psc.ambitiousPrice")} lc={lc} />
      </div>

      {result.pricePosition && <PriceBand position={result.pricePosition} />}

      <CompTable comps={result.comps} />
    </div>
  )
}
