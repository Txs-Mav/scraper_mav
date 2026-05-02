"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import {
  Loader2, RefreshCw, Search, AlertTriangle, Bell, Activity, Crown, Shield, User as UserIcon,
} from "lucide-react"

interface UserRow {
  id: string
  name: string | null
  email: string
  role: string
  subscription_plan: string | null
  subscription_source: string | null
  created_at: string
  updated_at: string
  avatar_url: string | null
  alerts_total: number
  alerts_active: number
  scrapings_total: number
  last_scraping_at: string | null
  last_reference_url: string | null
  // Vraie activité utilisateur
  last_activity_at: string | null
  last_activity_page: string | null
  last_sign_in_at: string | null
  email_confirmed_at: string | null
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} h`
  return `${Math.round(ms / 86400_000)} j`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" })
  } catch { return iso }
}

function isRecent(iso: string | null, withinMs: number): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < withinMs
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [planFilter, setPlanFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"created_at" | "last_activity_at" | "last_sign_in_at" | "scrapings_total" | "alerts_active">("last_activity_at")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur")
        return
      }
      setUsers(data.users || [])
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const plans = useMemo(() => {
    const set = new Set<string>()
    for (const u of users || []) set.add(u.subscription_plan || "free")
    return ["all", ...Array.from(set).sort()]
  }, [users])

  const filtered = useMemo(() => {
    if (!users) return []
    let list = users.filter(u => {
      if (planFilter !== "all" && (u.subscription_plan || "free") !== planFilter) return false
      if (query) {
        const q = query.toLowerCase()
        return (
          (u.email && u.email.toLowerCase().includes(q)) ||
          (u.name && u.name.toLowerCase().includes(q)) ||
          (u.id && u.id.toLowerCase().includes(q))
        )
      }
      return true
    })
    list = [...list].sort((a, b) => {
      if (sortBy === "scrapings_total") return (b.scrapings_total || 0) - (a.scrapings_total || 0)
      if (sortBy === "alerts_active") return (b.alerts_active || 0) - (a.alerts_active || 0)
      const aDate = a[sortBy] ? new Date(a[sortBy] as string).getTime() : 0
      const bDate = b[sortBy] ? new Date(b[sortBy] as string).getTime() : 0
      return bDate - aDate
    })
    return list
  }, [users, query, planFilter, sortBy])

  const counts = useMemo(() => {
    if (!users) return { total: 0, paid: 0, free: 0, active7d: 0 }
    const cutoff7d = Date.now() - 7 * 24 * 3600 * 1000
    return {
      total: users.length,
      paid: users.filter(u => u.subscription_plan && !["free", "standard"].includes(u.subscription_plan)).length,
      free: users.filter(u => !u.subscription_plan || ["free", "standard"].includes(u.subscription_plan)).length,
      // Actifs basé sur la VRAIE activité (page_view, session_start) — pas
      // les crons d'alertes qui s'exécutent automatiquement.
      active7d: users.filter(u => u.last_activity_at && new Date(u.last_activity_at).getTime() > cutoff7d).length,
    }
  }, [users])

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tous les utilisateurs Go-Data, leur plan et leur activité.
          </p>
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

      {/* Mini stats */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200 mb-6">
        <MiniCount label="Total" value={counts.total} />
        <MiniCount label="Payants" value={counts.paid} />
        <MiniCount label="Free" value={counts.free} />
        <MiniCount label="Actifs (7j)" value={counts.active7d} hint="présence UI réelle" />
      </section>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Recherche + filtre */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher par email, nom ou id…"
            className="w-full pl-9 pr-3 py-1.5 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
          />
        </div>
        <div className="inline-flex items-center bg-white border border-gray-200 rounded-md p-0.5">
          {plans.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPlanFilter(p)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                planFilter === p ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {p === "all" ? "Tous" : p}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading && !users ? (
        <div className="py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500">
                <th className="text-left px-5 py-2.5 font-medium">Utilisateur</th>
                <th className="text-left px-5 py-2.5 font-medium">Plan</th>
                <SortHeader label="Comparaisons" current={sortBy} value="scrapings_total" onClick={setSortBy} align="right" />
                <SortHeader label="Alertes" current={sortBy} value="alerts_active" onClick={setSortBy} align="right" />
                <SortHeader label="Inscription" current={sortBy} value="created_at" onClick={setSortBy} align="right" />
                <SortHeader label="Dern. connexion" current={sortBy} value="last_sign_in_at" onClick={setSortBy} align="right" />
                <SortHeader label="Dern. activité" current={sortBy} value="last_activity_at" onClick={setSortBy} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-500">Aucun utilisateur.</td></tr>
              ) : filtered.map(u => (
                <tr key={u.id} className="hover:bg-gray-50/50 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <RoleAvatar role={u.role} avatarUrl={u.avatar_url} name={u.name || u.email} />
                      <div className="min-w-0">
                        <p className="text-gray-900 text-sm font-medium truncate">{u.name || "Sans nom"}</p>
                        <p className="text-gray-500 text-xs truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <PlanBadge plan={u.subscription_plan} source={u.subscription_source} />
                    <p className="text-[10px] text-gray-500 mt-0.5">{u.role}</p>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className="inline-flex items-center gap-1 text-gray-900 text-sm font-medium">
                      <Activity className="h-3 w-3 text-gray-400" />
                      {u.scrapings_total}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className="inline-flex items-center gap-1 text-gray-900 text-sm font-medium">
                      <Bell className="h-3 w-3 text-gray-400" />
                      {u.alerts_active}<span className="text-gray-400">/{u.alerts_total}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-500 text-xs" title={formatDate(u.created_at)}>
                    il y a {timeAgo(u.created_at)}
                  </td>
                  <td className="px-5 py-3 text-right text-gray-500 text-xs" title={u.last_sign_in_at ? formatDate(u.last_sign_in_at) : ""}>
                    {u.last_sign_in_at ? (
                      <span className="inline-flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          isRecent(u.last_sign_in_at, 24 * 3600_000) ? "bg-emerald-500" : "bg-gray-300"
                        }`} />
                        il y a {timeAgo(u.last_sign_in_at)}
                      </span>
                    ) : (
                      <span className="text-gray-400">jamais</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right" title={u.last_activity_page ? `Page : ${u.last_activity_page}` : ""}>
                    {u.last_activity_at ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          isRecent(u.last_activity_at, 5 * 60_000) ? "bg-emerald-500 animate-pulse" :
                          isRecent(u.last_activity_at, 24 * 3600_000) ? "bg-emerald-500" :
                          isRecent(u.last_activity_at, 7 * 24 * 3600_000) ? "bg-amber-400" :
                          "bg-gray-300"
                        }`} />
                        <div className="text-right">
                          <p className="text-gray-700 text-xs">il y a {timeAgo(u.last_activity_at)}</p>
                          {u.last_activity_page && (
                            <p className="text-[10px] text-gray-400 font-mono truncate max-w-[120px]">{u.last_activity_page}</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {users && (
        <p className="mt-3 text-xs text-gray-500">
          {filtered.length} sur {users.length} utilisateurs.
        </p>
      )}
    </div>
  )
}

function MiniCount({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="bg-white px-5 py-3.5">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      <p className="text-xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

function SortHeader({
  label, current, value, onClick, align,
}: {
  label: string
  current: string
  value: any
  onClick: (v: any) => void
  align: "left" | "right"
}) {
  const active = current === value
  return (
    <th className={`px-5 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(value)}
        className={`inline-flex items-center gap-1 transition ${
          active ? "text-gray-900" : "text-gray-500 hover:text-gray-900"
        }`}
      >
        {label}
        {active && <span className="text-gray-400">↓</span>}
      </button>
    </th>
  )
}

function PlanBadge({ plan, source }: { plan: string | null; source: string | null }) {
  const p = plan || "free"
  const styles: Record<string, string> = {
    standard: "bg-gray-100 text-gray-700 ring-gray-200",
    pro: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    ultime: "bg-violet-50 text-violet-700 ring-violet-200",
    free: "bg-gray-100 text-gray-600 ring-gray-200",
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ${styles[p] || styles.free}`}>
        {p}
      </span>
      {source === "promo" && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 uppercase">
          promo
        </span>
      )}
    </span>
  )
}

function RoleAvatar({ role, avatarUrl, name }: { role: string; avatarUrl: string | null; name: string }) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-gray-200" />
  }
  if (role === "main") {
    return <div className="h-8 w-8 rounded-full bg-amber-50 ring-1 ring-amber-200 flex items-center justify-center"><Crown className="h-3.5 w-3.5 text-amber-600" /></div>
  }
  if (role === "developer") {
    return <div className="h-8 w-8 rounded-full bg-gray-900 flex items-center justify-center"><Shield className="h-3.5 w-3.5 text-white" /></div>
  }
  const initials = name.split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase() || "?"
  return (
    <div className="h-8 w-8 rounded-full bg-gray-100 ring-1 ring-gray-200 flex items-center justify-center text-[11px] font-medium text-gray-600">
      {initials || <UserIcon className="h-3.5 w-3.5" />}
    </div>
  )
}
