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
import { useLanguage } from "@/contexts/language-context"
import type { TranslationKey } from "@/lib/translations"
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

function formatDate(dateStr: string, t: (key: TranslationKey) => string, locale: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor(diff / (1000 * 60))

  if (minutes < 1) return t("alerts.now")
  if (minutes < 60) return t("alerts.minutesAgo").replace("{0}", minutes.toString())
  if (hours < 24) return t("alerts.hoursAgo").replace("{0}", hours.toString())

  return d.toLocaleDateString(locale === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function changeTypeLabel(type: string, t: (key: TranslationKey) => string): string {
  switch (type) {
    case 'price_increase': return t('alerts.priceUp')
    case 'price_decrease': return t('alerts.priceDown')
    case 'new_product': return t('alerts.newProduct')
    case 'removed_product': return t('alerts.productRemoved')
    case 'stock_change': return t('alerts.stockChanged')
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
  const { t, locale } = useLanguage()
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
          t("alerts.loadError")
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
          t("alerts.historyError")
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
      setFormError(t("alerts.selectScraper"))
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
        setFormError(data.error || t('alerts.createError'))
        return
      }

      setShowForm(false)
      setSelectedCacheId("")
      setScheduleHour(8)
      setScheduleMinute(0)
      await loadData()
    } catch {
      setFormError(t("alerts.networkError"))
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
    if (!confirm(t("alerts.deleteConfirm"))) return
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
          <p className="text-lg font-medium text-gray-900 dark:text-white">{t("alerts.accessDenied")}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("alerts.redirecting")}</p>
        </div>
      </Layout>
    )
  }

  // ─── Render ──────────────────────────────────────────────────

  return (
    <Layout>
      <div className="space-y-4">
        {/* ── KPI Hero + Secondary ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Hero — Alertes actives */}
          <div className="col-span-2 md:col-span-1 relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br from-blue-600 to-cyan-600 dark:from-blue-600 dark:to-cyan-700 shadow-lg shadow-blue-600/10 dark:shadow-blue-900/20">
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10" />
            <div className="relative flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-200/70 mb-1.5">{t("alerts.activeAlerts")}</p>
                <p className="text-4xl font-black text-white tabular-nums leading-none tracking-tight">{activeAlerts}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-white/15">
                <Bell className="h-5 w-5 text-white/80" />
              </div>
            </div>
          </div>

          {/* Secondary KPIs */}
          {[
            { label: t("alerts.unread"), value: unreadCount, icon: Eye, accent: "text-amber-500 dark:text-amber-400", dot: "bg-amber-400" },
            { label: t("alerts.upTrend"), value: priceIncreases, icon: TrendingUp, accent: "text-red-500 dark:text-red-400", dot: "bg-red-400", valueColor: "text-red-600 dark:text-red-400" },
            { label: t("alerts.downTrend"), value: priceDecreases, icon: TrendingDown, accent: "text-green-500 dark:text-green-400", dot: "bg-green-400", valueColor: "text-green-600 dark:text-green-400" },
          ].map((s, i) => {
            const Icon = s.icon
            return (
              <div key={i} className="rounded-2xl border border-gray-200/60 dark:border-white/[0.06] bg-white/70 dark:bg-white/[0.025] backdrop-blur-sm p-5 flex flex-col justify-between group hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    <p className="text-xs font-medium text-gray-400 dark:text-gray-500 tracking-wide">{s.label}</p>
                  </div>
                  <Icon className={`h-3.5 w-3.5 ${s.accent} opacity-50`} />
                </div>
                <p className={`text-3xl font-extrabold leading-none tabular-nums tracking-tight ${'valueColor' in s && s.valueColor ? s.valueColor : 'text-gray-800 dark:text-gray-100'}`}>{s.value}</p>
              </div>
            )
          })}
        </div>

        {/* ── Header actions ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            {!loading && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100/80 dark:bg-white/[0.04] text-[11px] font-medium text-gray-500 dark:text-gray-400">
                <ShieldCheck className="h-3 w-3" />
                {apiError
                  ? t("alerts.configRequired")
                  : isUnlimited
                  ? `${alertCount} ${t("alerts.unlimited")}`
                  : `${alertCount} / ${alertLimit}`
                }
              </span>
            )}
            {!loading && scraperCaches.length === 0 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">{t("alerts.createFirst")}</span>
            )}
            {!loading && !apiError && atLimit && !isUnlimited && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">{t("alerts.limitReached")}</span>
            )}
          </div>
          <button
            onClick={() => setShowForm(true)}
            disabled={!canCreate && !loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold shadow-md shadow-blue-600/15 hover:shadow-lg hover:-translate-y-0.5 transition-all active:translate-y-0"
          >
            <Plus className="h-4 w-4" />
            {t("alerts.newAlert")}
          </button>
        </div>

        {apiError && (
          <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/80 dark:bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">{t("alerts.configError")}</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{apiError}</p>
          </div>
        )}

        {/* ── Create alert form ── */}
        {showForm && (
          <div className="rounded-2xl border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-[#111114] shadow-lg shadow-gray-900/[0.05] dark:shadow-black/20 p-6">
            <h2 className="text-base font-extrabold text-gray-900 dark:text-white tracking-tight mb-4">{t("alerts.configureNew")}</h2>

            {formError && (
              <div className="mb-4 px-3 py-2.5 rounded-xl bg-red-50/80 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/40">
                <p className="text-sm text-red-700 dark:text-red-300 font-medium">{formError}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  {t("alerts.siteToWatch")}
                </label>
                {availableCaches.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {scraperCaches.length === 0
                      ? t("alerts.noScraperCache")
                      : t("alerts.allMonitored")}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {availableCaches.map((cache) => (
                      <button
                        key={cache.id}
                        type="button"
                        onClick={() => setSelectedCacheId(cache.id)}
                        className={`p-3 rounded-xl border-2 text-left transition-all hover:-translate-y-0.5 ${
                          selectedCacheId === cache.id
                            ? "border-blue-500 bg-blue-50/80 dark:bg-blue-900/20 shadow-sm"
                            : "border-gray-200/60 dark:border-white/[0.06] hover:border-gray-300 dark:hover:border-white/[0.1]"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <Globe className="h-3.5 w-3.5 text-blue-500" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{cache.siteName}</span>
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{cache.url}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">{cache.lastProductCount} {t("alerts.productAbbr")}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                    {t("alerts.timeUtc")}
                  </label>
                  <select
                    value={scheduleHour}
                    onChange={(e) => setScheduleHour(parseInt(e.target.value))}
                    className="px-3 py-2 border border-gray-200/60 dark:border-white/[0.06] rounded-xl bg-white/80 dark:bg-white/[0.03] text-gray-900 dark:text-white text-sm tabular-nums"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end pb-0.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={emailNotif}
                      onChange={(e) => setEmailNotif(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">{t("alerts.emailNotif")}</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={createAlert}
                  disabled={!selectedCacheId || actionLoading === 'create'}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:from-gray-400 disabled:to-gray-400 text-white rounded-xl text-sm font-semibold shadow-sm transition-all"
                >
                  {actionLoading === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                  {t("alerts.createAlert")}
                </button>
                <button
                  onClick={() => { setShowForm(false); setFormError(null) }}
                  className="px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Active alerts list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111114] p-10 text-center">
            <div className="max-w-md mx-auto">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/20 flex items-center justify-center mb-5">
                <Bell className="h-7 w-7 text-blue-500 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t("alerts.noAlerts")}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {t("alerts.noAlertsDesc")}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-[#111114] overflow-hidden shadow-lg shadow-gray-900/[0.05] dark:shadow-black/20">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.04]">
              <h2 className="text-base font-extrabold text-gray-900 dark:text-white tracking-tight">
                {t("alerts.monitoredSites")}
                <span className="ml-2 px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[11px] font-semibold tabular-nums">{alerts.length}</span>
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {alerts.map((alert) => {
                const isLoading = actionLoading === alert.id || actionLoading === `check-${alert.id}`
                const hostname = alert.scraper_cache?.site_url
                  ? getHostname(alert.scraper_cache.site_url)
                  : t("alerts.unknownSite")

                return (
                  <div
                    key={alert.id}
                    className={`px-5 py-3.5 hover:bg-gray-50/50 dark:hover:bg-white/[0.015] transition ${
                      !alert.is_active ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{hostname}</span>
                          {!alert.is_active && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 font-medium">{t("alerts.paused")}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2.5 mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(alert.schedule_hour, alert.schedule_minute)}
                          </span>
                          {alert.email_notification ? (
                            <span className="flex items-center gap-1 text-blue-500"><Mail className="h-3 w-3" /> Email</span>
                          ) : (
                            <span className="flex items-center gap-1"><MailX className="h-3 w-3" /> {t("alerts.noEmail")}</span>
                          )}
                          <span className="tabular-nums">{alert.scraper_cache?.last_product_count || 0} {t("alerts.productAbbr")}</span>
                          {alert.last_run_at && <span>{formatDate(alert.last_run_at, t, locale)}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => runCheck(alert.id)}
                          disabled={isLoading}
                          title={t("alerts.checkNow")}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition disabled:opacity-50"
                        >
                          {actionLoading === `check-${alert.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => toggleAlert(alert.id, alert.is_active)}
                          disabled={isLoading}
                          title={alert.is_active ? t('alerts.pause') : t('alerts.resume')}
                          className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition disabled:opacity-50"
                        >
                          {alert.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => deleteAlert(alert.id)}
                          disabled={isLoading}
                          title={t("delete")}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Changes history ── */}
        <div className="rounded-2xl border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-[#111114] overflow-hidden shadow-lg shadow-gray-900/[0.05] dark:shadow-black/20">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.04] flex items-center justify-between">
            <h2 className="text-base font-extrabold text-gray-900 dark:text-white tracking-tight">
              {t("alerts.detectedChanges")}
              {unreadCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[11px] font-semibold tabular-nums">{unreadCount}</span>
              )}
            </h2>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold"
              >
                <CheckCheck className="h-3 w-3" />
                {t("alerts.markAllRead")}
              </button>
            )}
          </div>

          {changes.length === 0 ? (
            <div className="p-8 text-center">
              <AlertTriangle className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("alerts.noChanges")}
              </p>
            </div>
          ) : (
            <div>
              <div className="divide-y divide-gray-50 dark:divide-white/[0.02]">
                {visibleChanges.map((change) => {
                  const siteUrl = change.scraper_alerts?.scraper_cache?.site_url
                  const hostname = siteUrl ? getHostname(siteUrl) : ''
                  const isPriceChange = change.change_type === 'price_increase' || change.change_type === 'price_decrease'
                  const isIncrease = change.change_type === 'price_increase'
                  const diff = change.details?.diff as number | undefined

                  return (
                    <div
                      key={change.id}
                      className={`px-5 py-3 transition hover:bg-gray-50/50 dark:hover:bg-white/[0.015] ${
                        !change.is_read ? 'bg-blue-50/30 dark:bg-blue-950/10' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0 p-1.5 rounded-lg bg-gray-100/80 dark:bg-white/[0.04]">
                          {changeTypeIcon(change.change_type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              {changeTypeLabel(change.change_type, t)}
                            </span>
                            {hostname && (
                              <span className="text-[11px] text-gray-400 dark:text-gray-500">· {hostname}</span>
                            )}
                            {isPriceChange && change.percentage_change !== null && (
                              <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ${
                                isIncrease
                                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                                  : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                              }`}>
                                {isIncrease ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                                {isIncrease ? '+' : ''}{change.percentage_change}%
                                {diff !== undefined && <span className="ml-0.5">({diff > 0 ? '+' : ''}{diff.toFixed(2)} $)</span>}
                              </span>
                            )}
                            {!change.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                          </div>

                          <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5 truncate font-medium">
                            {change.product_name || t('alerts.unknownProduct')}
                          </p>

                          <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                            {isPriceChange && change.old_value && change.new_value ? (
                              <span className="flex items-center gap-1.5 tabular-nums">
                                <span className="line-through opacity-60">{change.old_value}</span>
                                <span className="text-gray-300 dark:text-gray-600">→</span>
                                <span className={`font-semibold ${isIncrease ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                  {change.new_value}
                                </span>
                              </span>
                            ) : (
                              <>
                                {change.old_value && <span>{t("alerts.before")} {change.old_value}</span>}
                                {change.new_value && <span className="font-medium">{change.old_value ? t("alerts.after") : t("dash.price")} : {change.new_value}</span>}
                              </>
                            )}
                            <span className="ml-auto shrink-0">{formatDate(change.detected_at, t, locale)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {changes.length > 10 && (
                <button
                  onClick={() => setShowAllChanges(!showAllChanges)}
                  className="w-full py-3 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 flex items-center justify-center gap-1 border-t border-gray-100 dark:border-white/[0.04] transition"
                >
                  {showAllChanges ? (
                    <>{t("alerts.showLess")} <ChevronUp className="h-3.5 w-3.5" /></>
                  ) : (
                    <>{t("alerts.showMore").replace("{0}", String(changes.length - 10))} <ChevronDown className="h-3.5 w-3.5" /></>
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
