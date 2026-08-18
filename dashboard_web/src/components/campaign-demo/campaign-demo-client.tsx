"use client"

/**
 * Dashboard public des campagnes « démo privée » (/falardeau, /smsport…).
 * Quatre sections réelles (Surveillance, Analyse, Stratégie de pricing,
 * Fiches de prix) alimentées par les données scrapées ; le reste des outils
 * est regroupé derrière un seul verrou « compte requis » (alertes incluses).
 *
 * UX pensée pour quelqu'un qui découvre Go-Data : trois cartes « ce que
 * Go-Data a trouvé » dans le héro mènent directement aux sections, et les
 * onglets sont numérotés pour suggérer un ordre de lecture.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Bricolage_Grotesque } from "next/font/google"
import {
  ArrowRight, BarChart2, ChevronRight, CircleDollarSign, ClipboardList,
  Lock, Minus, Plus, Radar, TrendingDown, Target, Scale, X,
  type LucideIcon,
} from "lucide-react"

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

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700"] })

type SectionId = "surveillance" | "analyse" | "strategie" | "fiches"

const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: "surveillance", label: "Surveillance", icon: Radar },
  { id: "analyse", label: "Analyse", icon: BarChart2 },
  { id: "strategie", label: "Stratégie de pricing", icon: CircleDollarSign },
  { id: "fiches", label: "Fiches de prix", icon: ClipboardList },
]

const LOCKED_TOOLS = "Recherche produit, Alertes prix, Rapports, Par détaillant"

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
  const [section, setSection] = useState<SectionId>("surveillance")
  const [searchQuery, setSearchQuery] = useState("")
  const [pricingEnabled, setPricingEnabled] = useState(true)
  const [settings, setSettings] = useState<PricingStrategySettings>(() =>
    normalizePricingSettings({ ...DEFAULT_PRICING_SETTINGS, apply_enabled: true }))

  const products = data.products as any[]
  const signupHref = `/c/${config.code.toLowerCase()}`

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

  const goTo = (id: SectionId) => {
    setSection(id)
    // Amène le contenu sous la nav collante — le visiteur voit tout de
    // suite la section qu'il vient de choisir.
    requestAnimationFrame(() => {
      document.getElementById("campaign-nav")?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  const pos = data.analytics.positionnement
  const ecartLabel = `${pos.ecartPourcentage > 0 ? "+" : ""}${pos.ecartPourcentage.toFixed(1)} %`

  return (
    // Écart de couleur volontairement marqué entre le haut (héro blanc) et
    // le bas (zone de contenu grise) pour délimiter les deux mondes.
    <div className="min-h-screen bg-[#e3e7ee] dark:bg-[#08090b]">
      {/* ── Bandeau supérieur ─────────────────────────────── */}
      <header className="bg-[#0b0c0d]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-[8px] bg-white/10 ring-1 ring-white/15">
              <Image src="/Go-Data.svg" alt="Go-Data" fill sizes="32px" className="object-contain" />
            </span>
            <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
              GO-DATA
              <X className="h-3.5 w-3.5 text-orange-400" strokeWidth={3} aria-label="×" />
            </span>
            <span className="relative h-9 w-24 shrink-0 overflow-hidden rounded-[8px] bg-white px-1.5 py-1 ring-1 ring-white/15">
              <Image src={config.logo} alt={config.reference.name} fill sizes="96px" className="object-contain p-1" />
            </span>
          </div>
          <Link
            href={signupHref}
            className="group flex h-9 items-center gap-1.5 rounded-lg bg-orange-500 px-3.5 text-[13px] font-semibold text-black transition-all hover:bg-orange-400"
          >
            Activer l&apos;accès complet
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      {/* ── Héro ──────────────────────────────────────────── */}
      <section className="border-b border-gray-200 bg-white dark:border-white/[0.06] dark:bg-[#131415]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-600/10 px-3 py-1 text-[12px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-600/20 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-400/25">
            Démo privée · préparée pour {config.reference.name}
          </span>
          <h1 className={`${display.className} mt-4 text-[30px] font-bold leading-tight tracking-tight text-gray-900 sm:text-[36px] dark:text-white`}>
            Bonjour {config.contactName}
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
            L&apos;inventaire de <span className="font-semibold text-gray-900 dark:text-white">{config.reference.name}</span>,
            comparé en direct aux prix de {data.sites.length} concurrents.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <StatChip value={String(data.referenceCount)} label="unités suivies chez vous" />
            <StatChip value={String(data.matchedCount)} label="prix concurrents appariés" />
            <StatChip value={String(data.sites.length)} label="concurrents surveillés" />
            <StatChip value={timeAgo(data.scrapedAt)} label="dernière synchronisation" />
          </div>

          {/* Ce que Go-Data a trouvé — le visiteur sait où aller en 5 s. */}
          <div className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Ce que Go-Data a trouvé dans vos données
            </p>
            <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <InsightCard
                value={String(data.nonCompetitiveCount)}
                accent="red"
                label="unités où un concurrent est moins cher que vous"
                action="Voir lesquelles"
                onClick={() => goTo("surveillance")}
              />
              <InsightCard
                value={ecartLabel}
                accent="amber"
                label={`vs le marché — ${pos.classement}e sur ${pos.totalDetailleurs} détaillants`}
                action="Comprendre pourquoi"
                onClick={() => goTo("analyse")}
              />
              <InsightCard
                value={String(recommendations.length)}
                accent="orange"
                label="changements de prix recommandés, prêts à appliquer"
                action="Voir les fiches"
                onClick={() => goTo("fiches")}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Navigation sections (parcours numéroté) ───────── */}
      <nav id="campaign-nav" className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 shadow-[0_1px_8px_rgba(16,24,40,0.06)] backdrop-blur dark:border-white/[0.06] dark:bg-[#131415]/95 dark:shadow-none">
        <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6">
          {SECTIONS.map(({ id, label, icon: Icon }, i) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors ${
                section === id
                  ? "bg-orange-600 text-white dark:bg-orange-500 dark:text-black"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
              }`}
            >
              <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-bold tabular-nums ${
                section === id
                  ? "bg-white/25 text-white dark:bg-black/20 dark:text-black"
                  : "bg-gray-200 text-gray-500 dark:bg-white/10 dark:text-gray-400"
              }`} style={{ height: 18, width: 18 }}>
                {i + 1}
              </span>
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
          <span className="mx-1.5 h-5 w-px shrink-0 bg-gray-200 dark:bg-white/10" aria-hidden />
          <span
            title={`Avec un compte Go-Data : ${LOCKED_TOOLS}.`}
            className="flex h-9 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-gray-400 dark:text-gray-500"
          >
            <Lock className="h-3.5 w-3.5" />
            Plus d&apos;outils avec un compte
          </span>
        </div>
      </nav>

      {/* ── Contenu ───────────────────────────────────────── */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {section === "surveillance" && (
          <div className="space-y-4">
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
          </div>
        )}

        {section === "analyse" && (
          <div className="space-y-4">
            <SectionIntro
              title="Analyse"
              text="Votre positionnement de prix face au marché, calculé sur l'ensemble des inventaires surveillés."
            />
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
            onChange={setSettings}
            vehicleTypes={vehicleTypesPresent}
            recommendationsCount={recommendations.length}
            onSeeFiches={() => goTo("fiches")}
          />
        )}

        {section === "fiches" && (
          <FichesSection recommendations={recommendations} />
        )}
      </main>

      {/* ── Pied de page ──────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-white dark:border-white/[0.06] dark:bg-[#131415]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div className="max-w-xl">
              <p className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                Cette démonstration privée a été préparée pour {config.reference.name} par l&apos;équipe Go-Data.
                Les alertes de prix automatiques, la recherche produit et les rapports nécessitent un
                compte — l&apos;activation prend deux minutes.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2.5">
              <Link
                href={signupHref}
                className="flex h-11 items-center gap-2 rounded-xl bg-orange-600 px-5 text-[14px] font-semibold text-white transition-all hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
              >
                Activer l&apos;accès complet
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/contact"
                className="flex h-11 items-center rounded-xl border border-gray-200 bg-white px-5 text-[14px] font-semibold text-gray-700 transition-all hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:bg-transparent dark:text-gray-200 dark:hover:bg-white/[0.04]"
              >
                Parler à l&apos;équipe
              </Link>
            </div>
          </div>
          <p className="mt-6 text-[11px] text-gray-400 dark:text-gray-500">
            &copy; {new Date().getFullYear()} Go-Data · Données publiques collectées sur les sites des
            concessionnaires · Synchronisation {timeAgo(data.scrapedAt)}
          </p>
        </div>
      </footer>
    </div>
  )
}

// ─── Sous-composants ───────────────────────────────────────

function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none">
      <span className="text-[15px] font-bold tabular-nums text-gray-900 dark:text-white">{value}</span>
      <span className="text-[12px] text-gray-500 dark:text-gray-400">{label}</span>
    </span>
  )
}

const INSIGHT_ACCENTS = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  orange: "text-orange-600 dark:text-orange-400",
} as const

function InsightCard({
  value, label, action, accent, onClick,
}: {
  value: string
  label: string
  action: string
  accent: keyof typeof INSIGHT_ACCENTS
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-orange-400 hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none dark:hover:border-orange-400/60"
    >
      <span className={`${display.className} text-[24px] font-bold tabular-nums leading-none ${INSIGHT_ACCENTS[accent]}`}>
        {value}
      </span>
      <span className="mt-1.5 text-[13px] leading-snug text-gray-600 dark:text-gray-300">{label}</span>
      <span className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-semibold text-orange-600 group-hover:gap-1.5 dark:text-orange-400" style={{ transition: "gap 150ms" }}>
        {action}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}

function SectionIntro({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className={`${display.className} text-[20px] font-bold tracking-tight text-gray-900 dark:text-white`}>
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">{text}</p>
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
      <SectionIntro
        title="Stratégie de pricing"
        text="Choisissez votre règle : les prix recommandés se recalculent instantanément dans la Surveillance et les Fiches de prix. Ici, rien n'est sauvegardé — c'est votre bac à sable."
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
                  : "border-gray-200 bg-white hover:border-gray-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/20"
              }`}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                selected ? "bg-orange-600 text-white dark:bg-orange-400 dark:text-black" : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-300"
              }`}>
                <Icon className="h-4 w-4" />
              </span>
              <p className="mt-2.5 text-[14px] font-semibold text-gray-900 dark:text-white">{meta.label}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">{meta.tagline}</p>
            </button>
          )
        })}
      </div>

      {defaultKey === "lowest_minus_amount" && (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <p className="text-[13px] font-medium text-gray-700 dark:text-gray-200">
            Montant sous le prix concurrent le plus bas :
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAmount(amount - 25)}
              aria-label="Réduire le montant"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.06]"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[72px] text-center text-[15px] font-bold tabular-nums text-gray-900 dark:text-white">
              −{money.format(amount)}
            </span>
            <button
              type="button"
              onClick={() => setAmount(amount + 25)}
              aria-label="Augmenter le montant"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.06]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]">
        <div className="border-b border-gray-100 px-4 py-3 dark:border-white/[0.06]">
          <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Exceptions par type de véhicule</p>
          <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">
            Par défaut, la règle ci-dessus s&apos;applique partout. Ajustez un type au besoin.
          </p>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
          {vehicleTypes.map(vt => (
            <div key={vt} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200">
                {VEHICLE_TYPE_LABELS[vt] || vt}
              </span>
              <select
                value={settings.vehicle_type_strategies[vt]?.key ?? "default"}
                onChange={e => setOverride(vt, e.target.value as PricingStrategyKey | "default")}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] text-gray-700 focus:border-orange-500 focus:outline-none dark:border-white/10 dark:bg-[#1a1b1d] dark:text-gray-200"
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
      <SectionIntro
        title="Fiches de prix"
        text="Les changements de prix à appliquer dans votre site web ou votre DMS, générés depuis la stratégie choisie. Avec un compte, ces fiches se sauvegardent et se cochent au fur et à mesure."
      />

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 dark:border-white/[0.08] dark:bg-white/[0.08]">
        <MiniStat label="Recommandations" value={String(recommendations.length)} />
        <MiniStat label="Baisses suggérées" value={String(decreases.length)} hint={money.format(Math.abs(totalDecrease))} />
        <MiniStat label="Hausses possibles" value={String(increases.length)} />
      </div>

      {recommendations.length === 0 ? (
        <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-gray-300 text-[13px] text-gray-400 dark:border-white/10">
          Aucune recommandation avec la stratégie actuelle.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-[10px] uppercase tracking-wider text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400">
                <th className="px-4 py-2.5 font-medium">Produit</th>
                <th className="px-4 py-2.5 text-right font-medium">Votre prix</th>
                <th className="px-4 py-2.5 text-right font-medium">Prix recommandé</th>
                <th className="px-4 py-2.5 text-right font-medium">Écart</th>
                <th className="px-4 py-2.5 text-right font-medium">Base concurrentielle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {recommendations.map(r => (
                <tr key={r.productKey} className="transition hover:bg-gray-50/60 dark:hover:bg-white/[0.03]">
                  <td className="max-w-[320px] px-4 py-3">
                    {r.referenceUrl ? (
                      <a href={r.referenceUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium text-gray-900 hover:text-orange-600 dark:text-white dark:hover:text-orange-400">
                        {r.productName}
                      </a>
                    ) : (
                      <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-white">{r.productName}</span>
                    )}
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">
                      {VEHICLE_TYPE_LABELS[r.vehicleType] || r.vehicleType} · {r.strategyLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] tabular-nums text-gray-600 dark:text-gray-300">
                    {money.format(r.oldPrice)}
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] font-semibold tabular-nums text-gray-900 dark:text-white">
                    {money.format(r.recommendedPrice)}
                  </td>
                  <td className={`px-4 py-3 text-right text-[13px] font-semibold tabular-nums ${
                    r.difference < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                  }`}>
                    {r.difference > 0 ? "+" : ""}{money.format(r.difference)}
                  </td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums text-gray-500 dark:text-gray-400">
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
    <div className="bg-white px-4 py-3 dark:bg-[#131415]">
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{value}</p>
      {hint && <p className="text-[11px] text-gray-400 dark:text-gray-500">{hint}</p>}
    </div>
  )
}
