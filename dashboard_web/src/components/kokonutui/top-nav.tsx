"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  User,
  BarChart2,
  CreditCard,
  Activity,
  ChevronDown,
  LayoutGrid,
  Radar,
  Search,
  Lock,
  KeyRound,
  Webhook,
  Boxes,
  Users,
  FileBarChart,
  HelpCircle,
  Map,
  CircleDollarSign,
  ClipboardList,
  Sparkles,
  Bell,
  Tag,
  Package,
  type LucideIcon,
} from "lucide-react"

import Profile01 from "./profile-01"
import { useLanguage } from "@/contexts/language-context"
import { useAuth } from "@/contexts/auth-context"
import { getDashboardCapabilities } from "@/lib/account-navigation"
import { cn } from "@/lib/utils"
import { canAccessAnalytics, canAccessOrganisation } from "@/lib/plan-restrictions"

type NavLink = {
  id: string
  label: string
  description?: string
  href?: string
  icon: LucideIcon
  locked?: boolean
  requiresPaid?: boolean
  badgeKey?: "pendingChanges"
}

type NavCategory = {
  id: string
  label: string
  description: string
  icon: LucideIcon
  items: NavLink[]
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    id: "prix",
    label: "Prix",
    description: "Stratégie et changements",
    icon: Tag,
    items: [
      { id: "strategie", label: "Stratégie de pricing", description: "La règle qui calcule vos prix", href: "/dashboard/strategie-pricing", icon: CircleDollarSign },
      { id: "changements", label: "Changements à appliquer", description: "Vos fiches de changements", href: "/dashboard/changements", icon: ClipboardList, badgeKey: "pendingChanges" },
      { id: "comparaisons-prix", label: "Comparaisons", description: "Tableau des prix concurrents", href: "/dashboard/comparaisons", icon: LayoutGrid },
      { id: "surveillance-prix", label: "Surveillance", description: "Suivi quotidien", href: "/dashboard/surveillance", icon: Radar },
    ],
  },
  {
    id: "produits",
    label: "Produits",
    description: "Catalogue et recherche",
    icon: Package,
    items: [
      { id: "recherche", label: "Recherche", description: "Trouver un produit précis", icon: Search, locked: true },
      { id: "catalogue", label: "Catalogue", description: "Inventaire et stock", icon: Boxes, locked: true },
    ],
  },
  {
    id: "analyse",
    label: "Analyse",
    description: "Performance et rapports",
    icon: BarChart2,
    items: [
      { id: "analytics", label: "Vue d'ensemble", description: "Indicateurs de marché", href: "/dashboard/analytics", icon: BarChart2, requiresPaid: true },
      { id: "alertes", label: "Alertes prix", description: "Configurer les alertes", href: "/dashboard/alerte", icon: Bell, requiresPaid: true },
      { id: "rapports", label: "Rapports", description: "Exports et synthèses", icon: FileBarChart, locked: true },
    ],
  },
  {
    id: "compte",
    label: "Compte",
    description: "Paiements, équipe, support",
    icon: User,
    items: [
      { id: "paiements", label: "Paiements", description: "Abonnement et factures", href: "/dashboard/payments", icon: CreditCard },
      { id: "equipe", label: "Équipe", description: "Membres et rôles", icon: Users, locked: true },
      { id: "marketplace", label: "Marketplace", description: "Intégrations partenaires", icon: Boxes, locked: true },
      { id: "aide", label: "Aide", description: "Centre d'aide & support", href: "/dashboard/help", icon: HelpCircle },
      { id: "roadmap", label: "Roadmap", description: "Ce que nous préparons", icon: Map, locked: true },
    ],
  },
]

function categoryForPath(pathname: string | null): string | null {
  if (!pathname) return null
  if (pathname.startsWith("/dashboard/strategie-pricing")) return "prix"
  if (pathname.startsWith("/dashboard/changements")) return "prix"
  if (pathname.startsWith("/dashboard/comparaisons")) return "prix"
  if (pathname.startsWith("/dashboard/surveillance")) return "prix"
  if (pathname.startsWith("/dashboard/analytics")) return "analyse"
  if (pathname.startsWith("/dashboard/alerte")) return "analyse"
  if (pathname.startsWith("/dashboard/payments")) return "compte"
  if (pathname.startsWith("/dashboard/help")) return "compte"
  return null
}

export default function TopNav() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const pathname = usePathname()
  const plan = user?.subscription_plan ?? "standard"
  const subscriptionSource = user?.subscription_source || (user?.promo_code_id ? "promo" : null)
  const capabilities = getDashboardCapabilities(user?.business_type)

  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [pendingChangesCount, setPendingChangesCount] = useState<number>(0)
  const [mounted, setMounted] = useState(false)
  const navRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setOpenCategory(null)
  }, [pathname])

  useEffect(() => {
    if (!openCategory) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCategory(null)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [openCategory])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const fetchCount = async () => {
      try {
        const res = await fetch("/api/pricing/change-sheets?status=pending", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && typeof data?.pendingCount === "number") {
          setPendingChangesCount(data.pendingCount)
        }
      } catch {
        /* ignore */
      }
    }

    void fetchCount()
    const interval = setInterval(fetchCount, 60000)
    const onFocus = () => void fetchCount()
    window.addEventListener("focus", onFocus)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
    }
  }, [user, pathname])

  const activeCategoryFromPath = useMemo(() => categoryForPath(pathname), [pathname])

  const displayedCategories = useMemo(() => {
    if (capabilities.showDeveloperTools) return NAV_CATEGORIES
    return NAV_CATEGORIES
  }, [capabilities])

  const accessibleHref = (link: NavLink): string | null => {
    if (link.locked) return null
    if (!link.href) return null
    if (!link.requiresPaid) return link.href
    if (link.href === "/dashboard/analytics") {
      return canAccessAnalytics(plan, subscriptionSource) ? link.href : null
    }
    if (link.href === "/dashboard/alerte") {
      return canAccessOrganisation(plan, subscriptionSource) ? link.href : null
    }
    return link.href
  }

  const badgeFor = (link: NavLink): number | null => {
    if (link.badgeKey === "pendingChanges" && pendingChangesCount > 0) return pendingChangesCount
    return null
  }

  const developerLinks =
    capabilities.showDeveloperTools
      ? [
          { href: "/dashboard/api-keys", label: "API", icon: KeyRound },
          { href: "/dashboard/webhooks", label: "Webhooks", icon: Webhook },
          { href: "/dashboard/integrations", label: "Intégrations", icon: Boxes },
        ]
      : []

  const handleCategoryClick = (id: string) => {
    setOpenCategory(prev => (prev === id ? null : id))
  }

  return (
    <>
      <nav
        ref={navRef}
        className="px-3 sm:px-6 flex items-center justify-between bg-[var(--color-background-primary)] border-b border-[var(--color-border-secondary)] h-full relative z-[60]"
      >
        <Link href="/dashboard" className="flex items-center hover:opacity-90 transition-opacity">
          <span className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">GO-DATA</span>
        </Link>

        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-1 sm:gap-1.5">
            {displayedCategories.map(category => {
              const isOpen = openCategory === category.id
              const isActive = activeCategoryFromPath === category.id

              const categoryPendingBadge = category.id === "prix" && pendingChangesCount > 0 ? pendingChangesCount : null

              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => handleCategoryClick(category.id)}
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
                  <span>{category.label}</span>
                  {categoryPendingBadge !== null && (
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold tabular-nums">
                      {categoryPendingBadge > 99 ? "99+" : categoryPendingBadge}
                    </span>
                  )}
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
                        ? "opacity-100 bg-emerald-600 dark:bg-emerald-400"
                        : "opacity-0 group-hover:opacity-30 group-hover:bg-gray-300 dark:group-hover:bg-gray-600"
                    )}
                  />
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:ml-0">
          {developerLinks.length > 0 && (
            <div className="hidden xl:flex items-center gap-1">
              {developerLinks.map(link => {
                const Icon = link.icon
                const isExact = pathname?.startsWith(link.href)
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors",
                      isExact
                        ? "text-[var(--color-text-primary)] bg-[var(--color-background-hover)] font-semibold"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{link.label}</span>
                  </Link>
                )
              })}
            </div>
          )}

          {pendingChangesCount > 0 && (
            <Link
              href="/dashboard/changements"
              className="hidden md:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
              aria-label="Changements à appliquer"
              title="Changements à appliquer"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              <span className="tabular-nums">{pendingChangesCount > 99 ? "99+" : pendingChangesCount}</span>
            </Link>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger className="focus:outline-none">
              <div className="flex items-center justify-center w-8 h-8 rounded-full ring-2 ring-[var(--color-border-secondary)] cursor-pointer hover:bg-[var(--color-background-hover)] transition-colors overflow-hidden">
                {user?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatar_url} alt={user.name || "avatar"} className="w-full h-full object-cover" />
                ) : (
                  <User className="h-5 w-5 text-[var(--color-text-secondary)]" />
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-[280px] sm:w-80 bg-background border-border rounded-lg shadow-lg"
            >
              <Profile01
                avatar=""
                name={user?.name || t("profile.user")}
                role={
                  user?.role === "main"
                    ? t("profile.mainAccount")
                    : user?.role === "employee"
                      ? t("profile.employee")
                      : t("profile.visitor")
                }
                subscription={
                  user?.subscription_plan === "standard"
                    ? t("profile.free")
                    : user?.subscription_plan === "pro"
                      ? "Pro"
                      : user?.subscription_plan === "ultime"
                        ? "Ultime"
                        : t("profile.free")
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
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
              aria-label="Fermer le menu"
              onClick={() => setOpenCategory(null)}
              className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-md cursor-default"
            />
            <div className="relative bg-[var(--color-background-primary)] border-b border-[var(--color-border-secondary)] shadow-2xl animate-in slide-in-from-top-2 duration-200">
              <div className="max-w-[1800px] mx-auto px-3 sm:px-6 py-6">
                <div className="grid gap-6 grid-cols-2 md:grid-cols-4">
                  {displayedCategories.map(category => {
                    const isHighlighted = openCategory === category.id
                    return (
                      <div
                        key={category.id}
                        className={cn(
                          "rounded-xl p-4 transition",
                          isHighlighted
                            ? "bg-emerald-50/60 dark:bg-emerald-500/5 ring-1 ring-emerald-500/20"
                            : ""
                        )}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-lg",
                              isHighlighted
                                ? "bg-emerald-500 text-white"
                                : "bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]"
                            )}
                          >
                            <category.icon className="h-3.5 w-3.5" />
                          </div>
                          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
                            {category.label}
                          </h3>
                        </div>
                        <ul className="flex flex-col gap-0.5">
                          {category.items.map(item => {
                            const Icon = item.icon
                            const href = accessibleHref(item)
                            const badge = badgeFor(item)
                            const restricted = item.requiresPaid && !href

                            const content = (
                              <span
                                className={cn(
                                  "flex items-start gap-2.5 px-2 py-2 rounded-lg transition",
                                  href
                                    ? "hover:bg-[var(--color-background-hover)] cursor-pointer"
                                    : "cursor-not-allowed opacity-70"
                                )}
                              >
                                <span
                                  className={cn(
                                    "flex h-6 w-6 mt-0.5 shrink-0 items-center justify-center rounded-md",
                                    href
                                      ? "text-[var(--color-text-primary)]"
                                      : "text-[var(--color-text-tertiary)]"
                                  )}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5">
                                    <span
                                      className={cn(
                                        "text-sm font-semibold truncate",
                                        href ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
                                      )}
                                    >
                                      {item.label}
                                    </span>
                                    {badge !== null && (
                                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold tabular-nums">
                                        {badge > 99 ? "99+" : badge}
                                      </span>
                                    )}
                                    {item.locked && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                                        <Lock className="h-2.5 w-2.5" />
                                        Bientôt
                                      </span>
                                    )}
                                    {restricted && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                                        <Sparkles className="h-2.5 w-2.5" />
                                        Pro
                                      </span>
                                    )}
                                  </span>
                                  {item.description && (
                                    <span className="mt-0.5 block text-[11px] text-[var(--color-text-secondary)] leading-snug">
                                      {item.description}
                                    </span>
                                  )}
                                </span>
                              </span>
                            )

                            return (
                              <li key={item.id}>
                                {href ? (
                                  <Link
                                    href={href}
                                    onClick={() => setOpenCategory(null)}
                                    className="block"
                                  >
                                    {content}
                                  </Link>
                                ) : (
                                  <span className="block">{content}</span>
                                )}
                              </li>
                            )
                          })}
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
