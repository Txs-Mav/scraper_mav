"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { Search, X, ArrowRightLeft, Star, Globe, Sparkles, Trash2, Wand2, RefreshCw, Link, RotateCcw, ChevronDown, Settings2, BarChart3, Zap } from "lucide-react"
import Image from "next/image"
import ScraperConfig, { ScraperConfigHandle } from "./scraper-config"
import AIAgent from "./ai-agent"
import { useAuth } from "@/contexts/auth-context"
import { getLocalScrapingsCount, migrateLocalScrapingsToSupabase } from "@/lib/local-storage"
import LimitWarning from "./limit-warning"
import { useScrapingLimit } from "@/hooks/use-scraping-limit"
import PriceComparisonTable from "./price-comparison-table"

interface Product {
  name: string
  description?: string
  category: string
  categorie?: string
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
  etat?: string
  attributes?: Record<string, any>
  prixReference?: number | null
  differencePrix?: number | null
  siteReference?: string
}

interface ScraperDashboardProps {
  initialData?: { products: Product[] }
}

const categoryLabels: Record<string, string> = {
  moto: "Moto", motoneige: "Motoneige", motocross: "Motocross",
  scooter: "Scooter", quad: "Quad", "side-by-side": "Side-by-Side", autre: "Autre"
}

const disponibiliteLabels: Record<string, string> = {
  en_stock: "En stock", sur_commande: "Sur commande",
  epuise: "Épuisé", non_disponible: "Non disponible"
}

const etatLabels: Record<string, string> = {
  neuf: "Neuf", occasion: "Usagé", demonstrateur: "Démonstrateur"
}

const sourceCategorieLabels: Record<string, string> = {
  inventaire: "Inventaire", catalogue: "Catalogue", vehicules_occasion: "Inventaire usagé"
}

export default function ScraperDashboard({ initialData }: ScraperDashboardProps) {
  const { user } = useAuth()
  const scrapingLimit = useScrapingLimit()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false)
  const [migrating, setMigrating] = useState(false)

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
  const [configuredReferenceSite, setConfiguredReferenceSite] = useState<string | null>(null)
  const [cacheItems, setCacheItems] = useState<Product[]>([])
  const [cacheDisplay, setCacheDisplay] = useState<Product[]>([])
  const [scraperCache, setScraperCache] = useState<any[]>([])
  const [showScraperConfig, setShowScraperConfig] = useState(false)
  const [showCacheModal, setShowCacheModal] = useState(false)
  const [pendingRemovedCacheUrls, setPendingRemovedCacheUrls] = useState<string[]>([])
  const [mounted, setMounted] = useState(false)
  const [isScrapingActive, setIsScrapingActive] = useState(false)
  const [shouldStartScraping, setShouldStartScraping] = useState(false)
  const [ignoreColors, setIgnoreColors] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  const scraperRef = useRef<ScraperConfigHandle | null>(null)
  const inlineScraperRef = useRef<ScraperConfigHandle | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (shouldStartScraping && isScrapingActive) {
      const timer = setTimeout(() => {
        if (inlineScraperRef.current) {
          setShouldStartScraping(false)
          inlineScraperRef.current.runScrape()
        }
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [shouldStartScraping, isScrapingActive])

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

  useEffect(() => {
    if (user) {
      const localCount = getLocalScrapingsCount()
      if (localCount > 0) setShowMigrationPrompt(true)
    }
    const handleLocalScrapings = (event: CustomEvent) => {
      if (event.detail?.count > 0) setShowMigrationPrompt(true)
    }
    window.addEventListener('local-scrapings-available', handleLocalScrapings as EventListener)
    return () => window.removeEventListener('local-scrapings-available', handleLocalScrapings as EventListener)
  }, [user])

  useEffect(() => {
    let cancelled = false
    const fetchProducts = async (retries = 2, delayMs = 2000): Promise<Response> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetch('/api/products')
          if (response.ok) return response
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
      return fetch('/api/products')
    }
    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)
        if (initialData) { setProducts(initialData.products || []); setLoading(false); return }
        const response = await fetchProducts()
        if (cancelled) return
        if (!response.ok) throw new Error('Failed to load products')
        const data = await response.json()
        setProducts(data.products || [])
        if (data.metadata?.reference_url) {
          try {
            const url = new URL(data.metadata.reference_url)
            setReferenceSite(url.hostname.replace('www.', ''))
          } catch { setReferenceSite(data.metadata.reference_url) }
        } else {
          const refProduct = data.products?.find((p: Product) => p.siteReference)
          if (refProduct) setReferenceSite(refProduct.siteReference)
        }
        try {
          const configRes = await fetch('/api/scraper/config')
          if (configRes.ok) {
            const configData = await configRes.json()
            if (typeof configData.ignoreColors === 'boolean') setIgnoreColors(configData.ignoreColors)
          }
        } catch { /* non critique */ }
      } catch (err: any) {
        if (!cancelled) { setError(err.message || 'Erreur lors du chargement'); console.error(err) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true }
  }, [initialData, refreshKey])

  const handleMigrateScrapings = async () => {
    setMigrating(true)
    try {
      const result = await migrateLocalScrapingsToSupabase()
      if (result.success) { setShowMigrationPrompt(false); alert(`${result.migrated} scrapings migrés`); setRefreshKey(prev => prev + 1) }
      else alert(`Migration partielle: ${result.migrated} migrés, ${result.errors.length} erreurs`)
    } catch (error: any) { alert(`Erreur: ${error.message}`) }
    finally { setMigrating(false) }
  }

  const [scrapeNotification, setScrapeNotification] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)
  const justCompletedScrapingRef = useRef(false)

  const handleScrapeComplete = () => { justCompletedScrapingRef.current = true; setRefreshKey(prev => prev + 1) }
  const handleRefresh = () => { setRefreshKey(prev => prev + 1) }

  const [resetting, setResetting] = useState(false)
  const handleReset = async () => {
    if (!confirm('Effacer toutes les données du dashboard ?')) return
    setResetting(true)
    try {
      const res = await fetch('/api/dashboard/reset', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Erreur'); return }
      setProducts([]); setRefreshKey(prev => prev + 1)
    } catch (err) { console.error(err); alert('Erreur') }
    finally { setResetting(false) }
  }

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

  const uniqueCategories = useMemo(() => {
    return Array.from(new Set(products.map(p => (p.category ?? p.categorie ?? "").trim()).filter(Boolean))).sort()
  }, [products])

  const uniqueMarques = useMemo(() => {
    return Array.from(new Set(products.map(p => p.marque).filter(Boolean))).sort()
  }, [products])

  const uniqueSites = useMemo(() => {
    return Array.from(new Set(products.map(p => p.sourceSite && extractDomain(p.sourceSite)).filter(Boolean))).sort()
  }, [products])

  const uniqueProductsNames = useMemo(() => {
    return Array.from(new Set(products.map(p => p.name).filter(Boolean))).sort()
  }, [products])

  const uniqueDisponibilites = useMemo(() => {
    return Array.from(new Set(products.map(p => p.disponibilite).filter(Boolean))).sort()
  }, [products])

  const uniqueEtats = useMemo(() => {
    return Array.from(new Set(products.map(p => p.etat || p.sourceCategorie).filter((v): v is string => !!v))).sort()
  }, [products])

  const productsBySite = useMemo(() => {
    const grouped: Record<string, Product[]> = {}
    const compared: Product[] = []
    const reference: Product[] = []
    const otherSites: Record<string, Product[]> = {}
    const allCompetitors: Product[] = []

    products.forEach(product => {
      const site = product.sourceSite || 'unknown'
      const siteDomain = extractDomain(site)
      const refDomainNormalized = referenceSite?.toLowerCase().trim()
      const siteDomainNormalized = siteDomain?.toLowerCase().trim()
      const isReferenceProduct = refDomainNormalized && siteDomainNormalized === refDomainNormalized

      if (product.prixReference !== null && product.prixReference !== undefined) compared.push(product)
      if (isReferenceProduct) reference.push(product)
      else if (site !== 'unknown') {
        if (!otherSites[site]) otherSites[site] = []
        otherSites[site].push(product)
        allCompetitors.push(product)
      }
      if (!grouped[site]) grouped[site] = []
      grouped[site].push(product)
    })

    return { compared, reference, otherSites, allCompetitors, grouped }
  }, [products, referenceSite])

  useEffect(() => { setCacheItems(productsBySite.reference) }, [productsBySite.reference])
  useEffect(() => { setCacheDisplay(cacheItems.slice(0, 2)) }, [cacheItems])

  useEffect(() => {
    const { compared, reference, allCompetitors } = productsBySite
    if (justCompletedScrapingRef.current && (reference.length > 0 || allCompetitors.length > 0)) {
      justCompletedScrapingRef.current = false
      const parts: string[] = []
      if (reference.length > 0) parts.push(`${reference.length} référence`)
      if (allCompetitors.length > 0) parts.push(`${allCompetitors.length} concurrents`)
      if (compared.length > 0) parts.push(`${compared.length} comparés`)
      const totalProducts = reference.length + allCompetitors.length
      if (totalProducts > 0) {
        setScrapeNotification({ message: `${totalProducts} produits extraits — ${parts.join(', ')}`, type: compared.length > 0 || !allCompetitors.length ? 'success' : 'warning' })
        setTimeout(() => setScrapeNotification(null), 10_000)
      }
      if (compared.length > 0) setActiveTab("compared")
      else if (allCompetitors.length > 0) setActiveTab("allCompetitors")
      else setActiveTab("reference")
      return
    }
    if (activeTab === "compared" && compared.length === 0 && reference.length > 0) setActiveTab("reference")
    else if (activeTab === "reference" && reference.length === 0 && compared.length > 0) setActiveTab("compared")
    else if (activeTab === "reference" && reference.length === 0 && allCompetitors.length > 0) setActiveTab("allCompetitors")
  }, [activeTab, productsBySite])

  const filteredProducts = useMemo(() => {
    let filtered: Product[] = []
    if (activeTab === "compared") filtered = [...productsBySite.compared]
    else if (activeTab === "reference") filtered = [...productsBySite.reference]
    else if (activeTab === "allCompetitors") filtered = [...productsBySite.allCompetitors]
    else if (activeTab.startsWith("site-")) filtered = productsBySite.grouped[activeTab.replace("site-", "")] || []
    else filtered = [...products]

    if (searchQuery) { const q = searchQuery.toLowerCase(); filtered = filtered.filter(p => p.name?.toLowerCase().includes(q) || p.marque?.toLowerCase().includes(q) || p.modele?.toLowerCase().includes(q)) }
    if (selectedSite !== "all") filtered = filtered.filter(p => extractDomain(p.sourceSite || "") === selectedSite)
    if (selectedMarque !== "all") filtered = filtered.filter(p => p.marque === selectedMarque)
    if (selectedCategory !== "all") filtered = filtered.filter(p => (p.category ?? p.categorie ?? "").trim() === selectedCategory)
    if (selectedProduct !== "all") filtered = filtered.filter(p => p.name === selectedProduct)
    if (selectedDisponibilite !== "all") filtered = filtered.filter(p => p.disponibilite === selectedDisponibilite)
    if (selectedEtat !== "all") filtered = filtered.filter(p => (p.etat || p.sourceCategorie || '') === selectedEtat)
    if (priceDifferenceFilter !== null) filtered = filtered.filter(p => p.differencePrix != null && p.differencePrix >= priceDifferenceFilter)
    if (activeTab === "compared") filtered = filtered.filter(p => p.prixReference != null)

    const extractMarqueValue = (m: string | undefined) => m ? m.replace(/^Manufacturier\s*:\s*/i, "").trim().toLowerCase() : ""
    filtered.sort((a, b) => {
      let aVal: any, bVal: any
      if (sortBy === "prix") { aVal = a.prix || 0; bVal = b.prix || 0 }
      else if (sortBy === "annee") { aVal = a.annee || 0; bVal = b.annee || 0 }
      else if (sortBy === "marque") { aVal = extractMarqueValue(a.marque); bVal = extractMarqueValue(b.marque) }
      else if (sortBy === "site") { aVal = (a.sourceSite || "").toLowerCase(); bVal = (b.sourceSite || "").toLowerCase() }
      else { aVal = a.name || ""; bVal = b.name || "" }
      return sortOrder === "asc" ? (aVal > bVal ? 1 : aVal < bVal ? -1 : 0) : (aVal < bVal ? 1 : aVal > bVal ? -1 : 0)
    })
    return filtered
  }, [products, searchQuery, selectedCategory, selectedMarque, selectedDisponibilite, selectedEtat, priceDifferenceFilter, sortBy, sortOrder, activeTab, productsBySite])

  const hasActiveFilters = useMemo(() => {
    return searchQuery !== "" || selectedSite !== "all" || selectedMarque !== "all" || selectedCategory !== "all" || selectedProduct !== "all" || selectedDisponibilite !== "all" || selectedEtat !== "all" || priceDifferenceFilter !== null
  }, [searchQuery, selectedSite, selectedMarque, selectedCategory, selectedProduct, selectedDisponibilite, selectedEtat, priceDifferenceFilter])

  useEffect(() => {
    if (filteredProducts.length === 0 && hasActiveFilters && products.length > 0) resetFilters()
  }, [filteredProducts.length, hasActiveFilters, products.length])

  const resetFilters = () => {
    setSearchQuery(""); setSelectedSite("all"); setSelectedMarque("all"); setSelectedCategory("all")
    setSelectedProduct("all"); setSelectedDisponibilite("all"); setSelectedEtat("all"); setPriceDifferenceFilter(null)
    setSortBy("prix"); setSortOrder("asc")
  }

  const handleRemoveCacheItem = (index: number) => { setCacheItems(prev => prev.filter((_, i) => i !== index)) }
  const handleClearCache = () => { setCacheItems([]) }

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 border-2 border-gray-200 dark:border-gray-700 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Chargement des données...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-5 text-sm text-red-700 dark:text-red-300">
        <p className="font-medium mb-1">Erreur de chargement</p>
        <p className="text-red-600/80 dark:text-red-400/80">{error}</p>
      </div>
    )
  }

  const competitorEntries = Object.entries(productsBySite.otherSites)
  const scraperCacheCount = scraperCache.length

  return (
    <div className="space-y-6">
      {/* Migration */}
      {showMigrationPrompt && user && (
        <div className="flex items-center gap-4 rounded-2xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 px-5 py-4 text-sm">
          <div className="flex-1">
            <p className="font-medium text-blue-900 dark:text-blue-200">Scrapings locaux disponibles</p>
            <p className="text-blue-700/80 dark:text-blue-300/80 text-xs mt-0.5">{getLocalScrapingsCount()} scraping{getLocalScrapingsCount() > 1 ? "s" : ""} sauvegardé{getLocalScrapingsCount() > 1 ? "s" : ""} localement</p>
          </div>
          <button onClick={handleMigrateScrapings} disabled={migrating} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition disabled:opacity-50">{migrating ? "Migration..." : "Migrer"}</button>
          <button onClick={() => setShowMigrationPrompt(false)} className="text-blue-400 hover:text-blue-600 transition"><X className="h-4 w-4" /></button>
        </div>
      )}

      <LimitWarning type="scrapings" current={scrapingLimit.current} limit={scrapingLimit.limit} plan={user?.subscription_plan || null} isAuthenticated={!!user} />

      {/* ── En-tête ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {new Intl.DateTimeFormat("fr-CA", { dateStyle: "long" }).format(new Date())}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleRefresh} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] px-3.5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition shadow-sm" title="Actualiser">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
          <button type="button" onClick={() => setShowScraperConfig(true)} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] px-3.5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition shadow-sm" title="Configurer">
            <Settings2 className="h-4 w-4" />
            Configurer
          </button>
        </div>
      </div>

      {/* ── Statistiques ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Produits", value: filteredProducts.length, sub: "Catalogue filtré", icon: Search, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
          { label: "Référence", value: configuredReferenceSite || referenceSite || "Non défini", sub: "Site principal", icon: Star, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
          { label: "Concurrents", value: Object.keys(productsBySite.otherSites).length, sub: "Sites actifs", icon: Globe, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30" },
          { label: "Comparés", value: productsBySite.compared.length, sub: "Correspondances", icon: ArrowRightLeft, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
        ].map((s, i) => {
          const Icon = s.icon
          return (
            <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] p-5 hover:shadow-lg hover:shadow-gray-900/5 dark:hover:shadow-black/20 transition-all hover:-translate-y-0.5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-xl ${s.bg}`}><Icon className={`h-4 w-4 ${s.color}`} /></div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{s.label}</p>
              </div>
              <p className={`font-bold text-gray-900 dark:text-white break-all ${typeof s.value === 'string' && s.value.length > 14 ? 'text-sm' : 'text-2xl'}`}>{s.value}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{s.sub}</p>
            </div>
          )
        })}
      </div>

      {/* Notification */}
      {scrapeNotification && (
        <div className={`flex items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300 ${
          scrapeNotification.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-200'
            : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-200'
        }`}>
          <span>{scrapeNotification.message}</span>
          <button type="button" onClick={() => setScrapeNotification(null)} className="opacity-50 hover:opacity-100 transition"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* ── Scraping ── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] p-6 hover:shadow-lg hover:shadow-gray-900/5 dark:hover:shadow-black/20 transition-shadow">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Lancer un scraping</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Extrait et compare les produits de vos concurrents automatiquement.</p>
          </div>
          <div className="flex items-center gap-2">
            {scraperCacheCount > 0 && (
              <button type="button" onClick={() => setShowCacheModal(true)} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] px-3.5 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition shadow-sm">
                <Wand2 className="h-3.5 w-3.5 text-purple-500" />
                {scraperCacheCount} scraper{scraperCacheCount > 1 ? 's' : ''} en cache
              </button>
            )}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] px-3.5 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-400">
              {competitorEntries.length} concurrent{competitorEntries.length > 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {isScrapingActive ? (
          <ScraperConfig
            ref={inlineScraperRef}
            onScrapeStart={() => setIsScrapingActive(true)}
            onScrapeComplete={() => { setIsScrapingActive(false); handleScrapeComplete() }}
            hideHeader showLaunchButton={false} logsOnlyMode={true}
            onReferenceUrlChange={(_, domain) => setConfiguredReferenceSite(domain)}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setIsScrapingActive(true); setShouldStartScraping(true) }}
            className="group w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-blue-600 via-blue-600 to-purple-600 hover:from-blue-700 hover:via-blue-700 hover:to-purple-700 text-white rounded-xl font-semibold text-sm shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30 transition-all hover:-translate-y-0.5 active:translate-y-0"
          >
            <Zap className="h-4 w-4 group-hover:scale-110 transition-transform" />
            Lancer le scraping
          </button>
        )}
      </div>

      {/* ── Filtres ── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="w-full flex items-center justify-between px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/[0.02] transition"
        >
          <span className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.06]"><Search className="h-4 w-4 text-gray-500 dark:text-gray-400" /></div>
            Filtres et recherche
            {hasActiveFilters && <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />}
          </span>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-300 ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${showFilters ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="px-6 pb-6 space-y-5 border-t border-gray-100 dark:border-gray-800 pt-5">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher par nom, marque ou modèle..."
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition"
              />
              {searchQuery && <button type="button" onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition"><X className="h-4 w-4" /></button>}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: "Site", value: selectedSite, onChange: setSelectedSite, options: uniqueSites, all: "Tous les sites" },
                { label: "Marque", value: selectedMarque, onChange: setSelectedMarque, options: uniqueMarques, all: "Toutes les marques" },
                { label: "État", value: selectedEtat, onChange: setSelectedEtat, options: uniqueEtats, all: "Tous les états", labelMap: { ...etatLabels, ...sourceCategorieLabels } as Record<string, string> },
                { label: "Catégorie", value: selectedCategory, onChange: setSelectedCategory, options: uniqueCategories, all: "Toutes", labelMap: categoryLabels },
                { label: "Produit", value: selectedProduct, onChange: setSelectedProduct, options: uniqueProductsNames, all: "Tous les produits" },
                { label: "Disponibilité", value: selectedDisponibilite, onChange: setSelectedDisponibilite, options: uniqueDisponibilites, all: "Toutes", labelMap: disponibiliteLabels },
              ].map(f => (
                <div key={f.label}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{f.label}</p>
                  <select value={f.value} onChange={e => f.onChange(e.target.value)} className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition shadow-sm">
                    <option value="all">{f.all}</option>
                    {f.options.map(o => <option key={o} value={o}>{((f as any).labelMap as Record<string, string> | undefined)?.[o as string] || o}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-100 dark:border-gray-800">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mr-2">Trier par</span>
              {[
                { value: "marque", label: "Marque" }, { value: "site", label: "Concessionnaire" },
                { value: "prix", label: "Prix" }, { value: "annee", label: "Année" }, { value: "name", label: "Nom" },
              ].map(o => (
                <button key={o.value} type="button"
                  onClick={() => { if (sortBy === o.value) setSortOrder(sortOrder === "asc" ? "desc" : "asc"); else { setSortBy(o.value as typeof sortBy); setSortOrder("asc") } }}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                    sortBy === o.value
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm"
                      : "border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                  }`}
                >
                  {o.label}{sortBy === o.value && <span className="text-[10px]">{sortOrder === "asc" ? "↑" : "↓"}</span>}
                </button>
              ))}
              {hasActiveFilters && (
                <button type="button" onClick={resetFilters} className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition">
                  <RotateCcw className="h-3 w-3" /> Réinitialiser
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Vue des produits ── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Vue des produits</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{filteredProducts.length} produit{filteredProducts.length !== 1 ? 's' : ''}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { key: "reference", label: "Référence", count: productsBySite.reference.length, icon: Star, activeColor: "bg-amber-500 shadow-amber-500/25" },
              { key: "allCompetitors", label: "Concurrents", count: productsBySite.allCompetitors.length, icon: Globe, activeColor: "bg-blue-500 shadow-blue-500/25" },
              { key: "compared", label: "Comparés", count: productsBySite.compared.length, icon: ArrowRightLeft, activeColor: "bg-emerald-500 shadow-emerald-500/25" },
            ].map(t => {
              const Icon = t.icon
              return (
                <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                    activeTab === t.key
                      ? `${t.activeColor} text-white shadow-lg hover:-translate-y-0.5`
                      : "border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                  <span className={`text-xs ${activeTab === t.key ? 'opacity-75' : 'opacity-50'}`}>({t.count})</span>
                </button>
              )
            })}

            {Object.keys(productsBySite.otherSites).length > 0 && <div className="w-px h-8 bg-gray-200 dark:bg-gray-800 self-center mx-1" />}

            {Object.entries(productsBySite.otherSites).map(([siteUrl, siteProducts]) => (
              <button key={siteUrl} type="button" onClick={() => setActiveTab(`site-${siteUrl}`)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  activeTab === `site-${siteUrl}`
                    ? "bg-purple-500 text-white shadow-lg shadow-purple-500/25 hover:-translate-y-0.5"
                    : "border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                }`}
              >
                {extractDomain(siteUrl)}
                <span className={`text-xs ${activeTab === `site-${siteUrl}` ? 'opacity-75' : 'opacity-50'}`}>({siteProducts.length})</span>
              </button>
            ))}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            {activeTab === "reference" && "Tous les produits de votre site de référence"}
            {activeTab === "allCompetitors" && "L'ensemble des produits de vos concurrents"}
            {activeTab === "compared" && "Produits trouvés à la fois chez vous et chez un concurrent"}
            {activeTab.startsWith("site-") && `Produits de ${extractDomain(activeTab.replace("site-", ""))}`}
          </p>
        </div>

        <div className="p-0">
          <PriceComparisonTable products={filteredProducts} competitorsUrls={competitorEntries.flatMap(([, list]) => list.map(p => p.sourceSite || ""))} ignoreColors={ignoreColors} />
        </div>
      </div>

      {/* ── Modale cache ── */}
      {mounted && showCacheModal && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center px-4" onClick={e => { if (e.target === e.currentTarget) setShowCacheModal(false) }}>
          <div className="bg-white dark:bg-[#111114] rounded-2xl max-w-3xl w-full p-6 border border-gray-200 dark:border-gray-800 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h4 className="text-lg font-bold text-gray-900 dark:text-white">Scrapers en cache</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Sites avec scraper IA pré-configuré</p>
              </div>
              <button type="button" onClick={() => setShowCacheModal(false)} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition"><X className="h-5 w-5" /></button>
            </div>
            {scraperCacheCount === 0 ? (
              <div className="text-center py-8">
                <Wand2 className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Aucun scraper en cache. Lancez un scraping pour en créer un.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[60vh] overflow-y-auto">
                {scraperCache.map((scraper, idx) => {
                  const hostname = (() => { try { return new URL(scraper.url).hostname.replace(/^www\./, '') } catch { return scraper.url } })()
                  const createdDate = scraper.createdAt ? new Date(scraper.createdAt).toLocaleDateString('fr-FR') : '—'
                  return (
                    <div key={`${scraper.cacheKey || scraper.id}-${idx}`} className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 dark:border-gray-800 px-5 py-4 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition group">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 flex-shrink-0">
                          <Wand2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{hostname}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mt-0.5">
                            <span>{scraper.productUrlsCount || 0} URLs</span>
                            <span className="text-gray-300 dark:text-gray-600">·</span>
                            <span>{scraper.lastProductCount || 0} produits{scraper.inventoryOnly ? <span className="ml-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Inventaire</span> : null}</span>
                            <span className="text-gray-300 dark:text-gray-600">·</span>
                            <span>Créé le {createdDate}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${scraper.status === 'active' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}>
                          {scraper.status === 'active' ? 'Actif' : 'Expiré'}
                        </span>
                        <button
                          onClick={async () => {
                            try {
                              const params = new URLSearchParams({ cache_key: scraper.cacheKey || '', user_id: user?.id || '', url: scraper.url || '' })
                              const response = await fetch(`/api/scraper-ai/cache?${params.toString()}`, { method: 'DELETE' })
                              if (response.ok) { setScraperCache(prev => prev.filter((_, i) => i !== idx)); setPendingRemovedCacheUrls(prev => [...prev, scraper.url]); scraperRef.current?.removeUrlFromConfig(scraper.url) }
                            } catch (error) { console.error(error) }
                          }}
                          className="p-2 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition opacity-0 group-hover:opacity-100"
                        ><Trash2 className="h-4 w-4" /></button>
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

      {/* ── Modale config ── */}
      {mounted && createPortal(
        <div
          className={showScraperConfig ? "fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998] flex items-center justify-center px-4" : "hidden"}
          onClick={async e => { if (e.target === e.currentTarget) { await scraperRef.current?.saveConfig(); setShowScraperConfig(false) } }}
        >
          <div className="bg-white dark:bg-[#111114] rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col border border-gray-200 dark:border-gray-800 shadow-2xl">
            <div className="flex items-center justify-between p-5 pb-4 border-b border-gray-100 dark:border-gray-800">
              <h4 className="text-lg font-bold text-gray-900 dark:text-white">Configuration</h4>
              <button type="button" onClick={async () => { await scraperRef.current?.saveConfig(); setShowScraperConfig(false) }} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              <ScraperConfig
                ref={scraperRef}
                onScrapeStart={() => setIsScrapingActive(true)}
                onScrapeComplete={() => { setIsScrapingActive(false); handleScrapeComplete(); setTimeout(() => setShowScraperConfig(false), 2000) }}
                hideHeader showLaunchButton={false}
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
  )
}
