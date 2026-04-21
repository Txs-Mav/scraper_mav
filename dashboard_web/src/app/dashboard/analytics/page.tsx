"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import PricePositioningCard from "@/components/analytics/price-positioning"
import ProductCategoryAnalysis from "@/components/analytics/product-analysis"
import PriceEvolutionChart from "@/components/analytics/price-evolution"
import OpportunitiesDetection from "@/components/analytics/opportunities"
import RetailerAnalysis from "@/components/analytics/retailer-analysis"
import CategoryAnalysis from "@/components/analytics/category-analysis"
import AlertsAndInsights from "@/components/analytics/alerts-insights"
import ExplanatoryFactors from "@/components/analytics/explanatory-factors"
import Visualizations from "@/components/analytics/visualizations"
import { Lock, RefreshCw, RotateCcw, Package, Store, TrendingUp, Printer } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import BlocTemplate from "@/components/ui/bloc-template"
import { canAccessAnalytics } from "@/lib/plan-restrictions"
import { printCurrentPage } from "@/lib/export-utils"
import { AnalyticsSkeleton } from "@/components/skeleton-loader"

interface AnalyticsData {
  positionnement: {
    position: 'lowest' | 'average' | 'above'
    ecartPourcentage: number
    ecartValeur: number
    classement: number
    totalDetailleurs: number
    message: string
  }
  produits: Array<{
    name: string
    prix: number
    prixMoyenMarche: number
    prixMinMarche: number
    ecartPourcentage: number
    ecartPourcentageMin: number
    competitif: boolean
    hasCompetitor: boolean
    categorie: string
    sourceSite?: string
    disponibilite?: string
    etat?: string
    inventaire?: string
  }>
  evolutionPrix: Array<{
    date: string
    prixReference: number
    prixMoyenMarche: number
    prixConcurrents: Record<string, number>
  }>
  opportunites: Array<{
    type: 'augmentation' | 'baisse' | 'marge'
    produit: string
    recommandation: string
    impactPotentiel: number
    categorie?: string
  }>
  detailleurs: Array<{
    site: string
    prixMoyen: number
    agressivite: number
    frequencePromotions: number
    nombreProduits: number
    produitsComparables: number
    isReference: boolean
    categorieStats: Array<{
      categorie: string
      prixMoyen: number
      agressivite: number
      nombreProduits: number
    }>
  }>
  categories: Array<{
    categorie: string
    nombreProduits: number
    prixMoyenReference: number
    prixMoyenConcurrents: number
    ecartMoyenPourcentage: number
    competitifs: number
    nonCompetitifs: number
    detailParDetaillant: Array<{
      site: string
      prixMoyen: number
      ecartPourcentage: number
      nombreProduits: number
    }>
  }>
  alertes: Array<{
    type: 'concurrent' | 'ecart' | 'nouveau'
    message: string
    severite: 'low' | 'medium' | 'high'
    date: string
  }>
  stats: {
    prixMoyen: number
    heuresEconomisees: number
    nombreScrapes: number
    scrapesParJour: Array<{ date: string; count: number }>
  }
}

export default function AnalyticsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { t, locale } = useLanguage()
  const router = useRouter()
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [dataAsOf, setDataAsOf] = useState<Date | null>(null)

  const getEmptyAnalytics = (): AnalyticsData => ({
    positionnement: {
      position: 'average',
      ecartPourcentage: 0,
      ecartValeur: 0,
      classement: 0,
      totalDetailleurs: 0,
      message: t("analytics.noData")
    },
    produits: [],
    evolutionPrix: [],
    opportunites: [],
    detailleurs: [],
    categories: [],
    alertes: [],
    stats: {
      prixMoyen: 0,
      heuresEconomisees: 0,
      nombreScrapes: 0,
      scrapesParJour: []
    }
  })

  const effectiveSource = user?.subscription_source || (user?.promo_code_id ? 'promo' : null)
  const hasAccess = canAccessAnalytics(user?.subscription_plan ?? "standard", effectiveSource)

  const loadAnalytics = useCallback(async (isRefresh = false) => {
    try {
      setError(null)
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      const response = await fetch('/api/analytics')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || t("analytics.loadError"))
      }

      if (data.analytics) {
        setAnalytics(data.analytics)
      } else {
        setAnalytics(getEmptyAnalytics())
      }
      setDataAsOf(data?.data_as_of ? new Date(data.data_as_of) : null)
      setLastUpdated(new Date())
    } catch (err: unknown) {
      console.error('Error loading analytics:', err)
      const message = err instanceof Error ? err.message : t("analytics.loadError")
      setError(message)
      setAnalytics(getEmptyAnalytics())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const handleReset = useCallback(async () => {
    if (!confirm(t("analytics.resetConfirm"))) {
      return
    }

    try {
      setRefreshing(true)
      const response = await fetch('/api/analytics/reset', {
        method: 'POST'
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || t("analytics.resetError"))
        return
      }

      setAnalytics(getEmptyAnalytics())
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Error resetting analytics:', err)
      alert(t("analytics.resetError"))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && user && !hasAccess) {
      router.replace("/dashboard?restricted=analytics")
    }
  }, [authLoading, user, hasAccess, router])

  useEffect(() => {
    if (hasAccess) {
      loadAnalytics(false)
    }
  }, [loadAnalytics, hasAccess])

  const displayAnalytics = analytics || getEmptyAnalytics()

  if (authLoading || loading) {
    return (
      <Layout>
        <AnalyticsSkeleton />
      </Layout>
    )
  }

  if (user && !hasAccess) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Lock className="h-12 w-12 text-amber-500" />
          <p className="text-lg font-medium text-gray-900 dark:text-white">{t("analytics.accessDenied")}</p>
          <p className="text-sm text-gray-500 dark:text-[#B0B0B0]">{t("analytics.redirecting")}</p>
        </div>
      </Layout>
    )
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale === 'en' ? 'en-CA' : 'fr-CA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  const totalProducts = displayAnalytics.produits.length
  const competitifCount = displayAnalytics.produits.filter(p => p.competitif && p.hasCompetitor).length
  const nonCompetitifCount = displayAnalytics.produits.filter(p => !p.competitif && p.hasCompetitor).length
  const comparableCount = competitifCount + nonCompetitifCount
  const competitifRatio = comparableCount > 0 ? (competitifCount / comparableCount) * 100 : 0
  const isEmpty = displayAnalytics.stats.nombreScrapes === 0 && totalProducts === 0

  const kpis = [
    { label: t("analytics.productsAnalyzed"), value: totalProducts, icon: Package, dot: "bg-emerald-500" },
    { label: t("analytics.retailers"), value: displayAnalytics.detailleurs.length, icon: Store, dot: "bg-sky-500" },
    { label: t("analytics.opportunities"), value: displayAnalytics.opportunites.length, icon: TrendingUp, dot: "bg-amber-500" },
    { label: t("analytics.scrapes"), value: displayAnalytics.stats.nombreScrapes, icon: RefreshCw, dot: "bg-violet-500" },
  ]

  return (
    <Layout>
      <div id="analytics-print-area" className="space-y-5">
        {/* ── Page header ── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)] mb-1">
              {t("analytics.overline")}
            </p>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] leading-tight">
              {t("analytics.title")}
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              {t("analytics.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => printCurrentPage(t("analytics.title"))}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
              title={t("analytics.printAction")}
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("analytics.printAction")}</span>
            </button>
            <button
              onClick={() => loadAnalytics(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{t("analytics.refreshAction")}</span>
            </button>
            <button
              onClick={handleReset}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-600/80 dark:text-red-400/80 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("analytics.resetAction")}</span>
            </button>
          </div>
        </div>

        {/* ── KPI strip ── */}
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
                    {k.value.toLocaleString(locale === 'en' ? 'en-CA' : 'fr-CA')}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Competitive ratio bar */}
          {comparableCount > 0 && (
            <div className="border-t border-[var(--color-border-tertiary)] px-5 py-3.5 flex items-center gap-4">
              <div className="flex items-center gap-6 text-xs font-medium">
                <span className="flex items-center gap-1.5 text-[#27500A] dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="tabular-nums font-bold">{competitifCount}</span>
                  <span className="text-[var(--color-text-secondary)] font-normal">{t("analytics.competitive")}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[#791F1F] dark:text-red-400">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  <span className="tabular-nums font-bold">{nonCompetitifCount}</span>
                  <span className="text-[var(--color-text-secondary)] font-normal">{t("analytics.aboveMarket")}</span>
                </span>
              </div>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--color-background-secondary)] overflow-hidden max-w-xs ml-auto">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all"
                  style={{ width: `${competitifRatio}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-[var(--color-text-primary)] tabular-nums min-w-[3rem] text-right">
                {competitifRatio.toFixed(0)}%
              </span>
            </div>
          )}

          {/* Data freshness footer */}
          <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]/40 px-5 py-2.5 flex items-center justify-between gap-4 text-[11px] text-[var(--color-text-secondary)]">
            <span className="tabular-nums">
              {t("analytics.data")} <span className="font-medium text-[var(--color-text-primary)]">{dataAsOf ? formatDate(dataAsOf) : t("analytics.na")}</span>
            </span>
            <span className="tabular-nums">
              {t("analytics.updated")} <span className="font-medium text-[var(--color-text-primary)]">{lastUpdated ? formatDate(lastUpdated) : formatDate(new Date())}</span>
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200/60 dark:border-red-900/40 bg-red-50/80 dark:bg-red-950/20 px-4 py-3">
            <p className="text-red-700 dark:text-red-300 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-10 text-center">
            <div className="max-w-md mx-auto">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 flex items-center justify-center mb-5">
                <Package className="h-7 w-7 text-emerald-500 dark:text-emerald-400" />
              </div>
              <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">{t("analytics.noData")}</h3>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {t("analytics.noDataDesc")}
              </p>
            </div>
          </div>
        )}

        {/* ── Analysis sections ── */}
        {!isEmpty && (
          <div className="space-y-8">
            <AnalyticsSection
              caption={t("analytics.section.positioning")}
              description={t("analytics.section.positioningDesc")}
            >
              <BlocTemplate className="hover-elevate">
                <PricePositioningCard positionnement={displayAnalytics.positionnement} />
              </BlocTemplate>
            </AnalyticsSection>

            <AnalyticsSection
              caption={t("analytics.section.products")}
              description={t("analytics.section.productsDesc")}
            >
              <BlocTemplate className="hover-elevate">
                <ProductCategoryAnalysis produits={displayAnalytics.produits} />
              </BlocTemplate>
              <BlocTemplate className="hover-elevate">
                <CategoryAnalysis categories={displayAnalytics.categories} />
              </BlocTemplate>
              <BlocTemplate className="hover-elevate">
                <ExplanatoryFactors produits={displayAnalytics.produits} />
              </BlocTemplate>
            </AnalyticsSection>

            <AnalyticsSection
              caption={t("analytics.section.market")}
              description={t("analytics.section.marketDesc")}
            >
              <BlocTemplate className="hover-elevate">
                <PriceEvolutionChart
                  evolutionPrix={displayAnalytics.evolutionPrix}
                  scrapesParJour={displayAnalytics.stats.scrapesParJour}
                />
              </BlocTemplate>
              <BlocTemplate className="hover-elevate">
                <RetailerAnalysis detailleurs={displayAnalytics.detailleurs} />
              </BlocTemplate>
            </AnalyticsSection>

            <AnalyticsSection
              caption={t("analytics.section.actions")}
              description={t("analytics.section.actionsDesc")}
            >
              <BlocTemplate className="hover-elevate">
                <OpportunitiesDetection opportunites={displayAnalytics.opportunites} />
              </BlocTemplate>
              <BlocTemplate className="hover-elevate">
                <AlertsAndInsights alertes={displayAnalytics.alertes} stats={displayAnalytics.stats} />
              </BlocTemplate>
            </AnalyticsSection>

            <AnalyticsSection
              caption={t("analytics.section.visualizations")}
              description={t("analytics.section.visualizationsDesc")}
            >
              <BlocTemplate className="hover-elevate">
                <Visualizations
                  produits={displayAnalytics.produits}
                  detailleurs={displayAnalytics.detailleurs}
                />
              </BlocTemplate>
            </AnalyticsSection>
          </div>
        )}
      </div>
    </Layout>
  )
}

interface AnalyticsSectionProps {
  caption: string
  description?: string
  children: React.ReactNode
}

function AnalyticsSection({ caption, description, children }: AnalyticsSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 px-1">
        <div className="h-px flex-shrink-0 w-6 bg-[var(--color-border-tertiary)]" />
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            {caption}
          </p>
          {description && (
            <p className="text-xs text-[var(--color-text-secondary)]/70 mt-0.5">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </section>
  )
}
