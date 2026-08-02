"use client"

import { useState, useEffect, useRef, useCallback } from "react"
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

// Le bouton est déplaçable (drag) : position = centre du bouton, mémorisée
// par appareil. null = position CSS par défaut (bas-gauche).
const POS_STORAGE_KEY = "help-widget-pos"
const BTN_HALF = 26 // ~moitié du bouton (p-3.5 + icône h-5 ≈ 52px)

function clampToViewport(p: { x: number; y: number }) {
  return {
    x: Math.min(Math.max(p.x, BTN_HALF + 4), window.innerWidth - BTN_HALF - 4),
    y: Math.min(Math.max(p.y, BTN_HALF + 4), window.innerHeight - BTN_HALF - 4),
  }
}

export default function HelpWidget() {
  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const router = useRouter()

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    origin: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_STORAGE_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        if (typeof p?.x === "number" && typeof p?.y === "number") setPos(clampToViewport(p))
      }
    } catch { /* position par défaut */ }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      moved: false,
    }
    btnRef.current?.setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved && dx * dx + dy * dy < 36) return
    drag.moved = true
    setPos(clampToViewport({ x: drag.origin.x + dx, y: drag.origin.y + dy }))
  }, [])

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.moved) {
      // Le click qui suit un drag ne doit pas ouvrir le panneau.
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 0)
      setPos(current => {
        if (current) {
          try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(current)) } catch { /* plein */ }
        }
        return current
      })
    }
  }, [])

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
      color: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30",
    },
    {
      icon: Mail,
      label: "Nous contacter",
      description: "gestion@go-data.co",
      action: () => window.open("mailto:gestion@go-data.co"),
      color: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30",
    },
  ]

  return (
    <>
      {/* Bouton flottant — déplaçable (drag) ; un simple clic ouvre le panneau */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => { if (!suppressClickRef.current) setOpen(!open) }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title="Aide — glissez pour déplacer"
        style={pos ? { left: pos.x - BTN_HALF, top: pos.y - BTN_HALF, right: "auto", bottom: "auto" } : undefined}
        className={`fixed z-50 p-3.5 rounded-full shadow-lg transition-colors duration-200 touch-none cursor-grab active:cursor-grabbing ${
          pos ? "" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-4 sm:bottom-6 sm:left-6"
        } ${
          open
            ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-gray-900/20 rotate-90"
            : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border-secondary)] hover:shadow-xl hover:border-gray-300 dark:hover:border-gray-700"
        }`}
      >
        {open ? <X className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold ring-2 ring-[var(--color-background-primary)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Panneau — suit le bouton quand il a été déplacé */}
      {open && (
        <div
          style={pos ? (() => {
            const isDesktop = window.innerWidth >= 640
            const bottom = Math.max(16, window.innerHeight - pos.y + BTN_HALF + 12)
            if (!isDesktop) return { bottom, left: 16, right: 16 }
            return pos.x > window.innerWidth / 2
              ? { bottom, right: Math.max(16, window.innerWidth - pos.x - BTN_HALF), left: "auto" }
              : { bottom, left: Math.max(16, pos.x - BTN_HALF), right: "auto" }
          })() : undefined}
          className={`fixed z-50 w-auto sm:w-72 bg-[var(--color-background-primary)] rounded-2xl shadow-2xl shadow-black/15 dark:shadow-black/40 border border-[var(--color-border-secondary)] overflow-hidden animate-in slide-in-from-bottom-3 fade-in duration-200 ${
            pos ? "" : "bottom-[calc(8rem+env(safe-area-inset-bottom))] left-4 right-4 sm:bottom-20 sm:left-6 sm:right-auto"
          }`}>
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
