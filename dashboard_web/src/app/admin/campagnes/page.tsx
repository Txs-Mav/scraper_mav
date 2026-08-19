"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import QRCode from "qrcode"
import {
  Loader2, RefreshCw, AlertTriangle, QrCode, Copy, Check, Download,
  ChevronDown, Users, Activity, LogIn, MailCheck, MailX, TrendingUp,
} from "lucide-react"

interface CampaignUser {
  id: string
  name: string | null
  email: string
  subscription_plan: string | null
  created_at: string
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  last_activity_at: string | null
  sessions_total: number
  scrapings_total: number
}

interface PromoCodeRow {
  id: string
  code: string
  description: string | null
  is_active: boolean
  max_uses: number | null
  current_uses: number
  created_at: string
  deactivated_at: string | null
  users: CampaignUser[]
  users_count: number
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

// Campagnes avec landing dédiée : le lien/QR pointe vers leur page publique
// personnalisée plutôt que vers le /c/[code] générique.
const CAMPAIGN_LANDING_PATHS: Record<string, string> = {
  FALARDEAU: "/falardeau",
  SMSPORT: "/smsport",
  MORINSPORTS: "/morinsports",
  EXCELMOTO: "/excelmoto",
}

// URL d'inscription encodée dans le QR : la page campagne /c/[code]
// (inscription 1 écran, accès instantané). En prod NEXT_PUBLIC_APP_URL
// pointe vers le domaine public ; en local on retombe sur l'origin courant.
function signupUrl(code: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "")
  const path = CAMPAIGN_LANDING_PATHS[code.toUpperCase()] || `/c/${encodeURIComponent(code.toLowerCase())}`
  return `${base.replace(/\/$/, "")}${path}`
}

export default function AdminCampagnesPage() {
  const [codes, setCodes] = useState<PromoCodeRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/promo-codes", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur")
        return
      }
      const list: PromoCodeRow[] = data.codes || []
      setCodes(list)
      // Ouvre par défaut la campagne la plus récente qui a des inscriptions,
      // sinon la plus récente tout court.
      setExpanded(prev => prev ?? (list.find(c => c.users_count > 0)?.id || list[0]?.id || null))
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => {
    if (!codes) return { campaigns: 0, signups: 0, confirmed: 0, active7d: 0 }
    const all = codes.flatMap(c => c.users)
    const cutoff7d = Date.now() - 7 * 24 * 3600 * 1000
    return {
      campaigns: codes.filter(c => c.is_active).length,
      signups: all.length,
      confirmed: all.filter(u => u.email_confirmed_at).length,
      active7d: all.filter(u => u.last_activity_at && new Date(u.last_activity_at).getTime() > cutoff7d).length,
    }
  }, [codes])

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">Campagnes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Codes magiques, QR d&apos;inscription et comptes créés par campagne.
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

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200 mb-6">
        <MiniCount label="Codes actifs" value={totals.campaigns} />
        <MiniCount label="Inscriptions" value={totals.signups} />
        <MiniCount label="Emails confirmés" value={totals.confirmed} />
        <MiniCount label="Actifs (7j)" value={totals.active7d} hint="présence UI réelle" />
      </section>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {loading && !codes ? (
        <div className="py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : (
        <div className="space-y-3">
          {(codes || []).map(c => (
            <CampaignCard
              key={c.id}
              campaign={c}
              expanded={expanded === c.id}
              onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
              onActiveChange={(id, next) =>
                setCodes(prev => (prev || []).map(x =>
                  x.id === id
                    ? { ...x, is_active: next, deactivated_at: next ? null : new Date().toISOString() }
                    : x
                ))
              }
            />
          ))}
          {codes && codes.length === 0 && (
            <p className="py-12 text-center text-sm text-gray-500">Aucun code magique.</p>
          )}
        </div>
      )}
    </div>
  )
}

function CampaignCard({
  campaign, expanded, onToggle, onActiveChange,
}: {
  campaign: PromoCodeRow
  expanded: boolean
  onToggle: () => void
  onActiveChange: (id: string, next: boolean) => void
}) {
  const url = signupUrl(campaign.code)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const toggleActive = async () => {
    if (switching) return
    const next = !campaign.is_active
    setSwitching(true)
    setSwitchError(null)
    try {
      const res = await fetch(`/api/admin/promo-codes/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSwitchError(data?.error || "Erreur")
        return
      }
      onActiveChange(campaign.id, data.code.is_active)
    } catch (e: any) {
      setSwitchError(e?.message || "Erreur réseau")
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="w-full flex items-center gap-4 px-5 py-3.5">
        <button type="button" onClick={onToggle} className="flex items-center gap-4 min-w-0 flex-1 text-left group">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
            campaign.is_active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400"
          }`}>
            <QrCode className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-gray-900">{campaign.code}</span>
              {!campaign.is_active && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200 uppercase">
                  désactivé{campaign.deactivated_at ? ` le ${formatDate(campaign.deactivated_at)}` : ""}
                </span>
              )}
            </span>
            <span className="block text-xs text-gray-500 truncate">{campaign.description || "—"}</span>
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
            <Users className="h-3.5 w-3.5 text-gray-400" />
            <span className="tabular-nums font-medium text-gray-900">{campaign.users_count}</span>
            inscription{campaign.users_count > 1 ? "s" : ""}
          </span>
        </button>

        {/* Interrupteur : stoppe les nouvelles inscriptions, ne touche pas
            aux comptes existants. Réversible en un clic. */}
        <button
          type="button"
          role="switch"
          aria-checked={campaign.is_active}
          aria-label={campaign.is_active ? "Désactiver la campagne" : "Réactiver la campagne"}
          title={campaign.is_active ? "Campagne active — cliquer pour stopper les nouvelles inscriptions" : "Campagne désactivée — cliquer pour réactiver"}
          onClick={toggleActive}
          disabled={switching}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            campaign.is_active ? "bg-orange-600" : "bg-gray-200"
          }`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            campaign.is_active ? "left-[18px]" : "left-0.5"
          }`} />
        </button>

        <button type="button" onClick={onToggle} aria-label={expanded ? "Replier" : "Déplier"}>
          <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {switchError && (
        <p className="px-5 pb-2 text-xs text-red-600">{switchError}</p>
      )}

      {expanded && (
        <div className="border-t border-gray-100">
          <div className="grid gap-5 p-5 sm:grid-cols-[auto,1fr]">
            <QrBlock code={campaign.code} url={url} />
            <CampaignMonitor users={campaign.users} />
          </div>
          <div className="px-5 pb-5">
            <UsersTable users={campaign.users} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Zone de suivi de campagne : tuiles agrégées + inscriptions par jour. */
function CampaignMonitor({ users }: { users: CampaignUser[] }) {
  const stats = useMemo(() => {
    const cutoff7d = Date.now() - 7 * 24 * 3600 * 1000
    return {
      signups: users.length,
      confirmed: users.filter(u => u.email_confirmed_at).length,
      active7d: users.filter(u => u.last_activity_at && new Date(u.last_activity_at).getTime() > cutoff7d).length,
      sessions: users.reduce((s, u) => s + u.sessions_total, 0),
      scrapings: users.reduce((s, u) => s + u.scrapings_total, 0),
    }
  }, [users])

  // Inscriptions par jour, 14 derniers jours (fuseau local).
  const days = useMemo(() => {
    const out: Array<{ key: string; label: string; count: number }> = []
    const today = new Date()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      out.push({
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString("fr-CA", { day: "numeric", month: "short" }),
        count: 0,
      })
    }
    const index = new Map(out.map((d, i) => [d.key, i]))
    for (const u of users) {
      const d = new Date(u.created_at)
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10)
      const i = index.get(key)
      if (i !== undefined) out[i].count++
    }
    return out
  }, [users])

  const max = Math.max(1, ...days.map(d => d.count))

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
        {[
          { label: "Inscriptions", value: stats.signups },
          { label: "Confirmés", value: stats.confirmed },
          { label: "Actifs (7j)", value: stats.active7d },
          { label: "Sessions", value: stats.sessions },
          { label: "Comparaisons", value: stats.scrapings },
        ].map(s => (
          <div key={s.label} className="bg-white px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium truncate">{s.label}</p>
            <p className="text-lg font-semibold text-gray-900 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 p-4">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500 font-medium">
          <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
          Inscriptions — 14 derniers jours
        </p>
        {days.every(d => d.count === 0) ? (
          <p className="py-6 text-center text-xs text-gray-400">Aucune inscription sur la période.</p>
        ) : (
          <div>
            <div className="mt-3 flex h-24 items-end gap-[3px]">
              {days.map(d => (
                <div
                  key={d.key}
                  title={`${d.label} — ${d.count} inscription${d.count > 1 ? "s" : ""}`}
                  className="group relative flex-1 flex flex-col justify-end h-full"
                >
                  <div
                    className={`w-full rounded-t-[3px] transition-colors ${
                      d.count > 0 ? "bg-orange-600 group-hover:bg-orange-700" : "bg-gray-100"
                    }`}
                    style={{ height: d.count > 0 ? `${Math.max(8, (d.count / max) * 100)}%` : "3px" }}
                  />
                  {d.count > 0 && (
                    <span className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-semibold tabular-nums text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity">
                      {d.count}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-gray-400">
              <span>{days[0].label}</span>
              <span>{days[7].label}</span>
              <span>{days[13].label}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function QrBlock({ code, url }: { code: string; url: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, { width: 480, margin: 2, errorCorrectionLevel: "M" })
      .then(d => { if (!cancelled) setDataUrl(d) })
      .catch(() => { if (!cancelled) setDataUrl(null) })
    return () => { cancelled = true }
  }, [url])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard indisponible */ }
  }

  // PNG 2048 px : assez pour un flyer imprimé (~17 cm à 300 dpi).
  const downloadPng = async () => {
    const png = await QRCode.toDataURL(url, { width: 2048, margin: 4, errorCorrectionLevel: "M" })
    triggerDownload(png, `qr-${code.toLowerCase()}.png`)
  }

  const downloadSvg = async () => {
    const svg = await QRCode.toString(url, { type: "svg", margin: 4, errorCorrectionLevel: "M" })
    const blob = new Blob([svg], { type: "image/svg+xml" })
    const objectUrl = URL.createObjectURL(blob)
    triggerDownload(objectUrl, `qr-${code.toLowerCase()}.svg`)
    URL.revokeObjectURL(objectUrl)
  }

  return (
    <div className="w-full sm:w-56 shrink-0">
      <div className="rounded-lg border border-gray-200 bg-white p-3 flex items-center justify-center">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt={`QR ${code}`} className="h-44 w-44" />
        ) : (
          <div className="h-44 w-44 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-gray-500 break-all font-mono leading-relaxed">{url}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <SmallButton onClick={copyLink} icon={copied ? Check : Copy} label={copied ? "Copié" : "Copier le lien"} />
        <SmallButton onClick={downloadPng} icon={Download} label="PNG (impression)" />
        <SmallButton onClick={downloadSvg} icon={Download} label="SVG" />
      </div>
    </div>
  )
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a")
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function SmallButton({ onClick, icon: Icon, label }: { onClick: () => void; icon: any; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 bg-white text-[11px] font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

function UsersTable({ users }: { users: CampaignUser[] }) {
  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400 min-h-[120px]">
        Aucune inscription via ce code pour l&apos;instant.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500">
            <th className="text-left px-4 py-2 font-medium">Compte</th>
            <th className="text-right px-4 py-2 font-medium">Inscription</th>
            <th className="text-right px-4 py-2 font-medium">Dern. connexion</th>
            <th className="text-right px-4 py-2 font-medium" title="Sessions ouvertes dans l'application">Sessions</th>
            <th className="text-right px-4 py-2 font-medium">Comparaisons</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {users.map(u => (
            <tr key={u.id} className="hover:bg-gray-50/50 transition">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  {u.email_confirmed_at ? (
                    <MailCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Email confirmé" />
                  ) : (
                    <MailX className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Email non confirmé" />
                  )}
                  <div className="min-w-0">
                    <p className="text-gray-900 text-[13px] font-medium truncate">{u.name || "Sans nom"}</p>
                    <p className="text-gray-500 text-[11px] truncate">{u.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-gray-500" title={formatDate(u.created_at)}>
                il y a {timeAgo(u.created_at)}
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-gray-500" title={formatDate(u.last_sign_in_at)}>
                {u.last_sign_in_at ? (
                  <span className="inline-flex items-center gap-1">
                    <LogIn className="h-3 w-3 text-gray-400" />
                    il y a {timeAgo(u.last_sign_in_at)}
                  </span>
                ) : (
                  <span className="text-gray-400">jamais</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right text-xs tabular-nums text-gray-900 font-medium">
                {u.sessions_total}
              </td>
              <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                <span className="inline-flex items-center gap-1 text-gray-900 font-medium">
                  <Activity className="h-3 w-3 text-gray-400" />
                  {u.scrapings_total}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
