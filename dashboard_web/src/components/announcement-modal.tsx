"use client"

import { useEffect, useState, useCallback } from "react"
import Image from "next/image"
import { X, Sparkles, Loader2 } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { renderMarkdown } from "@/lib/simple-markdown"

interface NewsItem {
  id: string
  slug: string
  title: string
  summary: string | null
  body_md: string
  published_at: string | null
}

const DISMISSED_CACHE_KEY = "go-data:dismissed-news"

function readDismissedCache(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(DISMISSED_CACHE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function writeDismissedCache(ids: Set<string>) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(DISMISSED_CACHE_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // silencieux
  }
}

export default function AnnouncementModal() {
  const { user, isLoading: authLoading } = useAuth()
  const [news, setNews] = useState<NewsItem | null>(null)
  const [dismissing, setDismissing] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || authLoading || !user?.id) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch("/api/news/unseen", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const item: NewsItem | null = data?.news || null
        if (!item) return
        const localDismissed = readDismissedCache()
        if (localDismissed.has(item.id)) return
        setNews(item)
      } catch {
        // silencieux — ne pas bloquer l'UI
      }
    }
    void load()
    return () => { cancelled = true }
  }, [mounted, authLoading, user?.id])

  // Empêche le scroll du body lorsque le modal est ouvert
  useEffect(() => {
    if (!news) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [news])

  const handleDismiss = useCallback(async () => {
    if (!news) return
    setDismissing(true)
    const cache = readDismissedCache()
    cache.add(news.id)
    writeDismissedCache(cache)
    try {
      await fetch(`/api/news/${news.id}/dismiss`, { method: "POST" })
    } catch {
      // même en cas d'échec, on ferme — le cache local évite la réapparition
    } finally {
      setDismissing(false)
      setNews(null)
    }
  }, [news])

  if (!news) return null

  const firstName = (user?.name || "").split(" ")[0] || ""
  const greeting = firstName ? `Bonjour ${firstName},` : "Bonjour,"

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-title"
    >
      {/* Fond flouté (les côtés sont floutés comme demandé) */}
      <div className="absolute inset-0 bg-black/35 dark:bg-black/55 backdrop-blur-md" />

      {/* Carte */}
      <div className="relative w-full max-w-[560px] max-h-[90vh] flex flex-col bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] rounded-2xl shadow-2xl shadow-black/25 dark:shadow-black/60 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Bande décorative haute */}
        <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />

        {/* Bouton fermer discret */}
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition z-10"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* En-tête : logo + badge */}
        <div className="px-6 pt-7 pb-2 flex items-center gap-3">
          <div className="relative h-12 w-12 flex-shrink-0">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/70 via-white/30 to-transparent dark:from-white/15 dark:via-white/10 dark:to-transparent" />
            <Image
              src="/Go-Data.svg"
              alt="Go-Data"
              fill
              sizes="48px"
              className="relative object-contain drop-shadow-sm"
              style={{
                WebkitMaskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                maskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-3 w-3" />
              Nouveautés
            </span>
            <h2
              id="announcement-title"
              className="mt-1.5 text-xl sm:text-2xl font-bold text-[var(--color-text-primary)] leading-tight"
            >
              {news.title}
            </h2>
          </div>
        </div>

        {/* Corps scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-base font-medium text-[var(--color-text-primary)] mb-1">{greeting}</p>
          <div className="text-[14px]">
            {renderMarkdown(news.body_md)}
          </div>
        </div>

        {/* Pied signature + action */}
        <div className="px-6 py-4 border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]/40 flex items-center justify-between gap-3">
          <div className="text-[11px] text-[var(--color-text-tertiary)] leading-tight">
            Message envoyé par Maverick Menard<br className="hidden sm:block" />
            <span className="hidden sm:inline">— </span>fondateur Go-Data
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissing}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:translate-y-0 transition-all"
          >
            {dismissing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Compris
          </button>
        </div>
      </div>
    </div>
  )
}
