"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import PricePositioningCard from "@/components/analytics/price-positioning"
import ProductCategoryAnalysis from "@/components/analytics/product-analysis"
import PriceEvolutionChart from "@/components/analytics/price-evolution"
import OpportunitiesDetection from "@/components/analytics/opportunities"
import RetailerAnalysis from "@/components/analytics/retailer-analysis"
import AlertsAndInsights from "@/components/analytics/alerts-insights"
import ExplanatoryFactors from "@/components/analytics/explanatory-factors"
import ActionableRecommendations from "@/components/analytics/recommendations"
import Visualizations from "@/components/analytics/visualizations"
import LimitWarning from "@/components/limit-warning"
import { Loader2, Lock } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import BlocTemplate from "@/components/ui/bloc-template"

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
    categorie: string
    sourceSite?: string
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
  }>
  detailleurs: Array<{
    site: string
    prixMoyen: number
    agressivite: number
    frequencePromotions: number
    nombreProduits: number
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
  const { user, isLoading: authLoading, isMainAccount } = useAuth()
  const router = useRouter()
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    alertes: [],
    stats: {
      prixMoyen: 0,
      heuresEconomisees: 0,
      nombreScrapes: 0,
      scrapesParJour: []
    }
  })

  // Vérifier l'accès
  const hasAccess = user && user.subscription_plan && user.subscription_plan !== 'free'

  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/analytics')
        
        // L'API retourne toujours analytics (même vide), donc pas besoin de vérifier response.ok
        const data = await response.json()
        
        if (data.analytics) {
          setAnalytics(data.analytics)
        } else {
          // Fallback si analytics est null
          setAnalytics(getEmptyAnalytics())
        }
      } catch (err: any) {
        // En cas d'erreur, afficher la page avec des données vides
        console.error('Error loading analytics:', err)
        setAnalytics(getEmptyAnalytics())
      } finally {
        setLoading(false)
      }
    }

    // Charger immédiatement au montage, sans attendre authLoading
    loadAnalytics()
  }, [])

  // Si pas d'analytics, utiliser des données vides
  const displayAnalytics = analytics || getEmptyAnalytics()

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
            <p className="text-gray-600 dark:text-gray-400">Chargement des analytics...</p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight mb-8">
          Analyse de Prix
        </h1>

        {/* Afficher le message de restriction si pas d'accès */}
        {!hasAccess && (
          <div className="mb-6">
            <LimitWarning
              type="analytics"
              current={0}
              limit={0}
              plan={user?.subscription_plan || null}
              isAuthenticated={!!user}
            />
          </div>
        )}

        {/* Toujours afficher les composants analytics, même sans accès */}
        {displayAnalytics.stats.nombreScrapes === 0 && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded-lg">
            <p className="text-blue-800 dark:text-blue-300 text-sm">
              ℹ️ Aucune donnée de scraping disponible. Effectuez votre premier scraping pour voir les analytics.
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

