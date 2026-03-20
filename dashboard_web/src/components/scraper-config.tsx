"use client"

import { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Play, Plus, X, Loader2, Star, Clock, CheckCircle2, AlertCircle, ChevronDown, Globe, Database, ChevronRight, Search, Sparkles, BadgeCheck, Trash2 } from "lucide-react"
import { useScrapingLimit } from "@/hooks/use-scraping-limit"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"

const DEFAULT_REFERENCE_URL = ""
const SCRAPING_SESSION_KEY = "go-data-scraping-session"

interface ScrapingSession {
  logFile: string
  startTime: number
  referenceUrl: string
}

function saveScrapingSession(session: ScrapingSession) {
  try { localStorage.setItem(SCRAPING_SESSION_KEY, JSON.stringify(session)) } catch {}
}
function loadScrapingSession(): ScrapingSession | null {
  try {
    const raw = localStorage.getItem(SCRAPING_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function clearScrapingSession() {
  try { localStorage.removeItem(SCRAPING_SESSION_KEY) } catch {}
}

type CachedScraper = {
  url: string
  site_name?: string
  created_at?: string
  updated_at?: string
}

type SharedScraper = {
  id: string
  site_name: string
  site_slug: string
  site_url: string
  site_domain: string
  description?: string
  categories?: string[]
  vehicle_types?: string[]
  logo_url?: string
  version?: string
}

type ScrapingStep = {
  id: string
  label: string
  status: 'pending' | 'active' | 'completed' | 'error'
}

const SCRAPING_STEPS: Omit<ScrapingStep, 'status'>[] = [
  { id: 'init', label: 'Initialisation' },
  { id: 'analyze', label: 'Analyse' },
  { id: 'scrape', label: 'Extraction' },
  { id: 'save', label: 'Sauvegarde' },
]

export interface ScraperConfigHandle {
  runScrape: () => Promise<void>
  saveConfig: () => Promise<void>
  /** Retire une URL de la config (référence ou concurrent) quand un scraper est supprimé du cache */
  removeUrlFromConfig: (urlOrDomain: string) => void
}

interface ScraperConfigProps {
  onScrapeStart?: () => void
  onScrapeComplete?: () => void
  showConfig?: boolean
  onToggleConfig?: () => void
  hideHeader?: boolean
  showLaunchButton?: boolean
  logsOnlyMode?: boolean  // Mode pour afficher uniquement les logs (utilisé pendant le scraping inline)
  /** URLs supprimées du cache à retirer de la config (appliqué au montage / quand la liste change) */
  pendingRemovedCacheUrls?: string[]
  onAppliedRemovedCacheUrls?: () => void
  /** Callback appelé quand l'URL de référence change */
  onReferenceUrlChange?: (url: string, domain: string) => void
}

const ScraperConfig = forwardRef<ScraperConfigHandle, ScraperConfigProps>(function ScraperConfig(
  { onScrapeStart, onScrapeComplete, showConfig: controlledShow, onToggleConfig, hideHeader = false, showLaunchButton = true, logsOnlyMode = false, pendingRemovedCacheUrls = [], onAppliedRemovedCacheUrls, onReferenceUrlChange }: ScraperConfigProps,
  ref
) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const scrapingLimit = useScrapingLimit()
  const router = useRouter()
  const [referenceUrl, setReferenceUrl] = useState(DEFAULT_REFERENCE_URL)
  const [urls, setUrls] = useState<string[]>([""])
  const [competitorEnabled, setCompetitorEnabled] = useState<boolean[]>([true])
  const [forceRefresh, setForceRefresh] = useState(false)
  const [ignoreColors, setIgnoreColors] = useState(false)
  const [inventoryOnly, setInventoryOnly] = useState(true)
  const [matchMode, setMatchMode] = useState<string>('exact')
  const [isScraping, setIsScraping] = useState(false)
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(true)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [urlsWithoutScraper, setUrlsWithoutScraper] = useState<string[]>([])
  const [scrapingSteps, setScrapingSteps] = useState<ScrapingStep[]>([])
  const [currentLogFile, setCurrentLogFile] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(true)
  const logPollingRef = useRef<NodeJS.Timeout | null>(null)
  const [cachedScrapers, setCachedScrapers] = useState<CachedScraper[]>([])
  const [showCachedScrapers, setShowCachedScrapers] = useState(false)
  const [sharedSearchQuery, setSharedSearchQuery] = useState("")
  const [sharedSearchResults, setSharedSearchResults] = useState<SharedScraper[]>([])
  const [isSearchingShared, setIsSearchingShared] = useState(false)
  const sharedSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const addUrl = () => {
    setUrls([...urls, ""])
    setCompetitorEnabled(prev => [...prev, true])
  }

  const removeUrl = (index: number) => {
    if (urls.length > 1) {
      setUrls(urls.filter((_, i) => i !== index))
      setCompetitorEnabled(prev => prev.filter((_, i) => i !== index))
    }
  }

  const updateUrl = (index: number, value: string) => {
    const newUrls = [...urls]
    newUrls[index] = value
    setUrls(newUrls)
  }

  const toggleCompetitorEnabled = (index: number) => {
    setCompetitorEnabled(prev => prev.map((v, i) => (i === index ? !v : v)))
  }

  const setReferenceFromCompetitor = (index: number) => {
    const target = urls[index]?.trim()
    if (!target) return
    const prevRef = referenceUrl.trim()
    const newUrls = [...urls]
    newUrls[index] = prevRef
    setReferenceUrl(target)
    setUrls(newUrls)
  }

  // Vérifier quels URLs n'ont pas de scraper
  const checkScrapersForUrls = async () => {
    const allUrls = [
      referenceUrl.trim(),
      ...urls.filter((url, idx) => competitorEnabled[idx] && url.trim() !== "" && url.trim() !== referenceUrl.trim())
    ].filter(url => url.trim() !== "")

    if (allUrls.length === 0) {
      setUrlsWithoutScraper([])
      return
    }

    try {
      const response = await fetch('/api/scraper-ai/cache')
      const data = await response.json()
      const cachedUrls = new Set((data.scrapers || []).map((s: any) => s.url))

      const urlsWithout = allUrls.filter(url => {
        const normalized = url.replace(/\/$/, '').toLowerCase()
        return !Array.from(cachedUrls).some((cached) => {
          const normalizedCached = String(cached).replace(/\/$/, '').toLowerCase()
          try {
            const urlDomain = new URL(normalized).hostname.replace('www.', '')
            const cachedDomain = new URL(normalizedCached).hostname.replace('www.', '')
            return urlDomain === cachedDomain
          } catch {
            return normalized === normalizedCached
          }
        })
      })
      setUrlsWithoutScraper(urlsWithout)
    } catch {
      setUrlsWithoutScraper([])
    }
  }

  useEffect(() => {
    const timeoutId = setTimeout(() => checkScrapersForUrls(), 500)
    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceUrl, urls.join(',')])

  // Notifier le parent quand l'URL de référence change
  useEffect(() => {
    if (onReferenceUrlChange && referenceUrl.trim()) {
      const domain = getDomain(referenceUrl)
      onReferenceUrlChange(referenceUrl, domain)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceUrl]) // Pas besoin de onReferenceUrlChange dans les deps car on veut juste réagir aux changements d'URL

  const getTimeEstimate = () => {
    const activeUrls = urls.filter((url, idx) => competitorEnabled[idx] && url.trim() !== "")
    const otherUrls = activeUrls.filter(url => url.trim() !== "" && url.trim() !== referenceUrl.trim())
    const totalSites = referenceUrl.trim() ? 1 + otherUrls.length : otherUrls.length
    const sitesWithScraper = totalSites - urlsWithoutScraper.length
    const newSites = urlsWithoutScraper.length
    // Sites avec cache: ~30-60s (re-extraction), Nouveaux: ~3-8 min (exploration + extraction)
    const minSeconds = (sitesWithScraper * 30) + (newSites * 180)
    const maxSeconds = (sitesWithScraper * 90) + (newSites * 480)
    const avgSeconds = Math.round((minSeconds + maxSeconds) / 2)
    if (avgSeconds < 60) return { text: `~${avgSeconds}s`, seconds: avgSeconds }
    const minMin = Math.max(1, Math.ceil(minSeconds / 60))
    const maxMin = Math.ceil(maxSeconds / 60)
    return { text: `${minMin}-${maxMin} min`, seconds: avgSeconds }
  }

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isScraping) {
      interval = setInterval(() => setElapsedTime(prev => prev + 1), 1000)
    } else {
      setElapsedTime(0)
    }
    return () => clearInterval(interval)
  }, [isScraping])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
  }

  const updateStepsFromLogs = useCallback((logs: string[]) => {
    const content = logs.join('\n').toLowerCase()
    setScrapingSteps(prev => {
      const newSteps = [...prev]
      // Patterns basés sur les vrais logs Python
      const patterns: { step: string; patterns: string[]; completedPatterns?: string[] }[] = [
        { step: 'init', patterns: ['scraper ai', 'site de référence', 'user id'], completedPatterns: ['phase 1', 'vérification'] },
        { step: 'analyze', patterns: ['phase 1', 'phase 2', 'exploration', 'sitemap', 'urls découvertes'], completedPatterns: ['urls trouvées', 'scraper créé'] },
        { step: 'scrape', patterns: ['phase 3', 'extraction', 'produits de', 'urls/s', 'workers parallèles'], completedPatterns: ['produits extraits'] },
        { step: 'save', patterns: ['sauvegarde', 'supabase', 'cloud'], completedPatterns: ['scraping terminé', 'temps total'] },
      ]
      patterns.forEach(({ step, patterns: activePatterns, completedPatterns }) => {
        const stepIndex = newSteps.findIndex(s => s.id === step)
        if (stepIndex === -1) return
        const isActive = activePatterns.some(p => content.includes(p))
        const isCompleted = completedPatterns?.some(p => content.includes(p))
        if (isCompleted && newSteps[stepIndex].status !== 'completed') {
          newSteps[stepIndex] = { ...newSteps[stepIndex], status: 'completed' }
        } else if (isActive && newSteps[stepIndex].status === 'pending') {
          for (let i = 0; i < stepIndex; i++) {
            if (newSteps[i].status !== 'completed') newSteps[i] = { ...newSteps[i], status: 'completed' }
          }
          newSteps[stepIndex] = { ...newSteps[stepIndex], status: 'active' }
        }
      })
      // Détecter les erreurs critiques (crashes Python inclus)
      const hasCrash =
        content.includes('erreur fatale') ||
        content.includes('authentification requise') ||
        content.includes('traceback (most recent call last)') ||
        content.includes('typeerror:') ||
        content.includes('attributeerror:') ||
        content.includes('keyerror:') ||
        content.includes('importerror:')
      if (hasCrash) {
        const activeStep = newSteps.find(s => s.status === 'active')
        const targetIdx = activeStep
          ? newSteps.findIndex(s => s.id === activeStep.id)
          : newSteps.findIndex(s => s.status !== 'completed')
        if (targetIdx >= 0) {
          newSteps[targetIdx] = { ...newSteps[targetIdx], status: 'error' }
        }
      }
      // Fin du scraping (uniquement le résumé FINAL, pas les résumés par site)
      const isFinalEnd = (content.includes('scraping terminé') && content.includes('site de référence:'))
        || content.includes('données dans:')
        || content.includes('sauvegardé localement:')
        || content.includes('backup local:')
      if (isFinalEnd) {
        newSteps.forEach((_, i) => {
          if (newSteps[i].status !== 'error') newSteps[i] = { ...newSteps[i], status: 'completed' }
        })
      }
      return newSteps
    })
  }, [])

  const pollLogs = useCallback(async () => {
    if (!currentLogFile) return
    try {
      const response = await fetch(`/api/scraper/run?logFile=${encodeURIComponent(currentLogFile)}&lastLine=${logContent.length}`)
      const data = await response.json()
      if (data.lines && data.lines.length > 0) {
        setLogContent(prev => {
          const newLogs = [...prev, ...data.lines.filter((l: string) => l.trim())]
          updateStepsFromLogs(newLogs)
          return newLogs
        })
      } else {
        // Aucun nouveau log : avancer la barre visuellement selon le temps écoulé
        setScrapingSteps(prev => {
          const newSteps = [...prev]
          const allPending = newSteps.every(s => s.status === 'pending')
          if (allPending && elapsedTime >= 10) {
            newSteps[0] = { ...newSteps[0], status: 'active' }
          }
          const onlyInitActive = newSteps[0].status === 'active' && newSteps.slice(1).every(s => s.status === 'pending')
          if (onlyInitActive && elapsedTime >= 45) {
            newSteps[0] = { ...newSteps[0], status: 'completed' }
            newSteps[1] = { ...newSteps[1], status: 'active' }
          }
          return newSteps
        })
      }
      if (data.isComplete) {
        if (logPollingRef.current) {
          clearInterval(logPollingRef.current)
          logPollingRef.current = null
        }
        setIsScraping(false)
        clearScrapingSession()
        const fullContent = data.content || ''
        const isError = data.hasError ||
          fullContent.includes('Traceback (most recent call last)') ||
          fullContent.includes('TypeError:') ||
          fullContent.includes('AttributeError:') ||
          fullContent.includes('KeyError:') ||
          fullContent.includes('AUTHENTIFICATION REQUISE')
        if (isError) {
          setScrapeStatus('error')
        } else {
          setScrapeStatus('success')
          onScrapeComplete?.()
        }
      }
    } catch (error) {
      console.error('Error polling logs:', error)
    }
  }, [currentLogFile, logContent.length, updateStepsFromLogs, onScrapeComplete])

  useEffect(() => {
    if (isScraping && currentLogFile) {
      logPollingRef.current = setInterval(pollLogs, 2000)
      pollLogs()
    }
    return () => {
      if (logPollingRef.current) {
        clearInterval(logPollingRef.current)
        logPollingRef.current = null
      }
    }
  }, [isScraping, currentLogFile, pollLogs])

  const handleScrape = async () => {
    // Toujours utiliser l'état actuel de l'UI (pas la config sauvegardée)
    let currentRefUrl = referenceUrl.trim()
    let currentUrls = [...urls] // Copie pour éviter les mutations
    let currentEnabled = [...competitorEnabled]

    // Si pas de referenceUrl dans l'état, essayer de charger la config (fallback uniquement)
    if (!currentRefUrl) {
      try {
        const response = await fetch("/api/scraper/config")
        if (response.ok) {
          const config = await response.json()
          if (config.referenceUrl?.trim()) {
            currentRefUrl = config.referenceUrl.trim()
            setReferenceUrl(currentRefUrl)
          }
          // IMPORTANT: Ne fusionner les URLs de la config que si l'UI n'a AUCUNE URL valide
          const hasValidUiUrls = currentUrls.some(u => u.trim() !== '')
          if (!hasValidUiUrls && config.urls?.length > 0) {
            currentUrls = config.urls
            currentEnabled = config.urls.map(() => true)
            setUrls(currentUrls)
            setCompetitorEnabled(currentEnabled)
          }
        }
      } catch (e) {
        console.error('Erreur chargement config:', e)
      }
    }

    // Toujours pas de referenceUrl? Afficher un message
    if (!currentRefUrl) {
      setLogContent(['❌ Aucun site de référence configuré.', '→ Cliquez sur "Configurer" pour définir les URLs à scraper.'])
      setScrapeStatus('error')
      return
    }

    if (!scrapingLimit.canScrape) {
      setLogContent([
        '❌ Limite de scrapings atteinte.',
        `Vous avez utilisé ${scrapingLimit.current}/${scrapingLimit.limit} scrapings.`,
        '→ Passez au plan Pro ou Ultime pour des scrapings illimités.',
        '→ Visitez la page Paiements pour mettre à niveau votre plan.'
      ])
      setScrapeStatus('error')
      // Proposer de rediriger vers la page de paiements après 3 secondes
      setTimeout(() => {
        if (confirm('Voulez-vous être redirigé vers la page de paiements pour mettre à niveau votre plan ?')) {
          router.push('/dashboard/payments')
        }
      }, 3000)
      return
    }

    // Filtrer les concurrents : activés, non-vides, et différents du site de référence
    // IMPORTANT: Comparer par domaine (pas par URL exacte) pour éviter les doublons ref/trailing slash
    const getDomainForCompare = (u: string) => {
      try { return new URL(u.trim()).hostname.replace('www.', '').toLowerCase() } catch { return u.trim().toLowerCase() }
    }
    const refDomain = getDomainForCompare(currentRefUrl)
    const otherUrls = currentUrls.filter((url, idx) => {
      if (!currentEnabled[idx]) return false  // Utiliser currentEnabled (pas competitorEnabled)
      const trimmed = url.trim()
      if (!trimmed) return false
      // Comparer par domaine, pas par URL exacte (évite les problèmes de trailing slash)
      return getDomainForCompare(trimmed) !== refDomain
    })
    const allUrls = [currentRefUrl, ...otherUrls]

    // Log détaillé pour diagnostic
    console.log('[handleScrape] État des URLs:')
    console.log('  - currentUrls:', currentUrls)
    console.log('  - competitorEnabled:', competitorEnabled)
    console.log('  - referenceUrl:', currentRefUrl)
    console.log('  - otherUrls (filtrés):', otherUrls)
    console.log('  - allUrls (final):', allUrls)

    if (allUrls.length < 1) {
      setLogContent(['❌ Aucune URL valide à scraper.'])
      setScrapeStatus('error')
      return
    }

    setIsScraping(true)
    setElapsedTime(0)
    setLogContent([
      `🚀 Démarrage du scraping...`,
      `📍 Site de référence: ${getDomain(currentRefUrl)}`,
      `📊 ${allUrls.length} site(s) à analyser (${otherUrls.length} concurrent${otherUrls.length > 1 ? 's' : ''})`,
      ...otherUrls.map((u, i) => `   ${i + 1}. ${getDomain(u)}`)
    ])
    setCurrentLogFile(null)
    setScrapeStatus(null)
    setScrapingSteps(SCRAPING_STEPS.map((step, idx) => ({ ...step, status: idx === 0 ? 'active' : 'pending' })))
    onScrapeStart?.()

    try {
      // Sauvegarder la config AVANT le scrape avec les valeurs locales résolues
      // (le state React n'est peut-être pas encore à jour si la config a été chargée via fallback)
      await saveConfig({ referenceUrl: currentRefUrl, urls: otherUrls, skipAutoScrape: true })

      const response = await fetch("/api/scraper/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceUrl: currentRefUrl, urls: allUrls, forceRefresh, ignoreColors, inventoryOnly, matchMode, useAI: true }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || "Erreur lors du scraping")
      }
      const data = await response.json()
      if (data.logFile) {
        setCurrentLogFile(data.logFile)
        saveScrapingSession({ logFile: data.logFile, startTime: Date.now(), referenceUrl: currentRefUrl })
        setLogContent(prev => [...prev, `✅ Scraping lancé avec succès (${allUrls.length} sites)`, `📄 Fichier de logs: ${data.logFile.split('/').pop()}`])
      } else {
        setLogContent(prev => [...prev, `⚠️ Pas de fichier de logs retourné`])
      }
    } catch (error: any) {
      console.error('Erreur scraping:', error)
      setLogContent(prev => [...prev, `❌ Erreur: ${error.message}`])
      setScrapeStatus('error')
      setIsScraping(false)
      clearScrapingSession()
      setScrapingSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' } : s))
    }
  }

  const saveConfig = async (overrides?: { referenceUrl?: string; urls?: string[]; skipAutoScrape?: boolean }) => {
    try {
      const refUrl = overrides?.referenceUrl ?? referenceUrl.trim()
      const competitorUrls = overrides?.urls
        ?? urls.map((u, i) => (competitorEnabled[i] ? u : "")).filter(url => url.trim() !== "")
      const configData = {
        referenceUrl: refUrl,
        urls: competitorUrls,
        ignoreColors: ignoreColors,
        inventoryOnly: inventoryOnly,
        matchMode: matchMode,
        skipAutoScrape: overrides?.skipAutoScrape || false,
      }
      console.log('Saving config:', configData)
      const response = await fetch("/api/scraper/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configData),
      })
      const result = await response.json()
      console.log('Save result:', result)
    } catch (err) {
      console.error('Error saving config:', err)
    }
  }

  const loadConfig = async () => {
    try {
      const response = await fetch("/api/scraper/config")
      if (response.ok) {
        const config = await response.json()
        if (config.referenceUrl?.trim()) setReferenceUrl(config.referenceUrl)
        if (config.urls?.length > 0) {
          setUrls(config.urls)
          setCompetitorEnabled(config.urls.map(() => true))
        }
        if (typeof config.ignoreColors === 'boolean') {
          setIgnoreColors(config.ignoreColors)
        }
        if (config.matchMode) {
          setMatchMode(config.matchMode)
        }
        if (typeof config.inventoryOnly === 'boolean') {
          setInventoryOnly(config.inventoryOnly)
        }
      }
    } catch { }
  }

  const loadCachedScrapers = async () => {
    try {
      const response = await fetch('/api/scraper-ai/cache')
      if (response.ok) {
        const data = await response.json()
        setCachedScrapers(data.scrapers || [])
      }
    } catch (error) {
      console.error('Error loading cached scrapers:', error)
    }
  }

  const selectCachedScraper = (scraper: CachedScraper, isReference: boolean = true) => {
    if (isReference) {
      setReferenceUrl(scraper.url)
    } else {
      // Ajouter comme concurrent
      const emptyIndex = urls.findIndex(u => !u.trim())
      if (emptyIndex !== -1) {
        updateUrl(emptyIndex, scraper.url)
      } else {
        setUrls([...urls, scraper.url])
        setCompetitorEnabled(prev => [...prev, true])
      }
    }
    setShowCachedScrapers(false)
  }

  const deleteCachedScraper = async (scraper: CachedScraper) => {
    const params = new URLSearchParams({ url: scraper.url })
    if (user?.id) params.set('user_id', user.id)
    try {
      const response = await fetch(`/api/scraper-ai/cache?${params}`, { method: 'DELETE' })
      if (response.ok) {
        removeUrlFromConfig(scraper.url)
        setCachedScrapers(prev => prev.filter(s => s.url !== scraper.url))
      }
    } catch (error) {
      console.error('Error deleting cached scraper:', error)
    }
  }

  const searchSharedScrapers = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSharedSearchResults([])
      return
    }
    setIsSearchingShared(true)
    try {
      const res = await fetch(`/api/shared-scrapers/search?q=${encodeURIComponent(query.trim())}`)
      if (res.ok) {
        const data = await res.json()
        setSharedSearchResults(data.scrapers || [])
      }
    } catch {
      setSharedSearchResults([])
    } finally {
      setIsSearchingShared(false)
    }
  }, [])

  const handleSharedSearchChange = useCallback((value: string) => {
    setSharedSearchQuery(value)
    if (sharedSearchTimeoutRef.current) clearTimeout(sharedSearchTimeoutRef.current)
    sharedSearchTimeoutRef.current = setTimeout(() => searchSharedScrapers(value), 300)
  }, [searchSharedScrapers])

  const selectSharedScraper = (scraper: SharedScraper, isReference: boolean) => {
    if (isReference) {
      setReferenceUrl(scraper.site_url)
    } else {
      const emptyIndex = urls.findIndex(u => !u.trim())
      if (emptyIndex !== -1) {
        updateUrl(emptyIndex, scraper.site_url)
      } else {
        setUrls([...urls, scraper.site_url])
        setCompetitorEnabled(prev => [...prev, true])
      }
    }
    setSharedSearchQuery("")
    setSharedSearchResults([])
  }

  useEffect(() => {
    loadConfig()
    loadCachedScrapers()

    const session = loadScrapingSession()
    if (session?.logFile) {
      const ageMs = Date.now() - session.startTime
      if (ageMs < 30 * 60_000) {
        setCurrentLogFile(session.logFile)
        setIsScraping(true)
        setScrapeStatus(null)
        setScrapingSteps(SCRAPING_STEPS.map(s => ({ ...s, status: 'active' as const })))
        setLogContent([`🔄 Reprise du scraping en cours...`, `📍 Référence: ${session.referenceUrl}`])
      } else {
        clearScrapingSession()
      }
    }
  }, [])

  const otherValidUrls = urls.filter((url, idx) => competitorEnabled[idx] && url.trim() !== "" && url.trim() !== referenceUrl.trim())
  const totalSitesToScrape = referenceUrl.trim() ? 1 + otherValidUrls.length : otherValidUrls.length
  const timeEstimate = getTimeEstimate()
  // Mode logs only = affiche seulement les logs, pas le formulaire (utilisé pour le scraping inline)
  const isLogsOnlyMode = logsOnlyMode
  const isConfigOpen = isLogsOnlyMode ? false : (hideHeader ? true : (controlledShow !== undefined ? controlledShow : showConfig))

  const getDomain = (url: string) => {
    try { return new URL(url).hostname.replace('www.', '') }
    catch { return url }
  }

  const removeUrlFromConfig = useCallback((urlOrDomain: string) => {
    const targetDomain = urlOrDomain.startsWith('http') ? getDomain(urlOrDomain) : urlOrDomain.replace(/^www\./, '')
    if (!targetDomain) return
    setReferenceUrl(prev => (prev.trim() && getDomain(prev) === targetDomain ? '' : prev))
    setUrls(prev => {
      const next = prev.filter(u => !u.trim() || getDomain(u) !== targetDomain)
      return next.length ? next : ['']
    })
    setCompetitorEnabled(prev => {
      const kept = prev.filter((_, i) => {
        const u = urls[i]
        return !u?.trim() || getDomain(u) !== targetDomain
      })
      return kept.length ? kept : [true]
    })
  }, [urls])

  useEffect(() => {
    if (pendingRemovedCacheUrls.length === 0) return
    pendingRemovedCacheUrls.forEach(removeUrlFromConfig)
    onAppliedRemovedCacheUrls?.()
  }, [pendingRemovedCacheUrls, onAppliedRemovedCacheUrls, removeUrlFromConfig])

  useImperativeHandle(ref, () => ({ runScrape: handleScrape, saveConfig, removeUrlFromConfig }), [handleScrape, removeUrlFromConfig])

  const shouldShowLogsTerminal = isScraping || scrapeStatus

  return (
    <div className="space-y-6">
      {/* Alerte temps estimé (masquer en mode logs only) */}
      {!isLogsOnlyMode && urlsWithoutScraper.length > 0 && !isScraping && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-gray-50/80 dark:bg-white/[0.02] border border-gray-200/60 dark:border-white/[0.06]">
          <Clock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("config.firstAnalysis")}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              {urlsWithoutScraper.length} {t("config.sitesToAnalyze")}
            </p>
          </div>
        </div>
      )}

      {/* Formulaire de configuration (masqué en mode logs-only) */}
      {isConfigOpen && (
        <div className="space-y-6">
          {/* Barre de recherche scrapers universels */}
          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={sharedSearchQuery}
                onChange={(e) => handleSharedSearchChange(e.target.value)}
                placeholder={t("config.searchUniversal")}
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:focus:ring-violet-400/20 focus:border-violet-300 dark:focus:border-violet-500/30 transition-all placeholder:text-gray-400"
              />
              {isSearchingShared && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-500 animate-spin" />
              )}
            </div>

            {sharedSearchQuery.trim().length >= 2 && (
              <div className="mt-1.5 rounded-xl border border-violet-200/60 dark:border-violet-500/20 bg-white dark:bg-[#18181b] overflow-hidden shadow-lg shadow-violet-500/5">
                <div className="px-3 py-2 bg-violet-50/50 dark:bg-violet-500/[0.06] border-b border-violet-100/60 dark:border-violet-500/10 flex items-center gap-2">
                  <Sparkles className="w-3 h-3 text-violet-500 dark:text-violet-400" />
                  <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">
                    {t("config.universalScrapers")}
                  </span>
                </div>
                {sharedSearchResults.length > 0 ? (
                  <div className="max-h-52 overflow-y-auto divide-y divide-gray-100/60 dark:divide-white/[0.04]">
                    {sharedSearchResults.map((shared) => {
                      const isUsed = referenceUrl.includes(shared.site_domain) || urls.some(u => u.includes(shared.site_domain))
                      return (
                        <div
                          key={shared.id}
                          className={`flex items-center gap-3 px-3.5 py-3 hover:bg-violet-50/50 dark:hover:bg-violet-500/[0.04] transition-colors ${isUsed ? 'bg-violet-50/30 dark:bg-violet-500/[0.03]' : ''}`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-100 to-violet-50 dark:from-violet-500/20 dark:to-violet-500/5 flex items-center justify-center text-xs font-bold text-violet-600 dark:text-violet-400">
                            {shared.site_name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {shared.site_name}
                              </p>
                              <BadgeCheck className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400 flex-shrink-0" />
                            </div>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                              {shared.site_domain}
                              {shared.description && ` · ${shared.description.slice(0, 50)}`}
                            </p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => selectSharedScraper(shared, true)}
                              disabled={referenceUrl.includes(shared.site_domain)}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${referenceUrl.includes(shared.site_domain)
                                ? 'bg-violet-600 dark:bg-violet-500 text-white cursor-default'
                                : 'bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-500/20'
                                }`}
                            >
                              {referenceUrl.includes(shared.site_domain) ? t("config.ref") : t("config.referenceLabel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => selectSharedScraper(shared, false)}
                              disabled={urls.some(u => u.includes(shared.site_domain))}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${urls.some(u => u.includes(shared.site_domain))
                                ? 'bg-gray-100 dark:bg-white/[0.04] text-gray-300 dark:text-gray-600 cursor-default'
                                : 'bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-500/20'
                                }`}
                            >
                              {t("config.addCompetitor")}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : !isSearchingShared ? (
                  <div className="px-3.5 py-4 text-center">
                    <p className="text-xs text-gray-400 dark:text-gray-500">{t("config.noResultsSearch")}</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Scrapers en cache */}
          {cachedScrapers.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowCachedScrapers(!showCachedScrapers)}
                className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-gray-200/60 dark:border-white/[0.06] bg-gray-50/50 dark:bg-white/[0.02] hover:bg-gray-100/50 dark:hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("config.scrapersCache")} ({cachedScrapers.length})
                  </span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showCachedScrapers ? 'rotate-180' : ''}`} />
              </button>

              {showCachedScrapers && (
                <div className="rounded-xl border border-gray-200/60 dark:border-white/[0.06] overflow-hidden">
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-100/60 dark:divide-white/[0.04]">
                    {cachedScrapers.map((scraper, index) => {
                      const domain = getDomain(scraper.url)
                      const isSelected = referenceUrl === scraper.url || urls.includes(scraper.url)
                      return (
                        <div
                          key={index}
                          className={`flex items-center gap-3 px-3.5 py-3 hover:bg-gray-50/80 dark:hover:bg-white/[0.02] transition-colors ${isSelected ? 'bg-gray-50 dark:bg-white/[0.03]' : ''}`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-xs font-semibold text-gray-500 dark:text-gray-400">
                            {domain.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {scraper.site_name || domain}
                            </p>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                              {scraper.url}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => selectCachedScraper(scraper, true)}
                              disabled={referenceUrl === scraper.url}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${referenceUrl === scraper.url
                                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 cursor-default'
                                : 'bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.1]'
                                }`}
                            >
                              {referenceUrl === scraper.url ? t("config.ref") : t("config.referenceLabel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => selectCachedScraper(scraper, false)}
                              disabled={urls.includes(scraper.url)}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${urls.includes(scraper.url)
                                ? 'bg-gray-100 dark:bg-white/[0.04] text-gray-300 dark:text-gray-600 cursor-default'
                                : 'bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.1]'
                                }`}
                            >
                              {t("config.addCompetitor")}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCachedScraper(scraper)}
                              className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title={t("config.deleteSite")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Site de référence */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Star className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">{t("config.referenceUrl")}</span>
            </div>
            <input
              type="url"
              value={referenceUrl}
              onChange={(e) => setReferenceUrl(e.target.value)}
              placeholder="https://votre-site.com"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 dark:focus:ring-white/10 focus:border-gray-300 dark:focus:border-white/[0.12] transition-all placeholder:text-gray-400"
            />
          </div>

          {/* Séparateur */}
          <div className="h-px bg-gray-100 dark:bg-white/[0.04]" />

          {/* Sites concurrents */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">{t("config.competitorsLabel")}</span>
              </div>
              <button
                onClick={addUrl}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-md transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t("config.add")}
              </button>
            </div>

            <div className="space-y-1.5">
              {urls.map((url, index) => {
                const isReference = url.trim() === referenceUrl.trim() && url.trim() !== ""
                return (
                  <div key={index} className="group flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={competitorEnabled[index] && !isReference}
                      onChange={() => !isReference && toggleCompetitorEnabled(index)}
                      disabled={isReference}
                      className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:ring-gray-900/10 dark:focus:ring-white/10 disabled:opacity-30"
                    />
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => updateUrl(index, e.target.value)}
                      placeholder={`https://concurrent-${index + 1}.com`}
                      className={`flex-1 px-3.5 py-2.5 rounded-xl border bg-white dark:bg-white/[0.02] text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 dark:focus:ring-white/10 transition-all placeholder:text-gray-400 ${isReference
                        ? "border-gray-300 dark:border-white/[0.1] text-gray-500 dark:text-gray-400"
                        : "border-gray-200/60 dark:border-white/[0.06] text-gray-900 dark:text-white focus:border-gray-300 dark:focus:border-white/[0.12]"
                        }`}
                    />
                    {urls.length > 1 && !isReference && (
                      <button
                        onClick={() => removeUrl(index)}
                        className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Séparateur */}
          <div className="h-px bg-gray-100 dark:bg-white/[0.04]" />

          {/* Options */}
          <div className="space-y-2.5">
            <span className="text-sm font-medium text-gray-900 dark:text-white">{t("config.options")}</span>

            <div className="space-y-1">
              <label htmlFor="ignoreColors" className="flex items-center gap-2.5 py-1.5 px-1 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.02] cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  id="ignoreColors"
                  checked={ignoreColors}
                  onChange={(e) => setIgnoreColors(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:ring-gray-900/10 dark:focus:ring-white/10 focus:ring-offset-0"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("config.ignoreColors")}
                  <span className="ml-1.5 text-[11px] text-gray-400 dark:text-gray-500">{t("config.moreMatches")}</span>
                </span>
              </label>

              <label htmlFor="inventoryOnly" className="flex items-center gap-2.5 py-1.5 px-1 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.02] cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  id="inventoryOnly"
                  checked={inventoryOnly}
                  onChange={(e) => setInventoryOnly(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:ring-gray-900/10 dark:focus:ring-white/10 focus:ring-offset-0"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("config.filterCatalog")}
                </span>
              </label>

              <div className="pt-1">
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1.5 px-1">
                  {t("config.matchMode")}
                </label>
                <select
                  value={matchMode}
                  onChange={(e) => setMatchMode(e.target.value)}
                  className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-gray-900/10 dark:focus:ring-white/10 focus:border-gray-300 dark:focus:border-white/20"
                >
                  <option value="exact">{t("config.matchMode.exact")}</option>
                  <option value="base">{t("config.matchMode.base")}</option>
                  <option value="no_year">{t("config.matchMode.no_year")}</option>
                  <option value="flexible">{t("config.matchMode.flexible")}</option>
                </select>
              </div>

            </div>
          </div>

          {/* Résumé */}
          {totalSitesToScrape > 0 && !isScraping && (
            <>
              <div className="h-px bg-gray-100 dark:bg-white/[0.04]" />
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2.5">
                  <div className="flex -space-x-1">
                    {[referenceUrl, ...otherValidUrls].slice(0, 3).map((url, i) => (
                      <div key={i} className="w-7 h-7 rounded-full bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-[11px] font-medium text-gray-500 dark:text-gray-400 border-2 border-white dark:border-[#0f0f12]">
                        {getDomain(url).charAt(0).toUpperCase()}
                      </div>
                    ))}
                    {totalSitesToScrape > 3 && (
                      <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-[11px] font-medium text-gray-400 border-2 border-white dark:border-[#0f0f12]">
                        +{totalSitesToScrape - 3}
                      </div>
                    )}
                  </div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {totalSitesToScrape} site{totalSitesToScrape > 1 ? 's' : ''}
                  </span>
                </div>
                <span className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  ~{timeEstimate.text}
                </span>
              </div>
            </>
          )}

        </div>
      )}

      {/* Terminal de logs - TOUJOURS AFFICHÉ en mode logs-only OU pendant le scraping */}
      {shouldShowLogsTerminal && (
        <div className="rounded-2xl bg-white/95 dark:bg-white/[0.025] border border-gray-200/60 dark:border-white/[0.06] overflow-hidden shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]">

          {/* Progression - toujours visible */}
          <div className="px-5 pt-5 pb-4">
            {/* Header minimal */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {isScraping ? (
                  <div className="relative flex items-center justify-center w-8 h-8">
                    <div className="absolute inset-0 rounded-full bg-blue-500/10 dark:bg-blue-400/10 animate-ping" />
                    <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin relative z-10" />
                  </div>
                ) : scrapeStatus === 'error' ? (
                  <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
                    <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
                  </div>
                ) : scrapeStatus === 'success' ? (
                  <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-white/5 flex items-center justify-center">
                    <Database className="w-4 h-4 text-gray-400" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {isScraping ? t('config.inProgress') : scrapeStatus === 'error' ? t('config.error') : scrapeStatus === 'success' ? t('config.done') : t('config.extractionStep')}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatTime(elapsedTime)}
                  </p>
                </div>
              </div>
              {logContent.length > 0 && (
                <button
                  onClick={() => setShowLogs(prev => !prev)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
                >
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${showLogs ? 'rotate-90' : ''}`} />
                  Logs
                </button>
              )}
            </div>

            {/* Étapes de progression */}
            {scrapingSteps.length > 0 && (
              <div>
                <div className="flex gap-1.5 mb-2.5">
                  {scrapingSteps.map((step) => (
                    <div key={step.id} className="flex-1 h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-white/[0.06]">
                      <div className={`h-full rounded-full transition-all duration-700 ease-out ${step.status === 'completed' ? 'w-full bg-emerald-500' :
                          step.status === 'active' ? 'w-2/3 bg-blue-500 animate-pulse' :
                            step.status === 'error' ? 'w-full bg-red-500' :
                              'w-0'
                        }`} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between">
                  {scrapingSteps.map((step) => (
                    <span key={step.id} className={`text-[11px] font-medium transition-colors ${step.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' :
                        step.status === 'active' ? 'text-blue-600 dark:text-blue-400' :
                          step.status === 'error' ? 'text-red-500 dark:text-red-400' :
                            'text-gray-400 dark:text-gray-600'
                      }`}>
                      {step.status === 'completed' && <span className="mr-0.5">✓</span>}
                      {{ init: t('config.init'), analyze: t('config.analysis'), scrape: t('config.extractionStep'), save: t('config.saving') }[step.id] || step.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Message de fin */}
            {!isScraping && scrapeStatus && (
              <div className={`mt-4 px-4 py-3 rounded-xl text-sm font-medium ${scrapeStatus === 'error'
                  ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900/30'
                  : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/30'
                }`}>
                {scrapeStatus === 'error'
                  ? t('config.errorOccurred')
                  : t('config.scrapingDone')}
              </div>
            )}
          </div>

          {/* Logs dépliables */}
          {showLogs && logContent.length > 0 && (
            <div className="border-t border-gray-100 dark:border-white/[0.06]">
              <div className="px-5 py-3 max-h-48 overflow-y-auto" ref={(el) => { if (el) el.scrollTop = el.scrollHeight }}>
                <div className="space-y-0.5">
                  {logContent
                    .filter(line => {
                      const t = line.trim()
                      if (!t) return false
                      if (t.includes('UserWarning') || t.includes('warning_logs') || t.includes('DeprecationWarning')) return false
                      if (t.includes('site-packages/') || t.includes('show_deprecation_warning')) return false
                      if (/^[=]{10,}$/.test(t)) return false
                      if (t.startsWith('File "') || t.startsWith('File \'')) return false
                      if (/^\w+\(/.test(t) && !t.includes(':')) return false
                      if (/^\w+\.\w+\(/.test(t) && t.length < 120 && !t.includes('❌') && !t.includes('✅')) return false
                      return true
                    })
                    .map(line => {
                      let t = line.trim()
                      t = t.replace(/^(📋\s*)?Trace complète de l'erreur\s*:?\s*/i, '')
                      t = t.replace(/^Traceback \(most recent call last\)\s*:?\s*/, '')
                      if (!t) return null
                      return t
                    })
                    .filter((line): line is string => line !== null && line.length > 0)
                    .slice(-15)
                    .map((line, i) => {
                      const isError = /Error[:\s]|❌/.test(line)
                      const isSuccess = /produits extraits|SITE TERMINÉ|SCRAPING TERMINÉ|✅/.test(line)
                      const isWarning = line.includes('⚠️')
                      const isProgress = line.includes('📊') || /\d+\/\d+/.test(line)

                      return (
                        <div key={i} className={`text-[11px] leading-relaxed py-0.5 ${isError ? 'text-red-600 dark:text-red-400 font-medium' :
                            isSuccess ? 'text-emerald-600 dark:text-emerald-400' :
                              isWarning ? 'text-amber-600 dark:text-amber-400' :
                                isProgress ? 'text-blue-600/80 dark:text-blue-400/80' :
                                  'text-gray-400 dark:text-gray-500'
                          }`}>
                          {line}
                        </div>
                      )
                    })}
                  {isScraping && (
                    <div className="flex items-center gap-1.5 pt-1 text-xs text-gray-400">
                      <span className="inline-block w-1 h-3 bg-blue-500/60 rounded-full animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
})

export default ScraperConfig
