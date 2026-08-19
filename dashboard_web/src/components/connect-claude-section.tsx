"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Check, Copy, Loader2, Lock, RefreshCw, Sparkles, Trash2 } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface McpTokenStatus {
  token_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export default function ConnectClaudeSection() {
  const { t, locale } = useLanguage()
  const [status, setStatus] = useState<McpTokenStatus | null>(null)
  const [freshUrl, setFreshUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [schemaMissing, setSchemaMissing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/mcp/tokens")
      const data = await res.json()
      if (!res.ok) {
        if (data?.code === "MCP_SCHEMA_MISSING") setSchemaMissing(true)
        return
      }
      setStatus(data.token)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleGenerate = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await fetch("/api/mcp/tokens", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        if (data?.code === "MCP_SCHEMA_MISSING") setSchemaMissing(true)
        setError(data?.error || "Erreur")
        return
      }
      setFreshUrl(data.url)
      setCopied(false)
      await load()
    } catch (err: any) {
      setError(err?.message || "Erreur")
    } finally {
      setWorking(false)
    }
  }

  const handleRevoke = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await fetch("/api/mcp/tokens", { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur")
        return
      }
      setFreshUrl(null)
      await load()
    } catch (err: any) {
      setError(err?.message || "Erreur")
    } finally {
      setWorking(false)
    }
  }

  const handleCopy = async () => {
    if (!freshUrl) return
    try {
      await navigator.clipboard.writeText(freshUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      // silent
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "fr" ? "fr-CA" : "en-CA", {
      year: "numeric", month: "long", day: "numeric",
    })

  if (schemaMissing) {
    return (
      <section className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-6 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Configuration requise</h3>
            <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
              La table <code>mcp_tokens</code> est introuvable. Exécutez{" "}
              <code>supabase/migration_mcp_tokens.sql</code> dans l&apos;éditeur SQL Supabase.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const hasActiveToken = !!status && !status.revoked_at

  return (
    <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6 sm:p-8 mb-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-50 to-orange-50 dark:from-orange-950/40 dark:to-orange-950/30">
          <Sparkles className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t("settings.mcpTitle")}</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t("settings.mcpSubtitle")}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">{t("settings.mcpIntro")}</p>
          <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] mb-5">
            <Lock className="h-3.5 w-3.5" />
            {t("settings.mcpReadOnly")}
          </p>

          {freshUrl && (
            <div className="rounded-xl border border-orange-200 dark:border-orange-900/40 bg-orange-50 dark:bg-orange-950/20 p-4 mb-5">
              <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                {t("settings.mcpFreshTitle")}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-xs px-3 py-2.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)]">
                  {freshUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 transition shrink-0"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t("settings.mcpCopied") : t("settings.mcpCopy")}
                </button>
              </div>
              <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 mt-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {t("settings.mcpFreshWarning")}
              </p>
            </div>
          )}

          {hasActiveToken && status ? (
            <div className="flex flex-wrap items-center justify-between gap-3 py-4 border-t border-b border-[var(--color-border-tertiary)] mb-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{t("settings.mcpActiveLink")}</p>
                  <code className="text-xs text-[var(--color-text-tertiary)]">{status.token_prefix}</code>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  {t("settings.mcpCreated")} {formatDate(status.created_at)} · {t("settings.mcpLastUsed")}{" "}
                  {status.last_used_at ? formatDate(status.last_used_at) : t("settings.mcpNeverUsed")}
                </p>
                <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t("settings.mcpRegenerateWarning")}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={working}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border-secondary)] text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {t("settings.mcpRegenerate")}
                </button>
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={working}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("settings.mcpRevoke")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-5">
              {status?.revoked_at && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">{t("settings.mcpRevokedNote")}</p>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={working}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-semibold shadow-lg shadow-orange-600/25 hover:bg-orange-700 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-30 disabled:shadow-none disabled:translate-y-0 disabled:cursor-not-allowed transition-all"
              >
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t("settings.mcpGenerate")}
              </button>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-4">{error}</p>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">
              {t("settings.mcpHowTo")}
            </p>
            <ol className="space-y-1.5 text-sm text-[var(--color-text-secondary)] list-decimal list-inside">
              <li>{t("settings.mcpStep1")}</li>
              <li>{t("settings.mcpStep2")}</li>
              <li>{t("settings.mcpStep3")}</li>
            </ol>
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-2">{t("settings.mcpPlanNote")}</p>
          </div>
        </>
      )}
    </section>
  )
}
