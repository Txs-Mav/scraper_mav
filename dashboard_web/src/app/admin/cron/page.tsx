"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Loader2, RefreshCw, PlayCircle, CheckCircle2, XCircle, EyeOff,
  ExternalLink, Github, AlertTriangle,
} from "lucide-react"
import { EXTERNAL_LINKS } from "@/lib/external-links"

interface SiteRow {
  site_domain: string
  site_url: string
  status: string
  scraped_at: string | null
  updated_at: string
  product_count: number | null
  scrape_duration_seconds: number | null
  error_message: string | null
  temporarily_hidden: boolean
}

interface CronData {
  lock: { status: string; updated_at: string | null }
  sites: SiteRow[]
  count: number
}


function formatDate(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("fr-CA", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} h`
  return `${Math.round(ms / 86400_000)} j`
}

export default function AdminCronPage() {
  const [data, setData] = useState<CronData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [filter, setFilter] = useState<"all" | "success" | "error" | "hidden">("all")
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/cron", { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload?.error || "Erreur de chargement")
        return
      }
      setData(payload)
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const trigger = async () => {
    if (!confirm("Lancer un cycle de scraping maintenant ? Cela mobilise le backend pendant ~15 minutes.")) return
    setTriggering(true)
    setTriggerMsg(null)
    try {
      const res = await fetch("/api/admin/cron/trigger", { method: "POST" })
      const payload = await res.json()
      if (!res.ok) {
        setTriggerMsg(`Échec : ${payload?.error || payload?.message || "erreur"}`)
        return
      }
      setTriggerMsg(payload?.alreadyRunning ? "Un cron est déjà en cours d'exécution." : `Cron lancé. Job ${payload?.jobId || "?"}.`)
      setTimeout(load, 3000)
    } catch (e: any) {
      setTriggerMsg(`Erreur : ${e?.message || "réseau"}`)
    } finally {
      setTriggering(false)
    }
  }

  const sites = data?.sites || []
  const filtered = sites.filter(s => {
    if (filter === "all") return true
    if (filter === "hidden") return s.temporarily_hidden
    return s.status === filter
  })

  const stats = {
    success: sites.filter(s => s.status === "success" && !s.temporarily_hidden).length,
    error: sites.filter(s => s.status === "error").length,
    hidden: sites.filter(s => s.temporarily_hidden).length,
  }

  return (
    <div>
      <header className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">Cron horaire</h1>
          <p className="text-sm text-gray-500 mt-1">
            État du cycle de scraping (Vercel → Railway) qui tourne toutes les heures.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={EXTERNAL_LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub Actions
            <ExternalLink className="h-3 w-3" />
          </a>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </button>
          <button
            type="button"
            onClick={trigger}
            disabled={triggering || data?.lock.status === "running"}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 disabled:opacity-40 transition"
          >
            {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Lancer maintenant
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {triggerMsg && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800">
          {triggerMsg}
        </div>
      )}

      {loading && !data ? (
        <div className="py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : data ? (
        <div className="space-y-5">
          {/* Verrou */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-5 py-3.5 flex items-center gap-3">
            <span className={`h-2 w-2 rounded-full ${data.lock.status === "running" ? "bg-emerald-500 animate-pulse" : "bg-gray-300"}`} />
            <div className="flex-1">
              <p className="text-sm text-gray-900">
                Verrou cron · <span className="font-mono text-gray-700">{data.lock.status}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatDate(data.lock.updated_at)}{data.lock.updated_at && ` (il y a ${timeAgo(data.lock.updated_at)})`}
              </p>
            </div>
          </div>

          {/* Stats */}
          <section className="grid grid-cols-3 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200">
            <StatTile icon={CheckCircle2} label="Succès" value={stats.success} tone="emerald" />
            <StatTile icon={XCircle} label="Erreurs" value={stats.error} tone="red" />
            <StatTile icon={EyeOff} label="Cachés" value={stats.hidden} tone="amber" />
          </section>

          {/* Filtres + table */}
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center bg-white border border-gray-200 rounded-md p-0.5">
              {(["all", "success", "error", "hidden"] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                    filter === f ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {f === "all" ? "Tous" : f === "success" ? "Succès" : f === "error" ? "Erreurs" : "Cachés"}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">{filtered.length} site(s)</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="text-left px-5 py-2.5 font-medium">Site</th>
                  <th className="text-left px-5 py-2.5 font-medium">Statut</th>
                  <th className="text-right px-5 py-2.5 font-medium">Produits</th>
                  <th className="text-right px-5 py-2.5 font-medium">Durée</th>
                  <th className="text-right px-5 py-2.5 font-medium">Maj</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-gray-500">Aucun site dans ce filtre.</td></tr>
                ) : filtered.map(s => (
                  <tr key={s.site_domain} className="hover:bg-gray-50/50 transition">
                    <td className="px-5 py-3">
                      <a
                        href={s.site_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-900 hover:underline inline-flex items-center gap-1 font-mono text-xs"
                      >
                        {s.site_domain}
                        <ExternalLink className="h-3 w-3 text-gray-400" />
                      </a>
                    </td>
                    <td className="px-5 py-3">
                      <SiteStatusBadge status={s.status} hidden={s.temporarily_hidden} error={s.error_message} />
                    </td>
                    <td className="px-5 py-3 text-right text-gray-900 font-mono text-xs tabular-nums">
                      {s.product_count ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700 font-mono text-xs tabular-nums">
                      {s.scrape_duration_seconds ? `${Math.round(s.scrape_duration_seconds)}s` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-500 text-xs">
                      <span title={formatDate(s.updated_at)}>il y a {timeAgo(s.updated_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StatTile({
  icon: Icon, label, value, tone,
}: {
  icon: any
  label: string
  value: number
  tone: "emerald" | "red" | "amber"
}) {
  const toneText: Record<string, string> = {
    emerald: "text-emerald-600",
    red: "text-red-600",
    amber: "text-amber-600",
  }
  return (
    <div className="bg-white px-5 py-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`h-3.5 w-3.5 ${toneText[tone]}`} />
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      </div>
      <p className="text-[22px] font-semibold text-gray-900 tabular-nums">{value}</p>
    </div>
  )
}

function SiteStatusBadge({ status, hidden, error }: { status: string; hidden: boolean; error: string | null }) {
  if (hidden) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200" title={error || ""}>
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Caché
      </span>
    )
  }
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Succès
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 ring-1 ring-inset ring-red-200" title={error || ""}>
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Erreur
      </span>
    )
  }
  return <span className="text-xs text-gray-500">{status}</span>
}
