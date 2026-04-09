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
import { Lock, RefreshCw, RotateCcw, Calendar, Package, Store, TrendingUp, Printer } from "lucide-react"
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

  // Fonction pour obtenir des analytics vides
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

  // Vérifier l'accès : Analytics réservé aux plans Pro et Ultime
  // Fallback : si subscription_source est null mais promo_code_id est défini → promo
  const effectiveSource = user?.subscription_source || (user?.promo_code_id ? 'promo' : null)
  const hasAccess = canAccessAnalytics(user?.subscription_plan ?? "standard", effectiveSource)

  // Fonction de chargement des analytics
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

  // Fonction de réinitialisation (efface les données de la page Analyse)
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

      // Mettre à jour l'interface avec des données vides
      setAnalytics(getEmptyAnalytics())
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Error resetting analytics:', err)
      alert(t("analytics.resetError"))
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Rediriger les utilisateurs sans accès (plan Gratuit)
  useEffect(() => {
    if (!authLoading && user && !hasAccess) {
      router.replace("/dashboard?restricted=analytics")
    }
  }, [authLoading, user, hasAccess, router])

  // Charger les analytics au montage (seulement si accès)
  useEffect(() => {
    if (hasAccess) {
      loadAnalytics(false)
    }
  }, [loadAnalytics, hasAccess])

  // Si pas d'analytics, utiliser des données vides
  const displayAnalytics = analytics || getEmptyAnalytics()

  if (authLoading || loading) {
    return (
      <Layout>
        <AnalyticsSkeleton />
      </Layout>
    )
  }

  // Accès réservé aux plans Pro et Ultime : redirection
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

  // Formatage de la date
  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale === 'en' ? 'en-CA' : 'fr-CA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  const competitifCount = displayAnalytics.produits.filter(p => p.competitif && p.hasCompetitor).length
  const nonCompetitifCount = displayAnalytics.produits.filter(p => !p.competitif && p.hasCompetitor).length

  return (
    <Layout>
      <div id="analytics-print-area" className="space-y-4">
        {/* ── KPI Hero + Secondary ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Hero — Produits analysés */}
          <div className="col-span-2 md:col-span-1 relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br from-emerald-600 to-teal-600 dark:from-emerald-600 dark:to-teal-700 shadow-lg shadow-emerald-600/10 dark:shadow-emerald-900/20">
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10" />
            <div className="relative flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200/70 mb-1.5">{t("analytics.productsAnalyzed")}</p>
                <p className="text-4xl font-black text-white tabular-nums leading-none tracking-tight">{displayAnalytics.produits.length}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-white/15">
                <Package className="h-5 w-5 text-white/80" />
              </div>
            </div>
          </div>

          {/* Secondary KPIs */}
          {[
            { label: t("analytics.retailers"), value: displayAnalytics.detailleurs.length, icon: Store, accent: "text-emerald-500 dark:text-emerald-400", dot: "bg-emerald-400" },
            { label: t("analytics.opportunities"), value: displayAnalytics.opportunites.length, icon: TrendingUp, accent: "text-amber-500 dark:text-amber-400", dot: "bg-amber-400" },
            { label: t("analytics.scrapes"), value: displayAnalytics.stats.nombreScrapes, icon: RefreshCw, accent: "text-emerald-500 dark:text-emerald-400", dot: "bg-emerald-400" },
          ].map((s, i) => {
            const Icon = s.icon
            return (
              <div key={i} className="rounded-2xl border border-gray-200 dark:border-[#3A3A3A] bg-white dark:bg-[#222222] backdrop-blur-sm p-5 flex flex-col justify-between group hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    <p className="text-xs font-medium text-gray-500 dark:text-[#B0B0B0] tracking-wide">{s.label}</p>
                  </div>
                  <Icon className={`h-3.5 w-3.5 ${s.accent} opacity-50`} />
                </div>
                <p className="text-3xl font-extrabold text-gray-900 dark:text-white leading-none tabular-nums tracking-tight">{s.value}</p>
              </div>
            )
          })}
        </div>

        {/* ── Semantic mini-stats — Competitive vs Non-competitive ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-[#3B6D11]/20 dark:border-[#3B6D11]/30 bg-[#EAF3DE] dark:bg-[#3B6D11]/15 px-4 py-3 flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-[#3B6D11]" />
            <p className="text-xs font-medium text-[#27500A] dark:text-[#3B6D11]"><span className="tabular-nums font-bold text-sm">{competitifCount}</span> {t("analytics.competitive")}</p>
          </div>
          <div className="rounded-xl border border-[#A32D2D]/20 dark:border-[#A32D2D]/30 bg-[#FCEBEB] dark:bg-[#A32D2D]/15 px-4 py-3 flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-[#A32D2D]" />
            <p className="text-xs font-medium text-[#791F1F] dark:text-[#A32D2D]"><span className="tabular-nums font-bold text-sm">{nonCompetitifCount}</span> {t("analytics.aboveMarket")}</p>
          </div>
        </div>

        {/* ── Actions toolbar ── */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-gray-50 dark:bg-[#2A2A2A] px-4 py-2.5">
          <button
            onClick={() => printCurrentPage(t("analytics.title"))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-sky-500/30 bg-sky-500/10 text-xs font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 hover:border-sky-500/50 transition"
            title={t("analytics.printAction")}
          >
            <Printer className="h-3.5 w-3.5" />
            {t("analytics.printAction")}
          </button>
          <button
            onClick={() => loadAnalytics(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t("analytics.refreshAction")}
          </button>
          <button
            onClick={handleReset}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("analytics.resetAction")}
          </button>
          <div className="w-px h-5 bg-gray-100 dark:bg-[#2E2E2E] mx-1" />
          <div className="flex items-center gap-1.5 text-[11px] font-normal text-gray-400 dark:text-[#707070]">
            <Calendar className="h-3 w-3" />
            <span className="tabular-nums">{t("analytics.data")} {dataAsOf ? formatDate(dataAsOf) : t("analytics.na")} | {t("analytics.updated")} {lastUpdated ? formatDate(lastUpdated) : formatDate(new Date())}</span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200/60 dark:border-red-900/40 bg-red-50/80 dark:bg-red-950/20 px-4 py-3">
            <p className="text-red-700 dark:text-red-300 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {displayAnalytics.stats.nombreScrapes === 0 && displayAnalytics.produits.length === 0 && (
          <div className="rounded-2xl border border-gray-200 dark:border-[#3A3A3A] bg-white dark:bg-[#222222] backdrop-blur-sm p-10 text-center">
            <div className="max-w-md mx-auto">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 flex items-center justify-center mb-5">
                <Package className="h-7 w-7 text-emerald-500 dark:text-emerald-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t("analytics.noData")}</h3>
              <p className="text-sm text-gray-500 dark:text-[#B0B0B0] leading-relaxed">
                {t("analytics.noDataDesc")}
              </p>
            </div>
          </div>
        )}

        {/* ── Analysis sections — elevated cards ── */}
        <div className="space-y-4">
          <BlocTemplate className="hover-elevate">
            <PricePositioningCard positionnement={displayAnalytics.positionnement} />
          </BlocTemplate>

          <BlocTemplate className="hover-elevate">
            <ProductCategoryAnalysis produits={displayAnalytics.produits} />
          </BlocTemplate>

          <BlocTemplate className="hover-elevate">
            <PriceEvolutionChart
              evolutionPrix={displayAnalytics.evolutionPrix}
              scrapesParJour={displayAnalytics.stats.scrapesParJour}
            />
          </BlocTemplate>

          <BlocTemplate className="hover-elevate">
            <OpportunitiesDetection opportunites={displayAnalytics.opportunites} />
          </BlocTemplate>

          <BlocTemplate className="hover-elevate">
            <RetailerAnalysis detailleurs={displayAnalytics.detailleurs} />
          </BlocTemplate>

          <BlocTemplate className="hover-elevate">
            <CategoryAnalysis categories={displayAnalytics.categories} />
          </BlocTemplate>

          <BlocTemplate className="hover-elevate">
            <AlertsAndInsights alertes={displayAnalytics.alertes} stats={displayAnalytics.stats} />
          </BlocTemplate>

          <BlocTemplate className="hover-elevate">
            <ExplanatoryFactors produits={displayAnalytics.produits} />
          </BlocTemplate>

          <BlocTemplate className="hover-elevate">
            <Visualizations
              produits={displayAnalytics.produits}
              detailleurs={displayAnalytics.detailleurs}
            />
          </BlocTemplate>
        </div>
      </div>
    </Layout>
  )
}

