"use client"

import { useState, useEffect } from "react"
import { Sparkles, Play, Trash2, RefreshCw, Search, CheckCircle2, XCircle, Loader2, FileCode, Database } from "lucide-react"

interface ScraperCache {
  cacheKey: string
  url: string
  analyzedPages: string[]
  siteName: string
  structureType: string
  paginationType: string
  createdAt: string
  fileSize: number
}

interface ScraperData {
  siteAnalysis?: {
    siteName?: string
    structureType?: string
    paginationStrategy?: {
      type?: string
      pattern?: string
    }
  }
  fieldMappings?: Record<string, any>
  metadata?: {
    url?: string
    analyzed_pages?: string[]
  }
}

export default function AIAgent() {
  const [url, setUrl] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [running, setRunning] = useState(false)
  const [cachedScrapers, setCachedScrapers] = useState<ScraperCache[]>([])
  const [loadingCache, setLoadingCache] = useState(true)
  const [analysisResult, setAnalysisResult] = useState<ScraperData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Charger les scrapers en cache
  const loadCache = async () => {
    try {
      setLoadingCache(true)
      const response = await fetch('/api/scraper-ai/cache')
      if (response.ok) {
        const data = await response.json()
        setCachedScrapers(data.scrapers || [])
      }
    } catch (err: any) {
      console.error('Error loading cache:', err)
      // Ne pas afficher d'erreur pour le chargement du cache si le serveur n'est pas démarré
      // L'erreur sera visible lors des autres actions
    } finally {
      setLoadingCache(false)
    }
  }

  useEffect(() => {
    loadCache()
  }, [])

  // Analyser un site
  const handleAnalyze = async () => {
    if (!url.trim()) {
      setError("Veuillez entrer une URL")
      return
    }

    setAnalyzing(true)
    setError(null)
    setSuccess(null)
    setAnalysisResult(null)

    try {
      let response
      try {
        response = await fetch('/api/scraper-ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), forceRefresh: false })
      })
      } catch (fetchError: any) {
        // Erreur réseau (serveur non démarré, etc.)
        if (fetchError.message?.includes('Failed to fetch') || fetchError.message?.includes('NetworkError')) {
          throw new Error('ERR_CONNECTION_REFUSED')
        }
        throw fetchError
      }

      const data = await response.json()

      if (response.ok && data.success) {
        setAnalysisResult(data.scraperData)
        setSuccess(`Scraper généré avec succès pour ${data.scraperData?.siteAnalysis?.siteName || url}`)
        await loadCache() // Recharger le cache
      } else {
        setError(data.error || 'Erreur lors de l\'analyse')
      }
    } catch (err: any) {
      // Détecter les erreurs de connexion spécifiques
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError') || err.message === 'ERR_CONNECTION_REFUSED' || err.code === 'ERR_CONNECTION_REFUSED') {
        setError('❌ Serveur non démarré. Veuillez lancer "npm run dev" dans le dossier dashboard_web')
      } else {
      setError(err.message || 'Erreur de connexion')
      }
    } finally {
      setAnalyzing(false)
    }
  }

  // Exécuter un scraper
  const handleRun = async (scraperUrl: string, forceRefresh: boolean = false) => {
    setRunning(true)
    setError(null)
    setSuccess(null)

    try {
      let response
      try {
        response = await fetch('/api/scraper-ai/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: scraperUrl,
          forceRefresh 
        })
      })
      } catch (fetchError: any) {
        // Erreur réseau (serveur non démarré, etc.)
        if (fetchError.message?.includes('Failed to fetch') || fetchError.message?.includes('NetworkError')) {
          throw new Error('ERR_CONNECTION_REFUSED')
        }
        throw fetchError
      }

      const data = await response.json()

      if (response.ok && data.success) {
        setSuccess(`Scraping terminé pour ${scraperUrl}`)
        // Recharger les produits après un délai
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } else {
        setError(data.error || data.message || 'Erreur lors du scraping')
      }
    } catch (err: any) {
      // Détecter les erreurs de connexion spécifiques
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError') || err.message === 'ERR_CONNECTION_REFUSED' || err.code === 'ERR_CONNECTION_REFUSED') {
        setError('❌ Serveur non démarré. Veuillez lancer "npm run dev" dans le dossier dashboard_web')
      } else {
      setError(err.message || 'Erreur de connexion')
      }
    } finally {
      setRunning(false)
    }
  }

  // Supprimer un scraper du cache
  const handleDeleteCache = async (cacheKey: string, scraperUrl: string) => {
    if (!confirm(`Supprimer le scraper pour ${scraperUrl}?`)) {
      return
    }

    try {
      const response = await fetch(`/api/scraper-ai/cache?key=${cacheKey}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setSuccess('Scraper supprimé du cache')
        await loadCache()
      } else {
        setError(data.error || 'Erreur lors de la suppression')
      }
    } catch (err: any) {
      // Détecter les erreurs de connexion spécifiques
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError') || err.message === 'ERR_CONNECTION_REFUSED' || err.code === 'ERR_CONNECTION_REFUSED') {
        setError('❌ Serveur non démarré. Veuillez lancer "npm run dev" dans le dossier dashboard_web')
      } else {
      setError(err.message || 'Erreur de connexion')
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="bg-white dark:bg-[#0F0F12] rounded-xl p-6 border border-gray-200 dark:border-[#1F1F23]">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
            <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Agent IA - Analyseur de Sites
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Gemini analyse le HTML et génère un scraper spécifique pour chaque site
            </p>
          </div>
        </div>

        {/* Messages de statut */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-800 dark:text-green-200">{success}</p>
          </div>
        )}

        {/* Formulaire d'analyse */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !analyzing && handleAnalyze()}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-[#1F1F23] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400"
              disabled={analyzing}
            />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !url.trim()}
            className="px-6 py-2 bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyse en cours...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Analyser
              </>
            )}
          </button>
        </div>

        {/* Résultat de l'analyse */}
        {analysisResult && (
          <div className="mt-4 p-4 bg-gray-50 dark:bg-[#1F1F23] rounded-lg">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              Scraper généré
            </h3>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-gray-600 dark:text-gray-400">Site:</span>{' '}
                <span className="text-gray-900 dark:text-white">
                  {analysisResult.siteAnalysis?.siteName || 'N/A'}
                </span>
              </p>
              <p>
                <span className="text-gray-600 dark:text-gray-400">Structure:</span>{' '}
                <span className="text-gray-900 dark:text-white">
                  {analysisResult.siteAnalysis?.structureType || 'N/A'}
                </span>
              </p>
              <p>
                <span className="text-gray-600 dark:text-gray-400">Pagination:</span>{' '}
                <span className="text-gray-900 dark:text-white">
                  {analysisResult.siteAnalysis?.paginationStrategy?.type || 'none'}
                </span>
              </p>
              {analysisResult.metadata?.analyzed_pages && (
                <p>
                  <span className="text-gray-600 dark:text-gray-400">Pages analysées:</span>{' '}
                  <span className="text-gray-900 dark:text-white">
                    {analysisResult.metadata.analyzed_pages.length}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Liste des scrapers en cache */}
      <div className="bg-white dark:bg-[#0F0F12] rounded-xl p-6 border border-gray-200 dark:border-[#1F1F23]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Scrapers en cache ({cachedScrapers.length})
            </h3>
          </div>
          <button
            onClick={loadCache}
            disabled={loadingCache}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#1F1F23] rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loadingCache ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loadingCache ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : cachedScrapers.length === 0 ? (
          <div className="text-center py-8 text-gray-600 dark:text-gray-400">
            <FileCode className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Aucun scraper en cache</p>
            <p className="text-sm mt-1">Analysez un site pour générer un scraper</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cachedScrapers.map((scraper) => (
              <div
                key={scraper.cacheKey}
                className="p-4 border border-gray-200 dark:border-[#1F1F23] rounded-lg hover:bg-gray-50 dark:hover:bg-[#1F1F23] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900 dark:text-white mb-1">
                      {scraper.siteName}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 break-all">
                      {scraper.url}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-500">
                      <span className="px-2 py-1 bg-gray-100 dark:bg-[#1F1F23] rounded">
                        {scraper.structureType}
                      </span>
                      <span className="px-2 py-1 bg-gray-100 dark:bg-[#1F1F23] rounded">
                        Pagination: {scraper.paginationType}
                      </span>
                      <span className="px-2 py-1 bg-gray-100 dark:bg-[#1F1F23] rounded">
                        {(scraper.fileSize / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleRun(scraper.url, false)}
                      disabled={running}
                      className="p-2 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50"
                      title="Exécuter le scraper"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRun(scraper.url, true)}
                      disabled={running}
                      className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
                      title="Régénérer et exécuter"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCache(scraper.cacheKey, scraper.url)}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title="Supprimer du cache"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

