"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { Search, X, RotateCcw, ChevronLeft, ChevronRight, Settings2, Radar, Eye, Loader2 } from "lucide-react"
import ScraperConfig, { ScraperConfigHandle } from "./scraper-config"
import { useAuth } from "@/contexts/auth-context"
import { getLocalScrapingsCount, migrateLocalScrapingsToSupabase } from "@/lib/local-storage"
import LimitWarning from "./limit-warning"
import { useScrapingLimit } from "@/hooks/use-scraping-limit"
import { useLanguage } from "@/contexts/language-context"
import { KNOWN_BRANDS, normalizeProductGroupKey, type MatchMode } from "@/lib/analytics-calculations"
import { getEffectiveStatus } from "@/lib/product-status"
import PriceComparisonTable from "./price-comparison-table"
import Celebration from "./celebration"
import CompetitorCards from "./competitor-cards"
import { DashboardSkeleton } from "./skeleton-loader"
import { toast } from "sonner"

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
  quantity?: number
  inventaire?: string
  groupedUrls?: string[]
}

export type DashboardView = "comparaisons" | "surveillance"

interface ScraperDashboardProps {
  initialData?: { products: Product[] }
  view?: DashboardView
}

const vehicleTypeLabels: Record<string, string> = {
  moto: "Moto",
  vtt: "VTT / Quad",
  "cote-a-cote": "Côte-à-côte",
  motoneige: "Motoneige",
  motomarine: "Motomarine",
  "3-roues": "3 roues",
  ponton: "Ponton",
  bateau: "Bateau",
  "moteur-hors-bord": "Moteur hors-bord",
  equipement: "Équipement",
  remorque: "Remorque",
  "velo-electrique": "Vélo électrique",
  autre: "Autre",
}

const competitiviteLabels: Record<string, string> = {
  competitif: "Compétitif",
  non_competitif: "Non compétitif",
}

const etatLabels: Record<string, string> = {
  neuf: "Neuf", occasion: "Usagé", demonstrateur: "Démonstrateur"
}

const sourceCategorieLabels: Record<string, string> = {
  inventaire: "Inventaire", catalogue: "Catalogue", vehicules_occasion: "Inventaire usagé"
}

const BRAND_DISPLAY: Record<string, string> = {
  "cfmoto": "CFMOTO",
  "cf moto": "CFMOTO",
  "kawasaki": "Kawasaki",
  "suzuki": "Suzuki",
  "royal enfield": "Royal Enfield",
  "arctic cat": "Arctic Cat",
  "ktm": "KTM",
  "husqvarna": "Husqvarna",
  "yamaha": "Yamaha",
  "honda": "Honda",
  "polaris": "Polaris",
  "can-am": "Can-Am",
  "can am": "Can-Am",
  "sea-doo": "Sea-Doo",
  "sea doo": "Sea-Doo",
  "ski-doo": "Ski-Doo",
  "ski doo": "Ski-Doo",
  "brp": "BRP",
  "triumph": "Triumph",
  "harley-davidson": "Harley-Davidson",
  "harley davidson": "Harley-Davidson",
  "indian": "Indian",
  "bmw": "BMW",
  "ducati": "Ducati",
  "aprilia": "Aprilia",
  "beta": "Beta",
  "gasgas": "GasGas",
  "gas gas": "GasGas",
  "sherco": "Sherco",
  "rfn": "RFN",
  "argo": "Argo",
  "campagna": "Campagna",
  "starcraft": "Starcraft",
  "talaria": "Talaria",
  "scootterre": "Scootterre",
  "segway": "Segway",
  "sur-ron": "Sur-Ron",
  "surron": "Sur-Ron",
}

function normalizeMarque(raw: string): string {
  if (!raw) return ""
  const key = raw.toLowerCase().replace(/\s+/g, " ").trim()
  return BRAND_DISPLAY[key] || raw
}

function inferVehicleType(product: Product): string {
  const url = (product.sourceUrl || "").toLowerCase()
  const name = (product.name || "").toLowerCase()

  if (/\/velos?-electriques?/.test(url)) return "velo-electrique"
  if (/\/moto-trois-roues|\/three-wheel/.test(url)) return "3-roues"
  if (/\/motocyclette|\/motorcycle|\/motocyclettes-/.test(url)) return "moto"
  if (/\/vtt[/-]|\/atv[/-]/.test(url)) return "vtt"
  if (/\/cote-a-cote|\/side-by-side/.test(url)) return "cote-a-cote"
  if (/\/motoneige|\/snowmobile/.test(url)) return "motoneige"
  if (/\/motomarine|\/watercraft/.test(url)) return "motomarine"
  if (/\/ponton|\/pontoon/.test(url)) return "ponton"
  if (/\/bateau|\/boat/.test(url)) return "bateau"
  if (/\/moteur-hors-bord|\/outboard/.test(url)) return "moteur-hors-bord"
  if (/\/equipement-mecanique|\/power-equipment/.test(url)) return "equipement"
  if (/\/remorque|\/trailer/.test(url)) return "remorque"
  if (/\/argo\//.test(url) || /\bargo\b/.test(name)) return "vtt"

  if (/\b(?:ninja|z900|versys|klx|klr|vulcan|kx\d|scrambler|duke|ibex|street|bonneville)\b/.test(name)) return "moto"
  if (/\b(?:brute force|cforce|kfx|outlander|kingquad)\b/.test(name)) return "vtt"
  if (/\b(?:teryx|mule|uforce|zforce|maverick|ranger|rzr|defender)\b/.test(name)) return "cote-a-cote"
  if (/\b(?:jet ski|ultra 310)\b/.test(name)) return "motomarine"

  return "autre"
}

function getCompetitivite(product: Product): string | null {
  if (product.prixReference == null || !product.prix || product.prix <= 0) return null
  return product.prix <= product.prixReference ? "competitif" : "non_competitif"
}

const BRANDS_LOWER = KNOWN_BRANDS.map(b => b.toLowerCase())

function getEffectiveMarque(product: Product): string {
  const raw = product.marque
  if (raw) {
    const cleaned = raw.replace(/^Manufacturier\s*:\s*/i, "").trim()
    if (cleaned && cleaned.toLowerCase() !== "manufacturier") return normalizeMarque(cleaned)
  }
  const nameLower = (product.name || "").toLowerCase()
  for (let i = 0; i < BRANDS_LOWER.length; i++) {
    const brand = BRANDS_LOWER[i]
    const idx = nameLower.indexOf(brand)
    if (idx !== -1) {
      const after = nameLower[idx + brand.length]
      if (idx === 0 || nameLower[idx - 1] === ' ') {
        if (!after || after === ' ' || after === '-') {
          return normalizeMarque(brand)
        }
      }
    }
  }
  return ""
}

export default function ScraperDashboard({ initialData, view }: ScraperDashboardProps) {
  const showComparisons = view !== "surveillance"
  const showSurveillance = view !== "comparaisons"
  const { user } = useAuth()
  const scrapingLimit = useScrapingLimit()
  const { t, locale } = useLanguage()

  const vehicleTypeLabelsTr = useMemo(() => ({
    moto: t("vt.moto"), vtt: t("vt.vtt"), "cote-a-cote": t("vt.sxs"),
    motoneige: t("vt.snowmobile"), motomarine: t("vt.watercraft"), "3-roues": t("vt.threeWheel"),
    ponton: t("vt.pontoon"), bateau: t("vt.boat"), "moteur-hors-bord": t("vt.outboard"),
    equipement: t("vt.equipment"), remorque: t("vt.trailer"), "velo-electrique": t("vt.ebike"),
    autre: t("vt.other"),
  }), [t])

  const competitiviteLabelsTr = useMemo(() => ({
    competitif: t("comp.competitive"), non_competitif: t("comp.notCompetitive"),
  }), [t])

  const etatLabelsTr = useMemo(() => ({
    neuf: t("etat.new"), occasion: t("etat.used"), demonstrateur: t("etat.demo"),
  }), [t])

  const sourceCategorieLabelsTr = useMemo(() => ({
    inventaire: t("etat.inventory"), catalogue: t("etat.catalog"), vehicules_occasion: t("etat.usedInventory"),
  }), [t])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false)
  const [migrating, setMigrating] = useState(false)

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [selectedMarque, setSelectedMarque] = useState<string>("all")
  const [selectedCompetitivite, setSelectedCompetitivite] = useState<string>("all")
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
  const [showColorsInNames, setShowColorsInNames] = useState(true)
  const [matchMode, setMatchMode] = useState<MatchMode>('exact')
  const [showFilters, setShowFilters] = useState(false)
  const [refreshingFromCron, setRefreshingFromCron] = useState(false)
  const [lastScrapingTime, setLastScrapingTime] = useState<Date | null>(null)
  const [alertLastRunAt, setAlertLastRunAt] = useState<Date | null>(null)
  const [alertIntervalMinutes, setAlertIntervalMinutes] = useState(60)
  const scraperRef = useRef<ScraperConfigHandle | null>(null)
  const inlineScraperRef = useRef<ScraperConfigHandle | null>(null)
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollTabLeft, setCanScrollTabLeft] = useState(false)
  const [canScrollTabRight, setCanScrollTabRight] = useState(false)

  useEffect(() => {
    setMounted(true)
    setShouldStartScraping(false)
    try {
      const raw = localStorage.getItem("go-data-scraping-session")
      if (raw) {
        const session = JSON.parse(raw)
        if (session?.logFile && (Date.now() - session.startTime) < 30 * 60_000) {
          setIsScrapingActive(true)
          return
        }
      }
    } catch {}
    setIsScrapingActive(false)
  }, [])

  const checkTabScroll = useCallback(() => {
    const el = tabScrollRef.current
    if (!el) return
    setCanScrollTabLeft(el.scrollLeft > 2)
    setCanScrollTabRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const el = tabScrollRef.current
    if (!el) return
    checkTabScroll()
    el.addEventListener("scroll", checkTabScroll, { passive: true })
    const ro = new ResizeObserver(checkTabScroll)
    ro.observe(el)
    return () => { el.removeEventListener("scroll", checkTabScroll); ro.disconnect() }
  }, [checkTabScroll, products])

  const scrollTabs = useCallback((dir: "left" | "right") => {
    tabScrollRef.current?.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" })
  }, [])

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
        const scrapedAt = data.updatedAt || data.createdAt || data.metadata?.updated_at || data.metadata?.created_at
        if (scrapedAt) {
          setLastScrapingTime(new Date(scrapedAt))
        }
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
            if (configData.matchMode) setMatchMode(configData.matchMode as MatchMode)
            if (configData.alertLastRunAt) setAlertLastRunAt(new Date(configData.alertLastRunAt))
            if (configData.alertIntervalMinutes) setAlertIntervalMinutes(configData.alertIntervalMinutes)
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
  const [showCelebration, setShowCelebration] = useState(false)
  const justCompletedScrapingRef = useRef(false)

  const handleScrapeComplete = () => {
    justCompletedScrapingRef.current = true
    setLastScrapingTime(new Date())
    setShowCelebration(true)
    if (user) localStorage.setItem(`has_scraped_${user.id}`, "true")
    // Delay to let Supabase commit the new scraping before refreshing
    setTimeout(() => setRefreshKey(prev => prev + 1), 2000)
    // Safety-net retry in case the first refresh was too early
    setTimeout(() => setRefreshKey(prev => prev + 1), 6000)
  }
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
    return Array.from(new Set(products.map(p => inferVehicleType(p)).filter(v => v !== "autre"))).sort()
  }, [products])

  const uniqueMarques = useMemo(() => {
    return Array.from(new Set(products.map(p => getEffectiveMarque(p)).filter(Boolean))).sort()
  }, [products])

  const uniqueSites = useMemo(() => {
    return Array.from(new Set(products.map(p => p.sourceSite && extractDomain(p.sourceSite)).filter(Boolean))).sort()
  }, [products])

  const uniqueProductsNames = useMemo(() => {
    return Array.from(new Set(products.map(p => p.name).filter(Boolean))).sort()
  }, [products])

  const uniqueCompetitivites = useMemo(() => {
    const vals = products.map(p => getCompetitivite(p)).filter((v): v is string => !!v)
    return Array.from(new Set(vals)).sort()
  }, [products])

  const uniqueEtats = useMemo(() => {
    return Array.from(new Set(products.map(p => getEffectiveStatus(p.etat, p.sourceCategorie)).filter(Boolean))).sort()
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

  // Nombre de « comparés » = groupes uniques (une ligne = un véhicule référent), pas le nombre de lignes produit
  const comparedUniqueCount = useMemo(() => {
    const withRef = products.filter(p => p.prixReference != null && p.prixReference !== undefined)
    const keys = new Set(withRef.map(p => normalizeProductGroupKey(p as any)))
    return keys.size
  }, [products])

  useEffect(() => { setCacheItems(productsBySite.reference) }, [productsBySite.reference])
  useEffect(() => { setCacheDisplay(cacheItems.slice(0, 2)) }, [cacheItems])

  useEffect(() => {
    const { compared, reference, allCompetitors } = productsBySite
    if (justCompletedScrapingRef.current && (reference.length > 0 || allCompetitors.length > 0)) {
      justCompletedScrapingRef.current = false
      const parts: string[] = []
      if (reference.length > 0) parts.push(`${reference.length} référence`)
      if (allCompetitors.length > 0) parts.push(`${allCompetitors.length} concurrents`)
      if (comparedUniqueCount > 0) parts.push(`${comparedUniqueCount} comparés`)
      const totalProducts = reference.length + allCompetitors.length
      if (totalProducts > 0) {
        const notifType = comparedUniqueCount > 0 || !allCompetitors.length ? 'success' : 'warning'
        setScrapeNotification({ message: `${totalProducts} produits extraits — ${parts.join(', ')}`, type: notifType })
        if (notifType === 'success') {
          toast.success(`${totalProducts} produits extraits`, { description: parts.join(', '), duration: 8000 })
        } else {
          toast.warning(`${totalProducts} produits extraits`, { description: parts.join(', '), duration: 8000 })
        }
        setTimeout(() => setScrapeNotification(null), 10_000)
      }
      if (comparedUniqueCount > 0) setActiveTab("compared")
      else if (allCompetitors.length > 0) setActiveTab("allCompetitors")
      else setActiveTab("reference")
      return
    }
    if (activeTab === "compared" && comparedUniqueCount === 0 && reference.length > 0) setActiveTab("reference")
    else if (activeTab === "reference" && reference.length === 0 && comparedUniqueCount > 0) setActiveTab("compared")
    else if (activeTab === "reference" && reference.length === 0 && allCompetitors.length > 0) setActiveTab("allCompetitors")
  }, [activeTab, productsBySite, comparedUniqueCount])

  const filteredProducts = useMemo(() => {
    let filtered: Product[] = []
    if (activeTab === "compared") filtered = [...productsBySite.compared]
    else if (activeTab === "reference") filtered = [...productsBySite.reference]
    else if (activeTab === "allCompetitors") filtered = [...productsBySite.allCompetitors]
    else if (activeTab.startsWith("site-")) filtered = productsBySite.grouped[activeTab.replace("site-", "")] || []
    else filtered = [...products]

    if (searchQuery) {
      const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean)
      filtered = filtered.filter(p => {
        const name = (p.name || "").toLowerCase()
        const marque = getEffectiveMarque(p).toLowerCase()
        const modele = (p.modele || "").toLowerCase()
        const annee = p.annee ? String(p.annee) : ""
        const site = (p.sourceSite || "").toLowerCase()
        return tokens.every(tok =>
          name.includes(tok) || marque.includes(tok) || modele.includes(tok) || annee === tok || site.includes(tok)
        )
      })
    }
    if (selectedSite !== "all") filtered = filtered.filter(p => extractDomain(p.sourceSite || "") === selectedSite)
    if (selectedMarque !== "all") filtered = filtered.filter(p => getEffectiveMarque(p) === selectedMarque)
    if (selectedCategory !== "all") filtered = filtered.filter(p => inferVehicleType(p) === selectedCategory)
    if (selectedProduct !== "all") filtered = filtered.filter(p => p.name === selectedProduct)
    if (selectedCompetitivite !== "all") filtered = filtered.filter(p => getCompetitivite(p) === selectedCompetitivite)
    if (selectedEtat !== "all") filtered = filtered.filter(p => getEffectiveStatus(p.etat, p.sourceCategorie) === selectedEtat)
    if (priceDifferenceFilter !== null) filtered = filtered.filter(p => p.differencePrix != null && p.differencePrix >= priceDifferenceFilter)
    if (activeTab === "compared") filtered = filtered.filter(p => p.prixReference != null)

    filtered.sort((a, b) => {
      let aVal: any, bVal: any
      if (sortBy === "prix") { aVal = a.prix || 0; bVal = b.prix || 0 }
      else if (sortBy === "annee") { aVal = a.annee || 0; bVal = b.annee || 0 }
      else if (sortBy === "marque") { aVal = getEffectiveMarque(a).toLowerCase(); bVal = getEffectiveMarque(b).toLowerCase() }
      else if (sortBy === "site") { aVal = (a.sourceSite || "").toLowerCase(); bVal = (b.sourceSite || "").toLowerCase() }
      else { aVal = a.name || ""; bVal = b.name || "" }
      return sortOrder === "asc" ? (aVal > bVal ? 1 : aVal < bVal ? -1 : 0) : (aVal < bVal ? 1 : aVal > bVal ? -1 : 0)
    })
    return filtered
  }, [products, searchQuery, selectedSite, selectedCategory, selectedMarque, selectedProduct, selectedCompetitivite, selectedEtat, priceDifferenceFilter, sortBy, sortOrder, activeTab, productsBySite])

  const hasActiveFilters = useMemo(() => {
    return searchQuery !== "" || selectedSite !== "all" || selectedMarque !== "all" || selectedCategory !== "all" || selectedProduct !== "all" || selectedCompetitivite !== "all" || selectedEtat !== "all" || priceDifferenceFilter !== null
  }, [searchQuery, selectedSite, selectedMarque, selectedCategory, selectedProduct, selectedCompetitivite, selectedEtat, priceDifferenceFilter])

  // En onglet Comparés, une ligne = un groupe (véhicule); on affiche le nombre de lignes, pas de produits bruts
  const displayResultCount = useMemo(() => {
    if (activeTab !== "compared") return filteredProducts.length
    const keys = new Set(filteredProducts.map(p => normalizeProductGroupKey(p as any)))
    return keys.size
  }, [activeTab, filteredProducts])

  // Pas d'auto-reset : laisser l'utilisateur voir "0 résultats" et ajuster ses filtres

  const resetFilters = () => {
    setSearchQuery(""); setSelectedSite("all"); setSelectedMarque("all"); setSelectedCategory("all")
    setSelectedProduct("all"); setSelectedCompetitivite("all"); setSelectedEtat("all"); setPriceDifferenceFilter(null)
    setSortBy("prix"); setSortOrder("asc")
  }

  const handleRemoveCacheItem = (index: number) => { setCacheItems(prev => prev.filter((_, i) => i !== index)) }
  const handleClearCache = () => { setCacheItems([]) }

  const computeMonitoringStatus = useCallback(() => {
    const now = new Date()
    let lastAnalysisText = "—"
    let nextScanText = "—"

    if (lastScrapingTime) {
      const diffMs = now.getTime() - lastScrapingTime.getTime()
      const diffMin = Math.floor(diffMs / 60000)
      if (diffMin < 1) lastAnalysisText = t("alerts.now")
      else if (diffMin < 60) lastAnalysisText = t("dash.minutesAgo").replace("{0}", String(diffMin))
      else {
        const hours = Math.floor(diffMin / 60)
        const mins = diffMin % 60
        lastAnalysisText = mins > 0
          ? `${t("dash.hoursAgo").replace("{0}", String(hours))} ${String(mins).padStart(2, "0")}`
          : t("dash.hoursAgo").replace("{0}", String(hours))
      }
    }

    // Use alertLastRunAt (cron start) for next scan calculation — this is what the
    // cron actually checks for eligibility, not when the scraping data was saved.
    const baseTime = alertLastRunAt || lastScrapingTime
    const intervalMin = alertIntervalMinutes
    if (baseTime) {
      const nextScanTime = new Date(baseTime.getTime() + intervalMin * 60000)
      const remainingMs = nextScanTime.getTime() - now.getTime()
      if (remainingMs <= 0) {
        nextScanText = t("dash.scanOverdue")
      } else {
        const nextScanMin = Math.ceil(remainingMs / 60000)
        nextScanText = t("dash.inMinutes").replace("{0}", String(nextScanMin))
      }
    } else {
      nextScanText = t("dash.inMinutes").replace("{0}", "~60")
    }

    return { lastAnalysisText, nextScanText }
  }, [lastScrapingTime, alertLastRunAt, alertIntervalMinutes, t])

  const [monitoringStatus, setMonitoringStatus] = useState(computeMonitoringStatus)

  useEffect(() => {
    setMonitoringStatus(computeMonitoringStatus())
    const interval = setInterval(() => setMonitoringStatus(computeMonitoringStatus()), 30_000)
    return () => clearInterval(interval)
  }, [computeMonitoringStatus])

  // ── Render ──

  if (loading) {
    return <DashboardSkeleton />
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-5 text-sm text-red-700 dark:text-red-300">
        <p className="font-medium mb-1">{t("dash.loadError")}</p>
        <p className="text-red-600/80 dark:text-red-400/80">{error}</p>
      </div>
    )
  }

  const competitorEntries = Object.entries(productsBySite.otherSites)
  const scraperCacheCount = scraperCache.length

  return (
    <div className="space-y-5">
      {showCelebration && <Celebration onComplete={() => setShowCelebration(false)} />}

      {/* Migration */}
      {showMigrationPrompt && user && (
        <div className="flex items-center gap-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 px-5 py-4 text-sm">
          <div className="flex-1">
            <p className="font-medium text-emerald-900 dark:text-emerald-200">{t("dash.localScrapings")}</p>
            <p className="text-emerald-700/80 dark:text-emerald-300/80 text-xs mt-0.5">{getLocalScrapingsCount()} scraping{getLocalScrapingsCount() > 1 ? "s" : ""} sauvegardé{getLocalScrapingsCount() > 1 ? "s" : ""} localement</p>
          </div>
          <button onClick={handleMigrateScrapings} disabled={migrating} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-50">{migrating ? t("dash.migrating") : t("dash.migrate")}</button>
          <button onClick={() => setShowMigrationPrompt(false)} className="text-emerald-400 hover:text-emerald-600 transition"><X className="h-4 w-4" /></button>
        </div>
      )}

      <LimitWarning type="scrapings" current={scrapingLimit.current} limit={scrapingLimit.limit} plan={user?.subscription_plan || null} isAuthenticated={!!user} />

      {/* ── KPI row — Stripe-style: monochrome, sober, uniform ── */}
      <div data-onboarding="scrape" className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-[var(--color-border-tertiary)]">
          {/* Produits */}
          <div className="px-6 py-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
              {t("dash.products")}
            </p>
            <p className="text-[28px] font-semibold text-[var(--color-text-primary)] tabular-nums leading-none tracking-tight">
              {displayResultCount.toLocaleString(locale === 'en' ? 'en-CA' : 'fr-CA')}
            </p>
          </div>

          {/* Référence */}
          <div className="px-6 py-5 min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
              {t("dash.reference")}
            </p>
            <p
              className={`font-semibold text-[var(--color-text-primary)] leading-none tracking-tight truncate ${
                (configuredReferenceSite || referenceSite || "").length > 18 ? 'text-base' : 'text-lg'
              }`}
              title={configuredReferenceSite || referenceSite || "—"}
            >
              {configuredReferenceSite || referenceSite || "—"}
            </p>
          </div>

          {/* Concurrents */}
          <div className="px-6 py-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
              {t("dash.competitors")}
            </p>
            <p className="text-[28px] font-semibold text-[var(--color-text-primary)] tabular-nums leading-none tracking-tight">
              {Object.keys(productsBySite.otherSites).length}
            </p>
          </div>

          {/* Comparés */}
          <div className="px-6 py-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
              {t("dash.compared")}
            </p>
            <p className="text-[28px] font-semibold text-[var(--color-text-primary)] tabular-nums leading-none tracking-tight">
              {comparedUniqueCount.toLocaleString(locale === 'en' ? 'en-CA' : 'fr-CA')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Cartes concurrents comparés ── */}
      {showComparisons && Object.keys(productsBySite.otherSites).length > 0 && (
        <CompetitorCards
          competitorsBySite={productsBySite.otherSites}
          onSelect={(siteUrl) => setActiveTab(`site-${siteUrl}`)}
        />
      )}

      {/* Notification */}
      {scrapeNotification && (
        <div className={`flex items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300 ${
          scrapeNotification.type === 'success'
            ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-200'
            : 'bg-amber-50/80 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/40 text-amber-800 dark:text-amber-200'
        }`}>
          <span>{scrapeNotification.message}</span>
          <button type="button" onClick={() => setScrapeNotification(null)} className="opacity-50 hover:opacity-100 transition"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* ── Empty state ── */}
      {products.length === 0 && !isScrapingActive && (
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-10 text-center">
          <div className="max-w-md mx-auto">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 flex items-center justify-center mb-5">
              <Radar className="h-7 w-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">{t("dash.noData")}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">
              {t("dash.noDataDesc")}
            </p>
            <button
              type="button"
              onClick={() => setShowScraperConfig(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-semibold text-sm shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
            >
              <Settings2 className="h-4 w-4" />
              {t("dash.launchFirst")}
            </button>
          </div>
        </div>
      )}

      {showSurveillance && (<>
      {/* ── Surveillance + Actions — Stripe-style toolbar ── */}
      <div data-onboarding="scrape" className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Gauche : status compact */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
              {t("dash.marketMonitoring")}
            </span>
            {monitoringStatus.lastAnalysisText && monitoringStatus.lastAnalysisText !== "—" && (
              <span className="text-xs text-[var(--color-text-secondary)] hidden sm:inline tabular-nums">
                · {monitoringStatus.lastAnalysisText}
              </span>
            )}
          </div>

          {/* Droite : actions */}
          <div className="flex items-center gap-1">
            <button
              data-onboarding="config"
              type="button"
              onClick={() => setShowScraperConfig(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("dash.configuration")}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium transition-colors ${
                showFilters || hasActiveFilters
                  ? 'text-[var(--color-text-primary)] bg-[var(--color-background-secondary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("dash.filters")}</span>
              {hasActiveFilters && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            </button>

            <div className="w-px h-5 bg-[var(--color-border-tertiary)] mx-1" />

            <button
              type="button"
              disabled={refreshingFromCron}
              onClick={async () => {
                setRefreshingFromCron(true)
                try {
                  const res = await fetch('/api/products/analyze', { method: 'POST' })
                  const data = await res.json()
                  if (data.success) {
                    toast.success(t("dash.dataRefreshed"), { duration: 3000 })
                    setTimeout(() => setRefreshKey(prev => prev + 1), 1000)
                  } else {
                    toast.warning(t("dash.noCachedData"), { duration: 5000 })
                    setRefreshKey(prev => prev + 1)
                  }
                } catch {
                  setRefreshKey(prev => prev + 1)
                } finally {
                  setTimeout(() => setRefreshingFromCron(false), 2000)
                }
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium bg-[var(--color-text-primary)] text-[var(--color-background-primary)] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {refreshingFromCron ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              {t("dash.analyzeNow")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Filtres — Popup, Stripe-style ── */}
      {showFilters && mounted && createPortal(
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[9997] flex items-start justify-center pt-[15vh] px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowFilters(false) }}
        >
          <div className="bg-[var(--color-background-primary)] rounded-xl w-full max-w-2xl border border-[var(--color-border-tertiary)] shadow-xl animate-in fade-in slide-in-from-top-4 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border-tertiary)]">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t("dash.filters")}</h3>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 tabular-nums">
                  {displayResultCount} {displayResultCount !== 1 ? t("dash.results") : t("dash.result")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFilters(false)}
                className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: t("dash.site"), value: selectedSite, onChange: setSelectedSite, options: uniqueSites, all: t("dash.allSites") },
                  { label: t("dash.brand"), value: selectedMarque, onChange: setSelectedMarque, options: uniqueMarques, all: t("dash.allBrands") },
                  { label: t("dash.state"), value: selectedEtat, onChange: setSelectedEtat, options: uniqueEtats, all: t("dash.allStates"), labelMap: { ...etatLabelsTr, ...sourceCategorieLabelsTr } as Record<string, string> },
                  { label: t("dash.category"), value: selectedCategory, onChange: setSelectedCategory, options: uniqueCategories, all: t("dash.allCategories"), labelMap: vehicleTypeLabelsTr },
                  { label: t("dash.product"), value: selectedProduct, onChange: setSelectedProduct, options: uniqueProductsNames, all: t("dash.allProducts") },
                  { label: t("dash.competitiveness"), value: selectedCompetitivite, onChange: setSelectedCompetitivite, options: uniqueCompetitivites, all: t("dash.all"), labelMap: competitiviteLabelsTr },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-[11px] font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider">{f.label}</p>
                    <select
                      value={f.value}
                      onChange={e => f.onChange(e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition"
                    >
                      <option value="all" style={{ backgroundColor: "#ffffff", color: "#111827" }}>
                        {f.all}
                      </option>
                      {f.options.map(o => (
                        <option key={o} value={o} style={{ backgroundColor: "#ffffff", color: "#111827" }}>
                          {((f as any).labelMap as Record<string, string> | undefined)?.[o as string] || o}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-[var(--color-border-tertiary)]">
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Réinitialiser
                </button>
              ) : <div />}
              <button
                type="button"
                onClick={() => setShowFilters(false)}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[var(--color-text-primary)] text-[var(--color-background-primary)] text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Appliquer
                <span className="text-xs opacity-70 tabular-nums">· {displayResultCount}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Inline scraping active */}
      {isScrapingActive && (
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5">
          <ScraperConfig
            ref={inlineScraperRef}
            onScrapeStart={() => setIsScrapingActive(true)}
            onScrapeComplete={() => { setIsScrapingActive(false); handleScrapeComplete() }}
            hideHeader showLaunchButton={false} logsOnlyMode={true}
            onReferenceUrlChange={(_, domain) => setConfiguredReferenceSite(domain)}
          />
        </div>
      )}

      {/* ── Produits — section principale ── */}
      <div data-onboarding="analyze" className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] overflow-hidden">

        {/* Tab bar — Stripe minimal underline */}
        <div className="px-0">
          <div className="relative border-b border-[var(--color-border-tertiary)]">
            {canScrollTabLeft && (
              <button type="button" onClick={() => scrollTabs("left")} className="absolute left-0 top-0 bottom-0 z-10 flex items-center pl-1.5 pr-3 bg-gradient-to-r from-[var(--color-background-primary)] via-[var(--color-background-primary)]/90 to-transparent">
                <ChevronLeft className="h-4 w-4 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors" />
              </button>
            )}
            {canScrollTabRight && (
              <button type="button" onClick={() => scrollTabs("right")} className="absolute right-0 top-0 bottom-0 z-10 flex items-center pr-1.5 pl-3 bg-gradient-to-l from-[var(--color-background-primary)] via-[var(--color-background-primary)]/90 to-transparent">
                <ChevronRight className="h-4 w-4 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors" />
              </button>
            )}
            <div ref={tabScrollRef} className="flex items-end gap-0 px-4 overflow-x-auto scrollbar-hide">
              {[
                { key: "reference", label: t("dash.reference"), count: productsBySite.reference.length },
                { key: "allCompetitors", label: t("dash.competitors"), count: productsBySite.allCompetitors.length },
                { key: "compared", label: t("dash.compared"), count: comparedUniqueCount },
              ].map(tab => {
                const isActive = activeTab === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className="relative flex items-center gap-2 px-3.5 py-3.5 group transition-colors whitespace-nowrap"
                  >
                    <span
                      className={`text-sm transition-colors ${
                        isActive
                          ? 'font-semibold text-[var(--color-text-primary)]'
                          : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      {tab.label}
                    </span>
                    <span
                      className={`text-[11px] font-medium tabular-nums transition-colors ${
                        isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'
                      }`}
                    >
                      {tab.count.toLocaleString(locale === 'en' ? 'en-CA' : 'fr-CA')}
                    </span>
                    <span
                      className={`absolute -bottom-px left-2 right-2 h-[2px] rounded-full transition-all duration-200 ${
                        isActive
                          ? 'bg-[var(--color-text-primary)] opacity-100'
                          : 'bg-transparent opacity-0 group-hover:opacity-30 group-hover:bg-[var(--color-text-secondary)]'
                      }`}
                    />
                  </button>
                )
              })}

              {Object.keys(productsBySite.otherSites).length > 0 && (
                <div className="w-px h-4 bg-[var(--color-border-tertiary)] self-center mx-2" />
              )}

              {Object.entries(productsBySite.otherSites).map(([siteUrl, siteProducts]) => {
                const isActive = activeTab === `site-${siteUrl}`
                return (
                  <button
                    key={siteUrl}
                    type="button"
                    onClick={() => setActiveTab(`site-${siteUrl}`)}
                    className="relative flex items-center gap-2 px-3.5 py-3.5 group transition-colors whitespace-nowrap"
                  >
                    <span
                      className={`text-sm transition-colors ${
                        isActive
                          ? 'font-semibold text-[var(--color-text-primary)]'
                          : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      {extractDomain(siteUrl)}
                    </span>
                    <span
                      className={`text-[11px] font-medium tabular-nums transition-colors ${
                        isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'
                      }`}
                    >
                      {siteProducts.length.toLocaleString(locale === 'en' ? 'en-CA' : 'fr-CA')}
                    </span>
                    <span
                      className={`absolute -bottom-px left-2 right-2 h-[2px] rounded-full transition-all duration-200 ${
                        isActive
                          ? 'bg-[var(--color-text-primary)] opacity-100'
                          : 'bg-transparent opacity-0 group-hover:opacity-30 group-hover:bg-[var(--color-text-secondary)]'
                      }`}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Toolbar + Table */}
        <PriceComparisonTable
          products={filteredProducts}
          competitorsUrls={competitorEntries.flatMap(([, list]) => list.map(p => p.sourceSite || ""))}
          ignoreColors={ignoreColors}
          stripColorsFromDisplay={!showColorsInNames || ignoreColors}
          matchMode={matchMode}
          onMatchModeChange={(mode) => setMatchMode(mode as MatchMode)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onToggleColors={() => setShowColorsInNames(prev => !prev)}
          searchPlaceholder={t("dash.searchPlaceholder")}
          hideColorsLabel={t("dash.hideColors")}
          showColorsLabel={t("dash.showColors")}
        />
      </div>
      </>)}

      {/* ── Modale config ── */}
      {mounted && createPortal(
        <div
          className={showScraperConfig ? "fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998] flex items-center justify-center px-4" : "hidden"}
          onClick={async e => { if (e.target === e.currentTarget) { await scraperRef.current?.saveConfig(); setShowScraperConfig(false) } }}
        >
          <div className="bg-[var(--color-background-primary)] rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col border border-[var(--color-border-secondary)] shadow-2xl">
            <div className="flex items-center justify-between p-5 pb-4 border-b border-[var(--color-border-tertiary)]">
              <h4 className="text-lg font-bold text-[var(--color-text-primary)]">{t("dash.configuration")}</h4>

              <button type="button" onClick={async () => { await scraperRef.current?.saveConfig(); setShowScraperConfig(false) }} className="p-2 rounded-xl text-gray-400 hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"><X className="h-5 w-5" /></button>
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
