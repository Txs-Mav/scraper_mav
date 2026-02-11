"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Bell, User, Home, BarChart2, CreditCard } from "lucide-react"
import Profile01 from "./profile-01"
import { ThemeToggle } from "../theme-toggle"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import { canAccessAnalytics, canAccessOrganisation } from "@/lib/plan-restrictions"

export default function TopNav() {
  const { user } = useAuth()
  const pathname = usePathname()
  const plan = user?.subscription_plan ?? "standard"
  // Fallback : si subscription_source est null mais promo_code_id est défini → promo
  const subscriptionSource = user?.subscription_source || (user?.promo_code_id ? 'promo' : null)

  const allNavItems = [
    { label: "Dashboard", href: "/dashboard", icon: Home, requiresPaid: false },
    { label: "Analyse", href: "/dashboard/analytics", icon: BarChart2, requiresPaid: true },
    { label: "Alerte", href: "/dashboard/alerte", icon: Bell, requiresPaid: true },
    { label: "Paiements", href: "/dashboard/payments", icon: CreditCard, requiresPaid: false },
  ]

  const navItems = allNavItems.filter(
    (item) =>
      !item.requiresPaid ||
      (item.href === "/dashboard/analytics" && canAccessAnalytics(plan, subscriptionSource)) ||
      (item.href === "/dashboard/alerte" && canAccessOrganisation(plan, subscriptionSource))
  )

  return (
    <nav className="px-3 sm:px-6 flex items-center justify-between bg-white dark:bg-[#0F0F12] border-b border-gray-200 dark:border-[#1F1F23] h-full">
      <Link href="/dashboard" className="flex items-center gap-2 sm:gap-3 hover:opacity-90 transition-opacity">
        <div className="relative h-10 w-10 flex-shrink-0">
          <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-white/80 via-white/40 to-transparent dark:from-white/20 dark:via-white/12 dark:to-transparent" />
          <Image
            src="/Go-Data.png"
            alt="GO-DATA"
            fill
            sizes="40px"
            className="relative object-contain drop-shadow-sm"
            style={{
              WebkitMaskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
              maskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
            }}
          />
        </div>
        <span className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">GO-DATA</span>
      </Link>

      <div className="flex-1 flex justify-center">
        <div className="flex items-center gap-2 sm:gap-4">
          {navItems.map(item => {
            const Icon = item.icon
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1F1F23]"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 ml-auto sm:ml-0">
        <button
          type="button"
          className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-[#1F1F23] rounded-full transition-colors"
        >
          <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600 dark:text-gray-300" />
        </button>

        <ThemeToggle />

        {/* Section profil toujours visible - icône User toujours affichée */}
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
              avatar="https://ferf1mheo22r9ira.public.blob.vercel-storage.com/avatar-01-n0x8HFv8EUetf9z6ht0wScJKoTHqf8.png"
              name={user?.name || "Utilisateur"}
              role={user?.role === "main" ? "Compte principal" : user?.role === "employee" ? "Employé" : "Visiteur"}
              subscription={
                user?.subscription_plan === "standard"
                  ? "Gratuit"
                  : user?.subscription_plan === "pro"
                    ? "Pro"
                    : user?.subscription_plan === "ultime"
                      ? "Ultime"
                      : "Gratuit"
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}
