"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageCircle,
  RefreshCw,
  Reply,
  Search,
  Send,
} from "lucide-react"

type SupportType = "question" | "suggestion" | "bug" | "other"
type SupportStatus = "open" | "answered" | "closed"

interface SupportUser {
  id: string
  name: string | null
  email: string
  subscription_plan: string | null
  business_type: string | null
}

interface SupportMessage {
  id: string
  user_id: string
  type: SupportType
  subject: string
  message: string
  status: SupportStatus
  admin_reply: string | null
  admin_replied_at: string | null
  created_at: string
  updated_at: string
  users: SupportUser | null
}

const TYPES: Record<SupportType, { label: string; icon: any }> = {
  question: { label: "Question", icon: HelpCircle },
  suggestion: { label: "Suggestion", icon: Lightbulb },
  bug: { label: "Problème", icon: Bug },
  other: { label: "Autre", icon: MessageCircle },
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("fr-CA", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function statusLabel(status: SupportStatus): string {
  if (status === "answered") return "Répondu"
  if (status === "closed") return "Fermé"
  return "Ouvert"
}

function statusClass(status: SupportStatus): string {
  if (status === "answered") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (status === "closed") return "bg-gray-100 text-gray-600 border-gray-200"
  return "bg-amber-50 text-amber-700 border-amber-200"
}

export default function AdminSupportPage() {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<"all" | SupportStatus>("all")
  const [query, setQuery] = useState("")
  const [reply, setReply] = useState("")
  const [replyStatus, setReplyStatus] = useState<"answered" | "closed">("answered")
  const [loading, setLoading] = useState(true)
  const [replying, setReplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`
      const res = await fetch(`/api/admin/support${qs}`, { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur de chargement")
        setMessages([])
        return
      }
      setMessages(Array.isArray(data?.messages) ? data.messages : [])
    } catch (err: any) {
      setError(err?.message || "Erreur réseau")
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const list = messages || []
    const needle = query.trim().toLowerCase()
    if (!needle) return list
    return list.filter((item) => {
      const user = item.users
      return (
        item.subject.toLowerCase().includes(needle) ||
        item.message.toLowerCase().includes(needle) ||
        item.type.toLowerCase().includes(needle) ||
        user?.email?.toLowerCase().includes(needle) ||
        user?.name?.toLowerCase().includes(needle)
      )
    })
  }, [messages, query])

  const selected = useMemo(
    () => filtered.find((item) => item.id === selectedId) || filtered[0] || null,
    [filtered, selectedId]
  )

  useEffect(() => {
    setReply(selected?.admin_reply || "")
    setReplyStatus(selected?.status === "closed" ? "closed" : "answered")
  }, [selected?.id])

  const counts = useMemo(() => {
    const list = messages || []
    return {
      total: list.length,
      open: list.filter((item) => item.status === "open").length,
      answered: list.filter((item) => item.status === "answered").length,
      closed: list.filter((item) => item.status === "closed").length,
    }
  }, [messages])

  const submitReply = async () => {
    if (!selected) return
    if (!reply.trim()) {
      setError("Ajoute une réponse avant d'envoyer.")
      return
    }
    setReplying(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/support/${selected.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply, status: replyStatus }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Impossible d'envoyer la réponse")
        return
      }
      setMessages((current) =>
        (current || []).map((item) => (item.id === selected.id ? data.message : item))
      )
    } catch (err: any) {
      setError(err?.message || "Erreur réseau")
    } finally {
      setReplying(false)
    }
  }

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">Support</h1>
          <p className="text-sm text-gray-500 mt-1">Questions, suggestions et problèmes envoyés depuis le centre d'aide.</p>
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

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200 mb-6">
        <MiniCount label="Total" value={counts.total} />
        <MiniCount label="Ouverts" value={counts.open} />
        <MiniCount label="Répondus" value={counts.answered} />
        <MiniCount label="Fermés" value={counts.closed} />
      </section>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-[260px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher par client, sujet ou message..."
            className="w-full pl-9 pr-3 py-1.5 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
          />
        </div>
        <div className="inline-flex items-center bg-white border border-gray-200 rounded-md p-0.5">
          {(["all", "open", "answered", "closed"] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                statusFilter === status ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {status === "all" ? "Tous" : statusLabel(status)}
            </button>
          ))}
        </div>
      </div>

      {loading && !messages ? (
        <div className="py-20 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-5">
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">Aucun message.</div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[720px] overflow-y-auto">
                {filtered.map((item) => {
                  const type = TYPES[item.type]
                  const Icon = type.icon
                  const active = selected?.id === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full text-left px-4 py-3 transition ${active ? "bg-gray-50" : "hover:bg-gray-50/70"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Icon className="h-3.5 w-3.5" />
                            {type.label} · {formatDate(item.created_at)}
                          </p>
                          <h2 className="mt-1 text-sm font-medium text-gray-900 truncate">{item.subject}</h2>
                          <p className="mt-1 text-xs text-gray-500 truncate">
                            {item.users?.name || "Sans nom"} · {item.users?.email || item.user_id.slice(0, 8)}
                          </p>
                        </div>
                        <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white shadow-sm min-h-[520px]">
            {!selected ? (
              <div className="h-full min-h-[520px] flex items-center justify-center text-center px-6">
                <div>
                  <MessageCircle className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-900">Sélectionne un message</p>
                  <p className="text-xs text-gray-500 mt-1">La conversation et le champ de réponse apparaîtront ici.</p>
                </div>
              </div>
            ) : (
              <div className="p-6">
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-5 mb-5">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(selected.status)}`}>
                        {statusLabel(selected.status)}
                      </span>
                      <span className="text-xs text-gray-500">{TYPES[selected.type].label}</span>
                    </div>
                    <h2 className="text-xl font-semibold text-gray-900 tracking-tight">{selected.subject}</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      {selected.users?.name || "Sans nom"} · {selected.users?.email || selected.user_id}
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>Créé le</p>
                    <p className="font-medium text-gray-700">{formatDate(selected.created_at)}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Message client</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">{selected.message}</p>
                  </div>

                  {selected.admin_reply && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-2">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Réponse envoyée · {formatDate(selected.admin_replied_at)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-emerald-950 leading-relaxed">{selected.admin_reply}</p>
                    </div>
                  )}

                  <div className="pt-2">
                    <label htmlFor="support-reply" className="flex items-center gap-1.5 text-sm font-medium text-gray-900 mb-2">
                      <Reply className="h-4 w-4" />
                      Réponse
                    </label>
                    <textarea
                      id="support-reply"
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      rows={8}
                      maxLength={5000}
                      placeholder="Répondre au client..."
                      className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
                    />
                    <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="inline-flex items-center bg-gray-100 border border-gray-200 rounded-md p-0.5 w-fit">
                        {(["answered", "closed"] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => setReplyStatus(status)}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                              replyStatus === status ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                            }`}
                          >
                            {statusLabel(status)}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={submitReply}
                        disabled={replying}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Envoyer la réponse
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      <p className="mt-2 text-[22px] font-semibold text-gray-900 tracking-tight tabular-nums">{value}</p>
    </div>
  )
}
