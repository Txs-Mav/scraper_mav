"use client"

/**
 * Section "Présent" du rapport : photographie chiffrée du dernier scraping.
 *
 * On reste **strictement descriptif** : nombre de produits, prix moyen,
 * médian, min, max, répartition par catégorie / site / état. Aucune
 * interprétation, aucune recommandation — ce volet appartient à la page
 * Analyse.
 */

import { Package, Building2, Layers, Activity } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import type { ReportPresent } from "@/lib/reports-calculations"

interface PresentSnapshotProps {
  present: ReportPresent
  asOf: string | null
}

function formatMoney(value: number, locale: string): string {
  return value.toLocaleString(locale === "en" ? "en-CA" : "fr-CA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function formatDate(date: string | null, locale: string): string {
  if (!date) return "—"
  return new Date(date).toLocaleDateString(
    locale === "en" ? "en-CA" : "fr-CA",
    { day: "numeric", month: "short", year: "numeric" },
  )
}

export default function PresentSnapshot({
  present,
  asOf,
}: PresentSnapshotProps) {
  const { t, locale } = useLanguage()

  const kpis = [
    {
      label: t("reports.present.productsTotal"),
      value: present.totalProducts.toLocaleString(
        locale === "en" ? "en-CA" : "fr-CA",
      ),
      icon: Package,
      dot: "bg-[#3B6D11]",
    },
    {
      label: t("reports.present.sitesCount"),
      value: present.sitesCount.toLocaleString(
        locale === "en" ? "en-CA" : "fr-CA",
      ),
      icon: Building2,
      dot: "bg-sky-500",
    },
    {
      label: t("reports.present.categoriesCount"),
      value: present.categoriesCount.toLocaleString(
        locale === "en" ? "en-CA" : "fr-CA",
      ),
      icon: Layers,
      dot: "bg-amber-500",
    },
    {
      label: t("reports.present.productsWithPrice"),
      value: present.productsWithPrice.toLocaleString(
        locale === "en" ? "en-CA" : "fr-CA",
      ),
      icon: Activity,
      dot: "bg-violet-500",
    },
  ]

  const priceStats = [
    {
      label: t("reports.present.minPrice"),
      value: present.minPrice,
    },
    {
      label: t("reports.present.medianPrice"),
      value: present.medianPrice,
    },
    {
      label: t("reports.present.averagePrice"),
      value: present.averagePrice,
    },
    {
      label: t("reports.present.maxPrice"),
      value: present.maxPrice,
    },
  ]

  const topCategories = present.productsByCategory.slice(0, 6)
  const topSites = present.productsBySite.slice(0, 6)

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
            {t("reports.present.title")}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t("reports.present.subtitle")}
          </p>
        </div>
        <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
          {t("reports.present.asOf")}{" "}
          <span className="font-medium text-[var(--color-text-primary)]">
            {formatDate(asOf, locale)}
          </span>
        </span>
      </header>

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-[var(--color-border-tertiary)]">
          {kpis.map((k, i) => {
            const Icon = k.icon
            return (
              <div key={i} className="p-5 flex flex-col justify-center">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
                    <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                      {k.label}
                    </p>
                  </div>
                  <Icon className="h-3.5 w-3.5 text-[var(--color-text-secondary)] opacity-40" />
                </div>
                <p className="text-3xl font-extrabold text-[var(--color-text-primary)] tabular-nums leading-none tracking-tight">
                  {k.value}
                </p>
              </div>
            )
          })}
        </div>

        <div className="border-t border-[var(--color-border-tertiary)] grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--color-border-tertiary)]">
          {priceStats.map((stat) => (
            <div key={stat.label} className="px-5 py-3.5">
              <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                {stat.label}
              </p>
              <p className="text-base font-bold text-[var(--color-text-primary)] tabular-nums mt-0.5">
                {stat.value > 0 ? `${formatMoney(stat.value, locale)} $` : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {(topCategories.length > 0 || topSites.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {topCategories.length > 0 && (
            <DistributionCard
              title={t("reports.present.topCategories")}
              rows={topCategories.map((c) => ({
                label: c.category,
                count: c.count,
                price: c.averagePrice,
              }))}
              total={present.productsWithPrice}
              locale={locale}
              priceLabel={t("reports.present.averagePriceShort")}
              countLabel={t("reports.present.products")}
            />
          )}
          {topSites.length > 0 && (
            <DistributionCard
              title={t("reports.present.topSites")}
              rows={topSites.map((s) => ({
                label: s.site,
                count: s.count,
                price: s.averagePrice,
                badge: s.isReference
                  ? t("reports.present.referenceBadge")
                  : undefined,
              }))}
              total={present.productsWithPrice}
              locale={locale}
              priceLabel={t("reports.present.averagePriceShort")}
              countLabel={t("reports.present.products")}
            />
          )}
        </div>
      )}

      {present.productsByCondition.length > 0 && (
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
            {t("reports.present.conditionBreakdown")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {present.productsByCondition.map((c) => (
              <div
                key={c.etat}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)]"
              >
                <span className="text-xs text-[var(--color-text-secondary)] capitalize">
                  {c.etat}
                </span>
                <span className="text-xs font-bold text-[var(--color-text-primary)] tabular-nums">
                  {c.count.toLocaleString(
                    locale === "en" ? "en-CA" : "fr-CA",
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function DistributionCard({
  title,
  rows,
  total,
  locale,
  priceLabel,
  countLabel,
}: {
  title: string
  rows: Array<{
    label: string
    count: number
    price: number
    badge?: string
  }>
  total: number
  locale: string
  priceLabel: string
  countLabel: string
}) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">
        {title}
      </h3>
      <div className="space-y-3">
        {rows.map((r) => {
          const pct = (r.count / max) * 100
          const share = total > 0 ? (r.count / total) * 100 : 0
          return (
            <div key={r.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-[var(--color-text-primary)] capitalize truncate">
                    {r.label}
                  </span>
                  {r.badge && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#3B6D11]/15 text-[#27500A] dark:text-[#3B6D11] uppercase tracking-wider">
                      {r.badge}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[var(--color-text-secondary)] tabular-nums flex-shrink-0">
                  <span>
                    <span className="font-bold text-[var(--color-text-primary)]">
                      {r.count.toLocaleString(
                        locale === "en" ? "en-CA" : "fr-CA",
                      )}
                    </span>{" "}
                    {countLabel}
                  </span>
                  {r.price > 0 && (
                    <span>
                      {priceLabel}:{" "}
                      <span className="font-bold text-[var(--color-text-primary)]">
                        {r.price.toLocaleString(
                          locale === "en" ? "en-CA" : "fr-CA",
                          { maximumFractionDigits: 0 },
                        )}{" "}
                        $
                      </span>
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--color-background-secondary)] overflow-hidden">
                <div
                  className="h-full bg-[#3B6D11]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-[var(--color-text-secondary)] tabular-nums">
                {share.toFixed(1)}% du total
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
