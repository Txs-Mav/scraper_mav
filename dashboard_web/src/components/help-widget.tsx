"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  HelpCircle,
  X,
  BookOpen,
  Mail,
  ChevronRight,
  Megaphone,
} from "lucide-react"

interface HelpItem {
  icon: React.ElementType
  label: string
  description: string
  action: () => void
  color: string
  badge?: number | null
}

export default function HelpWidget() {
  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const router = useRouter()

  // Chargement léger pour afficher le badge (non-lues)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/news?limit=20", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setUnreadCount(typeof data?.unread_count === "number" ? data.unread_count : 0)
      } catch {
        // silencieux
      }
    })()
    return () => { cancelled = true }
  }, [])

  const items: HelpItem[] = [
    {
      icon: Megaphone,
      label: "Nouvelles",
      description: unreadCount > 0 ? `${unreadCount} nouvelle${unreadCount > 1 ? "s" : ""} à découvrir` : "Feed complet des annonces Go-Data",
      action: () => {
        setOpen(false)
        router.push("/dashboard/news")
      },
      color: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30",
      badge: unreadCount > 0 ? unreadCount : null,
    },
    {
      icon: BookOpen,
      label: "Guide & Tutoriel",
      description: "Revoir les étapes de démarrage",
      action: () => {
        setOpen(false)
        window.dispatchEvent(new CustomEvent("restart-onboarding"))
      },
      color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
    },
    {
      icon: Mail,
      label: "Nous contacter",
      description: "gestion@go-data.co",
      action: () => window.open("mailto:gestion@go-data.co"),
      color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
    },
  ]

  return (
    <>
      {/* Bouton flottant */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 left-6 z-50 p-3.5 rounded-full shadow-lg transition-all duration-200 ${
          open
            ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-gray-900/20 rotate-90"
            : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border-secondary)] hover:shadow-xl hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-700"
        }`}
      >
        {open ? <X className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold ring-2 ring-[var(--color-background-primary)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Panneau */}
      {open && (
        <div className="fixed bottom-20 left-6 z-50 w-72 bg-[var(--color-background-primary)] rounded-2xl shadow-2xl shadow-black/15 dark:shadow-black/40 border border-[var(--color-border-secondary)] overflow-hidden animate-in slide-in-from-bottom-3 fade-in duration-200">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Aide & Support</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Comment pouvons-nous vous aider ?</p>
          </div>

          <div className="px-3 pb-3 space-y-1">
            {items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.action}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-[var(--color-background-hover)] transition-colors group"
                >
                  <div className={`p-2 rounded-xl ${item.color} flex-shrink-0 relative`}>
                    <Icon className="h-4 w-4" />
                    {item.badge ? (
                      <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold ring-2 ring-[var(--color-background-primary)]">
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{item.label}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] truncate">{item.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 flex-shrink-0 transition" />
                </button>
              )
            })}
          </div>

          <div className="px-5 py-3 border-t border-[var(--color-border-tertiary)]">
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              Raccourci : <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-white/[0.06] font-mono text-[10px]">⌘K</kbd> pour chercher
            </p>
          </div>
        </div>
      )}
    </>
  )
}
