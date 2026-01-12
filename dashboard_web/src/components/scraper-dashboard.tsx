"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { Search, X, ArrowRightLeft, Star, Globe, Sparkles, Inbox, Trash2, Clock3, Wand2, Eye, RefreshCw } from "lucide-react"
import Image from "next/image"
import ScraperConfig, { ScraperConfigHandle } from "./scraper-config"
import AIAgent from "./ai-agent"
import { useAuth } from "@/contexts/auth-context"
import { getLocalScrapingsCount, migrateLocalScrapingsToSupabase } from "@/lib/local-storage"
import LimitWarning from "./limit-warning"
import { useScrapingLimit } from "@/hooks/use-scraping-limit"
import BlocTemplate from "./ui/bloc-template"
import PriceComparisonTable from "./price-comparison-table"

interface Product {
  name: string
  description?: string
  category: string
  marque: string
  modele: string
  prix: number
  disponibilite: string
  image?: string
  annee?: number
  kilometrage?: number
  cylindree?: string
  sourceUrl?: string
  sourceSite?: string
  sourceCategorie?: string
  attributes?: Record<string, any>
  prixReference?: number | null
  differencePrix?: number | null
  siteReference?: string
}

interface ScraperDashboardProps {
  initialData?: { products: Product[] }
}

const categoryLabels: Record<string, string> = {
  moto: "Moto",
  motoneige: "Motoneige",
  motocross: "Motocross",
  scooter: "Scooter",
  quad: "Quad",
  "side-by-side": "Side-by-Side",
  autre: "Autre"
}

const disponibiliteLabels: Record<string, string> = {
  en_stock: "En stock",
  sur_commande: "Sur commande",
  epuise: "Épuisé",
  non_disponible: "Non disponible"
}

export default function ScraperDashboard({ initialData }: ScraperDashboardProps) {
  const { user } = useAuth()
  const scrapingLimit = useScrapingLimit()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false)
  const [migrating, setMigrating] = useState(false)

  // Filtres et recherche
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [selectedMarque, setSelectedMarque] = useState<string>("all")
  const [selectedDisponibilite, setSelectedDisponibilite] = useState<string>("all")
  const [selectedSite, setSelectedSite] = useState<string>("all")
  const [selectedProduct, setSelectedProduct] = useState<string>("all")
  const [priceDifferenceFilter, setPriceDifferenceFilter] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<"prix" | "annee" | "name">("name")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeTab, setActiveTab] = useState<string>("compared")
  const [referenceSite, setReferenceSite] = useState<string | null>(null)
  const [cacheItems, setCacheItems] = useState<Product[]>([])
  const [cacheDisplay, setCacheDisplay] = useState<Product[]>([])
  const [showScraperConfig, setShowScraperConfig] = useState(false)
  const [showCacheModal, setShowCacheModal] = useState(false)
  const [mounted, setMounted] = useState(false)
  const scraperRef = useRef<ScraperConfigHandle | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Vérifier les scrapings locaux à migrer
  useEffect(() => {
    if (user) {
      const localCount = getLocalScrapingsCount()
      if (localCount > 0) {
        setShowMigrationPrompt(true)
      }
    }

    // Écouter l'événement de connexion
    const handleLocalScrapings = (event: CustomEvent) => {
      if (event.detail?.count > 0) {
        setShowMigrationPrompt(true)
      }
    }
    window.addEventListener('local-scrapings-available', handleLocalScrapings as EventListener)
    return () => window.removeEventListener('local-scrapings-available', handleLocalScrapings as EventListener)
  }, [user])

  // Charger les données
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        if (initialData) {
          setProducts(initialData.products || [])
          setLoading(false)
          return
        }

        const response = await fetch('/api/products')
        if (!response.ok) {
          throw new Error('Failed to load products')
        }
        const data = await response.json()
        setProducts(data.products || [])

        // Identifier le site de référence (premier produit avec siteReference)
        const refProduct = data.products?.find((p: Product) => p.siteReference)
        if (refProduct) {
          setReferenceSite(refProduct.siteReference)
        }
      } catch (err: any) {
        setError(err.message || 'Erreur lors du chargement des données')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [initialData, refreshKey])

  const handleMigrateScrapings = async () => {
    setMigrating(true)
    try {
      const result = await migrateLocalScrapingsToSupabase()
      if (result.success) {
        setShowMigrationPrompt(false)
        alert(`✅ ${result.migrated} scrapings migrés avec succès!`)
        setRefreshKey(prev => prev + 1) // Rafraîchir les données
      } else {
        alert(`⚠️ Migration partielle: ${result.migrated} migrés, ${result.errors.length} erreurs`)
      }
    } catch (error: any) {
      alert(`❌ Erreur lors de la migration: ${error.message}`)
    } finally {
      setMigrating(false)
    }
  }

  const handleScrapeComplete = () => {
    setRefreshKey(prev => prev + 1)
  }

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  // Extraire les valeurs uniques pour les filtres
  const uniqueCategories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean))
    return Array.from(cats).sort()
  }, [products])

  const uniqueMarques = useMemo(() => {
    const marques = new Set(products.map(p => p.marque).filter(Boolean))
    return Array.from(marques).sort()
  }, [products])

  const uniqueSites = useMemo(() => {
    const sites = new Set(products.map(p => p.sourceSite || p.siteReference).filter(Boolean))
    return Array.from(sites).sort()
  }, [products])

  const uniqueProductsNames = useMemo(() => {
    const names = new Set(products.map(p => p.name).filter(Boolean))
    return Array.from(names).sort()
  }, [products])

  const uniqueDisponibilites = useMemo(() => {
    const dispo = new Set(products.map(p => p.disponibilite).filter(Boolean))
    return Array.from(dispo).sort()
  }, [products])

  // Grouper les produits par site
  const productsBySite = useMemo(() => {
    const grouped: Record<string, Product[]> = {}
    const compared: Product[] = []
    const reference: Product[] = []
    const otherSites: Record<string, Product[]> = {}
    const allCompetitors: Product[] = [] // Tous les produits des concurrents

    products.forEach(product => {
      // Utiliser sourceSite ou siteReference pour identifier le site
      const site = product.sourceSite || product.siteReference || 'unknown'

      // Produits du site de référence
      // Le site de référence est celui qui a siteReference défini OU celui qui correspond à referenceSite
      const isReferenceProduct = product.siteReference && (
        !referenceSite ||
        site === referenceSite ||
        product.siteReference === referenceSite ||
        site === product.siteReference
      )

      // Produits comparés: doivent avoir prixReference défini
      // Cela signifie que le produit est présent dans la référence ET dans au moins un concurrent
      // - Pour les produits de référence: prixReference est défini seulement s'ils ont une correspondance avec un concurrent
      // - Pour les produits des concurrents: prixReference est défini seulement s'ils ont une correspondance avec la référence
      if (product.prixReference !== null && product.prixReference !== undefined) {
        compared.push(product)
      }

      if (isReferenceProduct) {
        reference.push(product)
      }

      // Produits des autres sites (pas de référence)
      if (!isReferenceProduct && site !== 'unknown') {
        if (!otherSites[site]) {
          otherSites[site] = []
        }
        otherSites[site].push(product)
        // Ajouter aussi à la liste de tous les concurrents
        allCompetitors.push(product)
      }

      // Grouper par site
      if (!grouped[site]) {
        grouped[site] = []
      }
      grouped[site].push(product)
    })

    return { compared, reference, otherSites, allCompetitors, grouped }
  }, [products, referenceSite])

  useEffect(() => {
    setCacheItems(productsBySite.reference)
  }, [productsBySite.reference])

  useEffect(() => {
    setCacheDisplay(cacheItems.slice(0, 2))
  }, [cacheItems])

  // Filtrer et trier les produits selon l'onglet actif
  const filteredProducts = useMemo(() => {
    let filtered: Product[] = []

    // Sélectionner les produits selon l'onglet actif
    if (activeTab === "compared") {
      filtered = [...productsBySite.compared]
    } else if (activeTab === "reference") {
      filtered = [...productsBySite.reference]
    } else if (activeTab === "allCompetitors") {
      filtered = [...productsBySite.allCompetitors]
    } else if (activeTab.startsWith("site-")) {
      const siteUrl = activeTab.replace("site-", "")
      filtered = productsBySite.grouped[siteUrl] || []
    } else {
      filtered = [...products]
    }

    // Recherche
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(p =>
        p.name?.toLowerCase().includes(query) ||
        p.marque?.toLowerCase().includes(query) ||
        p.modele?.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query)
      )
    }

    // Filtre site
    if (selectedSite !== "all") {
      filtered = filtered.filter(p => (p.sourceSite || p.siteReference) === selectedSite)
    }

    // Filtre marque
    if (selectedMarque !== "all") {
      filtered = filtered.filter(p => p.marque === selectedMarque)
    }

    // Filtre catégorie
    if (selectedCategory !== "all") {
      filtered = filtered.filter(p => p.category === selectedCategory)
    }

    // Filtre produit
    if (selectedProduct !== "all") {
      filtered = filtered.filter(p => p.name === selectedProduct)
    }

    // Filtre disponibilité (conservé pour compatibilité)
    if (selectedDisponibilite !== "all") {
      filtered = filtered.filter(p => p.disponibilite === selectedDisponibilite)
    }

    // Filtre différence de prix
    if (priceDifferenceFilter !== null) {
      filtered = filtered.filter(p => {
        if (p.differencePrix === null || p.differencePrix === undefined) {
          return false
        }
        return p.differencePrix >= priceDifferenceFilter
      })
    }

    // IMPORTANT: Pour l'onglet "Comparés", ne garder que les produits avec correspondance
    // Pour les autres onglets, afficher tous les produits du site
    if (activeTab === "compared") {
      filtered = filtered.filter(p => {
        return p.prixReference !== null && p.prixReference !== undefined
      })
    }

    // Tri
    filtered.sort((a, b) => {
      let aVal: any, bVal: any

      if (sortBy === "prix") {
        aVal = a.prix || 0
        bVal = b.prix || 0
      } else if (sortBy === "annee") {
        aVal = a.annee || 0
        bVal = b.annee || 0
      } else {
        aVal = a.name || ""
        bVal = b.name || ""
      }

      if (sortOrder === "asc") {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0
      }
    })

    return filtered
  }, [products, searchQuery, selectedCategory, selectedMarque, selectedDisponibilite, priceDifferenceFilter, sortBy, sortOrder, activeTab, productsBySite])

  const resetFilters = () => {
    setSearchQuery("")
    setSelectedCategory("all")
    setSelectedMarque("all")
    setSelectedDisponibilite("all")
    setPriceDifferenceFilter(null)
    setSortBy("prix")
    setSortOrder("asc")
  }

  const handleRemoveCacheItem = (index: number) => {
    setCacheItems(prev => prev.filter((_, i) => i !== index))
  }

  const handleClearCache = () => {
    setCacheItems([])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Chargement des données...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-red-800 dark:text-red-200">Erreur: {error}</p>
      </div>
    )
  }

  const competitorEntries = Object.entries(productsBySite.otherSites)
  const topCompetitors = competitorEntries.slice(0, 4)
  const cacheCount = cacheItems.length
  const cacheEmptyExamples = [
    {
      title: "Concession Nova Motors",
      accent: "from-blue-500/25 via-blue-500/10 to-blue-500/0",
      icon: Sparkles
    },
    {
      title: "Garage Altitude",
      accent: "from-amber-500/20 via-amber-500/8 to-amber-500/0",
      icon: Star
    }
  ]

  return (
    <div className="space-y-6">
      {/* Prompt de migration des scrapings locaux */}
      {showMigrationPrompt && user && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-1">Scrapings locaux détectés</h3>
              <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
                Vous avez {getLocalScrapingsCount()} scraping{getLocalScrapingsCount() > 1 ? "s" : ""} sauvegardé{getLocalScrapingsCount() > 1 ? "s" : ""} localement. Voulez-vous les migrer vers votre compte ?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleMigrateScrapings}
                  disabled={migrating}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {migrating ? "Migration..." : "Migrer maintenant"}
                </button>
                <button
                  onClick={() => setShowMigrationPrompt(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm"
                >
                  Plus tard
                </button>
              </div>
            </div>
            <button onClick={() => setShowMigrationPrompt(false)} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Avertissement de limite */}
      <LimitWarning
        type="scrapings"
        current={scrapingLimit.current}
        limit={scrapingLimit.limit}
        plan={user?.subscription_plan || null}
        isAuthenticated={!!user}
      />

      {/* Titre principal */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight">Dashboard</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] transition disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_10px_30px_-24px_rgba(0,0,0,0.35)]"
            title="Actualiser les produits"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" }).format(new Date())}
          </div>
        </div>
      </div>

      {/* Cartes stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Produits visibles", value: filteredProducts.length, sub: "Catalogue filtré", icon: Search, tone: "blue" },
          { label: "Site de référence", value: referenceSite || "Non défini", sub: "Point d’ancrage", icon: Star, tone: "amber" },
          { label: "Sites concurrents", value: Object.keys(productsBySite.otherSites).length, sub: "Sources actives", icon: Globe, tone: "purple" },
          { label: "Produits comparés", value: productsBySite.compared.length, sub: "Matchs trouvés", icon: ArrowRightLeft, tone: "emerald" },
        ].map((item, idx) => {
          const toneMap: Record<string, string> = {
            blue: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-200",
            amber: "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-200",
            purple: "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-200",
            emerald: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-200",
          }
          const Icon = item.icon
          return (
            <div key={idx} className="bg-white dark:bg-[#0F0F12] rounded-xl p-4 border border-gray-200 dark:border-[#1F1F23] flex items-start gap-3 hover-elevate">
              <div className={`p-2 rounded-lg ${toneMap[item.tone]}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-600 dark:text-gray-400">{item.label}</p>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white truncate">{item.value}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.sub}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Grille principale */}
      <div className="space-y-4">
        {/* Lancer un scraping – pleine largeur */}
        <BlocTemplate className="hover-elevate" innerClassName="bg-white/95 dark:bg-[#0F0F12] p-5 border border-gray-100 dark:border-white/5 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.45)]">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 dark:bg-[#1A1B20] px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-200">
                  <Sparkles className="h-4 w-4 text-purple-500 dark:text-purple-300" />
                  Scraper AI
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-900 dark:text-white">Lancer un scraping</h3>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <div className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 font-semibold shadow-[0_10px_30px_-24px_rgba(0,0,0,0.35)]">
                  {competitorEntries.length} sites concurrents
                </div>
                <button
                  type="button"
                  onClick={() => setShowScraperConfig(true)}
                  className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 font-semibold shadow-[0_10px_30px_-24px_rgba(0,0,0,0.35)] hover:bg-gray-50 dark:hover:bg-[#1a1b1f] transition"
                >
                  Configurer
                </button>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => scraperRef.current?.runScrape()}
                className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-700 hover:via-purple-700 hover:to-indigo-700 text-white rounded-xl font-semibold text-base shadow-[0_16px_40px_-24px_rgba(88,28,135,0.45)] hover:shadow-[0_18px_44px_-24px_rgba(88,28,135,0.55)] transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Lancer le scraping
              </button>
            </div>

          </div>
        </BlocTemplate>

        {/* Zone basse : Scraper en cache + Catalogue filtré côte à côte */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <BlocTemplate className="shadow-none bg-transparent hover-elevate" innerClassName="bg-gray-50/80 dark:bg-[#0F0F12] p-4 border border-gray-100 dark:border-white/5 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.45)]">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between mb-3">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Scraper en cache</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">Entrées prêtes à utiliser ou à lancer.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearCache}
                  disabled={cacheCount === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 text-xs font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" />
                  Vider le cache
                </button>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{cacheCount} éléments</div>
                <button
                  onClick={() => setShowCacheModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 text-xs font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Eye className="h-4 w-4" />
                  Voir
                </button>
              </div>
            </div>

            {cacheCount === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] p-3 shadow-[0_10px_32px_-26px_rgba(0,0,0,0.45)] space-y-3">
                <div className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <Inbox className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Aucun élément en cache pour le moment.</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Préparez vos prochains scrapes, ils s'afficheront ici.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {cacheEmptyExamples.map((ex, idx) => {
                    const Icon = ex.icon
                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0f1116] p-4 shadow-[0_12px_26px_-24px_rgba(0,0,0,0.4)] flex items-center gap-4"
                      >
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${ex.accent} flex items-center justify-center flex-shrink-0`}>
                          <Icon className="h-6 w-6 text-slate-900 dark:text-white" />
                        </div>
                        <p className="text-base font-semibold text-gray-900 dark:text-white">{ex.title}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {cacheCount} élément{cacheCount > 1 ? "s" : ""} en cache, prêts à être utilisés.
                </div>
                {cacheDisplay.map((item, idx) => (
                  <div
                    key={`${item.name}-${idx}`}
                    className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-gray-100 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2.5 shadow-[0_12px_26px_-24px_rgba(0,0,0,0.45)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-[#1F1F23] flex items-center justify-center">
                        <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.name || "Produit"}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {item.siteReference || item.sourceSite || "Référence"} • {item.marque || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 justify-between sm:justify-end w-full sm:w-auto">
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.prix ? `${item.prix.toFixed(0)} $` : "—"}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Prêt</p>
                      </div>
                      <button
                        onClick={() => handleRemoveCacheItem(idx)}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#1a1b1f]"
                      >
                        <Trash2 className="h-4 w-4" />
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </BlocTemplate>

          <BlocTemplate className="shadow-none bg-transparent hover-elevate" innerClassName="bg-white/95 dark:bg-[#0F0F12] p-4 border border-gray-100 dark:border-white/5 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.45)]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Filtre catalogue</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Site</p>
                  <div className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 shadow-[0_6px_20px_-16px_rgba(0,0,0,0.4)]">
                    <select
                      value={selectedSite}
                      onChange={e => setSelectedSite(e.target.value)}
                      className="w-full bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
                    >
                      <option value="all">Tous les sites</option>
                      {uniqueSites.map(site => (
                        <option key={site} value={site}>
                          {site}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Marque</p>
                  <div className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 shadow-[0_6px_20px_-16px_rgba(0,0,0,0.4)]">
                    <select
                      value={selectedMarque}
                      onChange={e => setSelectedMarque(e.target.value)}
                      className="w-full bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
                    >
                      <option value="all">Toutes les marques</option>
                      {uniqueMarques.map(m => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Catégorie</p>
                  <div className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 shadow-[0_6px_20px_-16px_rgba(0,0,0,0.4)]">
                    <select
                      value={selectedCategory}
                      onChange={e => setSelectedCategory(e.target.value)}
                      className="w-full bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
                    >
                      <option value="all">Toutes les catégories</option>
                      {uniqueCategories.map(cat => (
                        <option key={cat} value={cat}>
                          {categoryLabels[cat] || cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Produit</p>
                  <div className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 shadow-[0_6px_20px_-16px_rgba(0,0,0,0.4)]">
                    <select
                      value={selectedProduct}
                      onChange={e => setSelectedProduct(e.target.value)}
                      className="w-full bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
                    >
                      <option value="all">Tous les produits</option>
                      {uniqueProductsNames.map(n => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Affinez vos résultats en quelques clics.</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-4 py-2.5 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] transition"
                  >
                    Réinitialiser
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl bg-gray-900 text-white dark:bg-white dark:text-gray-900 px-4 py-2.5 text-sm font-semibold shadow-[0_16px_40px_-24px_rgba(0,0,0,0.6)] hover:shadow-[0_18px_44px_-24px_rgba(0,0,0,0.65)] transition"
                  >
                    Appliquer les filtres
                  </button>
                </div>
              </div>
            </div>

            {filteredProducts.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-[#1F1F23] overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-[#1F1F23]">
                  <thead className="bg-gradient-to-r from-gray-50 via-white to-gray-50 dark:from-[#0b0b0f] dark:via-[#0d0e13] dark:to-[#0b0b0f]">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Site</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Marque</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Catégorie</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Produit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-[#1F1F23]">
                    {filteredProducts.map((product, idx) => (
                      <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-[#0b0b0f] transition-colors">
                        <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{product.siteReference || product.sourceSite || "—"}</td>
                        <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{product.marque}</td>
                        <td className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">{categoryLabels[product.category] || product.category}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            {product.image ? (
                              <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.5)]">
                                <Image src={product.image} alt={product.name} width={40} height={40} className="object-cover w-full h-full" />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-[#1F1F23] flex items-center justify-center shadow-[0_12px_30px_-18px_rgba(0,0,0,0.5)]">
                                <Sparkles className="h-4 w-4 text-gray-500" />
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{product.name}</p>
                              {product.sourceSite && <p className="text-xs text-gray-500 dark:text-gray-400">{product.sourceSite}</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BlocTemplate>
        </div>

        {/* Tableau comparatif des prix */}
        <PriceComparisonTable
          products={products}
          competitorsUrls={competitorEntries.flatMap(([, list]) => list.map(p => p.sourceSite || p.siteReference || ""))}
        />

        {mounted &&
          showCacheModal &&
          createPortal(
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center px-4">
              <div className="bg-white dark:bg-[#0F0F12] rounded-2xl max-w-5xl w-full p-6 shadow-[0_24px_60px_-32px_rgba(0,0,0,0.55)] border border-gray-100 dark:border-[#1F1F23]">
                <div className="flex items-start justify-between mb-4">
                  <div className="space-y-1">
                    <h4 className="text-2xl font-semibold text-gray-900 dark:text-white">Cache des scrapers</h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCacheModal(false)}
                    aria-label="Fermer la modale cache"
                    className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
                  >
                    <X className="h-5 w-5" strokeWidth={2.25} />
                  </button>
                </div>

                {cacheCount === 0 ? (
                  <div className="text-sm font-semibold text-red-600 dark:text-red-400">
                    Aucun élément en cache pour le moment. Lancez un scraping pour les voir apparaître.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                    {cacheItems.map((item, idx) => (
                      <div
                        key={`${item.name}-${idx}-modal`}
                        className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-gray-100 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2.5 shadow-[0_12px_26px_-24px_rgba(0,0,0,0.45)]"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-[#1F1F23] flex items-center justify-center">
                            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.name || "Produit"}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {item.siteReference || item.sourceSite || "Référence"} • {item.marque || "—"}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2.5 justify-between sm:justify-end w-full sm:w-auto">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.prix ? `${item.prix.toFixed(0)} $` : "—"}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Prêt</p>
                          </div>
                          <button
                            onClick={() => handleRemoveCacheItem(idx)}
                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#1a1b1f]"
                          >
                            <Trash2 className="h-4 w-4" />
                            Supprimer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}

        {mounted &&
          createPortal(
            <div 
              className={showScraperConfig ? "fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998] flex items-center justify-center px-4 overflow-hidden" : "hidden"}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowScraperConfig(false)
                }
              }}
            >
              <div className="bg-white dark:bg-[#0F0F12] rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-[0_24px_60px_-32px_rgba(0,0,0,0.55)] border border-gray-100 dark:border-[#1F1F23]">
                <div className="flex items-start justify-between mb-4 p-6 pb-4 flex-shrink-0 border-b border-gray-200 dark:border-[#1F1F23]">
                  <h4 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-purple-600 bg-clip-text text-transparent dark:from-orange-400 dark:to-purple-400">
                    Configurer le scraping
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowScraperConfig(false)}
                    aria-label="Fermer la configuration du scraper"
                    className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors p-1"
                  >
                    <X className="h-6 w-6" strokeWidth={2.25} />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 px-6 pb-6">
                  <ScraperConfig
                    ref={scraperRef}
                    onScrapeComplete={handleScrapeComplete}
                    hideHeader
                    showLaunchButton={false}
                  />
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>
    </div>
  )
}

