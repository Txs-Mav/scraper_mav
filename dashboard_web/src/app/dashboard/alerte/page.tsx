"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  Bell, Loader2, Lock, Plus, Trash2, Clock, Mail, MailX,
  TrendingUp, TrendingDown, Package, PackageMinus, RefreshCw,
  CheckCheck, ChevronDown, ChevronUp, Eye, Globe, AlertTriangle,
  Pause, Play, ShieldCheck, Link, Settings2, Timer, Star, X,
  Radar, Activity,
} from "lucide-react"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import type { TranslationKey } from "@/lib/translations"
import { canAccessOrganisation } from "@/lib/plan-restrictions"

// ─── Types ──────────────────────────────────────────────────────────

interface CachedScraper {
  id: string
  cacheKey: string
  url: string
  siteName: string
  structureType: string
  status: string
  lastProductCount: number
  lastRunAt: string | null
  createdAt: string
}

interface Alert {
  id: string
  user_id: string
  reference_url: string | null
  competitor_urls: string[]
  categories: string[]
  scraper_cache_id: string | null
  schedule_type: 'daily' | 'interval'
  schedule_hour: number
  schedule_minute: number
  schedule_interval_hours: number | null
  is_active: boolean
  email_notification: boolean
  watch_price_increase: boolean
  watch_price_decrease: boolean
  watch_new_products: boolean
  watch_removed_products: boolean
  watch_stock_changes: boolean
  min_price_change_pct: number
  min_price_change_abs: number
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

function formatSchedule(alert: Alert, t: (key: TranslationKey) => string): string {
  if (alert.schedule_type === 'interval' && alert.schedule_interval_hours) {
    return t("alerts.everyXHours").replace("{0}", String(alert.schedule_interval_hours))
  }
  return t("alerts.dailyAt").replace("{0}", formatTime(alert.schedule_hour, alert.schedule_minute))
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

const INTERVAL_OPTIONS = [1, 2, 4, 6, 12, 24]

function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// ─── Main Component ─────────────────────────────────────────────────

export default function AlertePage() {
  const { user, isLoading: authLoading } = useAuth()
  const { t, locale } = useLanguage()
  const router = useRouter()
  const effectiveSource = user?.subscription_source || (user?.promo_code_id ? 'promo' : null)
  const hasAccess = canAccessOrganisation(user?.subscription_plan ?? "standard", effectiveSource)

  // State
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [changes, setChanges] = useState<AlertChange[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  // Plan limits
  const [alertCount, setAlertCount] = useState(0)
  const [alertLimit, setAlertLimit] = useState(0)

  // Scrapers en cache
  const [cachedScrapers, setCachedScrapers] = useState<CachedScraper[]>([])
  const [showCacheForRef, setShowCacheForRef] = useState(false)
  const [showCacheForComp, setShowCacheForComp] = useState(false)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [referenceUrl, setReferenceUrl] = useState("")
  const [competitorUrls, setCompetitorUrls] = useState<string[]>([])
  const [newCompetitor, setNewCompetitor] = useState("")
  const [scheduleType, setScheduleType] = useState<'daily' | 'interval'>('daily')
  const [scheduleHour, setScheduleHour] = useState(8)
  const [scheduleIntervalHours, setScheduleIntervalHours] = useState(6)
  const [emailNotif, setEmailNotif] = useState(true)
  const [watchPriceUp, setWatchPriceUp] = useState(true)
  const [watchPriceDown, setWatchPriceDown] = useState(true)
  const [watchNewProducts, setWatchNewProducts] = useState(true)
  const [watchRemovedProducts, setWatchRemovedProducts] = useState(true)
  const [watchStock, setWatchStock] = useState(true)
  const [minPricePct, setMinPricePct] = useState(1)
  const [minPriceAbs, setMinPriceAbs] = useState(2)
  const [formError, setFormError] = useState<string | null>(null)
  const [scrapingInProgress, setScrapingInProgress] = useState<Set<string>>(new Set())

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
      const [alertsRes, changesRes, cacheRes] = await Promise.all([
        fetch('/api/alerts'),
        fetch('/api/alerts/changes?limit=100'),
        fetch('/api/scraper-ai/cache'),
      ])

      if (alertsRes.ok) {
        const data = await alertsRes.json()
        setAlerts(data.alerts || [])
        setAlertCount(data.alert_count || 0)
        setAlertLimit(data.alert_limit ?? 0)
      } else {
        const data = await alertsRes.json().catch(() => ({}))
        setApiError(data?.details || data?.error || t("alerts.loadError"))
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
        setApiError(data?.details || data?.error || t("alerts.historyError"))
        setChanges([])
        setUnreadCount(0)
      }

      if (cacheRes.ok) {
        const data = await cacheRes.json()
        setCachedScrapers((data.scrapers || []).filter((s: CachedScraper) => s.status === 'active'))
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

  // ─── Form helpers ─────────────────────────────────────────────

  const resetForm = () => {
    setReferenceUrl("")
    setCompetitorUrls([])
    setNewCompetitor("")
    setScheduleType('daily')
    setScheduleHour(8)
    setScheduleIntervalHours(6)
    setEmailNotif(true)
    setWatchPriceUp(true)
    setWatchPriceDown(true)
    setWatchNewProducts(true)
    setWatchRemovedProducts(true)
    setWatchStock(true)
    setMinPricePct(1)
    setMinPriceAbs(2)
    setFormError(null)
    setShowCacheForRef(false)
    setShowCacheForComp(false)
  }

  const selectCacheForRef = (scraper: CachedScraper) => {
    setReferenceUrl(scraper.url)
    setShowCacheForRef(false)
  }

  const selectCacheForComp = (scraper: CachedScraper) => {
    if (!competitorUrls.includes(scraper.url) && scraper.url !== referenceUrl) {
      setCompetitorUrls(prev => [...prev, scraper.url])
    }
    setShowCacheForComp(false)
  }

  const availableCacheForRef = useMemo(
    () => cachedScrapers.filter(s => !competitorUrls.includes(s.url)),
    [cachedScrapers, competitorUrls]
  )

  const availableCacheForComp = useMemo(
    () => cachedScrapers.filter(s => s.url !== referenceUrl && !competitorUrls.includes(s.url)),
    [cachedScrapers, referenceUrl, competitorUrls]
  )

  const addCompetitor = () => {
    const url = newCompetitor.trim()
    if (!url) return
    if (!isValidUrl(url)) {
      setFormError(t("alerts.invalidUrl"))
      return
    }
    if (competitorUrls.includes(url)) return
    setCompetitorUrls(prev => [...prev, url])
    setNewCompetitor("")
    setFormError(null)
  }

  const removeCompetitor = (index: number) => {
    setCompetitorUrls(prev => prev.filter((_, i) => i !== index))
  }

  // ─── Actions ──────────────────────────────────────────────────

  const createAlert = async () => {
    setFormError(null)

    if (!referenceUrl.trim() || !isValidUrl(referenceUrl.trim())) {
      setFormError(t("alerts.invalidUrl"))
      return
    }

    setActionLoading('create')
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference_url: referenceUrl.trim(),
          competitor_urls: competitorUrls,
          schedule_type: 'interval',
          schedule_hour: 8,
          schedule_interval_hours: 1,
          email_notification: emailNotif,
          watch_price_increase: watchPriceUp,
          watch_price_decrease: watchPriceDown,
          watch_new_products: watchNewProducts,
          watch_removed_products: watchRemovedProducts,
          watch_stock_changes: watchStock,
          min_price_change_pct: minPricePct,
          min_price_change_abs: minPriceAbs,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (res.status === 409) {
          setFormError(t("alerts.duplicateUrl"))
        } else {
          setFormError(data.error || t('alerts.createError'))
        }
        return
      }

      const data = await res.json()
      if (data.initial_scraping_triggered && data.alert?.id) {
        setScrapingInProgress(prev => new Set(prev).add(data.alert.id))
      }

      setShowForm(false)
      resetForm()
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
    setScrapingInProgress(prev => new Set(prev).add(alertId))
    try {
      await fetch('/api/alerts/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId, trigger_scraping: true }),
      })
      await loadData()
    } finally {
      setActionLoading(null)
      setScrapingInProgress(prev => {
        const next = new Set(prev)
        next.delete(alertId)
        return next
      })
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

  // ─── Derived data ──────────────────────────────────────────────

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

  const isUnlimited = !apiError && alertLimit === -1
  const atLimit = !isUnlimited && alertCount >= alertLimit
  const canCreate = !apiError && !atLimit

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
          <div className="col-span-2 md:col-span-1 relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br from-emerald-600 to-teal-600 dark:from-emerald-600 dark:to-teal-700 shadow-lg shadow-emerald-600/10 dark:shadow-emerald-900/20">
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10" />
            <div className="relative flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200/70 mb-1.5">{t("alerts.activeAlerts")}</p>
                <p className="text-4xl font-black text-white tabular-nums leading-none tracking-tight">{activeAlerts}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-white/15">
                <Radar className="h-5 w-5 text-white/80" />
              </div>
            </div>
          </div>

          {[
            { label: t("alerts.unread"), value: unreadCount, icon: Activity, accent: "text-amber-500 dark:text-amber-400", dot: "bg-amber-400" },
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

        {apiError && (
          <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/80 dark:bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">{t("alerts.configError")}</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{apiError}</p>
          </div>
        )}


        {/* ── Active alerts list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="rounded-2xl border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.025] p-10 text-center">
            <div className="max-w-sm mx-auto">
              <div className="mx-auto w-12 h-12 rounded-xl bg-gray-100 dark:bg-white/[0.04] flex items-center justify-center mb-4">
                <Radar className="h-5 w-5 text-gray-400 dark:text-gray-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1.5">{t("alerts.noAlerts")}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {t("alerts.noAlertsDesc")}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.025] overflow-hidden shadow-lg shadow-gray-900/[0.05] dark:shadow-black/20">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.04]">
              <h2 className="text-base font-extrabold text-gray-900 dark:text-white tracking-tight">
                {t("alerts.monitoredSites")}
                <span className="ml-2 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400 text-[11px] font-semibold tabular-nums">{alerts.length}</span>
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {alerts.map((alert) => {
                const isLoading = actionLoading === alert.id || actionLoading === `check-${alert.id}`
                const isScraping = scrapingInProgress.has(alert.id)
                const displayUrl = alert.reference_url || alert.scraper_cache?.site_url
                const hostname = displayUrl ? getHostname(displayUrl) : t("alerts.unknownSite")
                const competitors: string[] = alert.competitor_urls || []
                const hasCache = !!alert.scraper_cache

                return (
                  <div
                    key={alert.id}
                    className={`px-5 py-3.5 hover:bg-gray-50/50 dark:hover:bg-white/[0.015] transition ${
                      !alert.is_active ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Reference site */}
                        <div className="flex items-center gap-2">
                          <Star className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{hostname}</span>
                          {hasCache && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium">{t("alerts.cached")}</span>
                          )}
                          {!alert.is_active && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 font-medium">{t("alerts.paused")}</span>
                          )}
                          {isScraping && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              {t("alerts.scrapingInProgress")}
                            </span>
                          )}
                        </div>

                        {/* Meta line: auto-monitoring, email, competitors count */}
                        <div className="flex flex-wrap items-center gap-2.5 mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                          <span className="flex items-center gap-1 text-emerald-500 dark:text-emerald-400">
                            <Radar className="h-3 w-3" />
                            {locale === 'fr' ? 'Auto' : 'Auto'}
                          </span>
                          {alert.email_notification ? (
                            <span className="flex items-center gap-1 text-blue-500"><Mail className="h-3 w-3" /> Email</span>
                          ) : (
                            <span className="flex items-center gap-1"><MailX className="h-3 w-3" /> {t("alerts.noEmail")}</span>
                          )}
                          {competitors.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              {t("alerts.competitorCount").replace("{0}", String(competitors.length))}
                            </span>
                          )}
                          {alert.scraper_cache?.last_product_count ? (
                            <span className="flex items-center gap-1">
                              <Package className="h-3 w-3" />
                              {alert.scraper_cache.last_product_count} {t("alerts.productAbbr")}
                            </span>
                          ) : null}
                          {alert.last_run_at && <span>{formatDate(alert.last_run_at, t, locale)}</span>}
                          {!alert.last_run_at && !isScraping && (
                            <span className="text-amber-500 dark:text-amber-400 italic">{t("alerts.firstScraping")}</span>
                          )}
                        </div>

                        {/* Competitor hostnames */}
                        {competitors.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {competitors.map((url, i) => (
                              <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                                <Globe className="h-2.5 w-2.5" />
                                {getHostname(url)}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Threshold badge (only if non-default) */}
                        {(alert.min_price_change_pct !== 1 || alert.min_price_change_abs !== 2) && (
                          <div className="mt-1.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-100/80 dark:bg-white/[0.04] text-[10px] font-medium text-gray-500">
                              <Settings2 className="h-2.5 w-2.5" />
                              {alert.min_price_change_pct}% / {alert.min_price_change_abs}$
                            </span>
                          </div>
                        )}
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

        {/* ── Activity feed ── */}
        <div className="rounded-2xl border border-gray-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.025] overflow-hidden shadow-lg shadow-gray-900/[0.05] dark:shadow-black/20">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.04] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Activity className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
              <h2 className="text-base font-extrabold text-gray-900 dark:text-white tracking-tight">
                {t("alerts.detectedChanges")}
                {unreadCount > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[11px] font-semibold tabular-nums">{unreadCount}</span>
                )}
              </h2>
            </div>
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
                                <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
                                <span className={`font-semibold ${isIncrease ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                  {change.new_value}
                                </span>
                              </span>
                            ) : (
                              <>
                                {change.old_value && <span>{t("alerts.before")} {change.old_value}</span>}
                                {change.new_value && <span className="font-medium">{change.old_value ? t("alerts.after") : t("alerts.priceLabel")} {change.new_value}</span>}
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
