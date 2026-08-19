"use client"

/**
 * Contenu des pages démo (/falardeau, /smsport), rendu dans le chrome du
 * vrai dashboard (demo-shell). Quatre sections réelles — Surveillance,
 * Analyse, Stratégie de pricing, Fiches de prix — alimentées par les
 * données scrapées ; la stratégie est éphémère (état local) et recalcule
 * en direct la colonne « Prix recommandé » et les fiches.
 */

import { useMemo, useState } from "react"
import { ChevronRight, Minus, Plus, Printer, TrendingDown, Target, Scale, type LucideIcon } from "lucide-react"

import DemoLayout, { type DemoSectionId } from "@/components/campaign-demo/demo-shell"
import PriceComparisonTable from "@/components/price-comparison-table"
import SurveillanceBackground from "@/components/kokonutui/surveillance-background"
import PricePositioningCard from "@/components/analytics/price-positioning"
import PriceEvolutionChart from "@/components/analytics/price-evolution"
import OpportunitiesDetection from "@/components/analytics/opportunities"
import AlertsAndInsights from "@/components/analytics/alerts-insights"
import RetailerPriceTrends from "@/components/analytics/retailer-price-trends"
import ExplanatoryFactors from "@/components/analytics/explanatory-factors"
import ProductCategoryAnalysis from "@/components/analytics/product-analysis"
import CategoryAnalysis from "@/components/analytics/category-analysis"
import RetailerAnalysis from "@/components/analytics/retailer-analysis"
import Visualizations from "@/components/analytics/visualizations"
import { printCurrentPage } from "@/lib/export-utils"
import { useLanguage } from "@/contexts/language-context"

import {
  buildPricingRowsFromProducts,
  calculatePricingRecommendation,
  normalizePricingSettings,
  DEFAULT_PRICING_SETTINGS,
  VEHICLE_TYPE_LABELS,
  type PricingRecommendation,
  type PricingStrategyKey,
  type PricingStrategySettings,
  type VehicleType,
} from "@/lib/pricing-strategy"
import type { CampaignDemoData, DealerCampaignConfig } from "@/lib/campaign-demo"

const STRATEGY_META: Record<PricingStrategyKey, { label: string; tagline: string; icon: LucideIcon }> = {
  lowest_minus_amount: { label: "Sous le plus bas", tagline: "Battre le concurrent le moins cher.", icon: TrendingDown },
  match_lowest: { label: "Égaler le plus bas", tagline: "Rester compétitif sans rogner la marge.", icon: Target },
  market_average: { label: "Moyenne du marché", tagline: "Équilibre entre marge et compétitivité.", icon: Scale },
}
const STRATEGY_ORDER: PricingStrategyKey[] = ["lowest_minus_amount", "match_lowest", "market_average"]

const money = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 })

export default function CampaignDemoClient({
  config, data,
}: {
  config: DealerCampaignConfig
  data: CampaignDemoData
}) {
  const [section, setSection] = useState<DemoSectionId>("surveillance")
  const [searchQuery, setSearchQuery] = useState("")
  // Comme dans le vrai produit : la stratégie de pricing n'est PAS appliquée
  // par défaut — la colonne « Prix recommandé » n'apparaît que si le visiteur
  // l'active dans la table ou choisit une règle dans l'onglet Stratégie.
  const [pricingEnabled, setPricingEnabled] = useState(false)
  const [settings, setSettings] = useState<PricingStrategySettings>(() =>
    normalizePricingSettings(DEFAULT_PRICING_SETTINGS))

  const handleStrategyChange = (next: PricingStrategySettings) => {
    setSettings(next)
    setPricingEnabled(true)
  }

  const products = data.products as any[]
  // Pas d'inscription Ultime en libre-service depuis la démo : l'activation
  // passe par l'équipe (un vrai code promo est envoyé au concessionnaire).
  const signupHref = "/contact"

  const pricingRows = useMemo(
    () => buildPricingRowsFromProducts(products, data.competitorUrls),
    [products, data.competitorUrls]
  )
  const recommendations = useMemo(
    () =>
      pricingRows
        .map(row => calculatePricingRecommendation(row, settings))
        .filter((r): r is PricingRecommendation => r !== null)
        .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)),
    [pricingRows, settings]
  )
  const vehicleTypesPresent = useMemo(
    () => Array.from(new Set(pricingRows.map(r => r.vehicleType || "autre"))) as VehicleType[],
    [pricingRows]
  )

  const goTo = (id: DemoSectionId) => {
    setSection(id)
    requestAnimationFrame(() => {
      document.getElementById("demo-content-top")?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  return (
    <DemoLayout
      section={section}
      onNavigate={goTo}
      signupHref={signupHref}
      contactName={config.contactName}
      dealerName={config.reference.name}
    >
      <div id="demo-content-top" />
      <SurveillanceBackground />

      {section === "surveillance" && (
        <PriceComparisonTable
          products={products}
          competitorsUrls={data.competitorUrls}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Rechercher un modèle…"
          pricingSettings={settings}
          pricingEnabled={pricingEnabled}
          onPricingEnabledChange={setPricingEnabled}
        />
      )}

      {section === "analyse" && (
        <AnalyseSection analytics={data.analytics} scrapedAt={data.scrapedAt} />
      )}

      {section === "strategie" && (
        <StrategySection
          settings={settings}
          onChange={handleStrategyChange}
          vehicleTypes={vehicleTypesPresent}
          recommendationsCount={recommendations.length}
          onSeeFiches={() => goTo("fiches")}
        />
      )}

      {section === "fiches" && (
        <FichesSection recommendations={recommendations} />
      )}
    </DemoLayout>
  )
}

// ─── Sous-composants ───────────────────────────────────────

/**
 * Réplique de /dashboard/analytics : même en-tête (pastille, titre, bande
 * KPI + anneau compétitif) et mêmes sections dans le même ordre. Seuls les
 * boutons Actualiser/Réinitialiser (actions de compte) sont omis.
 */
function AnalyseSection({
  analytics, scrapedAt,
}: {
  analytics: CampaignDemoData["analytics"]
  scrapedAt: string | null
}) {
  const { t } = useLanguage()

  const totalProducts = analytics.produits.length
  const competitifCount = analytics.produits.filter(p => p.competitif && p.hasCompetitor).length
  const nonCompetitifCount = analytics.produits.filter(p => !p.competitif && p.hasCompetitor).length
  const comparableCount = competitifCount + nonCompetitifCount
  const competitifRatio = comparableCount > 0 ? (competitifCount / comparableCount) * 100 : 0

  const updatedAgoLabel = (() => {
    if (!scrapedAt) return null
    const diffMin = Math.floor((Date.now() - new Date(scrapedAt).getTime()) / 60000)
    if (diffMin < 1) return t("analytics.updatedJustNow")
    if (diffMin < 60) return t("analytics.updatedMinAgo").replace("{n}", String(diffMin))
    return t("analytics.updatedHAgo").replace("{n}", String(Math.floor(diffMin / 60)))
  })()

  const headerKpis = [
    { label: t("analytics.productsAnalyzed"), value: totalProducts.toLocaleString("fr-CA") },
    { label: t("analytics.retailers"), value: analytics.detailleurs.length.toLocaleString("fr-CA") },
    { label: t("analytics.opportunities"), value: analytics.opportunites.length.toLocaleString("fr-CA") },
    { label: t("analytics.scrapes"), value: analytics.stats.nombreScrapes.toLocaleString("fr-CA") },
  ]

  const ringSize = 64
  const ringStroke = 6
  const ringRadius = (ringSize - ringStroke) / 2
  const ringCircumference = 2 * Math.PI * ringRadius
  const ringOffset = ringCircumference * (1 - competitifRatio / 100)

  return (
    <div className="space-y-4 relative">
      <header className="rounded-2xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/35 px-5 py-4 shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)] backdrop-blur-md">
        <div className="flex items-center justify-between gap-5 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span className="font-medium uppercase tracking-wider">{t("analytics.title")}</span>
              {updatedAgoLabel && <span className="tabular-nums opacity-70">· {updatedAgoLabel}</span>}
            </div>
            <h1 className="mt-1.5 text-2xl md:text-[1.8rem] font-semibold text-[var(--color-text-primary)] tracking-tight leading-tight">
              {t("analytics.subtitle")}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex items-stretch h-9 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]/85 shadow-sm overflow-hidden divide-x divide-[var(--color-border-tertiary)] backdrop-blur-sm">
              <button
                onClick={() => printCurrentPage(t("analytics.title"))}
                className="inline-flex items-center justify-center gap-1.5 px-3 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
                title={t("analytics.printAction")}
              >
                <Printer className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("analytics.printAction")}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── KPI strip : 4 chiffres XL + anneau ratio compétitif ── */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-[repeat(4,1fr)_auto] gap-x-5 gap-y-4 items-end">
          {headerKpis.map((k, i) => (
            <div key={i} className={i > 0 ? "md:pl-5 md:border-l border-[var(--color-border-tertiary)]/40" : ""}>
              <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
                {k.label}
              </p>
              <p className="text-[1.85rem] md:text-3xl font-extrabold tabular-nums leading-none mt-1.5 text-[var(--color-text-primary)] tracking-tight">
                {k.value}
              </p>
            </div>
          ))}

          {comparableCount > 0 && (
            <div className="md:pl-5 md:border-l border-[var(--color-border-tertiary)]/40 flex items-center gap-3 col-span-2 md:col-span-1">
              <div className="relative shrink-0" style={{ width: ringSize, height: ringSize }}>
                <svg width={ringSize} height={ringSize} className="rotate-[-90deg]">
                  <circle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius} stroke="currentColor" strokeOpacity="0.15" strokeWidth={ringStroke} fill="none" />
                  <circle
                    cx={ringSize / 2} cy={ringSize / 2} r={ringRadius}
                    stroke="currentColor" strokeWidth={ringStroke} strokeLinecap="round" fill="none"
                    strokeDasharray={ringCircumference} strokeDashoffset={ringOffset}
                    className="text-emerald-500 transition-all duration-500"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold tabular-nums text-[var(--color-text-primary)]">
                  {Math.round(competitifRatio)}%
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
                  {t("analytics.competitive")}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 tabular-nums">
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{competitifCount}</span>
                  <span className="opacity-60"> / </span>
                  <span className="font-semibold text-[var(--color-text-primary)]">{comparableCount}</span>
                  <span className="opacity-60"> {t("ap.products").toLowerCase()}</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Sections d'analyse (ordre identique au vrai site) ── */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1">
            <PricePositioningCard positionnement={analytics.positionnement} />
          </div>
          <div className="lg:col-span-2">
            <PriceEvolutionChart evolutionPrix={analytics.evolutionPrix} scrapesParJour={analytics.stats.scrapesParJour} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OpportunitiesDetection opportunites={analytics.opportunites} />
          <AlertsAndInsights alertes={analytics.alertes} stats={analytics.stats} />
        </div>

        <RetailerPriceTrends evolutionPrix={analytics.evolutionPrix} />

        <ExplanatoryFactors produits={analytics.produits} />

        <ProductCategoryAnalysis produits={analytics.produits} />

        <CategoryAnalysis categories={analytics.categories} />

        <RetailerAnalysis detailleurs={analytics.detailleurs} />

        <Visualizations produits={analytics.produits} detailleurs={analytics.detailleurs} />
      </div>
    </div>
  )
}

function SectionHeader({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
      <p className="mt-0.5 max-w-3xl text-sm text-[var(--color-text-secondary)]">{text}</p>
    </div>
  )
}

function StrategySection({
  settings, onChange, vehicleTypes, recommendationsCount, onSeeFiches,
}: {
  settings: PricingStrategySettings
  onChange: (next: PricingStrategySettings) => void
  vehicleTypes: VehicleType[]
  recommendationsCount: number
  onSeeFiches: () => void
}) {
  const defaultKey = settings.default_strategy.key
  const amount = settings.default_strategy.amount ?? 1

  const setDefault = (key: PricingStrategyKey) =>
    onChange(normalizePricingSettings({
      ...settings,
      default_strategy: key === "lowest_minus_amount" ? { key, amount } : { key },
    }))

  const setAmount = (next: number) =>
    onChange(normalizePricingSettings({
      ...settings,
      default_strategy: { key: "lowest_minus_amount", amount: Math.max(0, next) },
    }))

  const setOverride = (vt: VehicleType, key: PricingStrategyKey | "default") => {
    const overrides = { ...settings.vehicle_type_strategies }
    if (key === "default") delete overrides[vt]
    else overrides[vt] = key === "lowest_minus_amount" ? { key, amount } : { key }
    onChange(normalizePricingSettings({ ...settings, vehicle_type_strategies: overrides }))
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Stratégie de pricing"
        text="Choisissez votre règle : les prix recommandés se recalculent instantanément dans la Surveillance et les Fiches de prix."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STRATEGY_ORDER.map(key => {
          const meta = STRATEGY_META[key]
          const Icon = meta.icon
          const selected = defaultKey === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDefault(key)}
              className={`rounded-xl border p-4 text-left transition-all ${
                selected
                  ? "border-orange-600 bg-orange-50 ring-1 ring-orange-600 dark:border-orange-400 dark:bg-orange-400/10 dark:ring-orange-400"
                  : "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:border-gray-300 dark:hover:border-white/20"
              }`}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                selected ? "bg-orange-600 text-white dark:bg-orange-400 dark:text-black" : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]"
              }`}>
                <Icon className="h-4 w-4" />
              </span>
              <p className="mt-2.5 text-[14px] font-semibold text-[var(--color-text-primary)]">{meta.label}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">{meta.tagline}</p>
            </button>
          )
        })}
      </div>

      {defaultKey === "lowest_minus_amount" && (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4">
          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Montant sous le prix concurrent le plus bas :
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAmount(amount - 25)}
              aria-label="Réduire le montant"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-hover)]"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[72px] text-center text-[15px] font-bold tabular-nums text-[var(--color-text-primary)]">
              −{money.format(amount)}
            </span>
            <button
              type="button"
              onClick={() => setAmount(amount + 25)}
              aria-label="Augmenter le montant"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-hover)]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
        <div className="border-b border-[var(--color-border-tertiary)] px-4 py-3">
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">Exceptions par type de véhicule</p>
          <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
            Par défaut, la règle ci-dessus s&apos;applique partout. Ajustez un type au besoin.
          </p>
        </div>
        <div className="divide-y divide-[var(--color-border-tertiary)]">
          {vehicleTypes.map(vt => (
            <div key={vt} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
                {VEHICLE_TYPE_LABELS[vt] || vt}
              </span>
              <select
                value={settings.vehicle_type_strategies[vt]?.key ?? "default"}
                onChange={e => setOverride(vt, e.target.value as PricingStrategyKey | "default")}
                className="h-8 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 text-[12px] text-[var(--color-text-primary)] focus:border-orange-500 focus:outline-none"
              >
                <option value="default">Règle par défaut</option>
                {STRATEGY_ORDER.map(key => (
                  <option key={key} value={key}>{STRATEGY_META[key].label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onSeeFiches}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-orange-600 hover:underline dark:text-orange-400"
      >
        Avec cette règle, Go-Data génère {recommendationsCount} recommandations de prix — voir les fiches
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function FichesSection({ recommendations }: { recommendations: PricingRecommendation[] }) {
  const decreases = recommendations.filter(r => r.difference < 0)
  const increases = recommendations.filter(r => r.difference > 0)
  const totalDecrease = decreases.reduce((s, r) => s + r.difference, 0)

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Changements à appliquer"
        text="Les changements de prix à appliquer dans votre site web ou votre DMS, générés depuis la stratégie choisie. Avec un compte, ces fiches se sauvegardent et se cochent au fur et à mesure."
      />

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-border-secondary)]">
        <MiniStat label="Recommandations" value={String(recommendations.length)} />
        <MiniStat label="Baisses suggérées" value={String(decreases.length)} hint={money.format(Math.abs(totalDecrease))} />
        <MiniStat label="Hausses possibles" value={String(increases.length)} />
      </div>

      {recommendations.length === 0 ? (
        <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-[var(--color-border-secondary)] text-[13px] text-[var(--color-text-tertiary)]">
          Aucune recommandation avec la stratégie actuelle.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-left text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                <th className="px-4 py-2.5 font-medium">Produit</th>
                <th className="px-4 py-2.5 text-right font-medium">Votre prix</th>
                <th className="px-4 py-2.5 text-right font-medium">Prix recommandé</th>
                <th className="px-4 py-2.5 text-right font-medium">Écart</th>
                <th className="px-4 py-2.5 text-right font-medium">Base concurrentielle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-tertiary)]">
              {recommendations.map(r => (
                <tr key={r.productKey} className="transition hover:bg-[var(--color-background-hover)]">
                  <td className="max-w-[320px] px-4 py-3">
                    {r.referenceUrl ? (
                      <a href={r.referenceUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium text-[var(--color-text-primary)] hover:text-orange-600 dark:hover:text-orange-400">
                        {r.productName}
                      </a>
                    ) : (
                      <span className="block truncate text-[13px] font-medium text-[var(--color-text-primary)]">{r.productName}</span>
                    )}
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      {VEHICLE_TYPE_LABELS[r.vehicleType] || r.vehicleType} · {r.strategyLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[var(--color-text-secondary)]">
                    {money.format(r.oldPrice)}
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">
                    {money.format(r.recommendedPrice)}
                  </td>
                  <td className={`px-4 py-3 text-right text-[13px] font-semibold tabular-nums ${
                    r.difference < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                  }`}>
                    {r.difference > 0 ? "+" : ""}{money.format(r.difference)}
                  </td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums text-[var(--color-text-secondary)]">
                    min {money.format(r.basis.minimum)} · moy {money.format(Math.round(r.basis.average))} · {r.basis.competitorPrices.length} prix
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

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-[var(--color-background-primary)] px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</p>
      {hint && <p className="text-[11px] text-[var(--color-text-tertiary)]">{hint}</p>}
    </div>
  )
}
