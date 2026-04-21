"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { User, Home, BarChart2, CreditCard, Activity, ChevronDown, LayoutGrid, Radar } from "lucide-react"

import Profile01 from "./profile-01"
import { useLanguage } from "@/contexts/language-context"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import { canAccessAnalytics, canAccessOrganisation } from "@/lib/plan-restrictions"
import type { TranslationKey } from "@/lib/translations"

export default function TopNav() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const pathname = usePathname()
  const plan = user?.subscription_plan ?? "standard"
  const subscriptionSource = user?.subscription_source || (user?.promo_code_id ? 'promo' : null)

  const allNavItems: { labelKey: TranslationKey; href: string; icon: typeof Home; requiresPaid: boolean }[] = [
    { labelKey: "nav.dashboard", href: "/dashboard", icon: Home, requiresPaid: false },
    { labelKey: "nav.analytics", href: "/dashboard/analytics", icon: BarChart2, requiresPaid: true },
    { labelKey: "nav.alerts", href: "/dashboard/alerte", icon: Activity, requiresPaid: true },
    { labelKey: "nav.payments", href: "/dashboard/payments", icon: CreditCard, requiresPaid: false },
  ]

  const navItems = allNavItems.filter(
    (item) =>
      !item.requiresPaid ||
      (item.href === "/dashboard/analytics" && canAccessAnalytics(plan, subscriptionSource)) ||
      (item.href === "/dashboard/alerte" && canAccessOrganisation(plan, subscriptionSource))
  )

  return (
    <nav className="px-3 sm:px-6 flex items-center justify-between bg-[var(--color-background-primary)] border-b border-[var(--color-border-secondary)] h-full">
      <Link href="/dashboard" className="flex items-center hover:opacity-90 transition-opacity">
        <span className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">GO-DATA</span>
      </Link>

      <div className="flex-1 flex justify-center">
        <div className="flex items-center gap-1 sm:gap-2">
          {navItems.map(item => {
            const Icon = item.icon
            const isDashboard = item.href === "/dashboard"
            const isExact = isDashboard
              ? pathname === "/dashboard" ||
                pathname.startsWith("/dashboard/comparaisons") ||
                pathname.startsWith("/dashboard/surveillance")
              : pathname.startsWith(item.href)

            if (isDashboard) {
              return (
                <div
                  key={item.href}
                  className={cn(
                    "group relative flex items-center text-sm transition-colors",
                    isExact
                      ? "text-[var(--color-text-primary)] font-semibold"
                      : "text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)]"
                  )}
                >
                  <Link
                    href={item.href}
                    className="flex items-center gap-2 pl-3 pr-1.5 py-2.5"
                  >
                    <Icon className={cn("h-4 w-4", isExact ? "text-emerald-600 dark:text-emerald-400" : "")} />
                    <span>{t(item.labelKey)}</span>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={t("nav.dashboardMenu")}
                      className="flex items-center justify-center pr-3 pl-0.5 py-2.5 focus:outline-none hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      <ChevronDown className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
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
                          <span>{t("nav.compareBySite")}</span>
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
                  <span className={cn(
                    "absolute bottom-0 left-2 right-2 h-[2px] rounded-full transition-all duration-200 pointer-events-none",
                    isExact
                      ? "opacity-100 bg-emerald-600 dark:bg-emerald-400"
                      : "opacity-0 group-hover:opacity-40 group-hover:bg-gray-300 dark:group-hover:bg-gray-600"
                  )} />
                </div>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
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
