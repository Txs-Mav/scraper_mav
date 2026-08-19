"use client"

/**
 * Contenu des pages démo (/falardeau, /smsport), rendu dans le chrome du
 * vrai dashboard (demo-shell). Quatre sections réelles — Surveillance,
 * Analyse, Stratégie de pricing, Fiches de prix — alimentées par les
 * données scrapées ; la stratégie est éphémère (état local) et recalcule
 * en direct la colonne « Prix recommandé » et les fiches.
 */

import { useMemo, useState } from "react"
import { ChevronRight, Printer } from "lucide-react"

import DemoLayout, { type DemoSectionId } from "@/components/campaign-demo/demo-shell"
import StrategyEditor from "@/components/pricing/strategy-editor"
import PriceComparisonTable from "@/components/price-comparison-table"
import SurveillanceBackground from "@/components/kokonutui/surveillance-background"
import PricePositioningCard from "@/components/analytics/price-positioning"
import OpportunitiesDetection from "@/components/analytics/opportunities"
import AlertsAndInsights from "@/components/analytics/alerts-insights"
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
  type PricingStrategySettings,
  type VehicleType,
} from "@/lib/pricing-strategy"
import type { CampaignDemoData, DealerCampaignConfig } from "@/lib/campaign-demo"

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

      {/* `relative` obligatoire : SurveillanceBackground est en `fixed z-0`
          avec une base opaque — tout contenu non positionné serait peint
          DESSOUS (sections invisibles, page « vide »). */}
      <div className="relative">
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
      </div>
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

  // 4e KPI : l'écart vs marché plutôt que le compteur de scrapes du vrai
  // site (toujours « 1 » en démo, ce qui semblerait cassé).
  const ecart = analytics.positionnement.ecartPourcentage
  const headerKpis = [
    { label: t("analytics.productsAnalyzed"), value: totalProducts.toLocaleString("fr-CA") },
    { label: t("analytics.retailers"), value: analytics.detailleurs.length.toLocaleString("fr-CA") },
    { label: t("analytics.opportunities"), value: analytics.opportunites.length.toLocaleString("fr-CA") },
    { label: "Écart vs marché", value: `${ecart > 0 ? "+" : ""}${ecart.toFixed(1)} %` },
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

      {/* ── Sections d'analyse (mêmes cartes que le vrai site ; les blocs à
             séries temporelles — activité de scraping, tendances — sont
             omis : sans historique de compte ils n'afficheraient que du
             vide. Grille rééquilibrée en conséquence. ── */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-1 space-y-4">
            <PricePositioningCard positionnement={analytics.positionnement} />
            <AlertsAndInsights alertes={analytics.alertes} stats={analytics.stats} />
          </div>
          <div className="lg:col-span-2">
            <OpportunitiesDetection opportunites={analytics.opportunites} />
          </div>
        </div>

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
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Stratégie de pricing"
        text="Choisissez votre règle : les prix recommandés se recalculent instantanément dans la Surveillance et les Fiches de prix."
      />

      <StrategyEditor settings={settings} onChange={next => onChange(next)} vehicleTypes={vehicleTypes} />

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
