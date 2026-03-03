"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  Home,
  BarChart2,
  Bell,
  CreditCard,
  Settings,
  User,
  Zap,
  Download,
  ExternalLink,
  ArrowRight,
  Command,
} from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { canAccessAnalytics, canAccessOrganisation } from "@/lib/plan-restrictions"

interface SearchItem {
  id: string
  label: string
  description?: string
  icon: React.ElementType
  action: () => void
  category: "page" | "action"
  keywords?: string[]
}

export default function CommandSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { user } = useAuth()

  const plan = user?.subscription_plan ?? "standard"
  const subscriptionSource = user?.subscription_source || (user?.promo_code_id ? "promo" : null)

  const items: SearchItem[] = [
    { id: "dashboard", label: "Dashboard", description: "Vue principale et scraping", icon: Home, action: () => router.push("/dashboard"), category: "page", keywords: ["accueil", "home", "scraper", "produits"] },
    ...(canAccessAnalytics(plan, subscriptionSource)
      ? [{ id: "analytics", label: "Analyse", description: "Analytiques et insights", icon: BarChart2, action: () => router.push("/dashboard/analytics"), category: "page" as const, keywords: ["analytics", "graphiques", "prix", "stats"] }]
      : []),
    ...(canAccessOrganisation(plan, subscriptionSource)
      ? [{ id: "alertes", label: "Alertes", description: "Alertes de prix", icon: Bell, action: () => router.push("/dashboard/alerte"), category: "page" as const, keywords: ["alert", "notification", "prix"] }]
      : []),
    { id: "payments", label: "Paiements", description: "Abonnement et facturation", icon: CreditCard, action: () => router.push("/dashboard/payments"), category: "page", keywords: ["abonnement", "plan", "facture", "stripe", "pro"] },
    { id: "profile", label: "Profil", description: "Votre profil", icon: User, action: () => router.push("/dashboard/profile"), category: "page", keywords: ["compte", "avatar", "photo"] },
    { id: "settings", label: "Paramètres", description: "Paramètres du compte", icon: Settings, action: () => router.push("/dashboard/settings"), category: "page", keywords: ["réglages", "mot de passe", "email"] },
    { id: "scrape", label: "Lancer un scraping", description: "Démarrer une extraction de données", icon: Zap, action: () => { router.push("/dashboard"); setTimeout(() => window.dispatchEvent(new CustomEvent("open-scraper-config")), 300) }, category: "action", keywords: ["scraper", "extraction", "lancer", "démarrer"] },
    { id: "export", label: "Exporter les données", description: "Télécharger vos données", icon: Download, action: () => router.push("/dashboard/settings"), category: "action", keywords: ["export", "télécharger", "json", "csv"] },
    { id: "stripe", label: "Portail Stripe", description: "Gérer facturation et abonnement", icon: ExternalLink, action: async () => { try { const r = await fetch("/api/stripe/portal", { method: "POST" }); const d = await r.json(); if (r.ok && d.url) window.location.href = d.url } catch {} }, category: "action", keywords: ["stripe", "facture", "paiement"] },
  ]

  const filtered = query.trim()
    ? items.filter((item) => {
        const q = query.toLowerCase()
        return (
          item.label.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.keywords?.some((k) => k.includes(q))
        )
      })
    : items

  const pages = filtered.filter((i) => i.category === "page")
  const actions = filtered.filter((i) => i.category === "action")
  const allFiltered = [...pages, ...actions]

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
        setQuery("")
        setSelectedIndex(0)
      }
      if (!open) return
      if (e.key === "Escape") {
        setOpen(false)
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, allFiltered.length - 1))
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      }
      if (e.key === "Enter" && allFiltered[selectedIndex]) {
        e.preventDefault()
        allFiltered[selectedIndex].action()
        setOpen(false)
      }
    },
    [open, allFiltered, selectedIndex]
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-start justify-center pt-[15vh] px-4"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="w-full max-w-lg bg-white dark:bg-[#111114] rounded-2xl shadow-2xl shadow-black/20 border border-gray-200 dark:border-gray-800 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <Search className="h-5 w-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une page ou action..."
            className="flex-1 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-white/[0.06] text-[11px] font-medium text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {allFiltered.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <Search className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Aucun résultat pour &quot;{query}&quot;</p>
            </div>
          ) : (
            <>
              {pages.length > 0 && (
                <div className="px-3 pt-2 pb-1">
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Pages
                  </p>
                </div>
              )}
              {pages.map((item, idx) => {
                const Icon = item.icon
                const globalIdx = idx
                return (
                  <button
                    key={item.id}
                    data-index={globalIdx}
                    type="button"
                    onClick={() => { item.action(); setOpen(false) }}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
                      selectedIndex === globalIdx
                        ? "bg-blue-50 dark:bg-blue-950/30"
                        : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className={`p-2 rounded-xl ${
                      selectedIndex === globalIdx
                        ? "bg-blue-100 dark:bg-blue-900/40"
                        : "bg-gray-100 dark:bg-white/[0.06]"
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        selectedIndex === globalIdx
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-gray-500 dark:text-gray-400"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{item.label}</p>
                      {item.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.description}</p>
                      )}
                    </div>
                    {selectedIndex === globalIdx && (
                      <ArrowRight className="h-4 w-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                    )}
                  </button>
                )
              })}

              {actions.length > 0 && (
                <div className="px-3 pt-3 pb-1">
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Actions
                  </p>
                </div>
              )}
              {actions.map((item, idx) => {
                const Icon = item.icon
                const globalIdx = pages.length + idx
                return (
                  <button
                    key={item.id}
                    data-index={globalIdx}
                    type="button"
                    onClick={() => { item.action(); setOpen(false) }}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
                      selectedIndex === globalIdx
                        ? "bg-blue-50 dark:bg-blue-950/30"
                        : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className={`p-2 rounded-xl ${
                      selectedIndex === globalIdx
                        ? "bg-blue-100 dark:bg-blue-900/40"
                        : "bg-gray-100 dark:bg-white/[0.06]"
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        selectedIndex === globalIdx
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-gray-500 dark:text-gray-400"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{item.label}</p>
                      {item.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.description}</p>
                      )}
                    </div>
                    {selectedIndex === globalIdx && (
                      <ArrowRight className="h-4 w-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-white/[0.02]">
          <div className="flex items-center gap-3 text-[11px] text-gray-400">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-white/[0.08] font-mono">↑↓</kbd>
              naviguer
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-white/[0.08] font-mono">↵</kbd>
              sélectionner
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <Command className="h-3 w-3" />
            <span>K</span>
          </div>
        </div>
      </div>
    </div>
  )
}
