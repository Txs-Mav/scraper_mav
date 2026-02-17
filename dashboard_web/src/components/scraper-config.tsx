"use client"

import { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Play, Plus, X, Loader2, Star, Clock, CheckCircle2, AlertCircle, ChevronDown, Globe, Database, ChevronRight } from "lucide-react"
import { useScrapingLimit } from "@/hooks/use-scraping-limit"
import { useAuth } from "@/contexts/auth-context"

const DEFAULT_REFERENCE_URL = ""

type CachedScraper = {
  url: string
  site_name?: string
  created_at?: string
  updated_at?: string
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
  const scrapingLimit = useScrapingLimit()
  const router = useRouter()
  const [referenceUrl, setReferenceUrl] = useState(DEFAULT_REFERENCE_URL)
  const [urls, setUrls] = useState<string[]>([""])
  const [competitorEnabled, setCompetitorEnabled] = useState<boolean[]>([true])
  const [forceRefresh, setForceRefresh] = useState(false)
  const [ignoreColors, setIgnoreColors] = useState(false) // Ignorer les couleurs pour le matching
  const [inventoryOnly, setInventoryOnly] = useState(true) // Extraire seulement l'inventaire réel
  const [isScraping, setIsScraping] = useState(false)
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(true)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [urlsWithoutScraper, setUrlsWithoutScraper] = useState<string[]>([])
  const [scrapingSteps, setScrapingSteps] = useState<ScrapingStep[]>([])
  const [currentLogFile, setCurrentLogFile] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<string[]>([])
  const logPollingRef = useRef<NodeJS.Timeout | null>(null)
  const [cachedScrapers, setCachedScrapers] = useState<CachedScraper[]>([])
  const [showCachedScrapers, setShowCachedScrapers] = useState(false)

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
    const sitesWithoutScraper = urlsWithoutScraper.length
    const estimatedSeconds = (sitesWithScraper * 30) + (sitesWithoutScraper * 240)
    return estimatedSeconds < 60
      ? { text: `${estimatedSeconds}s`, seconds: estimatedSeconds }
      : { text: `${Math.ceil(estimatedSeconds / 60)} min`, seconds: estimatedSeconds }
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
        { step: 'scrape', patterns: ['phase 3', 'extraction', 'produits de'], completedPatterns: ['produits extraits'] },
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
      // Détecter les erreurs critiques (mais pas les erreurs Gemini qu'on peut ignorer)
      if (content.includes('erreur fatale') || content.includes('authentification requise')) {
        const activeStep = newSteps.find(s => s.status === 'active')
        if (activeStep) {
          const idx = newSteps.findIndex(s => s.id === activeStep.id)
          newSteps[idx] = { ...newSteps[idx], status: 'error' }
        }
      }
      // Fin du scraping
      if (content.includes('scraping terminé') || content.includes('temps total:')) {
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
      }
      if (data.isComplete) {
        if (logPollingRef.current) {
          clearInterval(logPollingRef.current)
          logPollingRef.current = null
        }
        setIsScraping(false)
        if (data.content?.includes('❌')) {
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
      // Sauvegarder la config AVANT le scrape pour que la prochaine session ait les bonnes URLs
      await saveConfig()

      const response = await fetch("/api/scraper/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceUrl: currentRefUrl, urls: allUrls, forceRefresh, ignoreColors, inventoryOnly, useAI: true }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || "Erreur lors du scraping")
      }
      const data = await response.json()
      if (data.logFile) {
        setCurrentLogFile(data.logFile)
        setLogContent(prev => [...prev, `✅ Scraping lancé avec succès (${allUrls.length} sites)`, `📄 Fichier de logs: ${data.logFile.split('/').pop()}`])
      } else {
        setLogContent(prev => [...prev, `⚠️ Pas de fichier de logs retourné`])
      }
    } catch (error: any) {
      console.error('Erreur scraping:', error)
      setLogContent(prev => [...prev, `❌ Erreur: ${error.message}`])
      setScrapeStatus('error')
      setIsScraping(false)
      setScrapingSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' } : s))
    }
  }

  const saveConfig = async () => {
    try {
      const configData = {
        referenceUrl: referenceUrl.trim(),
        urls: urls.map((u, i) => (competitorEnabled[i] ? u : "")).filter(url => url.trim() !== ""),
        ignoreColors: ignoreColors,
        inventoryOnly: inventoryOnly,
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

  useEffect(() => {
    loadConfig()
    loadCachedScrapers()
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

  // En mode logs-only, afficher seulement le terminal
  const shouldShowLogsTerminal = isLogsOnlyMode || isScraping || scrapeStatus

  return (
    <div className="space-y-6">
      {/* Alerte temps estimé - Style minimal (masquer en mode logs only) */}
      {!isLogsOnlyMode && urlsWithoutScraper.length > 0 && !isScraping && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
          <Clock className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              Première analyse requise
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
              {urlsWithoutScraper.length} site{urlsWithoutScraper.length > 1 ? 's' : ''} à analyser • ~3-5 min par site
            </p>
          </div>
        </div>
      )}

      {/* Formulaire de configuration (masqué en mode logs-only) */}
      {isConfigOpen && (
        <div className="space-y-6">
          {/* Scrapers en cache - Sélection visuelle */}
          {cachedScrapers.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowCachedScrapers(!showCachedScrapers)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100/50 dark:hover:bg-blue-950/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Scrapers en cache ({cachedScrapers.length})
                  </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-blue-600 dark:text-blue-400 transition-transform ${showCachedScrapers ? 'rotate-180' : ''}`} />
              </button>

              {showCachedScrapers && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111113] overflow-hidden">
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {cachedScrapers.map((scraper, index) => {
                      const domain = getDomain(scraper.url)
                      const isSelected = referenceUrl === scraper.url || urls.includes(scraper.url)
                      return (
                        <div
                          key={index}
                          className={`flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                        >
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold ${isSelected ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                            {domain.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {scraper.site_name || domain}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {scraper.url}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => selectCachedScraper(scraper, true)}
                              disabled={referenceUrl === scraper.url}
                              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${referenceUrl === scraper.url
                                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 cursor-default'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-600 dark:hover:text-blue-400'
                                }`}
                            >
                              {referenceUrl === scraper.url ? '★ Réf' : 'Référence'}
                            </button>
                            <button
                              type="button"
                              onClick={() => selectCachedScraper(scraper, false)}
                              disabled={urls.includes(scraper.url)}
                              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${urls.includes(scraper.url)
                                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-default'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            >
                              + Concurrent
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
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">Site de référence</span>
            </div>
            <div className="relative">
              <input
                type="url"
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                placeholder="https://votre-site.com"
                className="w-full px-4 py-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111113] text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder:text-gray-400"
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Les prix seront comparés à ce site
            </p>
          </div>

          {/* Séparateur */}
          <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-800 to-transparent" />

          {/* Sites concurrents */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">Concurrents</span>
                <span className="text-xs text-gray-400">optionnel</span>
              </div>
              <button
                onClick={addUrl}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter
              </button>
            </div>

            <div className="space-y-2">
              {urls.map((url, index) => {
                const isReference = url.trim() === referenceUrl.trim() && url.trim() !== ""
                return (
                  <div key={index} className="group flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={competitorEnabled[index] && !isReference}
                      onChange={() => !isReference && toggleCompetitorEnabled(index)}
                      disabled={isReference}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500/20 disabled:opacity-30"
                    />
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => updateUrl(index, e.target.value)}
                      placeholder={`https://concurrent-${index + 1}.com`}
                      className={`flex-1 px-4 py-3 rounded-xl border bg-white dark:bg-[#111113] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-400 ${isReference
                        ? "border-blue-200 dark:border-blue-800/50 text-blue-600 dark:text-blue-400"
                        : "border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white focus:border-blue-500"
                        }`}
                    />
                    {urls.length > 1 && !isReference && (
                      <button
                        onClick={() => removeUrl(index)}
                        className="p-2 text-gray-400 hover:text-red-500 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Séparateur */}
          <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-800 to-transparent" />

          {/* Options de scraping - TOUJOURS VISIBLE */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-gray-900 dark:text-white">Options</span>
            
            <div className="space-y-2 pl-1">
              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="ignoreColors"
                  checked={ignoreColors}
                  onChange={(e) => setIgnoreColors(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-purple-600 focus:ring-purple-500 focus:ring-offset-0 dark:bg-gray-800"
                />
                <label htmlFor="ignoreColors" className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                  <span>Ignorer les couleurs</span>
                  <span className="ml-1 text-xs text-purple-500 dark:text-purple-400">(plus de matchs possibles)</span>
                </label>
              </div>
              
              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="inventoryOnly"
                  checked={inventoryOnly}
                  onChange={(e) => setInventoryOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0 dark:bg-gray-800"
                />
                <label htmlFor="inventoryOnly" className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                  <span>Inventaire seulement</span>
                  <span className="ml-1 text-xs text-emerald-500 dark:text-emerald-400">(exclut les pages catalogue)</span>
                </label>
              </div>

              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="forceRefresh"
                  checked={forceRefresh}
                  onChange={(e) => setForceRefresh(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 dark:bg-gray-800"
                />
                <label htmlFor="forceRefresh" className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                  Régénérer les scrapers (nouvelle extraction)
                </label>
              </div>
            </div>
          </div>

          {/* Résumé minimal */}
          {totalSitesToScrape > 0 && !isScraping && (
            <>
              <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-800 to-transparent" />
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-1">
                    {[referenceUrl, ...otherValidUrls].slice(0, 3).map((url, i) => (
                      <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 border-white dark:border-[#0f0f12] ${i === 0 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}>
                        {getDomain(url).charAt(0).toUpperCase()}
                      </div>
                    ))}
                    {totalSitesToScrape > 3 && (
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-medium text-gray-500 border-2 border-white dark:border-[#0f0f12]">
                        +{totalSitesToScrape - 3}
                      </div>
                    )}
                  </div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {totalSitesToScrape} site{totalSitesToScrape > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-gray-500">
                  <Clock className="w-4 h-4" />
                  <span>~{timeEstimate.text}</span>
                </div>
              </div>
            </>
          )}

        </div>
      )}

      {/* Terminal de logs - TOUJOURS AFFICHÉ en mode logs-only OU pendant le scraping */}
      {shouldShowLogsTerminal && (
        <div className="rounded-xl bg-[#0d1117] border border-gray-800 overflow-hidden">
          {/* Header du terminal */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#161b22] border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27ca40]" />
              </div>
              <span className="text-xs text-gray-400 font-mono">scraper.log</span>
            </div>
            <div className="flex items-center gap-2">
              {isScraping && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />}
              <span className="text-xs font-mono text-gray-500">{formatTime(elapsedTime)}</span>
            </div>
          </div>

          {/* Contenu des logs */}
          <div className="p-4 max-h-48 overflow-y-auto font-mono text-xs space-y-1">
            {logContent.length === 0 ? (
              <div className="text-gray-500 animate-pulse">Démarrage du scraping...</div>
            ) : (
              logContent.slice(-15).map((line, i) => {
                // Déterminer la couleur selon le contenu
                let colorClass = 'text-gray-400'
                if (line.includes('✅') || line.includes('succès') || line.includes('terminé')) {
                  colorClass = 'text-emerald-400'
                } else if (line.includes('❌') || line.includes('erreur') || line.includes('error')) {
                  colorClass = 'text-red-400'
                } else if (line.includes('⚠️') || line.includes('warning')) {
                  colorClass = 'text-amber-400'
                } else if (line.includes('🚀') || line.includes('→') || line.includes('analyse') || line.includes('Phase')) {
                  colorClass = 'text-blue-400'
                } else if (line.includes('📦') || line.includes('produit')) {
                  colorClass = 'text-purple-400'
                }
                return (
                  <div key={i} className={`${colorClass} leading-relaxed`}>
                    <span className="text-gray-600 mr-2 select-none">{'>'}  </span>
                    {line}
                  </div>
                )
              })
            )}
            {isScraping && (
              <div className="text-gray-600 animate-pulse">
                <span className="mr-2 select-none">{'>'}</span>
                <span className="inline-block w-2 h-3.5 bg-gray-500 animate-pulse" />
              </div>
            )}
          </div>

          {/* Barre de progression */}
          {scrapingSteps.length > 0 && (
            <div className="px-4 pb-4">
              <div className="flex gap-1 mb-2">
                {scrapingSteps.map((step) => (
                  <div key={step.id} className="flex-1 h-1 rounded-full overflow-hidden bg-gray-800">
                    <div className={`h-full transition-all duration-500 ${step.status === 'completed' ? 'w-full bg-emerald-500' :
                      step.status === 'active' ? 'w-1/2 bg-blue-500 animate-pulse' :
                        step.status === 'error' ? 'w-full bg-red-500' :
                          'w-0'
                      }`} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-gray-600">
                {scrapingSteps.map((step) => (
                  <span key={step.id} className={`${step.status === 'completed' ? 'text-emerald-500' :
                    step.status === 'active' ? 'text-blue-400' :
                      step.status === 'error' ? 'text-red-400' : ''
                    }`}>
                    {step.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Message de fin */}
          {!isScraping && scrapeStatus && (
            <div className={`px-4 py-3 border-t ${scrapeStatus === 'error'
              ? 'bg-red-950/30 border-red-900/50'
              : 'bg-emerald-950/30 border-emerald-900/50'
              }`}>
              <div className="flex items-center gap-2">
                {scrapeStatus === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-red-400" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
                <span className={`text-xs font-medium ${scrapeStatus === 'error' ? 'text-red-300' : 'text-emerald-300'
                  }`}>
                  {scrapeStatus === 'error' ? 'Scraping échoué' : 'Scraping terminé avec succès!'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
})

export default ScraperConfig
