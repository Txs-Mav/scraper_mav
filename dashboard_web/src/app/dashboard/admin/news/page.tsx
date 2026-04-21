"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import {
  Loader2, Plus, Pencil, Trash2, Check, X, Megaphone,
  Eye, EyeOff, Sparkles, RefreshCw, AlertTriangle, Lock,
} from "lucide-react"
import { renderMarkdown } from "@/lib/simple-markdown"

interface NewsItem {
  id: string
  slug: string
  title: string
  summary: string | null
  body_md: string
  show_in_modal: boolean
  is_published: boolean
  published_at: string | null
  created_at: string
  updated_at: string
}

type Mode = "list" | "create" | "edit"

const EMPTY: Omit<NewsItem, "id" | "created_at" | "updated_at" | "published_at"> = {
  slug: "",
  title: "",
  summary: "",
  body_md: "",
  show_in_modal: false,
  is_published: true,
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("fr-CA", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export default function AdminNewsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()

  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>("list")
  const [editing, setEditing] = useState<NewsItem | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [resetReads, setResetReads] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  // Gate : compte principal uniquement
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push("/login")
      return
    }
    if (user.role !== "main") {
      router.push("/dashboard")
    }
  }, [authLoading, user, router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/news?limit=100&includeDrafts=true", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur de chargement")
        setItems([])
        return
      }
      setItems(Array.isArray(data?.items) ? data.items : [])
      setError(null)
    } catch (err: any) {
      setError(err?.message || "Erreur réseau")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role === "main") void load()
  }, [user, load])

  const startCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY })
    setResetReads(false)
    setMode("create")
    setError(null)
    setPreview(false)
  }

  const startEdit = (item: NewsItem) => {
    setEditing(item)
    setForm({
      slug: item.slug,
      title: item.title,
      summary: item.summary || "",
      body_md: item.body_md,
      show_in_modal: item.show_in_modal,
      is_published: item.is_published,
    })
    setResetReads(false)
    setMode("edit")
    setError(null)
    setPreview(false)
  }

  const cancel = () => {
    setMode("list")
    setEditing(null)
    setError(null)
    setPreview(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, any> = {
        slug: form.slug.trim() || undefined,
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        body_md: form.body_md,
        show_in_modal: form.show_in_modal,
        is_published: form.is_published,
      }
      const url = editing ? `/api/news/${editing.id}` : "/api/news"
      const method = editing ? "PUT" : "POST"
      if (editing && resetReads) payload.reset_reads = true

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur d'enregistrement")
        return
      }
      await load()
      cancel()
    } catch (err: any) {
      setError(err?.message || "Erreur réseau")
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async (item: NewsItem) => {
    if (!confirm(`Supprimer définitivement "${item.title}" ?`)) return
    try {
      const res = await fetch(`/api/news/${item.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.error || "Erreur de suppression")
        return
      }
      await load()
    } catch (err: any) {
      alert(err?.message || "Erreur réseau")
    }
  }

  if (authLoading || (user?.role === "main" && loading && !items)) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </Layout>
    )
  }

  if (user && user.role !== "main") {
    return (
      <Layout>
        <div className="max-w-xl mx-auto mt-20 text-center">
          <Lock className="h-10 w-10 text-gray-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Accès réservé</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Cette page est réservée aux comptes administrateurs.
          </p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* En-tête */}
        <header className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30">
              <Megaphone className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Nouvelles — Administration</h1>
              <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
                Publiez vos annonces. Elles apparaissent dans le modal de bienvenue et dans le feed Aide & Support.
              </p>
            </div>
          </div>
          {mode === "list" && (
            <button
              type="button"
              onClick={startCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 transition"
            >
              <Plus className="h-4 w-4" />
              Nouvelle annonce
            </button>
          )}
          {mode !== "list" && (
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--color-border-secondary)] text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
            >
              <X className="h-4 w-4" />
              Annuler
            </button>
          )}
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Vue LISTE */}
        {mode === "list" && (
          <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
            {items && items.length === 0 ? (
              <div className="py-20 text-center">
                <Megaphone className="h-10 w-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
                <p className="text-sm text-[var(--color-text-secondary)]">Aucune annonce pour l&apos;instant.</p>
                <button
                  type="button"
                  onClick={startCreate}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition"
                >
                  <Plus className="h-4 w-4" />
                  Créer la première
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-border-tertiary)]">
                {items?.map((item) => (
                  <li key={item.id} className="px-5 py-4 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</p>
                        {item.is_published ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                            Publié
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                            Brouillon
                          </span>
                        )}
                        {item.show_in_modal && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Modal
                          </span>
                        )}
                      </div>
                      {item.summary && (
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">{item.summary}</p>
                      )}
                      <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1.5">
                        Slug : <code className="font-mono">{item.slug}</code> · Publié le {formatDate(item.published_at)} · Modifié le {formatDate(item.updated_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border-secondary)] text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Éditer
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Vue FORMULAIRE */}
        {(mode === "create" || mode === "edit") && (
          <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-5">
              {mode === "create" ? "Nouvelle annonce" : "Éditer l'annonce"}
            </h2>

            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">Titre</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Ex: Nouveautés Go-Data — Avril"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] text-sm placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">Slug (optionnel)</label>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="auto depuis le titre"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] text-sm placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">Résumé (1 ligne)</label>
                <input
                  type="text"
                  value={form.summary}
                  onChange={(e) => setForm(f => ({ ...f, summary: e.target.value }))}
                  placeholder="Aperçu qui apparaît dans le feed"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] text-sm placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)]">Contenu (Markdown)</label>
                  <button
                    type="button"
                    onClick={() => setPreview(p => !p)}
                    className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    {preview ? <><EyeOff className="h-3.5 w-3.5" />Masquer l&apos;aperçu</> : <><Eye className="h-3.5 w-3.5" />Aperçu</>}
                  </button>
                </div>
                <div className={`grid gap-4 ${preview ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
                  <textarea
                    value={form.body_md}
                    onChange={(e) => setForm(f => ({ ...f, body_md: e.target.value }))}
                    placeholder="### Titre&#10;&#10;Contenu en **markdown**..."
                    rows={14}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] text-sm placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition font-mono"
                  />
                  {preview && (
                    <div className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]/40 px-4 py-3 overflow-auto">
                      {form.body_md.trim()
                        ? renderMarkdown(form.body_md)
                        : <p className="text-xs text-[var(--color-text-tertiary)] italic">L&apos;aperçu apparaîtra ici.</p>}
                    </div>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--color-text-tertiary)]">
                  Formats supportés : <code>###</code> titres, <code>**gras**</code>, <code>*italique*</code>, listes <code>-</code>, liens <code>[texte](url)</code>, <code>---</code> séparateur.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <ToggleRow
                  label="Publié"
                  description="Visible dans le feed et utilisable dans le modal."
                  checked={form.is_published}
                  onChange={(v) => setForm(f => ({ ...f, is_published: v }))}
                />
                <ToggleRow
                  label="Afficher dans le modal de bienvenue"
                  description="Popup au prochain login de chaque utilisateur (jusqu'à ce qu'il clique Compris)."
                  checked={form.show_in_modal}
                  onChange={(v) => setForm(f => ({ ...f, show_in_modal: v }))}
                />
              </div>

              {editing && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={resetReads}
                      onChange={(e) => setResetReads(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-[var(--color-border-secondary)] text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-xs text-amber-900 dark:text-amber-200">
                      <strong>Réafficher à tout le monde</strong> — efface les "Compris" précédents pour que tous les utilisateurs revoient cette annonce.
                      <span className="inline-flex items-center gap-1 ml-1 text-amber-700 dark:text-amber-300">
                        <RefreshCw className="h-3 w-3" /> à utiliser si vous modifiez une annonce importante.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--color-border-tertiary)]">
                <button
                  type="button"
                  onClick={cancel}
                  className="px-4 py-2.5 rounded-xl border border-[var(--color-border-secondary)] text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !form.title.trim() || !form.body_md.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {mode === "create" ? "Publier" : "Enregistrer"}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </Layout>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border-secondary)] px-4 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors mt-0.5 ${checked ? "bg-emerald-600" : "bg-gray-300 dark:bg-gray-700"}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{description}</p>
      </div>
    </div>
  )
}
