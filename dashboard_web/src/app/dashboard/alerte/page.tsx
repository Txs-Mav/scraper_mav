"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  Bell, Loader2, Lock, Plus, Trash2, Clock, Mail, MailX,
  TrendingUp, TrendingDown, Package, PackageMinus, RefreshCw,
  CheckCheck, ChevronDown, ChevronUp, Eye, Globe, AlertTriangle,
  Pause, Play, ShieldCheck,
} from "lucide-react"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { canAccessOrganisation } from "@/lib/plan-restrictions"

// ─── Types ──────────────────────────────────────────────────────────

interface ScraperCache {
  id: string
  url: string
  siteName: string
  cacheKey: string
  lastProductCount: number
  status: string
  lastRunAt: string | null
  createdAt: string
}

interface Alert {
  id: string
  user_id: string
  scraper_cache_id: string
  schedule_hour: number
  schedule_minute: number
  is_active: boolean
  email_notification: boolean
  last_run_at: string | null
  last_change_detected_at: string | null
  created_at: string
  scraper_cache: {
    id: string
    site_url: string
    cache_key: string
    last_product_count: number
    status: string
    last_run_at: string | null
  } | null
}

interface AlertChange {
  id: string
  alert_id: string
  change_type: string
  product_name: string | null
  old_value: string | null
  new_value: string | null
  percentage_change: number | null
  details: Record<string, any>
  detected_at: string
  is_read: boolean
  scraper_alerts?: {
    id: string
    scraper_cache: {
      site_url: string
      cache_key: string
    } | null
  } | null
}

// ─── Helpers ────────────────────────────────────────────────────────

function getHostname(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor(diff / (1000 * 60))

  if (minutes < 1) return "À l'instant"
  if (minutes < 60) return `Il y a ${minutes} min`
  if (hours < 24) return `Il y a ${hours}h`

  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function changeTypeLabel(type: string): string {
  switch (type) {
    case 'price_increase': return 'Hausse de prix'
    case 'price_decrease': return 'Baisse de prix'
    case 'new_product': return 'Nouveau produit'
    case 'removed_product': return 'Produit retiré'
    case 'stock_change': return 'Stock modifié'
    default: return type
  }
}

function changeTypeIcon(type: string) {
  switch (type) {
    case 'price_increase': return <TrendingUp className="h-4 w-4 text-red-500" />
    case 'price_decrease': return <TrendingDown className="h-4 w-4 text-green-500" />
    case 'new_product': return <Package className="h-4 w-4 text-blue-500" />
    case 'removed_product': return <PackageMinus className="h-4 w-4 text-orange-500" />
    case 'stock_change': return <RefreshCw className="h-4 w-4 text-purple-500" />
    default: return <Bell className="h-4 w-4 text-gray-500" />
  }
}

function changeTypeBg(type: string): string {
  switch (type) {
    case 'price_increase': return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
    case 'price_decrease': return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    case 'new_product': return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
    case 'removed_product': return 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
    case 'stock_change': return 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
    default: return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
  }
}

// ─── Main Component ─────────────────────────────────────────────────

export default function AlertePage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  // Fallback : si subscription_source est null mais promo_code_id est défini → promo
  const effectiveSource = user?.subscription_source || (user?.promo_code_id ? 'promo' : null)
  const hasAccess = canAccessOrganisation(user?.subscription_plan ?? "standard", effectiveSource)

  // State
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [changes, setChanges] = useState<AlertChange[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [scraperCaches, setScraperCaches] = useState<ScraperCache[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  // Plan limits
  const [alertCount, setAlertCount] = useState(0)
  const [alertLimit, setAlertLimit] = useState(0) // -1 = illimité

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [selectedCacheId, setSelectedCacheId] = useState("")
  const [scheduleHour, setScheduleHour] = useState(8)
  const [scheduleMinute, setScheduleMinute] = useState(0)
  const [emailNotif, setEmailNotif] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  // View state
  const [showAllChanges, setShowAllChanges] = useState(false)

  // ─── Auth checks ────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) router.push("/login")
  }, [authLoading, user, router])

  useEffect(() => {
    if (!authLoading && user && !hasAccess) router.replace("/dashboard?restricted=alerte")
  }, [authLoading, user, hasAccess, router])

  // ─── Data loading ───────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    try {
      const [alertsRes, changesRes, cachesRes] = await Promise.all([
        fetch('/api/alerts'),
        fetch('/api/alerts/changes?limit=100'),
        fetch('/api/scraper-ai/cache'),
      ])

      if (alertsRes.ok) {
        const data = await alertsRes.json()
        setAlerts(data.alerts || [])
        setAlertCount(data.alert_count || 0)
        setAlertLimit(data.alert_limit ?? 0) // -1 = illimité
      } else {
        const data = await alertsRes.json().catch(() => ({}))
        setApiError(
          data?.details ||
          data?.error ||
          "Impossible de charger les alertes. Vérifiez la configuration Supabase."
        )
        // Éviter d'afficher un faux 0/0 quand l'API est en erreur
        setAlerts([])
        setAlertCount(0)
        setAlertLimit(0)
      }

      if (changesRes.ok) {
        const data = await changesRes.json()
        setChanges(data.changes || [])
        setUnreadCount(data.unread_count || 0)
      } else {
        const data = await changesRes.json().catch(() => ({}))
        setApiError(
          data?.details ||
          data?.error ||
          "Impossible de charger l'historique des alertes."
        )
        setChanges([])
        setUnreadCount(0)
      }

      if (cachesRes.ok) {
        const data = await cachesRes.json()
        const rawCaches = data.scrapers || data.caches || (Array.isArray(data) ? data : [])
        const caches = rawCaches.map((c: any) => ({
          id: c.id,
          url: c.url || c.site_url,
          siteName: c.siteName || getHostname(c.url || c.site_url || ''),
          cacheKey: c.cacheKey || c.cache_key,
          lastProductCount: c.lastProductCount || c.last_product_count || 0,
          status: c.status || 'active',
          lastRunAt: c.lastRunAt || c.last_run_at,
          createdAt: c.createdAt || c.created_at,
        }))
        setScraperCaches(caches)
      }
    } catch (err) {
      console.error('[Alerte] Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && user && hasAccess) loadData()
  }, [authLoading, user, hasAccess, loadData])

  // ─── Actions ──────────────────────────────────────────────────

  const createAlert = async () => {
    setFormError(null)
    if (!selectedCacheId) {
      setFormError("Sélectionnez un scraper")
      return
    }

    setActionLoading('create')
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scraper_cache_id: selectedCacheId,
          schedule_hour: scheduleHour,
          schedule_minute: scheduleMinute,
          email_notification: emailNotif,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setFormError(data.error || 'Erreur lors de la création')
        return
      }

      setShowForm(false)
      setSelectedCacheId("")
      setScheduleHour(8)
      setScheduleMinute(0)
      await loadData()
    } catch {
      setFormError("Erreur réseau")
    } finally {
      setActionLoading(null)
    }
  }

  const toggleAlert = async (alertId: string, isActive: boolean) => {
    setActionLoading(alertId)
    try {
      await fetch(`/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })
      await loadData()
    } finally {
      setActionLoading(null)
    }
  }

  const deleteAlert = async (alertId: string) => {
    if (!confirm("Supprimer cette alerte ?")) return
    setActionLoading(alertId)
    try {
      await fetch(`/api/alerts/${alertId}`, { method: 'DELETE' })
      await loadData()
    } finally {
      setActionLoading(null)
    }
  }

  const runCheck = async (alertId: string) => {
    setActionLoading(`check-${alertId}`)
    try {
      const res = await fetch('/api/alerts/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId }),
      })
      const data = await res.json()
      console.log('[Alerte] Check result:', data)
      await loadData()
    } finally {
      setActionLoading(null)
    }
  }

  const markAllRead = async () => {
    try {
      await fetch('/api/alerts/changes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_all_read: true }),
      })
      setChanges(prev => prev.map(c => ({ ...c, is_read: true })))
      setUnreadCount(0)
    } catch (err) {
      console.error('[Alerte] Error marking all read:', err)
    }
  }

  // ─── Derived data (mémorisé) ──────────────────────────────────

  const alertedCacheIds = useMemo(() => new Set(alerts.map(a => a.scraper_cache_id)), [alerts])
  const availableCaches = useMemo(
    () => scraperCaches.filter(c => !alertedCacheIds.has(c.id) && c.status === 'active'),
    [scraperCaches, alertedCacheIds]
  )

  const visibleChanges = useMemo(
    () => showAllChanges ? changes : changes.slice(0, 10),
    [showAllChanges, changes]
  )

  const activeAlerts = useMemo(() => alerts.filter(a => a.is_active).length, [alerts])
  const priceIncreases = useMemo(
    () => changes.filter(c => c.change_type === 'price_increase' && !c.is_read).length,
    [changes]
  )
  const priceDecreases = useMemo(
    () => changes.filter(c => c.change_type === 'price_decrease' && !c.is_read).length,
    [changes]
  )

  // Calcul de la limite
  const isUnlimited = !apiError && alertLimit === -1
  const atLimit = !isUnlimited && alertCount >= alertLimit
  const canCreate = !apiError && !atLimit && availableCaches.length > 0

  // ─── Render guards ───────────────────────────────────────────

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
        </div>
      </Layout>
    )
  }

  if (!user) return null

  if (!hasAccess) {
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

  // ─── Render ──────────────────────────────────────────────────

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
            <p className="text-xs uppercase tracking-[0.28em] text-gray-500 dark:text-gray-400">Automatisation</p>
            <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight flex items-center gap-3 mt-2">
              <Bell className="h-8 w-8" />
              Alertes
              {unreadCount > 0 && (
                <span className="text-sm font-medium bg-red-500 text-white px-2.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Programmez des scrapings automatiques et recevez les changements par email.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={() => setShowForm(true)}
              disabled={!canCreate && !loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" />
              Nouvelle alerte
            </button>
            {/* Indicateur de limite */}
            {!loading && (
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                {apiError
                  ? "Configuration alertes requise"
                  : isUnlimited
                  ? `${alertCount} alerte${alertCount > 1 ? 's' : ''} (illimité)`
                  : `${alertCount} / ${alertLimit} alerte${alertLimit > 1 ? 's' : ''}`
                }
              </p>
            )}
            {/* Messages d'info */}
            {!loading && scraperCaches.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Créez d&apos;abord un scraper depuis le dashboard.
              </p>
            )}
            {!loading && scraperCaches.length > 0 && availableCaches.length === 0 && !atLimit && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Tous vos scrapers sont déjà surveillés.
              </p>
            )}
            {!loading && !apiError && atLimit && !isUnlimited && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Limite de {alertLimit} alerte{alertLimit > 1 ? 's' : ''} atteinte. Passez au plan Ultime pour plus.
              </p>
            )}
          </div>
        </div>

        {apiError && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
              Configuration des alertes incomplète.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              {apiError}
            </p>
          </div>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#1F1F23] rounded-xl border border-gray-200 dark:border-[#2B2B30] p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Alertes actives</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{activeAlerts}</p>
          </div>
          <div className="bg-white dark:bg-[#1F1F23] rounded-xl border border-gray-200 dark:border-[#2B2B30] p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Non lus</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{unreadCount}</p>
          </div>
          <div className="bg-white dark:bg-[#1F1F23] rounded-xl border border-gray-200 dark:border-[#2B2B30] p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Hausses de prix</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{priceIncreases}</p>
          </div>
          <div className="bg-white dark:bg-[#1F1F23] rounded-xl border border-gray-200 dark:border-[#2B2B30] p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Baisses de prix</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{priceDecreases}</p>
          </div>
        </div>

        {/* Create alert form */}
        {showForm && (
          <div className="bg-white dark:bg-[#1F1F23] rounded-xl border border-gray-200 dark:border-[#2B2B30] p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Configurer une nouvelle alerte</h2>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-800 dark:text-red-300">{formError}</p>
              </div>
            )}

            <div className="space-y-4">
              {/* Scraper selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Site à surveiller
                </label>
                {availableCaches.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {scraperCaches.length === 0
                      ? "Aucun scraper en cache. Créez d'abord un scraper depuis le dashboard."
                      : "Tous vos scrapers sont déjà surveillés."}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {availableCaches.map((cache) => (
                      <button
                        key={cache.id}
                        type="button"
                        onClick={() => setSelectedCacheId(cache.id)}
                        className={`p-4 rounded-lg border-2 text-left transition-colors ${
                          selectedCacheId === cache.id
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                            : "border-gray-200 dark:border-[#2B2B30] hover:border-gray-300 dark:hover:border-[#3B3B40]"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Globe className="h-4 w-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {cache.siteName}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{cache.url}</p>
                        <p className="text-xs text-gray-400 mt-1">{cache.lastProductCount} produits</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Schedule */}
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Heure du scraping quotidien
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={scheduleHour}
                      onChange={(e) => setScheduleHour(parseInt(e.target.value))}
                      className="px-3 py-2 border border-gray-300 dark:border-[#2B2B30] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white text-sm"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <span className="text-gray-500 font-bold">:</span>
                    <select
                      value={scheduleMinute}
                      onChange={(e) => setScheduleMinute(parseInt(e.target.value))}
                      className="px-3 py-2 border border-gray-300 dark:border-[#2B2B30] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white text-sm"
                    >
                      {[0, 15, 30, 45].map((m) => (
                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">(heure du serveur)</span>
                  </div>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={emailNotif}
                      onChange={(e) => setEmailNotif(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Notification par email
                    </span>
                  </label>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={createAlert}
                  disabled={!selectedCacheId || actionLoading === 'create'}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {actionLoading === 'create' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Bell className="h-4 w-4" />
                  )}
                  Créer l&apos;alerte
                </button>
                <button
                  onClick={() => { setShowForm(false); setFormError(null) }}
                  className="px-5 py-2.5 border border-gray-300 dark:border-[#2B2B30] text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-[#2B2B30] transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active alerts list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="bg-white dark:bg-[#1F1F23] rounded-xl border border-gray-200 dark:border-[#2B2B30] p-12 text-center">
            <Bell className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Aucune alerte configurée</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              Créez votre première alerte pour surveiller automatiquement les changements de prix.
              Chaque alerte surveille un site et lance un scraping quotidien à l&apos;heure choisie.
            </p>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Sites surveillés ({alerts.length})
            </h2>
            <div className="space-y-3">
              {alerts.map((alert) => {
                const isLoading = actionLoading === alert.id || actionLoading === `check-${alert.id}`
                const hostname = alert.scraper_cache?.site_url
                  ? getHostname(alert.scraper_cache.site_url)
                  : 'Site inconnu'

                return (
                  <div
                    key={alert.id}
                    className={`bg-white dark:bg-[#1F1F23] rounded-xl border border-gray-200 dark:border-[#2B2B30] p-4 transition-opacity ${
                      !alert.is_active ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-blue-500 shrink-0" />
                          <span className="font-medium text-gray-900 dark:text-white truncate">{hostname}</span>
                          {!alert.is_active && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">En pause</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Tous les jours à {formatTime(alert.schedule_hour, alert.schedule_minute)}
                          </span>
                          {alert.email_notification ? (
                            <span className="flex items-center gap-1 text-blue-500">
                              <Mail className="h-3.5 w-3.5" /> Email activé
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <MailX className="h-3.5 w-3.5" /> Email désactivé
                            </span>
                          )}
                          <span>{alert.scraper_cache?.last_product_count || 0} produits</span>
                          {alert.last_run_at && (
                            <span>Dernier scan : {formatDate(alert.last_run_at)}</span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => runCheck(alert.id)}
                          disabled={isLoading}
                          title="Vérifier maintenant"
                          className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {actionLoading === `check-${alert.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => toggleAlert(alert.id, alert.is_active)}
                          disabled={isLoading}
                          title={alert.is_active ? 'Mettre en pause' : 'Réactiver'}
                          className="p-2 text-gray-500 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {alert.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => deleteAlert(alert.id)}
                          disabled={isLoading}
                          title="Supprimer"
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Changes history */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Changements détectés
              {unreadCount > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">({unreadCount} non lu{unreadCount > 1 ? 's' : ''})</span>
              )}
            </h2>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Tout marquer comme lu
              </button>
            )}
          </div>

          {changes.length === 0 ? (
            <div className="bg-white dark:bg-[#1F1F23] rounded-xl border border-gray-200 dark:border-[#2B2B30] p-8 text-center">
              <AlertTriangle className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Aucun changement détecté. Les résultats apparaîtront ici après la première vérification automatique.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleChanges.map((change) => {
                const siteUrl = change.scraper_alerts?.scraper_cache?.site_url
                const hostname = siteUrl ? getHostname(siteUrl) : ''
                const isPriceChange = change.change_type === 'price_increase' || change.change_type === 'price_decrease'
                const isIncrease = change.change_type === 'price_increase'
                const diff = change.details?.diff as number | undefined

                return (
                  <div
                    key={change.id}
                    className={`rounded-lg border p-4 transition-colors ${changeTypeBg(change.change_type)} ${
                      !change.is_read ? 'ring-1 ring-blue-300 dark:ring-blue-700' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {changeTypeIcon(change.change_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Ligne 1 : type + site + badge non-lu */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {changeTypeLabel(change.change_type)}
                          </span>
                          {hostname && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">· {hostname}</span>
                          )}
                          {/* Badge augmentation / diminution pour les prix */}
                          {isPriceChange && change.percentage_change !== null && (
                            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                              isIncrease
                                ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                                : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                            }`}>
                              {isIncrease
                                ? <TrendingUp className="h-3 w-3" />
                                : <TrendingDown className="h-3 w-3" />}
                              {isIncrease ? '+' : ''}{change.percentage_change}%
                              {diff !== undefined && (
                                <span className="ml-0.5">
                                  ({diff > 0 ? '+' : ''}{diff.toFixed(2)} $)
                                </span>
                              )}
                            </span>
                          )}
                          {!change.is_read && (
                            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                          )}
                        </div>

                        {/* Ligne 2 : nom du produit */}
                        <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 truncate">
                          {change.product_name || 'Produit inconnu'}
                        </p>

                        {/* Ligne 3 : détails prix avant → après + date */}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                          {isPriceChange && change.old_value && change.new_value ? (
                            <span className="flex items-center gap-1.5">
                              <span className="line-through opacity-70">{change.old_value}</span>
                              <span className="text-gray-400">→</span>
                              <span className={`font-semibold ${
                                isIncrease ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                              }`}>
                                {change.new_value}
                              </span>
                            </span>
                          ) : (
                            <>
                              {change.old_value && <span>Avant : {change.old_value}</span>}
                              {change.new_value && (
                                <span className="font-medium">
                                  {change.old_value ? 'Après' : 'Prix'} : {change.new_value}
                                </span>
                              )}
                            </>
                          )}
                          <span className="ml-auto shrink-0">{formatDate(change.detected_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Show more / less */}
              {changes.length > 10 && (
                <button
                  onClick={() => setShowAllChanges(!showAllChanges)}
                  className="w-full py-3 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center justify-center gap-1 transition-colors"
                >
                  {showAllChanges ? (
                    <>Voir moins <ChevronUp className="h-4 w-4" /></>
                  ) : (
                    <>Voir les {changes.length - 10} autres changements <ChevronDown className="h-4 w-4" /></>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
