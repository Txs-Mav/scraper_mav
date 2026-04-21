"use client"

import { useEffect, useState, useCallback, useMemo, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import {
  Loader2, Megaphone, Sparkles, ArrowRight, Calendar,
  Mail, CheckCircle2, Search,
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
  is_read: boolean
}

function formatDateLong(iso: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString("fr-CA", {
      day: "numeric", month: "long", year: "numeric",
    })
  } catch {
    return ""
  }
}

function formatDateShort(iso: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString("fr-CA", {
      day: "numeric", month: "short", year: "numeric",
    })
  } catch {
    return ""
  }
}

export default function NewsPage() {
  return (
    <Suspense
      fallback={
        <Layout>
          <div className="flex items-center justify-center min-h-[60vh]">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        </Layout>
      }
    >
      <NewsPageContent />
    </Suspense>
  )
}

function NewsPageContent() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push("/login")
  }, [authLoading, user, router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/news?limit=100", { cache: "no-store" })
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
    if (user) void load()
  }, [user, load])

  // Ouvre l'article demandé dans l'URL (?id= ou ?slug=)
  useEffect(() => {
    if (!items) return
    const id = searchParams.get("id")
    const slug = searchParams.get("slug")
    if (id) {
      setSelectedId(id)
    } else if (slug) {
      const found = items.find(i => i.slug === slug)
      if (found) setSelectedId(found.id)
    }
  }, [items, searchParams])

  const markRead = useCallback(async (item: NewsItem) => {
    if (item.is_read) return
    try {
      await fetch(`/api/news/${item.id}/dismiss`, { method: "POST" })
      setItems(prev => (prev ? prev.map(n => (n.id === item.id ? { ...n, is_read: true } : n)) : prev))
    } catch {
      // silencieux
    }
  }, [])

  const openDetail = (item: NewsItem) => {
    setSelectedId(item.id)
    void markRead(item)
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", `/dashboard/news?id=${item.id}`)
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  const backToList = () => {
    setSelectedId(null)
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/dashboard/news")
    }
  }

  const selected = useMemo(
    () => (items && selectedId ? items.find(i => i.id === selectedId) || null : null),
    [items, selectedId]
  )

  const filtered = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.summary || "").toLowerCase().includes(q) ||
      i.body_md.toLowerCase().includes(q)
    )
  }, [items, query])

  const unreadCount = useMemo(() => (items || []).filter(i => !i.is_read).length, [items])
  const featured = filtered[0]
  const rest = filtered.slice(1)

  if (authLoading || (user && loading && !items)) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </Layout>
    )
  }

  // ─── Vue DÉTAIL (article) ──────────────────────────────────
  if (selected) {
    return (
      <Layout>
        <article className="max-w-3xl mx-auto">
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] mb-6 transition"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
            Retour aux nouvelles
          </button>

          <header className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                <Sparkles className="h-3 w-3" />
                Nouveauté
              </span>
              {selected.published_at && (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                  <Calendar className="h-3 w-3" />
                  {formatDateLong(selected.published_at)}
                </span>
              )}
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--color-text-primary)] tracking-tight leading-tight">
              {selected.title}
            </h1>
            {selected.summary && (
              <p className="mt-3 text-lg text-[var(--color-text-secondary)] leading-relaxed">
                {selected.summary}
              </p>
            )}
          </header>

          <div className="flex items-center gap-3 pb-6 mb-6 border-b border-[var(--color-border-tertiary)]">
            <div className="relative h-11 w-11 flex-shrink-0">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/70 via-white/30 to-transparent dark:from-white/15 dark:via-white/10 dark:to-transparent" />
              <Image
                src="/Go-Data.svg"
                alt="Go-Data"
                fill
                sizes="44px"
                className="relative object-contain drop-shadow-sm"
                style={{
                  WebkitMaskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                  maskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                }}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">Maverick Menard</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Fondateur Go-Data</p>
            </div>
          </div>

          <div className="text-[15px] text-[var(--color-text-primary)] leading-relaxed">
            {renderMarkdown(selected.body_md)}
          </div>

          <footer className="mt-12 pt-8 border-t border-[var(--color-border-tertiary)]">
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-100 dark:border-emerald-900/30 px-6 py-5 flex items-center gap-4">
              <Mail className="h-6 w-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Une question sur cette nouveauté ?</p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  Écrivez-moi à{" "}
                  <a href="mailto:gestion@go-data.co" className="text-emerald-600 dark:text-emerald-400 underline hover:no-underline">
                    gestion@go-data.co
                  </a>
                </p>
              </div>
            </div>
          </footer>
        </article>
      </Layout>
    )
  }

  // ─── Vue FEED (newsletter) ─────────────────────────────────
  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Hero */}
        <header className="mb-8 pb-6 border-b border-[var(--color-border-tertiary)]">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30">
                <Megaphone className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-[var(--color-text-primary)] tracking-tight">
                  Nouvelles Go-Data
                </h1>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1.5 max-w-2xl">
                  Toutes les nouveautés, améliorations et annonces importantes.
                  Un message direct, signé Maverick Menard.
                </p>
                <div className="flex items-center gap-3 mt-3">
                  {items && items.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                      <Calendar className="h-3 w-3" />
                      {items.length} message{items.length > 1 ? "s" : ""}
                    </span>
                  )}
                  {unreadCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                      {unreadCount} non lu{unreadCount > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Barre de recherche */}
            {items && items.length > 0 && (
              <div className="relative w-full sm:w-64">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] text-sm placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition"
                />
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-800 dark:text-red-300">
            {error}
          </div>
        )}

        {/* État vide */}
        {items && items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] py-20 text-center">
            <Megaphone className="h-12 w-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Aucune nouvelle pour l&apos;instant</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Les prochaines annonces Go-Data apparaîtront ici.
            </p>
          </div>
        )}

        {/* Résultats vides pour la recherche */}
        {items && items.length > 0 && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] py-16 text-center">
            <Search className="h-8 w-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-[var(--color-text-secondary)]">Aucun résultat pour "{query}".</p>
          </div>
        )}

        {/* Article vedette (le plus récent) */}
        {featured && (
          <button
            type="button"
            onClick={() => openDetail(featured)}
            className="w-full text-left mb-8 group rounded-2xl overflow-hidden border border-[var(--color-border-secondary)] bg-gradient-to-br from-[var(--color-background-primary)] to-[var(--color-background-secondary)]/40 hover:shadow-xl hover:-translate-y-0.5 hover:border-emerald-200 dark:hover:border-emerald-900/40 transition-all"
          >
            <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-600 text-white">
                  <Sparkles className="h-3 w-3" />
                  À la une
                </span>
                {!featured.is_read && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                    Nouveau
                  </span>
                )}
                {featured.is_read && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)]">
                    <CheckCircle2 className="h-3 w-3" />
                    Lu
                  </span>
                )}
                <span className="text-[11px] text-[var(--color-text-tertiary)] inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDateLong(featured.published_at)}
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] leading-tight group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition">
                {featured.title}
              </h2>
              {featured.summary && (
                <p className="mt-3 text-base text-[var(--color-text-secondary)] leading-relaxed max-w-2xl">
                  {featured.summary}
                </p>
              )}
              <div className="flex items-center justify-between mt-5 pt-5 border-t border-[var(--color-border-tertiary)]">
                <div className="flex items-center gap-2.5">
                  <div className="relative h-8 w-8 flex-shrink-0">
                    <Image
                      src="/Go-Data.svg"
                      alt="Go-Data"
                      fill
                      sizes="32px"
                      className="object-contain"
                      style={{
                        WebkitMaskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                        maskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--color-text-primary)]">Maverick Menard</p>
                    <p className="text-[10px] text-[var(--color-text-tertiary)]">Fondateur Go-Data</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400 group-hover:gap-2.5 transition-all">
                  Lire
                  <ArrowRight className="h-4 w-4" />
                </span>
              </div>
            </div>
          </button>
        )}

        {/* Liste des autres articles */}
        {rest.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4">
              Archives
            </h3>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rest.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openDetail(item)}
                    className="w-full h-full text-left p-5 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:shadow-lg hover:-translate-y-0.5 hover:border-emerald-200 dark:hover:border-emerald-900/40 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex-shrink-0 relative">
                        <Megaphone className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        {!item.is_read && (
                          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-[var(--color-background-primary)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 text-[11px] text-[var(--color-text-tertiary)]">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDateShort(item.published_at)}</span>
                          {!item.is_read && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                              Nouveau
                            </span>
                          )}
                        </div>
                        <h4 className={`text-base leading-snug ${item.is_read ? "font-medium text-[var(--color-text-secondary)]" : "font-semibold text-[var(--color-text-primary)]"} group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition`}>
                          {item.title}
                        </h4>
                        {item.summary && (
                          <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 line-clamp-2 leading-relaxed">
                            {item.summary}
                          </p>
                        )}
                        <span className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 group-hover:gap-2 transition-all">
                          Lire l&apos;article
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Footer newsletter */}
        {items && items.length > 0 && (
          <footer className="mt-12 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-100 dark:border-emerald-900/30 px-6 py-6 text-center">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Une suggestion ou question ?</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1 max-w-md mx-auto">
              Je lis tous les messages personnellement. N&apos;hésitez pas à m&apos;écrire pour toute question ou idée.
            </p>
            <a
              href="mailto:gestion@go-data.co"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 transition"
            >
              <Mail className="h-4 w-4" />
              gestion@go-data.co
            </a>
          </footer>
        )}
      </div>
    </Layout>
  )
}
