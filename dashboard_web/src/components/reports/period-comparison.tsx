"use client"

/**
 * Section "Tendances – variations chiffrées".
 *
 * On compare des fenêtres temporelles (présent vs passé) et on affiche
 * les chiffres bruts (valeur actuelle, valeur précédente, écart absolu
 * et relatif). Aucune cause, aucune recommandation : c'est volontaire.
 */

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import type {
  PeriodComparison,
  ReportTrends,
} from "@/lib/reports-calculations"

interface PeriodComparisonProps {
  trends: ReportTrends
}

interface CompareCardProps {
  label: string
  helper: string
  comp: PeriodComparison
  unit: "money" | "count"
  locale: string
  unavailableText: string
  currentText: string
  previousText: string
}

function formatValue(
  value: number,
  unit: "money" | "count",
  locale: string,
): string {
  if (unit === "money") {
    return `${value.toLocaleString(locale === "en" ? "en-CA" : "fr-CA", {
      maximumFractionDigits: 0,
    })} $`
  }
  return value.toLocaleString(locale === "en" ? "en-CA" : "fr-CA")
}

function CompareCard({
  label,
  helper,
  comp,
  unit,
  locale,
  unavailableText,
  currentText,
  previousText,
}: CompareCardProps) {
  const isUp = comp.delta > 0
  const isDown = comp.delta < 0
  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus
  const tone = isUp
    ? "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/15 border-red-500/20"
    : isDown
      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-500/20"
      : "text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)] border-[var(--color-border-tertiary)]"

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5 space-y-3">
      <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
        {label}
      </p>

      {comp.available ? (
        <>
          <div className="flex items-end gap-3">
            <p className="text-3xl font-extrabold text-[var(--color-text-primary)] tabular-nums leading-none">
              {formatValue(comp.current, unit, locale)}
            </p>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-semibold tabular-nums ${tone}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {comp.deltaPct >= 0 ? "+" : ""}
              {comp.deltaPct.toFixed(1)}%
            </span>
          </div>

          <p className="pt-2 border-t border-[var(--color-border-tertiary)] text-[11px] text-[var(--color-text-secondary)] tabular-nums">
            {previousText}{" "}
            <span className="font-semibold text-[var(--color-text-primary)]">
              {formatValue(comp.previous, unit, locale)}
            </span>{" "}
            · Δ{" "}
            <span className="font-semibold text-[var(--color-text-primary)]">
              {comp.delta >= 0 ? "+" : "−"}
              {formatValue(Math.abs(comp.delta), unit, locale)}
            </span>
          </p>
        </>
      ) : (
        <p className="text-xs italic text-[var(--color-text-secondary)] pt-2">
          {unavailableText}
        </p>
      )}
    </div>
  )
}

export default function PeriodComparisonSection({
  trends,
}: PeriodComparisonProps) {
  const { t, locale } = useLanguage()

  const cards: CompareCardProps[] = [
    {
      label: t("reports.trends.avgPrice7d"),
      helper: t("reports.trends.avgPrice7dHelper"),
      comp: trends.averagePrice7d,
      unit: "money",
      locale,
      unavailableText: t("reports.trends.notEnoughData"),
      currentText: t("reports.trends.current"),
      previousText: t("reports.trends.previous"),
    },
    {
      label: t("reports.trends.avgPrice30d"),
      helper: t("reports.trends.avgPrice30dHelper"),
      comp: trends.averagePrice30d,
      unit: "money",
      locale,
      unavailableText: t("reports.trends.notEnoughData"),
      currentText: t("reports.trends.current"),
      previousText: t("reports.trends.previous"),
    },
    {
      label: t("reports.trends.productsCount7d"),
      helper: t("reports.trends.productsCount7dHelper"),
      comp: trends.productsCount7d,
      unit: "count",
      locale,
      unavailableText: t("reports.trends.notEnoughData"),
      currentText: t("reports.trends.current"),
      previousText: t("reports.trends.previous"),
    },
    {
      label: t("reports.trends.productsCount30d"),
      helper: t("reports.trends.productsCount30dHelper"),
      comp: trends.productsCount30d,
      unit: "count",
      locale,
      unavailableText: t("reports.trends.notEnoughData"),
      currentText: t("reports.trends.current"),
      previousText: t("reports.trends.previous"),
    },
  ]

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
          {t("reports.trends.title")}
        </h2>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c, i) => (
          <CompareCard key={i} {...c} />
        ))}
      </div>
    </section>
  )
}
