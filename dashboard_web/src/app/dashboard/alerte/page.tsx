"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  Bell, Loader2, Lock, Plus, Trash2, Clock, Mail, MailX,
  TrendingUp, TrendingDown, Package, PackageMinus, RefreshCw,
  CheckCheck, ChevronDown, ChevronUp, Eye, Globe, AlertTriangle,
  Pause, Play, ShieldCheck, Link, Settings2, Timer, Star, X,
  Radar, Activity, MessageSquare, Slack, CheckCircle2, Database,
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
  schedule_interval_minutes: number | null
  is_active: boolean
  email_notification: boolean
  sms_notification?: boolean
  slack_notification?: boolean
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
  source_site: string | null
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
  if (alert.schedule_type === 'interval') {
    const minutes = alert.schedule_interval_minutes || (alert.schedule_interval_hours ? alert.schedule_interval_hours * 60 : 40)
    if (minutes < 60) {
      return t("alerts.everyXMinutes").replace("{0}", String(minutes))
    }
    const hours = Math.round(minutes / 60)
    return t("alerts.everyXHours").replace("{0}", String(hours))
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
    case 'price_increase': return (
      <div className="p-1.5 rounded-lg bg-[#EAF3DE] dark:bg-[#3B6D11]/20">
        <TrendingUp className="h-4 w-4 text-[#3B6D11]" />
      </div>
    )
    case 'price_decrease': return (
      <div className="p-1.5 rounded-lg bg-[#FCEBEB] dark:bg-[#A32D2D]/20">
        <TrendingDown className="h-4 w-4 text-[#A32D2D]" />
      </div>
    )
    case 'new_product': return (
      <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
        <Package className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
      </div>
    )
    case 'removed_product': return (
      <div className="p-1.5 rounded-lg bg-[var(--color-background-secondary)]">
        <PackageMinus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
      </div>
    )
    case 'stock_change': return (
      <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20">
        <RefreshCw className="h-4 w-4 text-[#BA7517]" />
      </div>
    )
    default: return (
      <div className="p-1.5 rounded-lg bg-[var(--color-background-secondary)]">
        <Bell className="h-4 w-4 text-gray-500 dark:text-gray-400" />
      </div>
    )
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

// ─── SourceRow: one configured site row in the data-refresh block ──

function SourceRow({
  url,
  isReference,
  cachedScrapers,
  t,
  locale,
}: {
  url: string
  isReference: boolean
  cachedScrapers: CachedScraper[]
  t: (key: TranslationKey) => string
  locale: string
}) {
  const hostname = getHostname(url)
  const match = cachedScrapers.find((c) => {
    try {
      return new URL(c.url).hostname.replace(/^www\./, '').toLowerCase() === hostname.toLowerCase()
    } catch {
      return false
    }
  })
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  const [imgError, setImgError] = useState(false)

  return (
    <div className="px-5 py-3.5 flex items-center gap-3 hover:bg-[var(--color-background-hover)]/40 transition">
      <div className="w-7 h-7 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)] overflow-hidden flex items-center justify-center shrink-0">
        {!imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={faviconUrl}
            alt={hostname}
            width={20}
            height={20}
            className="w-5 h-5 object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <Globe className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {isReference && <Star className="h-3.5 w-3.5 text-amber-500 shrink-0" fill="currentColor" />}
          <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{hostname}</span>
          {isReference && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-medium uppercase tracking-wide">
              {t("alerts.referenceBadge")}
            </span>
          )}
          {match ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 font-medium">
              <CheckCircle2 className="h-2.5 w-2.5" />
              {t("alerts.cached")}
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] font-medium">
              {t("alerts.noCache")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-[var(--color-text-secondary)]">
          {match?.lastProductCount ? (
            <span className="inline-flex items-center gap-1">
              <Package className="h-3 w-3" />
              {match.lastProductCount} {t("alerts.productAbbr")}
            </span>
          ) : null}
          {match?.lastRunAt && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDate(match.lastRunAt, t, locale)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
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
  const [smsNotif, setSmsNotif] = useState(true)
  const [slackNotif, setSlackNotif] = useState(true)
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

  // Configuration actualisation
  const [configReferenceUrl, setConfigReferenceUrl] = useState<string>("")
  const [configCompetitorUrls, setConfigCompetitorUrls] = useState<string[]>([])
  const [alertLastRunAt, setAlertLastRunAt] = useState<string | null>(null)
  const [alertIntervalMinutes, setAlertIntervalMinutes] = useState<number>(60)
  const [refreshingProducts, setRefreshingProducts] = useState(false)
  const [refreshResult, setRefreshResult] = useState<{
    ok: boolean
    message: string
    stats?: { referenceProducts: number; matchedProducts: number; totalProducts: number; cacheHits: number; elapsed: number }
  } | null>(null)
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null)

  // Planification de l'actualisation
  const [scheduleMode, setScheduleMode] = useState<'interval' | 'daily'>('interval')
  const [scheduleIntervalMin, setScheduleIntervalMin] = useState<number>(60)
  const [scheduleDailyHour, setScheduleDailyHour] = useState<number>(8)
  const [scheduleDailyMinute, setScheduleDailyMinute] = useState<number>(0)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleDirty, setScheduleDirty] = useState(false)
  const [scheduleSavedAt, setScheduleSavedAt] = useState<Date | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

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
      const [alertsRes, changesRes, cacheRes, configRes] = await Promise.all([
        fetch('/api/alerts'),
        fetch('/api/alerts/changes?limit=100'),
        fetch('/api/scraper-ai/cache'),
        fetch('/api/scraper/config'),
      ])

      if (configRes.ok) {
        const configData = await configRes.json()
        setConfigReferenceUrl(configData.referenceUrl || "")
        setConfigCompetitorUrls(Array.isArray(configData.urls) ? configData.urls : [])
        setAlertLastRunAt(configData.alertLastRunAt || null)
        if (typeof configData.alertIntervalMinutes === 'number') {
          setAlertIntervalMinutes(configData.alertIntervalMinutes)
        }
      }

      if (alertsRes.ok) {
        const data = await alertsRes.json()
        const loadedAlerts: Alert[] = data.alerts || []
        setAlerts(loadedAlerts)
        setAlertCount(data.alert_count || 0)
        setAlertLimit(data.alert_limit ?? 0)

        // Hydrate schedule UI from the user's active alert
        const primary = loadedAlerts.find(a => a.is_active) || loadedAlerts[0]
        if (primary) {
          const mode = primary.schedule_type === 'daily' ? 'daily' : 'interval'
          setScheduleMode(mode)
          if (mode === 'interval') {
            const mins = primary.schedule_interval_minutes
              || (primary.schedule_interval_hours ? primary.schedule_interval_hours * 60 : 60)
            setScheduleIntervalMin(mins)
          } else {
            setScheduleDailyHour(primary.schedule_hour ?? 8)
            setScheduleDailyMinute(primary.schedule_minute ?? 0)
          }
          setScheduleDirty(false)
        }
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
    setSmsNotif(true)
    setSlackNotif(true)
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
          schedule_interval_minutes: 40,
          email_notification: emailNotif,
          sms_notification: smsNotif,
          slack_notification: slackNotif,
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

  const saveSchedule = async () => {
    if (savingSchedule) return
    const primary = alerts.find(a => a.is_active) || alerts[0]
    if (!primary) {
      setScheduleError(t("alerts.noActiveAlert"))
      return
    }
    setSavingSchedule(true)
    setScheduleError(null)
    try {
      const payload: Record<string, any> = {}
      if (scheduleMode === 'interval') {
        payload.schedule_type = 'interval'
        payload.schedule_interval_minutes = scheduleIntervalMin
      } else {
        payload.schedule_type = 'daily'
        payload.schedule_hour = scheduleDailyHour
        payload.schedule_minute = scheduleDailyMinute
      }
      const res = await fetch(`/api/alerts/${primary.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setScheduleError(data?.error || t("alerts.scheduleSaveError"))
        return
      }
      setScheduleDirty(false)
      setScheduleSavedAt(new Date())
      if (scheduleMode === 'interval') {
        setAlertIntervalMinutes(scheduleIntervalMin)
      }
      await loadData()
    } catch (err: any) {
      setScheduleError(err?.message || t("alerts.scheduleSaveError"))
    } finally {
      setSavingSchedule(false)
    }
  }

  const refreshProductsFromCache = async () => {
    if (refreshingProducts) return
    setRefreshingProducts(true)
    setRefreshResult(null)
    try {
      const res = await fetch('/api/products/analyze', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.success) {
        setRefreshResult({
          ok: true,
          message: data.message || t("alerts.refreshSuccess"),
          stats: data.stats,
        })
        setLastRefreshAt(new Date())
      } else {
        setRefreshResult({
          ok: false,
          message: data.message || data.error || t("alerts.refreshError"),
        })
      }
    } catch (err: any) {
      setRefreshResult({
        ok: false,
        message: err?.message || t("alerts.refreshError"),
      })
    } finally {
      setRefreshingProducts(false)
    }
  }

  const markAllRead = async () => {
    try {
      setChanges(prev => prev.map(c => ({ ...c, is_read: true })))
      setUnreadCount(0)
      await fetch('/api/alerts/changes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_all_read: true }),
      })
    } catch (err) {
      console.error('[Alerte] Error marking all read:', err)
      await loadData()
    }
  }

  const markOneRead = async (changeId: string) => {
    try {
      setChanges(prev => prev.map(c => c.id === changeId ? { ...c, is_read: true } : c))
      setUnreadCount(prev => Math.max(0, prev - 1))
      await fetch('/api/alerts/changes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [changeId] }),
      })
    } catch (err) {
      console.error('[Alerte] Error marking read:', err)
      await loadData()
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
          <p className="text-lg font-medium text-[var(--color-text-primary)]">{t("alerts.accessDenied")}</p>
          <p className="text-sm text-[var(--color-text-secondary)]">{t("alerts.redirecting")}</p>
        </div>
      </Layout>
    )
  }

  // ─── Render ──────────────────────────────────────────────────

  return (
    <Layout>
      <div className="space-y-4">
        {/* ── KPI ── */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: t("alerts.activeAlerts"), value: activeAlerts, icon: Radar },
            { label: t("alerts.unread"), value: unreadCount, icon: Activity },
            { label: t("alerts.upTrend"), value: priceIncreases, icon: TrendingUp },
            { label: t("alerts.downTrend"), value: priceDecreases, icon: TrendingDown },
          ].map((s, i) => {
            const Icon = s.icon
            return (
              <div key={i} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] backdrop-blur-sm p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)] tracking-wide">{s.label}</p>
                  <Icon className="h-3.5 w-3.5 text-[var(--color-text-secondary)] opacity-50" />
                </div>
                <p className="text-3xl font-extrabold leading-none tabular-nums tracking-tight text-[var(--color-text-primary)]">{s.value}</p>
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
        ) : !configReferenceUrl ? (
          <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-10 text-center">
            <div className="max-w-sm mx-auto">
              <div className="mx-auto w-12 h-12 rounded-xl bg-[var(--color-background-secondary)] flex items-center justify-center mb-4">
                <Radar className="h-5 w-5 text-[var(--color-text-secondary)]" />
              </div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)] mb-1.5">{t("alerts.noConfig")}</h3>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {t("alerts.noConfigDesc")}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden shadow-lg shadow-gray-900/[0.05] dark:shadow-black/20">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--color-border-tertiary)] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-extrabold text-[var(--color-text-primary)] tracking-tight flex items-center gap-2">
                  <Database className="h-4 w-4 text-emerald-500" />
                  {t("alerts.dataRefresh")}
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  {t("alerts.dataRefreshDesc")}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold shrink-0">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                {t("alerts.autoHourly")}
              </span>
            </div>

            {/* Primary action + status */}
            <div className="px-5 py-4 border-b border-[var(--color-border-tertiary)] flex flex-col md:flex-row md:items-center gap-3">
              <button
                type="button"
                onClick={refreshProductsFromCache}
                disabled={refreshingProducts}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:translate-y-0 shrink-0"
              >
                {refreshingProducts ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("alerts.refreshing")}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    {t("alerts.refreshProducts")}
                  </>
                )}
              </button>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-secondary)] flex-1 min-w-0">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  {t("alerts.lastCronRun")}{" "}
                  <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {alertLastRunAt ? formatDate(alertLastRunAt, t, locale) : t("alerts.never")}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Timer className="h-3 w-3" />
                  {scheduleMode === 'interval'
                    ? (scheduleIntervalMin < 60
                        ? t("alerts.everyXMinutes").replace("{0}", String(scheduleIntervalMin))
                        : t("alerts.everyXHours").replace("{0}", String(Math.round(scheduleIntervalMin / 60))))
                    : t("alerts.dailyAt").replace("{0}", `${String(scheduleDailyHour).padStart(2, '0')}:${String(scheduleDailyMinute).padStart(2, '0')}`)}
                </span>
                {lastRefreshAt && (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    {t("alerts.refreshedAt").replace("{0}", formatDate(lastRefreshAt.toISOString(), t, locale))}
                  </span>
                )}
              </div>
            </div>

            {/* Schedule configuration */}
            <div className="px-5 py-4 border-b border-[var(--color-border-tertiary)] space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                    {t("alerts.scheduleTitle")}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {t("alerts.scheduleDesc")}
                  </p>
                </div>
                {scheduleSavedAt && !scheduleDirty && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("alerts.scheduleSaved")}
                  </span>
                )}
              </div>

              {/* Mode switch */}
              <div className="inline-flex p-0.5 rounded-xl bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)]">
                <button
                  type="button"
                  onClick={() => { setScheduleMode('interval'); setScheduleDirty(true) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                    scheduleMode === 'interval'
                      ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <Timer className="inline h-3 w-3 mr-1" />
                  {t("alerts.scheduleInterval")}
                </button>
                <button
                  type="button"
                  onClick={() => { setScheduleMode('daily'); setScheduleDirty(true) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                    scheduleMode === 'daily'
                      ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <Clock className="inline h-3 w-3 mr-1" />
                  {t("alerts.scheduleDaily")}
                </button>
              </div>

              {/* Mode-specific controls */}
              <div className="flex items-center gap-3 flex-wrap">
                {scheduleMode === 'interval' ? (
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    <span>{t("alerts.everyLabel")}</span>
                    <select
                      value={scheduleIntervalMin}
                      onChange={(e) => { setScheduleIntervalMin(parseInt(e.target.value)); setScheduleDirty(true) }}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-sm font-semibold text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                      {[20, 30, 40, 60, 120, 240, 360, 720, 1440].map((min) => (
                        <option key={min} value={min}>
                          {min < 60
                            ? t("alerts.minutesShort").replace("{0}", String(min))
                            : t("alerts.hoursShort").replace("{0}", String(Math.round(min / 60)))}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-text-secondary)]">{t("alerts.dailyAtLabel")}</span>
                    <select
                      value={scheduleDailyHour}
                      onChange={(e) => { setScheduleDailyHour(parseInt(e.target.value)); setScheduleDirty(true) }}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-sm font-semibold text-[var(--color-text-primary)] tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                      {Array.from({ length: 24 }).map((_, h) => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <span className="text-sm font-semibold text-[var(--color-text-secondary)]">:</span>
                    <select
                      value={scheduleDailyMinute}
                      onChange={(e) => { setScheduleDailyMinute(parseInt(e.target.value)); setScheduleDirty(true) }}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-sm font-semibold text-[var(--color-text-primary)] tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                      {[0, 15, 30, 45].map((m) => (
                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <span className="text-[11px] text-[var(--color-text-secondary)] italic">{t("alerts.utcNote")}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={saveSchedule}
                  disabled={savingSchedule || !scheduleDirty}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-text-primary)] text-[var(--color-background-primary)] text-xs font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingSchedule ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("alerts.saving")}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3 w-3" />
                      {t("alerts.saveSchedule")}
                    </>
                  )}
                </button>
              </div>

              {scheduleError && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {scheduleError}
                </p>
              )}
            </div>

            {/* Refresh feedback */}
            {refreshResult && (
              <div
                className={`px-5 py-3 border-b border-[var(--color-border-tertiary)] text-xs font-medium flex items-start gap-2 ${
                  refreshResult.ok
                    ? 'bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200'
                    : 'bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200'
                }`}
              >
                {refreshResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <div className="flex-1 min-w-0">
                  <p>{refreshResult.message}</p>
                  {refreshResult.ok && refreshResult.stats && (
                    <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
                      {t("alerts.refreshStats")
                        .replace("{0}", String(refreshResult.stats.totalProducts))
                        .replace("{1}", String(refreshResult.stats.matchedProducts))
                        .replace("{2}", String(refreshResult.stats.cacheHits))
                        .replace("{3}", String(refreshResult.stats.elapsed))}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setRefreshResult(null)}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Sources list */}
            <div className="px-5 py-3 bg-[var(--color-background-secondary)]/40 border-b border-[var(--color-border-tertiary)] flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                {t("alerts.monitoredSources")}
              </p>
              <span className="px-1.5 py-0.5 rounded-md bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] text-[11px] font-semibold tabular-nums">
                {1 + configCompetitorUrls.length}
              </span>
            </div>
            <div className="divide-y divide-[var(--color-border-tertiary)]">
              <SourceRow
                url={configReferenceUrl}
                isReference
                cachedScrapers={cachedScrapers}
                t={t}
                locale={locale}
              />
              {configCompetitorUrls.map((url, i) => (
                <SourceRow
                  key={`${url}-${i}`}
                  url={url}
                  isReference={false}
                  cachedScrapers={cachedScrapers}
                  t={t}
                  locale={locale}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Activity feed ── */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden shadow-lg shadow-gray-900/[0.05] dark:shadow-black/20">
          <div className="px-5 py-4 border-b border-[var(--color-border-tertiary)] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-extrabold text-[var(--color-text-primary)] tracking-tight">
                {t("alerts.detectedChanges")}
                {unreadCount > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded-md bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] text-[11px] font-semibold tabular-nums">{unreadCount}</span>
                )}
              </h2>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-700 font-semibold"
              >
                <CheckCheck className="h-3 w-3" />
                {t("alerts.markAllRead")}
              </button>
            )}
          </div>

          {changes.length === 0 ? (
            <div className="p-8 text-center">
              <AlertTriangle className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t("alerts.noChanges")}
              </p>
            </div>
          ) : (
            <div>
              <div className="p-3 space-y-2.5">
                {visibleChanges.map((change) => {
                  const sourceSite = change.source_site
                  const fallbackSiteUrl = change.scraper_alerts?.scraper_cache?.site_url
                  const displaySite = sourceSite || (fallbackSiteUrl ? getHostname(fallbackSiteUrl) : '')
                  const isPriceChange = change.change_type === 'price_increase' || change.change_type === 'price_decrease'
                  const isIncrease = change.change_type === 'price_increase'
                  const diff = change.details?.diff as number | undefined
                  const productImage = change.details?.image as string | undefined

                  const deltaColor = isIncrease
                    ? 'text-[#3B6D11] bg-[#EAF3DE] dark:bg-[#3B6D11]/15'
                    : 'text-[#A32D2D] bg-[#FCEBEB] dark:bg-[#A32D2D]/15'

                  return (
                    <div
                      key={change.id}
                      className={`group rounded-xl border transition-all ${
                        !change.is_read
                          ? 'border-emerald-200/40 dark:border-emerald-800/30 bg-emerald-50/20 dark:bg-emerald-950/5'
                          : 'border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)]'
                      } hover:shadow-sm`}
                    >
                      <div className="p-5">
                        {/* Rangée du haut : image + nom + timestamp */}
                        <div className="flex items-start gap-4">
                          {/* Image produit ou icône */}
                          <div className="shrink-0">
                            {productImage ? (
                              <div className="w-14 h-14 rounded-xl overflow-hidden bg-[var(--color-background-secondary)] ring-1 ring-gray-200/50 dark:ring-white/[0.06]">
                                <img
                                  src={productImage}
                                  alt={change.product_name || ''}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    const el = e.target as HTMLImageElement
                                    el.parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-400 text-xs">Img</div>'
                                  }}
                                />
                              </div>
                            ) : (
                              changeTypeIcon(change.change_type)
                            )}
                          </div>

                          {/* Nom + meta */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <h4 className="text-base font-bold text-gray-900 dark:text-white leading-snug">
                                {change.product_name || t('alerts.unknownProduct')}
                              </h4>
                              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                                {!change.is_read && (
                                  <button
                                    onClick={() => markOneRead(change.id)}
                                    className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 hover:bg-emerald-700 transition-colors cursor-pointer"
                                    title={t("alerts.markRead")}
                                  />
                                )}
                                <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
                                  {formatDate(change.detected_at, t, locale)}
                                </span>
                              </div>
                            </div>

                            {/* Type + delta + site — sur une ligne */}
                            <div className="flex items-center gap-2.5 mt-2 flex-wrap">
                              {productImage && <span className="shrink-0">{changeTypeIcon(change.change_type)}</span>}
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                {changeTypeLabel(change.change_type, t)}
                              </span>
                              {isPriceChange && change.percentage_change !== null && (
                                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums ${deltaColor}`}>
                                  {isIncrease ? '+' : ''}{change.percentage_change}%
                                  {diff !== undefined && (
                                    <span className="font-semibold">({diff > 0 ? '+' : ''}{diff.toFixed(0)} $)</span>
                                  )}
                                </span>
                              )}
                              {!isPriceChange && change.new_value && (
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
                                  {change.new_value}
                                </span>
                              )}
                              {displaySite && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-[#242628] text-sm font-semibold text-gray-700 dark:text-gray-300 ml-auto shrink-0">
                                  <Globe className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                                  {displaySite}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Bloc prix — centré, plus gros */}
                        {isPriceChange && change.old_value && change.new_value && (
                          <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-[var(--color-border-tertiary)]">
                            <span className="text-lg text-gray-400 dark:text-gray-500 line-through tabular-nums">
                              {change.old_value}
                            </span>
                            <span className="text-gray-300 dark:text-gray-600 text-lg">&rarr;</span>
                            <span className={`text-xl font-extrabold tabular-nums ${isIncrease ? 'text-[#3B6D11]' : 'text-[#A32D2D]'}`}>
                              {change.new_value}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {changes.length > 10 && (
                <button
                  onClick={() => setShowAllChanges(!showAllChanges)}
                  className="w-full py-3 text-xs font-medium text-[var(--color-text-secondary)] hover:text-gray-700 dark:hover:text-gray-200 flex items-center justify-center gap-1 border-t border-[var(--color-border-tertiary)] transition"
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
