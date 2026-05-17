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
    ? "text-[#A32D2D] bg-[#FCEBEB] dark:bg-[#A32D2D]/15 border-[#A32D2D]/20"
    : isDown
      ? "text-[#27500A] dark:text-[#3B6D11] bg-[#EAF3DE] dark:bg-[#3B6D11]/15 border-[#3B6D11]/20"
      : "text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)] border-[var(--color-border-tertiary)]"

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5 space-y-3">
      <div>
        <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          {label}
        </p>
        <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
          {helper}
        </p>
      </div>

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

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--color-border-tertiary)]">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] font-semibold">
                {currentText}
              </p>
              <p className="text-sm font-bold text-[var(--color-text-primary)] tabular-nums mt-0.5">
                {formatValue(comp.current, unit, locale)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] font-semibold">
                {previousText}
              </p>
              <p className="text-sm font-bold text-[var(--color-text-primary)] tabular-nums mt-0.5">
                {formatValue(comp.previous, unit, locale)}
              </p>
            </div>
          </div>

          <div className="text-[11px] text-[var(--color-text-secondary)] tabular-nums">
            Δ ={" "}
            <span className="font-medium text-[var(--color-text-primary)]">
              {comp.delta >= 0 ? "+" : ""}
              {formatValue(Math.abs(comp.delta) * Math.sign(comp.delta || 1), unit, locale)}
            </span>
          </div>
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
        <p className="text-sm text-[var(--color-text-secondary)]">
          {t("reports.trends.subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c, i) => (
          <CompareCard key={i} {...c} />
        ))}
      </div>
    </section>
  )
}
