"use client"

/**
 * Page Rapports.
 *
 * Différence avec /dashboard/analytics :
 *  - Le rapport documente **les faits** (présent + historique chiffré).
 *  - L'analyse interprète ces faits (causes, recommandations).
 *
 * Source de données : `/api/reports` qui charge tout l'historique
 * de scrapings de l'utilisateur. Le rapport gagne en richesse à mesure
 * que les données s'accumulent.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  FileText,
  Lock,
  Printer,
  RefreshCw,
  RotateCcw,
} from "lucide-react"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import { canAccessAnalytics } from "@/lib/plan-restrictions"
import { printCurrentPage } from "@/lib/export-utils"
import { AnalyticsSkeleton } from "@/components/skeleton-loader"
import PresentSnapshot from "@/components/reports/present-snapshot"
import DataAccumulation from "@/components/reports/data-accumulation"
import PeriodComparisonSection from "@/components/reports/period-comparison"
import PriceChangesTables from "@/components/reports/price-changes-tables"
import {
  emptyReport,
  type ReportData,
} from "@/lib/reports-calculations"

export default function ReportsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { t, locale } = useLanguage()
  const router = useRouter()

  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const effectiveSource =
    user?.subscription_source ||
    (user?.promo_code_id ? "promo" : null)
  const hasAccess = canAccessAnalytics(
    user?.subscription_plan ?? "standard",
    effectiveSource,
  )

  const loadReport = useCallback(
    async (isRefresh = false) => {
      try {
        setError(null)
        if (isRefresh) setRefreshing(true)
        else setLoading(true)

        const response = await fetch("/api/reports")
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(t("reports.errorAuth"))
          }
          if (response.status === 403) {
            throw new Error(t("reports.accessDenied"))
          }
          throw new Error(t("reports.loadError"))
        }

        if (data.report) {
          setReport(data.report)
        } else {
          setReport(emptyReport())
        }
        setLastUpdated(new Date())
      } catch (err: unknown) {
        console.error("Error loading report:", err)
        const message =
          err instanceof Error ? err.message : t("reports.loadError")
        setError(message)
        setReport(emptyReport())
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [t],
  )

  useEffect(() => {
    if (!authLoading && user && !hasAccess) {
      router.replace("/dashboard?restricted=reports")
    }
  }, [authLoading, user, hasAccess, router])

  useEffect(() => {
    if (hasAccess) loadReport(false)
  }, [hasAccess, loadReport])

  const handleReset = useCallback(async () => {
    const confirmation = window.prompt(t("reports.reset.confirmPrompt"))
    if (confirmation === null) return
    if (confirmation.trim().toUpperCase() !== "RESET") {
      alert(t("reports.reset.confirmInvalid"))
      return
    }

    try {
      setRefreshing(true)
      const response = await fetch("/api/reports/reset", { method: "POST" })
      const data: {
        error?: string
        details?: string
        hint?: string
        deleted?: number
        partial?: number
      } = await response.json().catch(() => ({}))

      if (!response.ok) {
        console.error("Error resetting report:", {
          status: response.status,
          statusText: response.statusText,
          ...data,
        })
        const isTimeout =
          response.status === 504 ||
          response.status === 408 ||
          response.status === 524
        const message = isTimeout
          ? t("reports.reset.timeout")
          : data.error || t("reports.reset.error")
        const detail = data.details || data.hint || ""
        alert(detail ? `${message}\n\n${detail}` : message)
        return
      }

      setReport(emptyReport())
      setLastUpdated(new Date())
    } catch (err) {
      console.error("Error resetting report:", err)
      alert(t("reports.reset.error"))
    } finally {
      setRefreshing(false)
    }
  }, [t])

  const updatedAgoLabel = useMemo(() => {
    if (!lastUpdated) return null
    const diffMs = Date.now() - lastUpdated.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return t("reports.updatedJustNow")
    if (diffMin < 60)
      return t("reports.updatedMinAgo").replace("{n}", String(diffMin))
    const diffH = Math.floor(diffMin / 60)
    return t("reports.updatedHAgo").replace("{n}", String(diffH))
  }, [lastUpdated, t])

  if (authLoading || loading) {
    return (
      <Layout>
        <AnalyticsSkeleton />
      </Layout>
    )
  }

  if (user && !hasAccess) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Lock className="h-12 w-12 text-amber-500" />
          <p className="text-lg font-medium text-[var(--color-text-primary)]">
            {t("reports.accessDenied")}
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t("reports.redirecting")}
          </p>
        </div>
      </Layout>
    )
  }

  const data = report ?? emptyReport()
  const isEmpty = data.meta.totalScrapings === 0

  return (
    <Layout>
      <div id="analytics-print-area" className="space-y-6">
        {/* ── En-tête : le titre + la couverture réelle, rien d'autre ── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)] leading-tight">
              {t("reports.title")}
            </h1>
            {!isEmpty && (
              <p id="report-coverage" className="mt-1 text-[13px] text-[var(--color-text-secondary)] tabular-nums">
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {data.meta.totalScrapings}
                </span>{" "}
                scrapings ·{" "}
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {data.meta.daysCovered}
                </span>{" "}
                jours d&apos;historique ·{" "}
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {data.past.totalDataPoints.toLocaleString(
                    locale === "en" ? "en-CA" : "fr-CA",
                  )}
                </span>{" "}
                prix collectés
              </p>
            )}
          </div>

          <div id="report-actions" className="flex items-center gap-2">
            {updatedAgoLabel && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/25">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
                </span>
                <span className="text-xs font-medium text-orange-700 dark:text-orange-400">
                  {updatedAgoLabel}
                </span>
              </div>
            )}
            <button
              onClick={() => printCurrentPage(t("reports.title"))}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {t("reports.printAction")}
              </span>
            </button>
            <button
              onClick={() => loadReport(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">
                {t("reports.refreshAction")}
              </span>
            </button>
            <button
              onClick={handleReset}
              disabled={refreshing || loading}
              title={t("reports.reset.tooltip")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-600/80 hover:text-red-600 hover:bg-red-500/10 transition disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {t("reports.reset.action")}
              </span>
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-4 py-3">
            <p className="text-red-700 dark:text-red-400 text-sm font-medium">
              {error}
            </p>
          </div>
        )}

        {isEmpty ? (
          <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-10 text-center">
            <div className="max-w-md mx-auto">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center mb-5">
                <FileText className="h-7 w-7 text-orange-600 dark:text-orange-400" />
              </div>
              <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
                {t("reports.empty.title")}
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t("reports.empty.short")}
              </p>
              <button
                id="report-empty-cta"
                onClick={() => router.push("/dashboard")}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
              >
                {t("reports.empty.cta")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div id="report-present">
              <PresentSnapshot
                present={data.present}
                asOf={data.meta.lastScrapingDate}
              />
            </div>

            <div id="report-accumulation">
              <DataAccumulation past={data.past} meta={data.meta} />
            </div>

            {data.meta.hasEnoughHistory ? (
              <div id="report-trends" className="space-y-6">
                <PeriodComparisonSection trends={data.trends} />
                <PriceChangesTables trends={data.trends} />
              </div>
            ) : (
              /* Pourquoi les tendances sont vides : il faut ≥ 2 analyses
                 pour comparer. On montre où en est l'utilisateur. */
              <div
                id="report-locked"
                className="rounded-2xl border border-dashed border-orange-500/40 bg-orange-50/50 dark:bg-orange-500/[0.06] p-6"
              >
                <div className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-600 text-white dark:bg-orange-500 dark:text-black">
                      <Lock className="h-3.5 w-3.5" />
                    </span>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      Tendances disponibles à la 2<sup>e</sup> analyse
                    </p>
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Les tendances comparent vos analyses entre elles.
                    Vous en avez{" "}
                    <span className="font-bold tabular-nums text-[var(--color-text-primary)]">
                      {data.meta.totalScrapings}
                    </span>{" "}
                    — il en faut{" "}
                    <span className="font-bold tabular-nums text-[var(--color-text-primary)]">2</span>.
                  </p>
                  <div className="flex w-full max-w-[200px] items-center gap-1.5">
                    <span className="h-1.5 flex-1 rounded-full bg-orange-500" />
                    <span className="h-1.5 flex-1 rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)]" />
                  </div>
                  <button
                    onClick={() => router.push("/dashboard")}
                    className="mt-1 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
                  >
                    Lancer une nouvelle analyse
                  </button>
                </div>
              </div>
            )}

            <footer className="px-1 text-right text-[11px] text-[var(--color-text-secondary)] tabular-nums">
              {t("reports.footer.generated")}{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                {lastUpdated
                  ? lastUpdated.toLocaleString(
                      locale === "en" ? "en-CA" : "fr-CA",
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )
                  : "—"}
              </span>
            </footer>
          </>
        )}
      </div>
    </Layout>
  )
}
