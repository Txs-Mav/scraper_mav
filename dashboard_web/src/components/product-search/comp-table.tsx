"use client"

import type { AdjustedComparable } from "@/lib/search-valuation/types"
import { cn } from "@/lib/utils"
import { useLanguage } from "@/contexts/language-context"

function formatMoney(value: number, lc: string): string {
  return new Intl.NumberFormat(lc, {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatAdjustment(value: number, lc: string): string {
  if (value === 0) return formatMoney(0, lc)
  const sign = value > 0 ? "+" : "-"
  return `${sign}${formatMoney(Math.abs(value), lc)}`
}

export default function CompTable({ comps }: { comps: AdjustedComparable[] }) {
  const { t, locale } = useLanguage()
  const lc = locale === "en" ? "en-CA" : "fr-CA"
  return (
    <details className="rounded-lg border border-[var(--color-border-secondary)] overflow-hidden group">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] hover:bg-[var(--color-background-hover)]">
        {t("psc.viewComps")}
      </summary>
      <div className="overflow-x-auto border-t border-[var(--color-border-secondary)]">
        <table className="min-w-[900px] w-full text-xs">
          <thead className="bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]">
            <tr>
              <th className="text-left font-semibold px-3 py-2">{t("psc.vehicle")}</th>
              <th className="text-left font-semibold px-3 py-2">{t("psc.year")}</th>
              <th className="text-left font-semibold px-3 py-2">{t("psc.km")}</th>
              <th className="text-left font-semibold px-3 py-2">{t("psc.listedPrice")}</th>
              <th className="text-left font-semibold px-3 py-2">{t("psc.adjustments")}</th>
              <th className="text-left font-semibold px-3 py-2">{t("psc.adjustedPrice")}</th>
              <th className="text-left font-semibold px-3 py-2">{t("psc.weight")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-secondary)]">
            {comps.map((comp, index) => (
              <tr key={`${comp.source_url || comp.name}:${index}`} className="align-top">
                <td className="px-3 py-2 text-[var(--color-text-primary)] max-w-[280px]">
                  <div className="font-medium line-clamp-2">{comp.name}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)] truncate">
                    {comp.sourceDomain}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums text-[var(--color-text-secondary)]">
                  {comp.annee || "—"}
                </td>
                <td className="px-3 py-2 tabular-nums text-[var(--color-text-secondary)]">
                  {comp.kilometrage != null ? comp.kilometrage.toLocaleString(lc) : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums font-medium text-[var(--color-text-primary)]">
                  {formatMoney(comp.originalPrice, lc)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {comp.adjustments.length === 0 ? (
                      <span className="text-[var(--color-text-tertiary)]">{t("psc.none")}</span>
                    ) : (
                      comp.adjustments.map((adjustment, adjustmentIndex) => (
                        <span
                          key={`${adjustment.type}:${adjustmentIndex}`}
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                            adjustment.amount > 0 && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
                            adjustment.amount < 0 && "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
                            adjustment.amount === 0 && "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300",
                          )}
                          title={adjustment.reason}
                        >
                          {formatAdjustment(adjustment.amount, lc)} {adjustment.reason}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                  {formatMoney(comp.adjustedPrice, lc)}
                </td>
                <td className="px-3 py-2 tabular-nums text-[var(--color-text-secondary)]">
                  {Math.round(comp.similarityScore * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
