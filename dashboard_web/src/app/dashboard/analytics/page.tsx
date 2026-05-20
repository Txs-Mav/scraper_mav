"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import SurveillanceBackground from "@/components/kokonutui/surveillance-background"
import PricePositioningCard from "@/components/analytics/price-positioning"
import ProductCategoryAnalysis from "@/components/analytics/product-analysis"
import PriceEvolutionChart from "@/components/analytics/price-evolution"
import OpportunitiesDetection from "@/components/analytics/opportunities"
import RetailerAnalysis from "@/components/analytics/retailer-analysis"
import CategoryAnalysis from "@/components/analytics/category-analysis"
import AlertsAndInsights from "@/components/analytics/alerts-insights"
import ExplanatoryFactors from "@/components/analytics/explanatory-factors"
import Visualizations from "@/components/analytics/visualizations"
import RetailerPriceTrends from "@/components/analytics/retailer-price-trends"
import { Lock, RefreshCw, RotateCcw, Printer } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
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
        method: 'POST',
      })
      const data: {
        error?: string
        details?: string
        hint?: string
        deleted?: number
        partial?: number
      } = await response.json().catch(() => ({}))

      if (!response.ok) {
        console.error('Error resetting analytics:', {
          status: response.status,
          statusText: response.statusText,
          ...data,
        })

        const isTimeout =
          response.status === 504 ||
          response.status === 408 ||
          response.status === 524
        const message = isTimeout
          ? "La suppression a pris trop de temps. Vous avez beaucoup de données accumulées — réessayez, l'opération se poursuivra par lots successifs."
          : data.error || t("analytics.resetError")
        const detail = data.details || data.hint || ''
        alert(detail ? `${message}\n\n${detail}` : message)
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
          <p className="text-lg font-medium text-[var(--color-text-primary)]">{t("analytics.accessDenied")}</p>
          <p className="text-sm text-[var(--color-text-secondary)]">{t("analytics.redirecting")}</p>
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

  const updatedAgoLabel = (() => {
    if (!lastUpdated) return null
    const diffMs = Date.now() - lastUpdated.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return t("analytics.updatedJustNow")
    if (diffMin < 60) return t("analytics.updatedMinAgo").replace("{n}", String(diffMin))
    const diffH = Math.floor(diffMin / 60)
    return t("analytics.updatedHAgo").replace("{n}", String(diffH))
  })()

  const lc = locale === 'en' ? 'en-CA' : 'fr-CA'

  // KPIs principaux affichés en grille — chiffres XL.
  const headerKpis = [
    {
      label: t("analytics.productsAnalyzed"),
      value: totalProducts.toLocaleString(lc),
    },
    {
      label: t("analytics.retailers"),
      value: displayAnalytics.detailleurs.length.toLocaleString(lc),
    },
    {
      label: t("analytics.opportunities"),
      value: displayAnalytics.opportunites.length.toLocaleString(lc),
    },
    {
      label: t("analytics.scrapes"),
      value: displayAnalytics.stats.nombreScrapes.toLocaleString(lc),
    },
  ]

  // Anneau de progression pour le ratio compétitif (SVG vectoriel pur).
  const ringSize = 64
  const ringStroke = 6
  const ringRadius = (ringSize - ringStroke) / 2
  const ringCircumference = 2 * Math.PI * ringRadius
  const ringOffset = ringCircumference * (1 - competitifRatio / 100)

  return (
    <Layout>
      <SurveillanceBackground />
      <div id="analytics-print-area" className="space-y-4 relative">
        {/* ── Header unifié (style Surveillance) ── */}
        <header className="rounded-2xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/35 px-5 py-4 shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-5 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="font-medium uppercase tracking-wider">
                  {t("analytics.title")}
                </span>
                {updatedAgoLabel && (
                  <span className="tabular-nums opacity-70">· {updatedAgoLabel}</span>
                )}
                {dataAsOf && (
                  <span className="tabular-nums opacity-60">· {formatDate(dataAsOf)}</span>
                )}
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
                <button
                  onClick={() => loadAnalytics(true)}
                  disabled={refreshing}
                  className="inline-flex items-center justify-center gap-1.5 px-3 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{t("analytics.refreshAction")}</span>
                </button>
                <button
                  onClick={handleReset}
                  disabled={refreshing || loading}
                  className="inline-flex items-center justify-center gap-1.5 px-3 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("analytics.resetAction")}</span>
                </button>
              </div>
            </div>
          </div>

          {/* ── KPI strip : 4 chiffres XL + anneau ratio compétitif ── */}
          <div className="mt-5 grid grid-cols-2 md:grid-cols-[repeat(4,1fr)_auto] gap-x-5 gap-y-4 items-end">
            {headerKpis.map((k, i) => (
              <div
                key={i}
                className={i > 0 ? 'md:pl-5 md:border-l border-[var(--color-border-tertiary)]/40' : ''}
              >
                <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
                  {k.label}
                </p>
                <p className="text-[1.85rem] md:text-3xl font-extrabold tabular-nums leading-none mt-1.5 text-[var(--color-text-primary)] tracking-tight">
                  {k.value}
                </p>
              </div>
            ))}

            {/* Anneau compétitif */}
            {comparableCount > 0 && (
              <div className="md:pl-5 md:border-l border-[var(--color-border-tertiary)]/40 flex items-center gap-3 col-span-2 md:col-span-1">
                <div className="relative shrink-0" style={{ width: ringSize, height: ringSize }}>
                  <svg width={ringSize} height={ringSize} className="rotate-[-90deg]">
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      stroke="currentColor"
                      strokeOpacity="0.15"
                      strokeWidth={ringStroke}
                      fill="none"
                    />
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      stroke="currentColor"
                      strokeWidth={ringStroke}
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
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
                    <span className="opacity-60"> produits</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/35 backdrop-blur-md px-4 py-3">
            <p className="text-[var(--color-text-primary)] text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/35 backdrop-blur-md p-10 text-center">
            <div className="max-w-md mx-auto">
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{t("analytics.noData")}</h3>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {t("analytics.noDataDesc")}
              </p>
            </div>
          </div>
        )}

        {/* ── Analysis sections ── */}
        {!isEmpty && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1">
                <PricePositioningCard positionnement={displayAnalytics.positionnement} />
              </div>
              <div className="lg:col-span-2">
                <PriceEvolutionChart
                  evolutionPrix={displayAnalytics.evolutionPrix}
                  scrapesParJour={displayAnalytics.stats.scrapesParJour}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <OpportunitiesDetection opportunites={displayAnalytics.opportunites} />
              <AlertsAndInsights alertes={displayAnalytics.alertes} stats={displayAnalytics.stats} />
            </div>

            <RetailerPriceTrends evolutionPrix={displayAnalytics.evolutionPrix} />

            <ExplanatoryFactors produits={displayAnalytics.produits} />

            <ProductCategoryAnalysis produits={displayAnalytics.produits} />

            <CategoryAnalysis categories={displayAnalytics.categories} />

            <RetailerAnalysis detailleurs={displayAnalytics.detailleurs} />

            <Visualizations
              produits={displayAnalytics.produits}
              detailleurs={displayAnalytics.detailleurs}
            />
          </div>
        )}
      </div>
    </Layout>
  )
}
