"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Bell, User, Home, BarChart2, CreditCard, Search, Command } from "lucide-react"

import Profile01 from "./profile-01"
import { ThemeToggle } from "../theme-toggle"
import { LanguageToggle } from "@/contexts/language-context"
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
    { labelKey: "nav.alerts", href: "/dashboard/alerte", icon: Bell, requiresPaid: true },
    { labelKey: "nav.payments", href: "/dashboard/payments", icon: CreditCard, requiresPaid: false },
  ]

  const navItems = allNavItems.filter(
    (item) =>
      !item.requiresPaid ||
      (item.href === "/dashboard/analytics" && canAccessAnalytics(plan, subscriptionSource)) ||
      (item.href === "/dashboard/alerte" && canAccessOrganisation(plan, subscriptionSource))
  )

  return (
    <nav className="px-3 sm:px-6 flex items-center justify-between bg-white dark:bg-[#0F0F12] border-b border-gray-200 dark:border-[#1F1F23] h-full">
      <Link href="/dashboard" className="flex items-center hover:opacity-90 transition-opacity">
        <span className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">GO-DATA</span>
      </Link>

      <div className="flex-1 flex justify-center">
        <div className="flex items-center gap-1 sm:gap-2">
          {navItems.map(item => {
            const Icon = item.icon
            const isExact = item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-2 px-3 py-2.5 text-sm transition-colors",
                  isExact
                    ? "text-gray-900 dark:text-white font-semibold"
                    : "text-gray-500 dark:text-gray-400 font-medium hover:text-gray-900 dark:hover:text-white"
                )}
              >
                <Icon className={cn("h-4 w-4", isExact ? "text-blue-600 dark:text-blue-400" : "")} />
                <span>{t(item.labelKey)}</span>
                <span className={cn(
                  "absolute bottom-0 left-2 right-2 h-[2px] rounded-full transition-all duration-200",
                  isExact
                    ? "opacity-100 bg-blue-600 dark:bg-blue-400"
                    : "opacity-0 group-hover:opacity-40 group-hover:bg-gray-300 dark:group-hover:bg-gray-600"
                )} />
              </Link>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 ml-auto sm:ml-0">
        {/* Search trigger */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] text-gray-400 dark:text-gray-500 text-sm hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:border-gray-300 dark:hover:border-gray-700 transition-all"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs">{t("search")}</span>
          <kbd className="ml-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-200 dark:bg-white/[0.06] text-[10px] font-medium">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>

        <LanguageToggle />
        <ThemeToggle />

        {/* Section profil */}
        <DropdownMenu>
          <DropdownMenuTrigger className="focus:outline-none">
            <div className="flex items-center justify-center w-8 h-8 rounded-full ring-2 ring-gray-200 dark:ring-[#2B2B30] cursor-pointer hover:bg-gray-100 dark:hover:bg-[#1F1F23] transition-colors overflow-hidden">
              {user?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar_url} alt={user.name || "avatar"} className="w-full h-full object-cover" />
              ) : (
                <User className="h-5 w-5 text-gray-600 dark:text-gray-300" />
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
