"use client"

/**
 * Contenu des pages démo (/falardeau, /smsport), rendu dans le chrome du
 * vrai dashboard (demo-shell). Quatre sections réelles — Surveillance,
 * Analyse, Stratégie de pricing, Fiches de prix — alimentées par les
 * données scrapées ; la stratégie est éphémère (état local) et recalcule
 * en direct la colonne « Prix recommandé » et les fiches.
 */

import { useMemo, useState } from "react"
import { ChevronRight, Minus, Plus, TrendingDown, Target, Scale, type LucideIcon } from "lucide-react"

import DemoLayout, { type DemoSectionId } from "@/components/campaign-demo/demo-shell"
import PriceComparisonTable from "@/components/price-comparison-table"
import PricePositioningCard from "@/components/analytics/price-positioning"
import OpportunitiesDetection from "@/components/analytics/opportunities"
import ExplanatoryFactors from "@/components/analytics/explanatory-factors"
import ProductCategoryAnalysis from "@/components/analytics/product-analysis"
import CategoryAnalysis from "@/components/analytics/category-analysis"
import RetailerAnalysis from "@/components/analytics/retailer-analysis"
import Visualizations from "@/components/analytics/visualizations"

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

function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 3600_000) return `il y a ${Math.max(1, Math.round(ms / 60_000))} min`
  if (ms < 86400_000) return `il y a ${Math.round(ms / 3600_000)} h`
  return `il y a ${Math.round(ms / 86400_000)} j`
}

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

  const pos = data.analytics.positionnement
  const ecartLabel = `${pos.ecartPourcentage > 0 ? "+" : ""}${pos.ecartPourcentage.toFixed(1)} %`

  return (
    <DemoLayout
      section={section}
      onNavigate={goTo}
      signupHref={signupHref}
      contactName={config.contactName}
      dealerName={config.reference.name}
    >
      <div id="demo-content-top" />

      {/* Accueil personnalisé + constats, présentés comme un widget du
          dashboard (mêmes tokens que les cartes du vrai site). */}
      <div className="mb-4 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 sm:p-5">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Bonjour {config.contactName}
        </h1>
        <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
          L&apos;inventaire de {config.reference.name} ({data.referenceCount} unités), comparé en direct
          aux prix de {data.sites.length} concurrents · synchronisé {timeAgo(data.scrapedAt)}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <InsightButton
            value={String(data.nonCompetitiveCount)}
            valueClass="text-red-600 dark:text-red-400"
            label="unités où un concurrent est moins cher"
            active={section === "surveillance"}
            onClick={() => goTo("surveillance")}
          />
          <InsightButton
            value={ecartLabel}
            valueClass="text-amber-600 dark:text-amber-400"
            label={`vs le marché — ${pos.classement}e sur ${pos.totalDetailleurs} détaillants`}
            active={section === "analyse"}
            onClick={() => goTo("analyse")}
          />
          <InsightButton
            value={String(recommendations.length)}
            valueClass="text-orange-600 dark:text-orange-400"
            label="changements de prix recommandés"
            active={section === "fiches"}
            onClick={() => goTo("fiches")}
          />
        </div>
      </div>

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
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PricePositioningCard positionnement={data.analytics.positionnement} />
            <OpportunitiesDetection opportunites={data.analytics.opportunites} />
          </div>
          <ExplanatoryFactors produits={data.analytics.produits} />
          <ProductCategoryAnalysis produits={data.analytics.produits} />
          <CategoryAnalysis categories={data.analytics.categories} />
          <RetailerAnalysis detailleurs={data.analytics.detailleurs} />
          <Visualizations produits={data.analytics.produits} detailleurs={data.analytics.detailleurs} />
        </div>
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

function InsightButton({
  value, valueClass, label, active, onClick,
}: {
  value: string
  valueClass: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-lg border p-3 text-left transition ${
        active
          ? "border-orange-500/50 bg-orange-50/60 dark:bg-orange-500/5"
          : "border-[var(--color-border-secondary)] hover:bg-[var(--color-background-hover)]"
      }`}
    >
      <span className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</span>
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--color-text-secondary)]">{label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-0.5" />
    </button>
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
