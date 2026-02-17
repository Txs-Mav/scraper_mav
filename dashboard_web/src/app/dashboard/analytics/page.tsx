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
import ActionableRecommendations from "@/components/analytics/recommendations"
import Visualizations from "@/components/analytics/visualizations"
import { Loader2, Lock, RefreshCw, RotateCcw, Calendar, Package, Store, TrendingUp, Printer } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import BlocTemplate from "@/components/ui/bloc-template"
import { canAccessAnalytics } from "@/lib/plan-restrictions"
import { printCurrentPage } from "@/lib/export-utils"

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
    ecartPourcentage: number
    competitif: boolean
    hasCompetitor: boolean
    categorie: string
    sourceSite?: string
    disponibilite?: string
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
      message: 'Aucune donnée disponible'
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
        throw new Error(data?.error || "Impossible de charger les analyses")
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
      const message = err instanceof Error ? err.message : "Erreur lors du chargement des analyses"
      setError(message)
      setAnalytics(getEmptyAnalytics())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Fonction de réinitialisation (efface les données de la page Analyse)
  const handleReset = useCallback(async () => {
    if (!confirm('Effacer les données de la page Analyse ? Cette action est irréversible.')) {
      return
    }

    try {
      setRefreshing(true)
      const response = await fetch('/api/analytics/reset', {
        method: 'POST'
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Erreur lors de la réinitialisation')
        return
      }

      // Mettre à jour l'interface avec des données vides
      setAnalytics(getEmptyAnalytics())
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Error resetting analytics:', err)
      alert('Erreur lors de la réinitialisation')
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
        <div className="flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
            <p className="text-gray-600 dark:text-gray-400">Chargement des analyses...</p>
          </div>
        </div>
      </Layout>
    )
  }

  // Accès réservé aux plans Pro et Ultime : redirection
  if (user && !hasAccess) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Lock className="h-12 w-12 text-amber-500" />
          <p className="text-lg font-medium text-gray-900 dark:text-white">Accès réservé aux plans Pro et Ultime</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Redirection vers le dashboard...</p>
        </div>
      </Layout>
    )
  }

  // Formatage de la date
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('fr-CA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  return (
    <Layout>
      <div id="analytics-print-area" className="container mx-auto px-4 py-8">
        {/* Header avec titre et actions */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight">
            Analyse de Prix
          </h1>

          <div className="flex items-center gap-3">
            <button
              onClick={() => printCurrentPage("Analyse de Prix")}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#1F1F23] border border-gray-200 dark:border-[#2B2B30] rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#2B2B30] transition-colors"
              title="Imprimer la page d'analyse"
            >
              <Printer className="h-4 w-4" />
              <span>Imprimer</span>
            </button>
            <button
              onClick={() => loadAnalytics(true)}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#1F1F23] border border-gray-200 dark:border-[#2B2B30] rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#2B2B30] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Actualiser</span>
            </button>
            <button
              onClick={handleReset}
              disabled={refreshing || loading}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#1F1F23] border border-gray-200 dark:border-[#2B2B30] rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#2B2B30] transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Réinitialiser</span>
            </button>
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-[#1F1F23] rounded-xl text-gray-600 dark:text-gray-400 text-sm">
              <Calendar className="h-4 w-4" />
              <span>
                Données: {dataAsOf ? formatDate(dataAsOf) : "n/a"} | MAJ: {lastUpdated ? formatDate(lastUpdated) : formatDate(new Date())}
              </span>
            </div>
          </div>
        </div>

        {/* Cartes de statistiques résumées */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-[#0F0F12] rounded-2xl border border-gray-200 dark:border-[#1F1F23] p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20">
              <Package className="h-6 w-6 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Produits analysés</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {displayAnalytics.produits.length}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0F0F12] rounded-2xl border border-gray-200 dark:border-[#1F1F23] p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
              <Store className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Détaillants</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {displayAnalytics.detailleurs.length}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0F0F12] rounded-2xl border border-gray-200 dark:border-[#1F1F23] p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20">
              <TrendingUp className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Opportunités</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {displayAnalytics.opportunites.length}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0F0F12] rounded-2xl border border-gray-200 dark:border-[#1F1F23] p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20">
              <RefreshCw className="h-6 w-6 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Scrapes totaux</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {displayAnalytics.stats.nombreScrapes}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg">
            <p className="text-red-800 dark:text-red-300 text-sm">
              {error}
            </p>
          </div>
        )}

        {/* Message si aucune donnée */}
        {displayAnalytics.stats.nombreScrapes === 0 && displayAnalytics.produits.length === 0 && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded-lg">
            <p className="text-blue-800 dark:text-blue-300 text-sm">
              ℹ️ Aucune donnée de scraping disponible. Effectuez votre premier scraping pour voir les analyses.
            </p>
          </div>
        )}

        <div className="space-y-6">
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
            <ActionableRecommendations opportunites={displayAnalytics.opportunites} />
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

