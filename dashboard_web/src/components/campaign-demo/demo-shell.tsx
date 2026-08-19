"use client"

/**
 * Chrome du dashboard reproduit à l'identique pour les pages démo
 * (/falardeau, /smsport) : TopNav à catégories avec méga-menu, tab bar
 * mobile, layout et fond réels. Différences avec le vrai shell :
 *   - aucune auth ni requête compte (visiteur anonyme) ;
 *   - les 4 sections disponibles naviguent DANS la page (state) au lieu de
 *     router vers /dashboard/* ;
 *   - les autres outils sont visibles mais « Compte requis » (les items
 *     « Bientôt » du vrai site gardent leur badge d'origine) ;
 *   - un bandeau fin au-dessus identifie la démo et porte le CTA.
 */

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { createPortal } from "react-dom"
import {
  ArrowRight, ChevronDown, ChevronRight, CircleDollarSign, ClipboardList,
  Home, Lock, Menu, Radar, User, X, BarChart2,
} from "lucide-react"

import { NAV_CATEGORIES, type NavLink } from "@/components/kokonutui/top-nav"
import { useLanguage } from "@/contexts/language-context"
import { cn } from "@/lib/utils"

export type DemoSectionId = "surveillance" | "analyse" | "strategie" | "fiches"

// Routes du vrai dashboard disponibles dans la démo → section interne.
const SECTION_BY_HREF: Record<string, DemoSectionId> = {
  "/dashboard/surveillance": "surveillance",
  "/dashboard/analytics": "analyse",
  "/dashboard/strategie-pricing": "strategie",
  "/dashboard/changements": "fiches",
}

const CATEGORY_BY_SECTION: Record<DemoSectionId, string> = {
  surveillance: "prix",
  analyse: "analyse",
  strategie: "prix",
  fiches: "prix",
}

const BREADCRUMB_LABELS: Record<DemoSectionId, string> = {
  surveillance: "Surveillance",
  analyse: "Analyse",
  strategie: "Stratégie de pricing",
  fiches: "Changements à appliquer",
}

interface DemoNavProps {
  section: DemoSectionId
  onNavigate: (section: DemoSectionId) => void
  signupHref: string
  contactName: string
}

// ─── Layout (copie de kokonutui/layout.tsx, widgets compte exclus) ────

export default function DemoLayout({
  section, onNavigate, signupHref, contactName, dealerName, children,
}: DemoNavProps & { dealerName: string; children: ReactNode }) {
  // Contrairement au Layout du dashboard, pas de garde « mounted » : le
  // thème vient de la classe posée sur <html> par le ThemeProvider racine,
  // et la page doit être rendue côté serveur (lien ouvert depuis un
  // courriel — le contenu ne peut pas attendre l'hydratation).
  return (
    <div className="min-h-screen flex flex-col">
      {/* Bandeau démo : seul élément absent du vrai site — identifie la
          page privée et porte le CTA d'activation. */}
      <div className="flex items-center justify-between gap-3 border-b border-orange-200/70 bg-orange-50 px-3 py-1.5 text-[12px] dark:border-orange-500/20 dark:bg-orange-500/10 sm:px-6">
        <span className="truncate font-medium text-orange-800 dark:text-orange-300">
          Démo privée · préparée pour {contactName} ({dealerName}) — données réelles de votre marché
        </span>
        <Link
          href={signupHref}
          className="inline-flex shrink-0 items-center gap-1 font-semibold text-orange-700 hover:underline dark:text-orange-300"
        >
          Activer l&apos;accès complet
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <header className="h-16 border-b border-[var(--color-border-secondary)]">
        <DemoTopNav section={section} onNavigate={onNavigate} signupHref={signupHref} contactName={contactName} />
      </header>
      <main className="flex-1 overflow-auto p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6 background-template">
        <div className="w-full max-w-[1800px] mx-auto">
          <DemoBreadcrumbs section={section} />
          {children}
        </div>
      </main>
      <DemoMobileTabBar section={section} onNavigate={onNavigate} />
    </div>
  )
}

// ─── Breadcrumbs (mêmes classes que components/breadcrumbs.tsx) ───────

function DemoBreadcrumbs({ section }: { section: DemoSectionId }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm mb-6 animate-in fade-in duration-300">
      <span className="flex items-center gap-1.5">
        <Home className="h-3.5 w-3.5 text-[var(--color-text-secondary)] mr-0.5" />
        <span className="text-[var(--color-text-secondary)]">Dashboard</span>
      </span>
      <span className="flex items-center gap-1.5">
        <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
        <span className="font-medium text-[var(--color-text-primary)]">{BREADCRUMB_LABELS[section]}</span>
      </span>
    </nav>
  )
}

// ─── TopNav (copie de kokonutui/top-nav.tsx, sans auth) ───────────────

function DemoTopNav({ section, onNavigate, signupHref, contactName }: DemoNavProps) {
  const { t } = useLanguage()
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const navRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!openCategory) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCategory(null)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [openCategory])

  const activeCategory = CATEGORY_BY_SECTION[section]

  const navigate = (target: DemoSectionId) => {
    setOpenCategory(null)
    onNavigate(target)
  }

  return (
    <>
      <nav
        ref={navRef}
        className="px-3 sm:px-6 flex items-center justify-between bg-[var(--color-background-primary)] border-b border-[var(--color-border-secondary)] h-full relative z-[60]"
      >
        <button
          type="button"
          onClick={() => navigate("surveillance")}
          className="flex items-center hover:opacity-90 transition-opacity"
        >
          <span className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">GO-DATA</span>
        </button>

        <div className="hidden sm:flex flex-1 justify-center min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap">
            {NAV_CATEGORIES.map(category => {
              const isOpen = openCategory === category.id
              const isActive = activeCategory === category.id
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setOpenCategory(prev => (prev === category.id ? null : category.id))}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  className={cn(
                    "group relative flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors focus:outline-none rounded-md",
                    isOpen
                      ? "text-[var(--color-text-primary)] font-semibold bg-[var(--color-background-hover)]"
                      : isActive
                        ? "text-[var(--color-text-primary)] font-semibold"
                        : "text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)]"
                  )}
                >
                  <span>{t(category.labelKey)}</span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      isOpen ? "rotate-180 opacity-90" : "opacity-50 group-hover:opacity-80"
                    )}
                  />
                  <span
                    className={cn(
                      "absolute bottom-0 left-2 right-2 h-[2px] rounded-full transition-all duration-200 pointer-events-none",
                      isActive || isOpen
                        ? "opacity-100 bg-orange-600 dark:bg-orange-400"
                        : "opacity-0 group-hover:opacity-30 group-hover:bg-gray-300 dark:group-hover:bg-gray-600"
                    )}
                  />
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:ml-0">
          <Link
            href={signupHref}
            className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-orange-600 text-white text-xs font-semibold transition hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
          >
            Activer l&apos;accès complet
          </Link>
          <div
            title={`Démo — ${contactName}`}
            className="flex items-center justify-center w-8 h-8 rounded-full ring-2 ring-[var(--color-border-secondary)] overflow-hidden"
          >
            <User className="h-5 w-5 text-[var(--color-text-secondary)]" />
          </div>
        </div>
      </nav>

      {mounted && openCategory &&
        createPortal(
          <div
            className="fixed inset-x-0 top-16 bottom-0 z-50 animate-in fade-in duration-150"
            role="presentation"
          >
            <button
              type="button"
              aria-label={t("nav.closeMenu")}
              onClick={() => setOpenCategory(null)}
              className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-md cursor-default"
            />
            <div className="relative bg-[var(--color-background-primary)] border-b border-[var(--color-border-secondary)] shadow-2xl animate-in slide-in-from-top-2 duration-200">
              <div className="max-w-[1800px] mx-auto px-3 sm:px-6 py-6">
                <div className="grid gap-6 grid-cols-2 md:grid-cols-4">
                  {NAV_CATEGORIES.map(category => {
                    const isHighlighted = openCategory === category.id
                    return (
                      <div
                        key={category.id}
                        className={cn(
                          "rounded-xl p-4 transition",
                          isHighlighted
                            ? "bg-orange-50/60 dark:bg-orange-500/5 ring-1 ring-orange-500/20"
                            : ""
                        )}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-lg",
                              isHighlighted
                                ? "bg-orange-500 text-white"
                                : "bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]"
                            )}
                          >
                            <category.icon className="h-3.5 w-3.5" />
                          </div>
                          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
                            {t(category.labelKey)}
                          </h3>
                        </div>
                        <ul className="flex flex-col gap-0.5">
                          {category.items.map(item => (
                            <DemoMenuItem key={item.id} item={item} onNavigate={navigate} />
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/** Item du méga-menu : mêmes classes que le vrai TopNav. Disponible →
    bascule de section ; « Bientôt » du vrai site inchangé ; le reste →
    badge « Compte requis ». */
function DemoMenuItem({ item, onNavigate }: { item: NavLink; onNavigate: (s: DemoSectionId) => void }) {
  const { t } = useLanguage()
  const target = item.href ? SECTION_BY_HREF[item.href] : undefined
  const available = target !== undefined

  const content = (
    <span
      className={cn(
        "flex items-start gap-2.5 px-2 py-2 rounded-lg transition",
        available
          ? "hover:bg-[var(--color-background-hover)] cursor-pointer"
          : "cursor-not-allowed opacity-70"
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 mt-0.5 shrink-0 items-center justify-center rounded-md",
          available ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]"
        )}
      >
        <item.icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-sm font-semibold truncate",
              available ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
            )}
          >
            {t(item.labelKey)}
          </span>
          {item.locked && (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <Lock className="h-2.5 w-2.5" />
              {t("topnav.badge.comingSoon")}
            </span>
          )}
          {!item.locked && !available && (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[9px] font-semibold text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300">
              <Lock className="h-2.5 w-2.5" />
              Compte requis
            </span>
          )}
        </span>
        {item.descriptionKey && (
          <span className="mt-0.5 block text-[11px] text-[var(--color-text-secondary)] leading-snug">
            {t(item.descriptionKey)}
          </span>
        )}
      </span>
    </span>
  )

  return (
    <li>
      {available ? (
        <button type="button" onClick={() => onNavigate(target!)} className="block w-full text-left">
          {content}
        </button>
      ) : (
        <span className="block">{content}</span>
      )}
    </li>
  )
}

// ─── Tab bar mobile (copie de kokonutui/mobile-tab-bar.tsx) ───────────

const DEMO_TABS: Array<{ id: DemoSectionId; label: string; icon: typeof Radar }> = [
  { id: "surveillance", label: "Prix", icon: Radar },
  { id: "analyse", label: "Analyse", icon: BarChart2 },
  { id: "strategie", label: "Stratégie", icon: CircleDollarSign },
  { id: "fiches", label: "Fiches", icon: ClipboardList },
]

function DemoMobileTabBar({ section, onNavigate }: { section: DemoSectionId; onNavigate: (s: DemoSectionId) => void }) {
  const { t } = useLanguage()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [menuOpen])

  const navigate = (target: DemoSectionId) => {
    setMenuOpen(false)
    onNavigate(target)
  }

  return (
    <>
      <nav
        aria-label="Navigation mobile"
        className="sm:hidden fixed inset-x-0 bottom-0 z-[65] border-t border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex h-14 items-stretch">
          {DEMO_TABS.map(tab => {
            const Icon = tab.icon
            const active = section === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigate(tab.id)}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  active ? "text-orange-600 dark:text-orange-400" : "text-[var(--color-text-secondary)]"
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                <span className="truncate max-w-[72px]">{tab.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              menuOpen ? "text-orange-600 dark:text-orange-400" : "text-[var(--color-text-secondary)]"
            )}
          >
            <Menu className="h-5 w-5" />
            <span>Menu</span>
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="sm:hidden fixed inset-0 z-[70]">
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] pb-[calc(1rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-4 duration-200">
            <div className="sticky top-0 flex items-center justify-between bg-[var(--color-background-primary)] px-5 pt-4 pb-2">
              <span className="text-sm font-bold text-[var(--color-text-primary)]">Menu</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Fermer"
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-[var(--color-background-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {NAV_CATEGORIES.map(cat => (
              <div key={cat.id} className="px-3 pt-2 pb-1">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {t(cat.labelKey)}
                </p>
                <div className="space-y-0.5">
                  {cat.items.map(item => {
                    const Icon = item.icon
                    const target = item.href ? SECTION_BY_HREF[item.href] : undefined
                    if (target === undefined) {
                      return (
                        <span
                          key={item.id}
                          className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-[var(--color-text-secondary)] opacity-50"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate">{t(item.labelKey)}</span>
                          <Lock className="h-3 w-3 shrink-0" />
                        </span>
                      )
                    }
                    const active = section === target
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(target)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors",
                          active
                            ? "bg-orange-50 font-semibold text-orange-700 dark:bg-orange-400/10 dark:text-orange-300"
                            : "text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-orange-600 dark:text-orange-400" : "text-[var(--color-text-secondary)]")} />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
