"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import {
  Loader2, RefreshCw, Activity, ListChecks, Users, Bell,
  CheckCircle2, AlertTriangle, XCircle, EyeOff, ArrowUpRight,
  Hammer,
} from "lucide-react"

interface Stats {
  scrapers: { total: number; pending: number; approved: number; rejected: number; active: number }
  cron: {
    status: string
    last_lock_update: string | null
    last_success_run: string | null
    sites_total: number
    sites_success: number
    sites_error: number
    sites_hidden: number
    hidden_domains: { domain: string; hidden_at: string | null; last_error: string | null }[]
  }
  users: { total: number; by_plan: Record<string, number>; by_role: Record<string, number>; signups_30d: number }
  alerts: { total: number; active: number }
  activity: { recent_scrapings: { id: string; user_id: string; created_at: string }[] }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} h`
  return `${Math.round(ms / 86400_000)} j`
}

export default function AdminHome() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/stats", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur de chargement")
        return
      }
      setStats(data)
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div>
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">Vue d&apos;ensemble</h1>
          <p className="text-sm text-gray-500 mt-1">État du système Go-Data en temps réel.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {loading && !stats ? (
        <div className="py-24 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : stats ? (
        <div className="space-y-6">
          {/* KPIs */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200">
            <Kpi
              label="Scrapers en attente"
              value={stats.scrapers.pending}
              hint={`${stats.scrapers.active} en production`}
              href="/admin/scrapers"
            />
            <Kpi
              label="Cron horaire"
              value={stats.cron.status === "running" ? "En cours" : "Idle"}
              hint={`Dernier succès : ${timeAgo(stats.cron.last_success_run)}`}
              href="/admin/cron"
              accent={stats.cron.status === "running" ? "emerald" : undefined}
            />
            <Kpi
              label="Clients"
              value={stats.users.total}
              hint={`+${stats.users.signups_30d} sur 30 j`}
              href="/admin/users"
            />
            <Kpi
              label="Alertes actives"
              value={stats.alerts.active}
              hint={`${stats.alerts.total} configurées`}
            />
          </section>

          {/* Cron health + Plans */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card title="Santé du cron" subtitle="Dernier cycle de scraping" actionHref="/admin/cron" actionLabel="Détails" className="lg:col-span-2">
              <div className="grid grid-cols-3 divide-x divide-gray-100 -mx-5">
                <Mini icon={CheckCircle2} label="Succès" value={stats.cron.sites_success} tone="emerald" />
                <Mini icon={XCircle} label="Erreurs" value={stats.cron.sites_error} tone="red" />
                <Mini icon={EyeOff} label="Cachés" value={stats.cron.sites_hidden} tone="amber" />
              </div>

              {stats.cron.hidden_domains.length > 0 && (
                <div className="mt-5 pt-5 border-t border-gray-100">
                  <p className="text-[11px] uppercase tracking-wider text-gray-400 font-medium mb-2">Sites cachés</p>
                  <ul className="space-y-1.5 max-h-44 overflow-auto">
                    {stats.cron.hidden_domains.map(h => (
                      <li key={h.domain} className="text-xs text-gray-700 flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        <span className="font-mono">{h.domain}</span>
                        {h.last_error && <span className="text-gray-400 truncate">— {h.last_error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card title="Répartition" subtitle="Clients par plan & rôle">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-400 font-medium mb-2">Plans</p>
                <ul className="space-y-1 mb-4">
                  {Object.entries(stats.users.by_plan).map(([plan, count]) => (
                    <li key={plan} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 capitalize">{plan}</span>
                      <span className="font-mono text-gray-900 font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] uppercase tracking-wider text-gray-400 font-medium mb-2">Rôles</p>
                <ul className="space-y-1">
                  {Object.entries(stats.users.by_role).map(([role, count]) => (
                    <li key={role} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 capitalize">{role}</span>
                      <span className="font-mono text-gray-900 font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </section>

          {/* Activity */}
          <Card title="Activité récente" subtitle="Dernières comparaisons clients">
            {stats.activity.recent_scrapings.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">Aucune activité récente.</p>
            ) : (
              <ul className="divide-y divide-gray-100 -my-2">
                {stats.activity.recent_scrapings.map(s => (
                  <li key={s.id} className="py-2 text-sm flex items-center justify-between">
                    <span className="font-mono text-gray-700">user {s.user_id.slice(0, 8)}…</span>
                    <span className="text-gray-400 text-xs">il y a {timeAgo(s.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Quick actions */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <QuickAction href="/admin/scrapers" icon={ListChecks} label="Valider les pending" />
            <QuickAction href="/admin/cron" icon={Activity} label="Inspecter le cron" />
            <QuickAction href="/admin/usine" icon={Hammer} label="Générer un scraper" />
          </section>
        </div>
      ) : null}
    </div>
  )
}

function Kpi({
  label, value, hint, href, accent,
}: {
  label: string
  value: string | number
  hint?: string
  href?: string
  accent?: "emerald" | "red"
}) {
  const accentDot = accent === "emerald" ? "bg-emerald-500" : accent === "red" ? "bg-red-500" : ""
  const inner = (
    <div className="bg-white px-5 py-4 hover:bg-gray-50 transition-colors h-full">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
        {accent && <span className={`h-1.5 w-1.5 rounded-full ${accentDot}`} />}
      </div>
      <p className="text-[22px] font-semibold text-gray-900 tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
  return href ? <Link href={href} className="block">{inner}</Link> : inner
}

function Card({
  title, subtitle, children, actionHref, actionLabel, className = "",
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  actionHref?: string
  actionLabel?: string
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>
      <header className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {actionHref && (
          <Link
            href={actionHref}
            className="text-xs font-medium text-gray-700 hover:text-gray-900 inline-flex items-center gap-1"
          >
            {actionLabel || "Voir"}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </header>
      <div className="p-5">{children}</div>
    </div>
  )
}

function Mini({
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
    <div className="px-5 py-1">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`h-3.5 w-3.5 ${toneText[tone]}`} />
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      </div>
      <p className="text-xl font-semibold text-gray-900 tabular-nums">{value}</p>
    </div>
  )
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition group"
    >
      <Icon className="h-4 w-4 text-gray-500 group-hover:text-gray-900 transition-colors" />
      <span className="text-sm text-gray-900 flex-1 font-medium">{label}</span>
      <ArrowUpRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-900 transition-colors" />
    </Link>
  )
}
