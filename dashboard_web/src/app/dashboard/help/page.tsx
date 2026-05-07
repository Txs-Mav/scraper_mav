"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
} from "lucide-react"

type SupportType = "question" | "suggestion" | "bug" | "other"

interface SupportMessage {
  id: string
  type: SupportType
  subject: string
  message: string
  status: "open" | "answered" | "closed"
  admin_reply: string | null
  admin_replied_at: string | null
  created_at: string
  updated_at: string
}

const TYPE_OPTIONS: Array<{ value: SupportType; label: string; description: string; icon: any }> = [
  { value: "question", label: "Question", description: "Besoin d'une réponse", icon: HelpCircle },
  { value: "suggestion", label: "Suggestion", description: "Idée d'amélioration", icon: Lightbulb },
  { value: "bug", label: "Problème", description: "Quelque chose ne marche pas", icon: Bug },
  { value: "other", label: "Autre", description: "Demande générale", icon: MessageCircle },
]

function formatDate(iso: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("fr-CA", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function statusLabel(status: SupportMessage["status"]) {
  if (status === "answered") return "Répondu"
  if (status === "closed") return "Fermé"
  return "Ouvert"
}

function statusClass(status: SupportMessage["status"]) {
  if (status === "answered") return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40"
  if (status === "closed") return "bg-gray-100 text-gray-600 border-gray-200 dark:bg-white/[0.05] dark:text-gray-300 dark:border-white/[0.08]"
  return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/40"
}

export default function DashboardHelpPage() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [type, setType] = useState<SupportType>("question")
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")

  const selectedType = useMemo(
    () => TYPE_OPTIONS.find((option) => option.value === type) ?? TYPE_OPTIONS[0],
    [type]
  )

  const loadMessages = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/support/messages", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Impossible de charger vos messages.")
        setMessages([])
        return
      }
      setMessages(Array.isArray(data?.messages) ? data.messages : [])
    } catch (err: any) {
      setError(err?.message || "Erreur réseau.")
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!subject.trim()) {
      setError("Ajoutez un sujet court.")
      return
    }
    if (message.trim().length < 10) {
      setError("Ajoutez un message d'au moins 10 caractères.")
      return
    }

    setSending(true)
    try {
      const res = await fetch("/api/support/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, subject, message }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Impossible d'envoyer le message.")
        return
      }
      setMessages((current) => [data.message, ...current])
      setSubject("")
      setMessage("")
      setType("question")
      setSuccess("Message envoyé. Vous verrez la réponse ici dès qu'elle sera disponible.")
    } catch (err: any) {
      setError(err?.message || "Erreur réseau.")
    } finally {
      setSending(false)
    }
  }

  const SelectedIcon = selectedType.icon

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" />
                Support Go-Data
              </span>
              <h1 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
                Centre d'aide
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-secondary)] leading-relaxed">
                Envoyez une question, une suggestion ou un problème rencontré dans le dashboard. Les réponses du compte dev apparaîtront dans votre historique.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              <p className="font-medium text-[var(--color-text-primary)]">Réponse centralisée</p>
              <p className="mt-1 text-xs leading-relaxed">
                Plus besoin d'écrire par courriel : le fil reste attaché à votre compte.
              </p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-6">
          <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300">
                <SelectedIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Envoyer un message</h2>
                <p className="text-sm text-[var(--color-text-secondary)]">Décrivez clairement ce que vous voulez savoir ou améliorer.</p>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300 flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300 flex gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{success}</span>
              </div>
            )}

            <form onSubmit={sendMessage} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Type de demande
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TYPE_OPTIONS.map((option) => {
                    const Icon = option.icon
                    const active = type === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setType(option.value)}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          active
                            ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100"
                            : "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:bg-[var(--color-background-hover)] text-[var(--color-text-primary)]"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Icon className={`h-4 w-4 ${active ? "text-emerald-600 dark:text-emerald-300" : "text-[var(--color-text-secondary)]"}`} />
                          {option.label}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{option.description}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="support-subject" className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Sujet
                </label>
                <input
                  id="support-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={140}
                  placeholder="Ex. Comment modifier mes concurrents ?"
                  className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="support-message" className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Message
                </label>
                <textarea
                  id="support-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={7}
                  maxLength={5000}
                  placeholder="Ajoutez le contexte, la page concernée, ce que vous avez essayé et le résultat attendu."
                  className="w-full resize-none rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{message.length}/5000 caractères</p>
              </div>

              <button
                type="submit"
                disabled={sending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Envoyer
              </button>
            </form>
          </div>

          <aside className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Mes demandes</h2>
                <p className="text-sm text-[var(--color-text-secondary)]">Historique et réponses.</p>
              </div>
              <button
                type="button"
                onClick={() => void loadMessages()}
                className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-300"
              >
                Actualiser
              </button>
            </div>

            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-tertiary)] mx-auto" />
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] p-6 text-center">
                <MessageCircle className="h-8 w-8 text-[var(--color-text-tertiary)] mx-auto mb-2" />
                <p className="text-sm font-medium text-[var(--color-text-primary)]">Aucune demande pour le moment.</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Votre prochain message apparaîtra ici.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[720px] overflow-y-auto pr-1">
                {messages.map((item) => {
                  const option = TYPE_OPTIONS.find((entry) => entry.value === item.type) ?? TYPE_OPTIONS[0]
                  const Icon = option.icon
                  return (
                    <article key={item.id} className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                            <Icon className="h-3.5 w-3.5" />
                            {option.label} · {formatDate(item.created_at)}
                          </p>
                          <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-primary)] truncate">{item.subject}</h3>
                        </div>
                        <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{item.message}</p>
                      {item.admin_reply && (
                        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                            Réponse Go-Data · {formatDate(item.admin_replied_at)}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900 dark:text-emerald-100">{item.admin_reply}</p>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </aside>
        </section>
      </div>
    </Layout>
  )
}
