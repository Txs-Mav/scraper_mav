"use client"

import { useState, useEffect, forwardRef, useImperativeHandle } from "react"
import { Play, Plus, X, Loader2, Sparkles, ChevronDown, Star, Clock } from "lucide-react"
import { useScrapingLimit } from "@/hooks/use-scraping-limit"
import LimitWarning from "./limit-warning"
import { useAuth } from "@/contexts/auth-context"

const DEFAULT_REFERENCE_URL = "https://www.exemple-reference.com/"

export interface ScraperConfigHandle {
  runScrape: () => Promise<void>
}

interface ScraperConfigProps {
  onScrapeStart?: () => void
  onScrapeComplete?: () => void
  showConfig?: boolean
  onToggleConfig?: () => void
  hideHeader?: boolean
  showLaunchButton?: boolean
}

const ScraperConfig = forwardRef<ScraperConfigHandle, ScraperConfigProps>(function ScraperConfig(
  { onScrapeStart, onScrapeComplete, showConfig: controlledShow, onToggleConfig, hideHeader = false, showLaunchButton = true }: ScraperConfigProps,
  ref
) {
  const { user } = useAuth()
  const scrapingLimit = useScrapingLimit()
  const [referenceUrl, setReferenceUrl] = useState(DEFAULT_REFERENCE_URL)
  const [urls, setUrls] = useState<string[]>([""])
  const [competitorEnabled, setCompetitorEnabled] = useState<boolean[]>([true])
  const [forceRefresh, setForceRefresh] = useState(false)
  const [isScraping, setIsScraping] = useState(false)
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showMultipleUrls, setShowMultipleUrls] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [urlsWithoutScraper, setUrlsWithoutScraper] = useState<string[]>([])
  const [checkingScrapers, setCheckingScrapers] = useState(false)

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
    
    const prevRef = referenceUrl.trim() || DEFAULT_REFERENCE_URL
    const newUrls = [...urls]
    // Remplacer l'URL à l'index par l'ancienne référence
    newUrls[index] = prevRef
    // Définir la nouvelle référence
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

    setCheckingScrapers(true)
    try {
      const response = await fetch('/api/scraper-ai/cache')
      const data = await response.json()
      const cachedUrls = new Set((data.scrapers || []).map((s: any) => s.url))

      const urlsWithout = allUrls.filter(url => {
        // Normaliser l'URL pour la comparaison (enlever trailing slash, etc.)
        const normalized = url.replace(/\/$/, '').toLowerCase()
        return !Array.from(cachedUrls).some((cached: string) => {
          const normalizedCached = (cached as string).replace(/\/$/, '').toLowerCase()
          // Comparer les domaines
          try {
            const urlDomain = new URL(normalized).hostname.replace('www.', '')
            const cachedDomain = new URL(normalizedCached).hostname.replace('www.', '')
            return urlDomain === cachedDomain
          } catch {
            return normalized === normalizedCached || normalized.startsWith(normalizedCached) || normalizedCached.startsWith(normalized)
          }
        })
      })

      setUrlsWithoutScraper(urlsWithout)
    } catch (error) {
      console.error('Error checking scrapers:', error)
      setUrlsWithoutScraper([])
    } finally {
      setCheckingScrapers(false)
    }
  }

  // Vérifier les scrapers quand les URLs changent
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkScrapersForUrls()
    }, 500) // Debounce de 500ms

    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceUrl, urls.join(',')])

  // Calculer l'estimation du temps
  const getTimeEstimate = () => {
    const activeUrls = urls.filter((url, idx) => competitorEnabled[idx] && url.trim() !== "")
    const otherUrls = activeUrls.filter(url => url.trim() !== "" && url.trim() !== referenceUrl.trim())
    const totalSites = referenceUrl.trim() ? 1 + otherUrls.length : otherUrls.length

    // Temps estimé: ~30s par site avec scraper, ~3-5 min par site sans scraper (analyse + génération)
    const sitesWithScraper = totalSites - urlsWithoutScraper.length
    const sitesWithoutScraper = urlsWithoutScraper.length

    const estimatedSeconds = (sitesWithScraper * 30) + (sitesWithoutScraper * 240) // 4 min pour sites sans scraper

    if (estimatedSeconds < 60) {
      return { text: `~${estimatedSeconds}s`, seconds: estimatedSeconds }
    } else {
      const minutes = Math.ceil(estimatedSeconds / 60)
      return { text: `~${minutes} min`, seconds: estimatedSeconds }
    }
  }

  // Timer pendant le scraping
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isScraping) {
      interval = setInterval(() => {
        setElapsedTime(prev => prev + 1)
      }, 1000)
    } else {
      setElapsedTime(0)
    }
    return () => clearInterval(interval)
  }, [isScraping])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  const handleScrape = async () => {
    if (!referenceUrl.trim()) {
      setReferenceUrl(DEFAULT_REFERENCE_URL)
      alert("Veuillez définir un site de référence")
      return
    }

    // Vérifier la limite avant de lancer le scraping
    if (!scrapingLimit.canScrape) {
      alert(`Limite de ${scrapingLimit.limit} scrapings atteinte. ${!user ? 'Connectez-vous' : user.subscription_plan === 'free' ? 'Passez au plan Standard ou Premium' : ''} pour plus de scrapings.`)
      return
    }

    const otherUrls = urls.filter((url, idx) => competitorEnabled[idx] && url.trim() !== "" && url.trim() !== referenceUrl.trim())
    const allUrls = [referenceUrl.trim(), ...otherUrls]
    const totalSites = allUrls.length

    // Permettre le scraping avec seulement le site de référence
    if (totalSites < 1) {
      alert("Veuillez définir au moins un site à scraper")
      return
    }

    setIsScraping(true)
    setElapsedTime(0)
    if (totalSites === 1) {
      setScrapeStatus(`🚀 Extraction du site de référence...`)
    } else {
      setScrapeStatus(`🚀 Scraping de ${totalSites} sites en parallèle...`)
    }
    onScrapeStart?.()

    try {
      let response
      try {
        response = await fetch("/api/scraper/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            referenceUrl: referenceUrl.trim(),
            urls: allUrls,
            forceRefresh,
            useAI: true,
          }),
        })
      } catch (fetchError: any) {
        // Erreur réseau (serveur non démarré, etc.)
        if (fetchError.message?.includes('Failed to fetch') || fetchError.message?.includes('NetworkError')) {
          throw new Error('ERR_CONNECTION_REFUSED')
        }
        throw fetchError
      }

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Erreur lors du scraping")
      }

      // L'API retourne maintenant immédiatement (scraping en arrière-plan)
      const data = await response.json()
      // Le scraping est lancé en arrière-plan
      setScrapeStatus(`🚀 ${data.message || "Scraping lancé en arrière-plan. Le processus continue même si vous fermez cette page."}`)

      await saveConfig()

      // Ne pas arrêter le statut immédiatement - le scraping continue en arrière-plan
      setTimeout(() => {
        setIsScraping(false)
        setScrapeStatus(`⏳ Scraping en cours en arrière-plan. Vérifiez les résultats dans quelques minutes.`)
      }, 3000)
    } catch (error: any) {
      // Détecter les erreurs de connexion spécifiques
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError') || error.message === 'ERR_CONNECTION_REFUSED' || error.code === 'ERR_CONNECTION_REFUSED') {
        setScrapeStatus(`❌ Serveur non démarré. Veuillez lancer "npm run dev" dans le dossier dashboard_web`)
      } else {
        setScrapeStatus(`❌ Erreur: ${error.message}`)
      }
      setIsScraping(false)
    }
  }

  const saveConfig = async () => {
    try {
      await fetch("/api/scraper/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          referenceUrl: referenceUrl.trim() || DEFAULT_REFERENCE_URL,
          urls: urls.map((u, i) => (competitorEnabled[i] ? u : "")).filter(url => url.trim() !== ""),
          forceRefresh,
          useAI: true,
        }),
      })
    } catch (error) {
      console.error("Erreur lors de la sauvegarde de la configuration:", error)
    }
  }

  const loadConfig = async () => {
    try {
      const response = await fetch("/api/scraper/config")
      if (response.ok) {
        const config = await response.json()
        if (config.referenceUrl && config.referenceUrl.trim() !== "") setReferenceUrl(config.referenceUrl)
        else setReferenceUrl(DEFAULT_REFERENCE_URL)
        if (config.urls && config.urls.length > 0) {
          setUrls(config.urls)
          setCompetitorEnabled(config.urls.map(() => true))
          if (config.urls.length > 1) {
            setShowMultipleUrls(true)
          }
        }
        if (config.forceRefresh !== undefined) {
          setForceRefresh(config.forceRefresh)
        }
      }
    } catch (error) {
      console.error("Erreur lors du chargement de la configuration:", error)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const otherValidUrls = urls.filter((url, idx) => competitorEnabled[idx] && url.trim() !== "" && url.trim() !== referenceUrl.trim())
  const totalSitesToScrape = referenceUrl.trim() ? 1 + otherValidUrls.length : otherValidUrls.length
  const timeEstimate = getTimeEstimate()
  // Si hideHeader est true (modale), toujours afficher le contenu
  const isConfigOpen = hideHeader ? true : (controlledShow !== undefined ? controlledShow : showConfig)
  const toggleConfig = () => {
    if (onToggleConfig) onToggleConfig()
    else setShowConfig(prev => !prev)
  }

  useImperativeHandle(ref, () => ({
    runScrape: handleScrape
  }))

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-xl p-6 border border-gray-200 dark:border-[#1F1F23]">
      {/* Message d'avertissement pour URLs sans scraper */}
      {urlsWithoutScraper.length > 0 && !isScraping && (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-lg animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200 mb-1">
                ⏱️ Scraping plus long prévu
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                {urlsWithoutScraper.length} site{urlsWithoutScraper.length > 1 ? 's' : ''} sans scraper détecté{urlsWithoutScraper.length > 1 ? 's' : ''}.
                L'agent IA devra analyser et générer un scraper, ce qui peut prendre 3-5 minutes par site.
              </p>
              <div className="text-xs text-amber-600 dark:text-amber-400 font-mono bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded">
                Sites concernés: {urlsWithoutScraper.slice(0, 2).map(url => {
                  try {
                    return new URL(url).hostname.replace('www.', '')
                  } catch {
                    return url
                  }
                }).join(', ')}
                {urlsWithoutScraper.length > 2 && ` +${urlsWithoutScraper.length - 2} autre${urlsWithoutScraper.length > 3 ? 's' : ''}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Indicateur de vérification en cours */}
      {checkingScrapers && (
        <div className="mb-4 p-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Vérification des scrapers en cache...
        </div>
      )}
      {!hideHeader && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-500" />
            Scraper AI
          </h2>
          <button
            onClick={toggleConfig}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            {isConfigOpen ? "Masquer" : "Afficher"}
          </button>
        </div>
      )}

      {isConfigOpen && (
        <div className="space-y-5">
          {/* Liste unifiée des sites */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-base font-bold text-gray-900 dark:text-white">
                Sites à scraper
              </label>
              <button
                onClick={addUrl}
                className="inline-flex items-center gap-2 rounded-lg border-2 border-purple-400 dark:border-purple-500 bg-purple-50 dark:bg-purple-900/30 px-3 py-2 text-xs font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-800/40 transition"
              >
                <Plus className="w-4 h-4" />
                Ajouter un site
              </button>
            </div>

            {/* Site de référence */}
            <div className={`p-4 rounded-xl border-2 transition-all ${
              referenceUrl.trim() ? "bg-gradient-to-r from-orange-50 to-orange-100/80 dark:from-orange-900/40 dark:to-orange-800/30 border-orange-400 dark:border-orange-500" : "bg-gray-50 dark:bg-[#1A1A1F] border-gray-200 dark:border-[#2A2A30]"
            }`}>
              <div className="flex items-start gap-3">
                <div className="flex items-center gap-3 mt-1">
                  <input
                    type="radio"
                    name="reference-site"
                    checked={true}
                    readOnly
                    className="h-4 w-4 text-orange-600 dark:text-orange-400 border-gray-300 dark:border-gray-600 focus:ring-orange-500 cursor-default"
                  />
                  <Star className={`w-5 h-5 ${referenceUrl.trim() ? "text-orange-600 dark:text-orange-400 fill-orange-600 dark:fill-orange-400" : "text-gray-400 dark:text-gray-500"}`} />
                </div>
                <div className="flex-1 space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-orange-700 dark:text-orange-300">
                    SITE DE RÉFÉRENCE
                  </label>
                  <input
                    type="url"
                    value={referenceUrl}
                    onChange={(e) => setReferenceUrl(e.target.value || DEFAULT_REFERENCE_URL)}
                    placeholder="https://www.exemple-reference.com/"
                    className="w-full px-4 py-3 border-2 border-orange-400 dark:border-orange-500 rounded-lg bg-white dark:bg-orange-950/40 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 font-medium text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                  <p className="text-xs font-medium text-orange-700 dark:text-orange-300">
                    ⭐ Les prix des concurrents seront comparés à ce site
                  </p>
                </div>
              </div>
            </div>

            {/* Sites concurrents */}
            <div className="space-y-2">
              {urls.map((url, index) => {
                const urlTrimmed = url.trim()
                const refTrimmed = referenceUrl.trim()
                const isReference = urlTrimmed === refTrimmed && urlTrimmed !== ""
                
                return (
                  <div
                    key={index}
                    className={`p-4 rounded-xl border transition-colors ${
                      isReference 
                        ? "bg-orange-50/50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-600" 
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F0F12] hover:border-purple-300 dark:hover:border-purple-600"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="reference-site"
                          checked={isReference}
                          onChange={() => urlTrimmed && setReferenceFromCompetitor(index)}
                          disabled={!urlTrimmed}
                          className="h-4 w-4 text-purple-600 dark:text-purple-400 border-gray-300 dark:border-gray-600 focus:ring-purple-500 dark:focus:ring-purple-400 disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={competitorEnabled[index] && !isReference}
                            onChange={() => !isReference && toggleCompetitorEnabled(index)}
                            disabled={isReference}
                            className="rounded border-gray-300 dark:border-gray-600 text-purple-600 dark:text-purple-400 focus:ring-purple-500 dark:focus:ring-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span className={`text-xs font-semibold ${isReference ? "text-orange-700 dark:text-orange-300" : "text-gray-800 dark:text-gray-200"}`}>
                            {isReference ? "Référence" : "Activer"}
                          </span>
                        </label>
                      </div>
                      <input
                        type="url"
                        value={url}
                        onChange={(e) => updateUrl(index, e.target.value)}
                        placeholder={`https://concurrent-${index + 1}.com/`}
                        className={`flex-1 px-4 py-3 border rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 ${
                          isReference 
                            ? "border-orange-300 dark:border-orange-600 bg-orange-50 dark:bg-orange-950/40 focus:ring-orange-500 dark:focus:ring-orange-400" 
                            : "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#1A1A1F] focus:ring-purple-500 dark:focus:ring-purple-400"
                        }`}
                      />
                      {urls.length > 1 && !isReference && (
                        <button
                          onClick={() => removeUrl(index)}
                          className="p-2 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          aria-label="Supprimer ce site"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {isReference && (
                      <div className="mt-2 flex items-center gap-2 text-xs font-medium text-orange-700 dark:text-orange-300">
                        <Star className="w-3 h-3 fill-orange-600 dark:fill-orange-400" />
                        <span>Cette URL est définie comme référence (voir en haut)</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Résumé avec estimation du temps */}
          <div className="p-4 bg-gradient-to-r from-purple-50 to-purple-100/80 dark:from-purple-900/30 dark:to-purple-800/20 rounded-xl border border-purple-300 dark:border-purple-600">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-purple-800 dark:text-purple-200">
                📊 Résumé
              </span>
              <span className="text-sm font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5 bg-purple-200 dark:bg-purple-800/50 px-3 py-1 rounded-full">
                <Clock className="w-4 h-4" />
                {timeEstimate.text}
              </span>
            </div>
            <div className="space-y-1.5 text-xs">
              {referenceUrl.trim() && (
                <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300 font-semibold">
                  <Star className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 fill-orange-600 dark:fill-orange-400" />
                  <span className="truncate font-medium">{referenceUrl.trim()}</span>
                  <span className="text-orange-800 dark:text-orange-200 bg-orange-200 dark:bg-orange-800/50 px-2 py-0.5 rounded text-[10px] font-bold">RÉFÉRENCE</span>
                </div>
              )}
              {otherValidUrls.map((url, i) => (
                <div key={i} className="flex items-center gap-2 text-gray-700 dark:text-gray-300 font-medium">
                  <span className="w-3.5 h-3.5 flex items-center justify-center text-[10px] font-bold bg-purple-200 dark:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-full">{i + 1}</span>
                  <span className="truncate">{url}</span>
                </div>
              ))}
            </div>
            {totalSitesToScrape >= 2 && (
              <p className="mt-3 text-xs text-purple-700 dark:text-purple-300 font-semibold">
                ⚡ {totalSitesToScrape} sites scrapés en parallèle • Seuls les produits en commun seront affichés
              </p>
            )}
            {totalSitesToScrape === 1 && (
              <p className="mt-3 text-xs text-purple-700 dark:text-purple-300 font-semibold">
                ⚡ Extraction de tous les produits du site de référence
              </p>
            )}
          </div>

          {/* Statut avec timer */}
          {scrapeStatus && (
            <div className={`p-4 rounded-xl flex items-center justify-between ${scrapeStatus.includes("❌")
              ? "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
              : scrapeStatus.includes("✅")
                ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800"
                : "bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800"
              }`}>
              <span>{scrapeStatus}</span>
              {isScraping && (
                <span className="text-sm font-mono font-bold">
                  {formatTime(elapsedTime)}
                </span>
              )}
            </div>
          )}

          {/* Bouton de lancement - Style vibrant (optionnel) */}
          {showLaunchButton && (
            <>
              <button
                onClick={handleScrape}
                disabled={isScraping || totalSitesToScrape < 1}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-700 hover:via-purple-700 hover:to-indigo-700 text-white rounded-xl font-semibold text-lg shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {isScraping ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>Scraping en cours...</span>
                    <span className="font-mono text-violet-200">{formatTime(elapsedTime)}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-6 h-6" />
                    <span>Lancer le scraping</span>
                    <span className="text-violet-200 text-sm">({totalSitesToScrape} site{totalSitesToScrape > 1 ? 's' : ''} • {timeEstimate.text})</span>
                  </>
                )}
              </button>

              {totalSitesToScrape < 1 && (
                <p className="text-xs text-center text-amber-600 dark:text-amber-400 font-medium">
                  ⚠️ Veuillez définir au moins un site à scraper
                </p>
              )}
              {totalSitesToScrape === 1 && (
                <p className="text-xs text-center text-blue-600 dark:text-blue-400 font-medium">
                  ℹ️ Extraction du site de référence uniquement (sans comparaison)
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
})

export default ScraperConfig
