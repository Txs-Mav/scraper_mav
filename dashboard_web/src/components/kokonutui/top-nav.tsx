"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { User, Home, BarChart2, CreditCard, Activity, ChevronDown, LayoutGrid, Radar, Search, Lock } from "lucide-react"

import Profile01 from "./profile-01"
import { useLanguage } from "@/contexts/language-context"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import { canAccessAnalytics, canAccessOrganisation } from "@/lib/plan-restrictions"
import type { TranslationKey } from "@/lib/translations"

type NavItemKind = "dashboard" | "productSearch" | "link"

type NavItem = {
  kind: NavItemKind
  labelKey: TranslationKey
  href?: string
  icon: typeof Home
  requiresPaid: boolean
}

export default function TopNav() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const pathname = usePathname()
  const plan = user?.subscription_plan ?? "standard"
  const subscriptionSource = user?.subscription_source || (user?.promo_code_id ? 'promo' : null)

  const allNavItems: NavItem[] = [
    { kind: "dashboard", labelKey: "nav.dashboard", icon: Home, requiresPaid: false },
    { kind: "productSearch", labelKey: "nav.productSearch", icon: Search, requiresPaid: false },
    { kind: "link", labelKey: "nav.analytics", href: "/dashboard/analytics", icon: BarChart2, requiresPaid: true },
    { kind: "link", labelKey: "nav.alerts", href: "/dashboard/alerte", icon: Activity, requiresPaid: true },
    { kind: "link", labelKey: "nav.payments", href: "/dashboard/payments", icon: CreditCard, requiresPaid: false },
  ]

  const navItems = allNavItems.filter(
    (item) =>
      !item.requiresPaid ||
      (item.href === "/dashboard/analytics" && canAccessAnalytics(plan, subscriptionSource)) ||
      (item.href === "/dashboard/alerte" && canAccessOrganisation(plan, subscriptionSource))
  )

  const isDashboardActive =
    pathname.startsWith("/dashboard/comparaisons") ||
    pathname.startsWith("/dashboard/surveillance")

  return (
    <nav className="px-3 sm:px-6 flex items-center justify-between bg-[var(--color-background-primary)] border-b border-[var(--color-border-secondary)] h-full">
      <Link href="/dashboard" className="flex items-center hover:opacity-90 transition-opacity">
        <span className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">GO-DATA</span>
      </Link>

      <div className="flex-1 flex justify-center">
        <div className="flex items-center gap-1 sm:gap-2">
          {navItems.map(item => {
            const Icon = item.icon

            if (item.kind === "dashboard") {
              return (
                <DropdownMenu key="dashboard">
                  <DropdownMenuTrigger
                    aria-label={t("nav.dashboardMenu")}
                    className={cn(
                      "group relative flex items-center gap-2 px-3 py-2.5 text-sm transition-colors focus:outline-none",
                      isDashboardActive
                        ? "text-[var(--color-text-primary)] font-semibold"
                        : "text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)]"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", isDashboardActive ? "text-emerald-600 dark:text-emerald-400" : "")} />
                    <span>{t(item.labelKey)}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
                    <span className={cn(
                      "absolute bottom-0 left-2 right-2 h-[2px] rounded-full transition-all duration-200 pointer-events-none",
                      isDashboardActive
                        ? "opacity-100 bg-emerald-600 dark:bg-emerald-400"
                        : "opacity-0 group-hover:opacity-40 group-hover:bg-gray-300 dark:group-hover:bg-gray-600"
                    )} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    sideOffset={8}
                    className="w-[240px] bg-background border-border rounded-lg shadow-lg"
                  >
                    <DropdownMenuItem asChild>
                      <Link
                        href="/dashboard/comparaisons"
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <LayoutGrid className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span>{t("nav.byRetailer")}</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href="/dashboard/surveillance"
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Radar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span>{t("nav.marketMonitoringNav")}</span>
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            }

            if (item.kind === "productSearch") {
              return (
                <DropdownMenu key="productSearch">
                  <DropdownMenuTrigger
                    aria-label={t("nav.productSearch")}
                    className={cn(
                      "group relative flex items-center gap-2 px-3 py-2.5 text-sm transition-colors focus:outline-none",
                      "text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)]"
                    )}
                  >
                    <span className="relative inline-flex items-center justify-center">
                      <Icon className="h-4 w-4" />
                      <Lock className="absolute -bottom-1 -right-1.5 h-2.5 w-2.5 text-amber-500" />
                    </span>
                    <span>{t(item.labelKey)}</span>
                    <span className={cn(
                      "absolute bottom-0 left-2 right-2 h-[2px] rounded-full transition-all duration-200 pointer-events-none",
                      "opacity-0 group-hover:opacity-40 group-hover:bg-gray-300 dark:group-hover:bg-gray-600"
                    )} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="center"
                    sideOffset={8}
                    className="w-[280px] bg-background border-border rounded-lg shadow-lg p-3"
                  >
                    <div className="flex flex-col items-center text-center gap-2 py-2">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-900/20">
                        <Lock className="h-5 w-5 text-amber-500" />
                      </div>
                      <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {t("nav.comingSoon")}
                      </p>
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                        {t("nav.comingSoonDesc")}
                      </p>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            }

            const isExact = item.href ? pathname.startsWith(item.href) : false

            return (
              <Link
                key={item.href}
                href={item.href!}
                className={cn(
                  "group relative flex items-center gap-2 px-3 py-2.5 text-sm transition-colors",
                  isExact
                    ? "text-[var(--color-text-primary)] font-semibold"
                    : "text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)]"
                )}
              >
                <Icon className={cn("h-4 w-4", isExact ? "text-emerald-600 dark:text-emerald-400" : "")} />
                <span>{t(item.labelKey)}</span>
                <span className={cn(
                  "absolute bottom-0 left-2 right-2 h-[2px] rounded-full transition-all duration-200",
                  isExact
                    ? "opacity-100 bg-emerald-600 dark:bg-emerald-400"
                    : "opacity-0 group-hover:opacity-40 group-hover:bg-gray-300 dark:group-hover:bg-gray-600"
                )} />
              </Link>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 ml-auto sm:ml-0">
        {/* Section profil */}
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
              name={user?.name || (t("profile.user"))}
              role={user?.role === "main" ? t("profile.mainAccount") : user?.role === "employee" ? t("profile.employee") : t("profile.visitor")}
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
  )
}
