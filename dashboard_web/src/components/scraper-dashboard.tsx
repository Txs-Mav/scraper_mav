"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { Search, X, ArrowRightLeft, Star, Globe, Sparkles, Inbox, Trash2, Clock3, Wand2, Eye, RefreshCw, Link, RotateCcw } from "lucide-react"
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
  categorie?: string // alias possible depuis l'API
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
  etat?: string // neuf, occasion, demonstrateur
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

const etatLabels: Record<string, string> = {
  neuf: "Neuf",
  occasion: "Usagé",
  demonstrateur: "Démonstrateur"
}

const sourceCategorieLabels: Record<string, string> = {
  inventaire: "Inventaire",
  catalogue: "Catalogue",
  vehicules_occasion: "Inventaire usagé"
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
  const [selectedEtat, setSelectedEtat] = useState<string>("all")
  const [priceDifferenceFilter, setPriceDifferenceFilter] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<"prix" | "annee" | "name" | "marque" | "site">("name")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeTab, setActiveTab] = useState<string>("reference")
  const [referenceSite, setReferenceSite] = useState<string | null>(null)
  const [configuredReferenceSite, setConfiguredReferenceSite] = useState<string | null>(null) // URL de la config
  const [cacheItems, setCacheItems] = useState<Product[]>([])
  const [cacheDisplay, setCacheDisplay] = useState<Product[]>([])
  const [scraperCache, setScraperCache] = useState<any[]>([]) // Les vrais scrapers en cache
  const [showScraperConfig, setShowScraperConfig] = useState(false)
  const [showCacheModal, setShowCacheModal] = useState(false)
  const [pendingRemovedCacheUrls, setPendingRemovedCacheUrls] = useState<string[]>([])
  const [mounted, setMounted] = useState(false)
  const [isScrapingActive, setIsScrapingActive] = useState(false) // Track si scraping en cours
  const [shouldStartScraping, setShouldStartScraping] = useState(false) // Trigger pour lancer le scraping
  const [ignoreColors, setIgnoreColors] = useState(false) // Option ignorer les couleurs
  const scraperRef = useRef<ScraperConfigHandle | null>(null)
  const inlineScraperRef = useRef<ScraperConfigHandle | null>(null) // Ref pour le ScraperConfig inline

  useEffect(() => {
    setMounted(true)
  }, [])

  // Lancer le scraping quand shouldStartScraping est true et que le ScraperConfig inline est monté
  useEffect(() => {
    if (shouldStartScraping && isScrapingActive) {
      // Petit délai pour laisser le ScraperConfig se monter et assigner la ref
      const timer = setTimeout(() => {
        if (inlineScraperRef.current) {
          setShouldStartScraping(false) // Reset le trigger
          inlineScraperRef.current.runScrape()
        }
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [shouldStartScraping, isScrapingActive])

  // Charger les scrapers en cache depuis l'API
  useEffect(() => {
    const loadScraperCache = async () => {
      try {
        const response = await fetch('/api/scraper-ai/cache')
        if (response.ok) {
          const data = await response.json()
          setScraperCache(data.scrapers || [])
        }
      } catch (error) {
        console.error('Erreur lors du chargement du cache des scrapers:', error)
      }
    }
    loadScraperCache()
  }, [refreshKey])

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

  // Charger les données avec retry automatique
  useEffect(() => {
    let cancelled = false

    const fetchProducts = async (retries = 2, delayMs = 2000): Promise<Response> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetch('/api/products')
          if (response.ok) return response
          // Erreur serveur (5xx) : retenter
          if (response.status >= 500 && attempt < retries) {
            await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
            continue
          }
          return response
        } catch (err) {
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
            continue
          }
          throw err
        }
      }
      return fetch('/api/products') // fallback final
    }

    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)
        if (initialData) {
          setProducts(initialData.products || [])
          setLoading(false)
          return
        }

        const response = await fetchProducts()
        if (cancelled) return
        if (!response.ok) {
          throw new Error('Failed to load products')
        }
        const data = await response.json()
        setProducts(data.products || [])

        // Identifier le site de référence depuis metadata
        if (data.metadata?.reference_url) {
          try {
            const url = new URL(data.metadata.reference_url)
            const domain = url.hostname.replace('www.', '')
            setReferenceSite(domain)
          } catch {
            setReferenceSite(data.metadata.reference_url)
          }
        } else {
          const refProduct = data.products?.find((p: Product) => p.siteReference)
          if (refProduct) {
            setReferenceSite(refProduct.siteReference)
          }
        }
        // Charger la config pour ignoreColors
        try {
          const configRes = await fetch('/api/scraper/config')
          if (configRes.ok) {
            const configData = await configRes.json()
            if (typeof configData.ignoreColors === 'boolean') {
              setIgnoreColors(configData.ignoreColors)
            }
          }
        } catch { /* non critique */ }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Erreur lors du chargement des données')
          console.error(err)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadData()
    return () => { cancelled = true }
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

  const [scrapeNotification, setScrapeNotification] = useState<{
    message: string
    type: 'success' | 'warning'
  } | null>(null)
  const justCompletedScrapingRef = useRef(false)

  const handleScrapeComplete = () => {
    justCompletedScrapingRef.current = true
    setRefreshKey(prev => prev + 1)
  }

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  const [resetting, setResetting] = useState(false)
  const handleReset = async () => {
    if (!confirm('Effacer toutes les données du dashboard ? Cette action est irréversible.')) return
    setResetting(true)
    try {
      const res = await fetch('/api/dashboard/reset', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Erreur lors de la réinitialisation')
        return
      }
      setProducts([])
      setRefreshKey(prev => prev + 1)
    } catch (err) {
      console.error('Error resetting dashboard:', err)
      alert('Erreur lors de la réinitialisation')
    } finally {
      setResetting(false)
    }
  }

  // Helper: domaine normalisé pour filtres site (affichage et comparaison)
  const extractDomain = (url: string): string => {
    if (!url) return ""
    try {
      const toParse = url.startsWith("http") ? url : "https://" + url
      return new URL(toParse).hostname.replace(/^www\./, "")
    } catch {
      const m = url.match(/(?:https?:\/\/)?(?:www\.)?([^/\s]+)/i)
      return m ? m[1].replace(/^www\./, "") : url
    }
  }

  // Extraire les valeurs uniques pour les filtres (catégorie: category ou categorie selon API)
  const uniqueCategories = useMemo(() => {
    const cats = new Set(
      products
        .map(p => (p.category ?? p.categorie ?? "").trim())
        .filter(Boolean)
    )
    return Array.from(cats).sort()
  }, [products])

  const uniqueMarques = useMemo(() => {
    const marques = new Set(products.map(p => p.marque).filter(Boolean))
    return Array.from(marques).sort()
  }, [products])

  const uniqueSites = useMemo(() => {
    const sites = new Set(
      products
        .map(p => p.sourceSite && extractDomain(p.sourceSite))
        .filter(Boolean)
    )
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

  const uniqueEtats = useMemo(() => {
    const etats = new Set(products.map(p => p.etat || p.sourceCategorie).filter((v): v is string => !!v))
    return Array.from(etats).sort()
  }, [products])

  // Helper pour extraire le domaine d'une URL
  // Grouper les produits par site (utilise extractDomain défini plus haut)
  const productsBySite = useMemo(() => {
    const grouped: Record<string, Product[]> = {}
    const compared: Product[] = []
    const reference: Product[] = []
    const otherSites: Record<string, Product[]> = {}
    const allCompetitors: Product[] = [] // Tous les produits des concurrents

    // Debug: log pour comprendre les données
    if (products.length > 0) {
      const uniqueSites = new Set(products.map(p => p.sourceSite).filter(Boolean))
      console.log('[ProductsBySite] Reference site:', referenceSite)
      console.log('[ProductsBySite] Unique sourceSite values:', Array.from(uniqueSites))
      console.log('[ProductsBySite] Total products:', products.length)
    }

    products.forEach(product => {
      // Utiliser sourceSite pour identifier le site
      const site = product.sourceSite || 'unknown'
      const siteDomain = extractDomain(site)

      // Un produit est du site de référence si son domaine correspond au referenceSite
      // IMPORTANT: Comparaison insensible à la casse
      const refDomainNormalized = referenceSite?.toLowerCase().trim()
      const siteDomainNormalized = siteDomain?.toLowerCase().trim()
      const isReferenceProduct = refDomainNormalized && siteDomainNormalized === refDomainNormalized

      // Produits comparés: doivent avoir prixReference défini
      // (produit présent à la fois dans référence ET dans un concurrent)
      if (product.prixReference !== null && product.prixReference !== undefined) {
        compared.push(product)
      }

      if (isReferenceProduct) {
        reference.push(product)
      } else if (site !== 'unknown') {
        // Produits des autres sites (concurrents)
        if (!otherSites[site]) {
          otherSites[site] = []
        }
        otherSites[site].push(product)
        allCompetitors.push(product)
      }

      // Grouper par site
      if (!grouped[site]) {
        grouped[site] = []
      }
      grouped[site].push(product)
    })

    // Debug: résumé
    console.log('[ProductsBySite] Result:', {
      reference: reference.length,
      allCompetitors: allCompetitors.length,
      compared: compared.length,
      otherSitesKeys: Object.keys(otherSites)
    })

    return { compared, reference, otherSites, allCompetitors, grouped }
  }, [products, referenceSite])

  useEffect(() => {
    setCacheItems(productsBySite.reference)
  }, [productsBySite.reference])

  useEffect(() => {
    setCacheDisplay(cacheItems.slice(0, 2))
  }, [cacheItems])

  // Basculer automatiquement selon les produits disponibles
  useEffect(() => {
    const { compared, reference, allCompetitors } = productsBySite

    // POST-SCRAPING: Basculer vers l'onglet le plus pertinent et afficher une notification
    if (justCompletedScrapingRef.current && (reference.length > 0 || allCompetitors.length > 0)) {
      justCompletedScrapingRef.current = false

      // Construire la notification de résumé
      const parts: string[] = []
      if (reference.length > 0) parts.push(`${reference.length} produits de référence`)
      if (allCompetitors.length > 0) parts.push(`${allCompetitors.length} produits concurrents`)
      if (compared.length > 0) parts.push(`${compared.length} correspondances`)

      const totalProducts = reference.length + allCompetitors.length
      const hasComparisons = compared.length > 0
      const hasCompetitors = allCompetitors.length > 0

      if (totalProducts > 0) {
        setScrapeNotification({
          message: `${totalProducts} produits extraits : ${parts.join(', ')}`,
          type: hasComparisons || !hasCompetitors ? 'success' : 'warning'
        })
        // Auto-dismiss après 10 secondes
        setTimeout(() => setScrapeNotification(null), 10_000)
      }

      // Basculer vers le meilleur onglet
      if (hasComparisons) {
        setActiveTab("compared")
      } else if (hasCompetitors) {
        setActiveTab("allCompetitors")
      } else {
        setActiveTab("reference")
      }
      return
    }

    // NAVIGATION NORMALE: corriger l'onglet si vide
    if (activeTab === "compared" && compared.length === 0 && reference.length > 0) {
      setActiveTab("reference")
    } else if (activeTab === "reference" && reference.length === 0 && compared.length > 0) {
      setActiveTab("compared")
    } else if (activeTab === "reference" && reference.length === 0 && allCompetitors.length > 0) {
      setActiveTab("allCompetitors")
    }
  }, [activeTab, productsBySite])

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

    // Filtre site (comparaison par hostname normalisé)
    if (selectedSite !== "all") {
      filtered = filtered.filter(p => extractDomain(p.sourceSite || "") === selectedSite)
    }

    // Filtre marque
    if (selectedMarque !== "all") {
      filtered = filtered.filter(p => p.marque === selectedMarque)
    }

    // Filtre catégorie (API peut envoyer category ou categorie)
    if (selectedCategory !== "all") {
      filtered = filtered.filter(
        p => (p.category ?? p.categorie ?? "").trim() === selectedCategory
      )
    }

    // Filtre produit
    if (selectedProduct !== "all") {
      filtered = filtered.filter(p => p.name === selectedProduct)
    }

    // Filtre disponibilité (conservé pour compatibilité)
    if (selectedDisponibilite !== "all") {
      filtered = filtered.filter(p => p.disponibilite === selectedDisponibilite)
    }

    // Filtre état (neuf/occasion/demonstrateur ou sourceCategorie)
    if (selectedEtat !== "all") {
      filtered = filtered.filter(p => {
        const productEtat = p.etat || p.sourceCategorie || ''
        return productEtat === selectedEtat
      })
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
    // Fonction pour extraire la marque nettoyée
    const extractMarqueValue = (marque: string | undefined) => {
      if (!marque) return ""
      return marque.replace(/^Manufacturier\s*:\s*/i, "").trim().toLowerCase()
    }

    filtered.sort((a, b) => {
      let aVal: any, bVal: any

      if (sortBy === "prix") {
        aVal = a.prix || 0
        bVal = b.prix || 0
      } else if (sortBy === "annee") {
        aVal = a.annee || 0
        bVal = b.annee || 0
      } else if (sortBy === "marque") {
        aVal = extractMarqueValue(a.marque)
        bVal = extractMarqueValue(b.marque)
      } else if (sortBy === "site") {
        aVal = (a.sourceSite || "").toLowerCase()
        bVal = (b.sourceSite || "").toLowerCase()
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
  }, [products, searchQuery, selectedCategory, selectedMarque, selectedDisponibilite, selectedEtat, priceDifferenceFilter, sortBy, sortOrder, activeTab, productsBySite])

  // Vérifier si au moins un filtre est actif
  const hasActiveFilters = useMemo(() => {
    return (
      searchQuery !== "" ||
      selectedSite !== "all" ||
      selectedMarque !== "all" ||
      selectedCategory !== "all" ||
      selectedProduct !== "all" ||
      selectedDisponibilite !== "all" ||
      selectedEtat !== "all" ||
      priceDifferenceFilter !== null
    )
  }, [searchQuery, selectedSite, selectedMarque, selectedCategory, selectedProduct, selectedDisponibilite, selectedEtat, priceDifferenceFilter])

  // Réinitialiser automatiquement les filtres si aucun produit n'est affiché et qu'au moins un filtre est actif
  useEffect(() => {
    if (filteredProducts.length === 0 && hasActiveFilters && products.length > 0) {
      resetFilters()
    }
  }, [filteredProducts.length, hasActiveFilters, products.length])

  const resetFilters = () => {
    setSearchQuery("")
    setSelectedSite("all")
    setSelectedMarque("all")
    setSelectedCategory("all")
    setSelectedProduct("all")
    setSelectedDisponibilite("all")
    setSelectedEtat("all")
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
  const scraperCacheCount = scraperCache.length
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
          <button
            type="button"
            onClick={handleReset}
            disabled={loading || resetting}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] transition disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_10px_30px_-24px_rgba(0,0,0,0.35)]"
            title="Effacer les données du dashboard"
          >
            <RotateCcw className={`h-4 w-4 ${resetting ? 'animate-spin' : ''}`} />
            Réinitialiser
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
          { label: "Site de référence", value: configuredReferenceSite || referenceSite || "Non défini", sub: "Point d’ancrage", icon: Star, tone: "amber" },
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

      {/* Notification post-scraping */}
      {scrapeNotification && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300 ${scrapeNotification.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
            : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
          }`}>
          <span>{scrapeNotification.message}</span>
          <button
            type="button"
            onClick={() => setScrapeNotification(null)}
            className="ml-2 opacity-60 hover:opacity-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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

            {/* Bouton ou Logs de scraping */}
            <div>
              {isScrapingActive ? (
                /* Afficher ScraperConfig avec logs pendant le scraping */
                <ScraperConfig
                  ref={inlineScraperRef}
                  onScrapeStart={() => setIsScrapingActive(true)}
                  onScrapeComplete={() => {
                    setIsScrapingActive(false)
                    handleScrapeComplete()
                  }}
                  hideHeader
                  showLaunchButton={false}
                  logsOnlyMode={true}
                  onReferenceUrlChange={(_, domain) => setConfiguredReferenceSite(domain)}
                />
              ) : (
                /* Bouton Lancer le scraping */
                <button
                  type="button"
                  onClick={() => {
                    setIsScrapingActive(true)
                    setShouldStartScraping(true) // Trigger pour lancer après que le composant soit monté
                  }}
                  className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-700 hover:via-purple-700 hover:to-indigo-700 text-white rounded-xl font-semibold text-base shadow-[0_16px_40px_-24px_rgba(88,28,135,0.45)] hover:shadow-[0_18px_44px_-24px_rgba(88,28,135,0.55)] transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Lancer le scraping
                </button>
              )}
            </div>

          </div>
        </BlocTemplate>

        {/* Zone basse : Scraper en cache + Catalogue filtré côte à côte */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <BlocTemplate className="shadow-none bg-transparent hover-elevate" innerClassName="bg-gray-50/80 dark:bg-[#0F0F12] p-4 border border-gray-100 dark:border-white/5 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.45)]">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between mb-3">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Scrapers en cache</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">Sites avec scraper généré, prêts à être réutilisés.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{scraperCacheCount} scraper{scraperCacheCount > 1 ? "s" : ""}</div>
                <button
                  onClick={() => setShowCacheModal(true)}
                  disabled={scraperCacheCount === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 text-xs font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Eye className="h-4 w-4" />
                  Voir tout
                </button>
              </div>
            </div>

            {scraperCacheCount === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] p-3 shadow-[0_10px_32px_-26px_rgba(0,0,0,0.45)] space-y-3">
                <div className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <Inbox className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Aucun scraper en cache pour le moment.</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Lancez un scraping et le système créera automatiquement un scraper réutilisable.</p>
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
                  {scraperCacheCount} scraper{scraperCacheCount > 1 ? "s" : ""} en cache, réutilisable{scraperCacheCount > 1 ? "s" : ""} pour les prochains scrapings.
                </div>
                {scraperCache.slice(0, 3).map((scraper, idx) => {
                  const hostname = (() => {
                    try {
                      return new URL(scraper.url).hostname.replace(/^www\./, '')
                    } catch {
                      return scraper.url
                    }
                  })()
                  return (
                    <div
                      key={`${scraper.cacheKey || scraper.id}-${idx}`}
                      className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-gray-100 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2.5 shadow-[0_12px_26px_-24px_rgba(0,0,0,0.45)]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-500/20 dark:from-violet-500/30 dark:to-purple-500/30 flex items-center justify-center">
                          <Wand2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{hostname}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {scraper.productUrlsCount || 0} URLs • {scraper.lastProductCount || 0} produits
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 justify-between sm:justify-end w-full sm:w-auto">
                        <div className="text-right">
                          <p className={`text-xs font-medium px-2 py-0.5 rounded ${scraper.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            }`}>
                            {scraper.status === 'active' ? 'Actif' : 'Expiré'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {scraperCacheCount > 3 && (
                  <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                    +{scraperCacheCount - 3} autre{scraperCacheCount > 4 ? 's' : ''} scraper{scraperCacheCount > 4 ? 's' : ''}
                  </p>
                )}
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

              {/* Champ de recherche */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Recherche</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Nom, marque, modèle, description..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      aria-label="Effacer la recherche"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
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
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">État</p>
                  <div className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 shadow-[0_6px_20px_-16px_rgba(0,0,0,0.4)]">
                    <select
                      value={selectedEtat}
                      onChange={e => setSelectedEtat(e.target.value)}
                      className="w-full bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
                    >
                      <option value="all">Tous les états</option>
                      {uniqueEtats.map(e => (
                        <option key={e} value={e}>
                          {etatLabels[e] || sourceCategorieLabels[e] || e}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Disponibilité</p>
                  <div className="rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-3 py-2 shadow-[0_6px_20px_-16px_rgba(0,0,0,0.4)]">
                    <select
                      value={selectedDisponibilite}
                      onChange={e => setSelectedDisponibilite(e.target.value)}
                      className="w-full bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
                    >
                      <option value="all">Toutes</option>
                      {uniqueDisponibilites.map(d => (
                        <option key={d} value={d}>
                          {disponibiliteLabels[d] || d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section de tri */}
              <div className="border-t border-gray-100 dark:border-[#1F1F23] pt-4 mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Trier par</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "marque", label: "Marque (A-Z)" },
                    { value: "site", label: "Concessionnaire (A-Z)" },
                    { value: "prix", label: "Prix" },
                    { value: "annee", label: "Année" },
                    { value: "name", label: "Nom" },
                  ].map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        if (sortBy === option.value) {
                          // Toggle sort order si même critère
                          setSortOrder(sortOrder === "asc" ? "desc" : "asc")
                        } else {
                          setSortBy(option.value as typeof sortBy)
                          setSortOrder("asc")
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${sortBy === option.value
                        ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                        : "border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1b1f]"
                        }`}
                    >
                      {option.label}
                      {sortBy === option.value && (
                        <span className="ml-1">{sortOrder === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">Affinez vos résultats en quelques clics.</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-4 py-2.5 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] transition"
                  >
                    Réinitialiser
                  </button>
                </div>
              </div>
            </div>
          </BlocTemplate>
        </div>

        {/* Onglets de vue */}
        <BlocTemplate className="shadow-none bg-transparent" innerClassName="bg-white/95 dark:bg-[#0F0F12] p-4 border border-gray-100 dark:border-white/5 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.45)]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Vue des produits</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{filteredProducts.length} produit{filteredProducts.length > 1 ? 's' : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("reference")}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${activeTab === "reference"
                    ? "bg-amber-500 text-white shadow-[0_8px_20px_-8px_rgba(245,158,11,0.5)]"
                    : "border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1b1f]"
                  }`}
              >
                <Star className="h-4 w-4" />
                Référence
                <span className="ml-1 text-xs opacity-80">({productsBySite.reference.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("allCompetitors")}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${activeTab === "allCompetitors"
                    ? "bg-blue-500 text-white shadow-[0_8px_20px_-8px_rgba(59,130,246,0.5)]"
                    : "border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1b1f]"
                  }`}
              >
                <Globe className="h-4 w-4" />
                Tous les concurrents
                <span className="ml-1 text-xs opacity-80">({productsBySite.allCompetitors.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("compared")}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${activeTab === "compared"
                    ? "bg-emerald-500 text-white shadow-[0_8px_20px_-8px_rgba(16,185,129,0.5)]"
                    : "border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1b1f]"
                  }`}
              >
                <ArrowRightLeft className="h-4 w-4" />
                Comparés
                <span className="ml-1 text-xs opacity-80">({productsBySite.compared.length})</span>
              </button>

              {Object.keys(productsBySite.otherSites).length > 0 && (
                <div className="w-px h-8 bg-gray-200 dark:bg-[#1F1F23]" />
              )}

              {Object.entries(productsBySite.otherSites).map(([siteUrl, siteProducts]) => {
                const siteName = extractDomain(siteUrl)
                return (
                  <button
                    key={siteUrl}
                    type="button"
                    onClick={() => setActiveTab(`site-${siteUrl}`)}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${activeTab === `site-${siteUrl}`
                        ? "bg-purple-500 text-white shadow-[0_8px_20px_-8px_rgba(168,85,247,0.5)]"
                        : "border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1b1f]"
                      }`}
                  >
                    {siteName}
                    <span className="ml-1 text-xs opacity-80">({siteProducts.length})</span>
                  </button>
                )
              })}
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-[#1F1F23]">
              {activeTab === "reference" && "Tous les produits du site de référence"}
              {activeTab === "allCompetitors" && "Tous les produits de tous les concurrents combinés"}
              {activeTab === "compared" && "Seulement les produits présents à la fois dans référence et concurrents"}
              {activeTab.startsWith("site-") && `Produits de ${extractDomain(activeTab.replace("site-", ""))}`}
            </div>
          </div>
        </BlocTemplate>

        {/* Tableau comparatif : utilise filteredProducts pour respecter onglets et filtres catalogue */}
        <PriceComparisonTable
          products={filteredProducts}
          competitorsUrls={competitorEntries.flatMap(([, list]) => list.map(p => p.sourceSite || ""))}
          ignoreColors={ignoreColors}
        />

        {mounted &&
          showCacheModal &&
          createPortal(
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center px-4">
              <div className="bg-white dark:bg-[#0F0F12] rounded-2xl max-w-5xl w-full p-6 shadow-[0_24px_60px_-32px_rgba(0,0,0,0.55)] border border-gray-100 dark:border-[#1F1F23]">
                <div className="flex items-start justify-between mb-4">
                  <div className="space-y-1">
                    <h4 className="text-2xl font-semibold text-gray-900 dark:text-white">Scrapers en cache</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Sites avec scraper généré automatiquement</p>
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

                {scraperCacheCount === 0 ? (
                  <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                    Aucun scraper en cache pour le moment. Lancez un scraping pour générer un scraper réutilisable.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                    {scraperCache.map((scraper, idx) => {
                      const hostname = (() => {
                        try {
                          return new URL(scraper.url).hostname.replace(/^www\./, '')
                        } catch {
                          return scraper.url
                        }
                      })()
                      const createdDate = scraper.createdAt ? new Date(scraper.createdAt).toLocaleDateString('fr-FR') : '—'

                      return (
                        <div
                          key={`${scraper.cacheKey || scraper.id}-${idx}-modal`}
                          className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-gray-100 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] px-4 py-3 shadow-[0_12px_26px_-24px_rgba(0,0,0,0.45)]"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 dark:from-violet-500/30 dark:to-purple-500/30 flex items-center justify-center flex-shrink-0">
                              <Wand2 className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{hostname}</p>
                              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <span className="flex items-center gap-1">
                                  <Link className="h-3 w-3" />
                                  {scraper.productUrlsCount || 0} URLs
                                </span>
                                <span>•</span>
                                <span>{scraper.lastProductCount || 0} produits</span>
                                <span>•</span>
                                <span>Créé le {createdDate}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2.5 justify-between sm:justify-end w-full sm:w-auto">
                            <p className={`text-xs font-medium px-2 py-1 rounded ${scraper.status === 'active'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              }`}>
                              {scraper.status === 'active' ? 'Actif' : 'Expiré'}
                            </p>
                            <button
                              onClick={async () => {
                                try {
                                  // Envoyer cache_key ET url pour garantir la suppression dans Supabase
                                  const params = new URLSearchParams({
                                    cache_key: scraper.cacheKey || '',
                                    user_id: user?.id || '',
                                    url: scraper.url || ''
                                  })
                                  const response = await fetch(`/api/scraper-ai/cache?${params.toString()}`, {
                                    method: 'DELETE'
                                  })
                                  if (response.ok) {
                                    const deletedUrl = scraper.url
                                    setScraperCache(prev => prev.filter((_, i) => i !== idx))
                                    setPendingRemovedCacheUrls(prev => [...prev, deletedUrl])
                                    scraperRef.current?.removeUrlFromConfig(deletedUrl)
                                  } else {
                                    console.error('Erreur suppression:', await response.text())
                                  }
                                } catch (error) {
                                  console.error('Erreur suppression scraper:', error)
                                }
                              }}
                              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#1F1F23] px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#1a1b1f]"
                            >
                              <Trash2 className="h-4 w-4" />
                              Supprimer
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}

        {mounted &&
          createPortal(
            <div
              className={showScraperConfig ? "fixed inset-0 bg-black/40 backdrop-blur-sm z-[9998] flex items-center justify-center px-4" : "hidden"}
              onClick={async (e) => {
                if (e.target === e.currentTarget) {
                  // Sauvegarder la config avant de fermer
                  await scraperRef.current?.saveConfig()
                  setShowScraperConfig(false)
                }
              }}
            >
              <div className="bg-white dark:bg-[#0f0f12] rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl shadow-black/10 dark:shadow-black/40 border border-gray-200/50 dark:border-gray-800/50">
                <div className="flex items-center justify-between p-5 pb-4 border-b border-gray-100 dark:border-gray-800/50">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Configuration
                  </h4>
                  <button
                    type="button"
                    onClick={async () => {
                      // Sauvegarder la config avant de fermer
                      await scraperRef.current?.saveConfig()
                      setShowScraperConfig(false)
                    }}
                    aria-label="Fermer"
                    className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 p-5">
                  <ScraperConfig
                    ref={scraperRef}
                    onScrapeStart={() => setIsScrapingActive(true)}
                    onScrapeComplete={() => {
                      setIsScrapingActive(false)
                      handleScrapeComplete()
                      // Fermer la modale après 2s pour laisser voir le message de succès
                      setTimeout(() => setShowScraperConfig(false), 2000)
                    }}
                    hideHeader
                    showLaunchButton={false}
                    pendingRemovedCacheUrls={pendingRemovedCacheUrls}
                    onAppliedRemovedCacheUrls={() => setPendingRemovedCacheUrls([])}
                    onReferenceUrlChange={(_, domain) => setConfiguredReferenceSite(domain)}
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

