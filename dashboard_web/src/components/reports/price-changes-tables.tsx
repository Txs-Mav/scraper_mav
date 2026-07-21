"use client"

/**
 * Section "Tendances – mouvements détaillés".
 *
 * Tableaux factuels :
 *   - top hausses et baisses de prix par produit ;
 *   - tendances par site (prix moyen 1ère vs dernière capture) ;
 *   - tendances par catégorie.
 *
 * On affiche les chiffres, pas les conclusions.
 */

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import type {
  ReportTrends,
  ProductTrend,
} from "@/lib/reports-calculations"

interface PriceChangesTablesProps {
  trends: ReportTrends
}

function formatMoney(value: number, locale: string): string {
  return value.toLocaleString(locale === "en" ? "en-CA" : "fr-CA", {
    maximumFractionDigits: 0,
  })
}

function formatDate(date: string, locale: string): string {
  return new Date(date).toLocaleDateString(
    locale === "en" ? "en-CA" : "fr-CA",
    { day: "numeric", month: "short" },
  )
}

function DeltaBadge({ value }: { value: number }) {
  const isUp = value > 0
  const isDown = value < 0
  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus
  const tone = isUp
    ? "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/15"
    : isDown
      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/15"
      : "text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)]"
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums ${tone}`}
    >
      <Icon className="h-3 w-3" />
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  )
}

function TopMovesTable({
  title,
  description,
  rows,
  locale,
  emptyText,
  productLabel,
  siteLabel,
  fromLabel,
  toLabel,
  variationLabel,
  periodLabel,
}: {
  title: string
  description: string
  rows: ProductTrend[]
  locale: string
  emptyText: string
  productLabel: string
  siteLabel: string
  fromLabel: string
  toLabel: string
  variationLabel: string
  periodLabel: string
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--color-border-tertiary)]">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {title}
        </h3>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm italic text-[var(--color-text-secondary)]">
          {emptyText}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)]/40">
              <tr>
                <th className="text-left px-5 py-2 font-semibold">
                  {productLabel}
                </th>
                <th className="text-left px-5 py-2 font-semibold hidden md:table-cell">
                  {siteLabel}
                </th>
                <th className="text-right px-5 py-2 font-semibold">
                  {fromLabel}
                </th>
                <th className="text-right px-5 py-2 font-semibold">
                  {toLabel}
                </th>
                <th className="text-right px-5 py-2 font-semibold">
                  {variationLabel}
                </th>
                <th className="text-right px-5 py-2 font-semibold hidden lg:table-cell">
                  {periodLabel}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-tertiary)]">
              {rows.map((row, i) => (
                <tr key={`${row.product}-${row.site}-${i}`}>
                  <td className="px-5 py-2.5 text-[var(--color-text-primary)] font-medium max-w-xs truncate">
                    {row.product || "—"}
                  </td>
                  <td className="px-5 py-2.5 text-[var(--color-text-secondary)] hidden md:table-cell">
                    {row.site}
                  </td>
                  <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] tabular-nums">
                    {formatMoney(row.firstPrice, locale)} $
                  </td>
                  <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] font-semibold tabular-nums">
                    {formatMoney(row.lastPrice, locale)} $
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <DeltaBadge value={row.deltaPct} />
                  </td>
                  <td className="px-5 py-2.5 text-right text-[11px] text-[var(--color-text-secondary)] tabular-nums hidden lg:table-cell">
                    {formatDate(row.firstSeen, locale)} →{" "}
                    {formatDate(row.lastSeen, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function PriceChangesTables({
  trends,
}: PriceChangesTablesProps) {
  const { t, locale } = useLanguage()

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
          {t("reports.changes.title")}
        </h2>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TopMovesTable
          title={t("reports.changes.dropsTitle")}
          description={t("reports.changes.dropsDesc")}
          rows={trends.biggestPriceDrops}
          locale={locale}
          emptyText={t("reports.changes.empty")}
          productLabel={t("reports.changes.col.product")}
          siteLabel={t("reports.changes.col.site")}
          fromLabel={t("reports.changes.col.first")}
          toLabel={t("reports.changes.col.last")}
          variationLabel={t("reports.changes.col.variation")}
          periodLabel={t("reports.changes.col.period")}
        />
        <TopMovesTable
          title={t("reports.changes.increasesTitle")}
          description={t("reports.changes.increasesDesc")}
          rows={trends.biggestPriceIncreases}
          locale={locale}
          emptyText={t("reports.changes.empty")}
          productLabel={t("reports.changes.col.product")}
          siteLabel={t("reports.changes.col.site")}
          fromLabel={t("reports.changes.col.first")}
          toLabel={t("reports.changes.col.last")}
          variationLabel={t("reports.changes.col.variation")}
          periodLabel={t("reports.changes.col.period")}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border-tertiary)]">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t("reports.changes.siteTrends")}
            </h3>
          </div>
          {trends.siteTrends.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm italic text-[var(--color-text-secondary)]">
              {t("reports.changes.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)]/40">
                  <tr>
                    <th className="text-left px-5 py-2 font-semibold">
                      {t("reports.changes.col.site")}
                    </th>
                    <th className="text-right px-5 py-2 font-semibold">
                      {t("reports.changes.col.firstAvg")}
                    </th>
                    <th className="text-right px-5 py-2 font-semibold">
                      {t("reports.changes.col.lastAvg")}
                    </th>
                    <th className="text-right px-5 py-2 font-semibold">
                      {t("reports.changes.col.variation")}
                    </th>
                    <th className="text-right px-5 py-2 font-semibold hidden md:table-cell">
                      {t("reports.changes.col.productsCount")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-tertiary)]">
                  {trends.siteTrends.map((row) => (
                    <tr key={row.site}>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--color-text-primary)]">
                            {row.site}
                          </span>
                          {row.isReference && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/15 text-orange-700 dark:text-orange-400 uppercase tracking-wider">
                              {t("reports.changes.referenceBadge")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] tabular-nums">
                        {formatMoney(row.firstAveragePrice, locale)} $
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] font-semibold tabular-nums">
                        {formatMoney(row.lastAveragePrice, locale)} $
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <DeltaBadge value={row.deltaPct} />
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] tabular-nums hidden md:table-cell">
                        {row.productsCount.toLocaleString(
                          locale === "en" ? "en-CA" : "fr-CA",
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border-tertiary)]">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t("reports.changes.categoryTrends")}
            </h3>
          </div>
          {trends.categoryTrends.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm italic text-[var(--color-text-secondary)]">
              {t("reports.changes.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)]/40">
                  <tr>
                    <th className="text-left px-5 py-2 font-semibold">
                      {t("reports.changes.col.category")}
                    </th>
                    <th className="text-right px-5 py-2 font-semibold">
                      {t("reports.changes.col.firstAvg")}
                    </th>
                    <th className="text-right px-5 py-2 font-semibold">
                      {t("reports.changes.col.lastAvg")}
                    </th>
                    <th className="text-right px-5 py-2 font-semibold">
                      {t("reports.changes.col.variation")}
                    </th>
                    <th className="text-right px-5 py-2 font-semibold hidden md:table-cell">
                      {t("reports.changes.col.productsCount")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-tertiary)]">
                  {trends.categoryTrends.map((row) => (
                    <tr key={row.category}>
                      <td className="px-5 py-2.5 font-medium text-[var(--color-text-primary)] capitalize">
                        {row.category}
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] tabular-nums">
                        {formatMoney(row.firstAveragePrice, locale)} $
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] font-semibold tabular-nums">
                        {formatMoney(row.lastAveragePrice, locale)} $
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <DeltaBadge value={row.deltaPct} />
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--color-text-primary)] tabular-nums hidden md:table-cell">
                        {row.productsCount.toLocaleString(
                          locale === "en" ? "en-CA" : "fr-CA",
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
