"use client"

import { useEffect, useMemo, useState } from "react"
import { LogOut, Settings, CreditCard, LogIn, MoveUpRight, User, Megaphone, ShieldCheck, Moon, Sun } from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import { useRouter } from "next/navigation"
import { isDevAdminUserPublic } from "@/lib/auth/admin"

interface MenuItem {
  label: string
  value?: string
  href: string
  icon?: React.ReactNode
  external?: boolean
}

interface Profile01Props {
  name: string
  role: string
  avatar: string
  subscription?: string
}

const defaultProfile = {
  name: "Eugene An",
  role: "Owner",
  avatar: "",
  subscription: "Free Trial",
} satisfies Required<Profile01Props>

export default function Profile01({
  name = defaultProfile.name,
  role = defaultProfile.role,
  avatar = defaultProfile.avatar,
  subscription = defaultProfile.subscription,
}: Partial<Profile01Props> = defaultProfile) {
  const { user, isMainAccount } = useAuth()
  const { t } = useLanguage()
  const router = useRouter()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const currentTheme = mounted ? (theme === "system" ? resolvedTheme : theme) : "dark"
  const isDark = currentTheme === "dark"

  const displayName = user?.name || name
  const displayRole = useMemo(() => {
    if (user?.role === "owner" || user?.role === "main") return t("profile.owner")
    if (user?.role === "member") return t("profile.member")
    return t("profile.user")
  }, [user?.role, t])
  const displayAvatar = user?.avatar_url || avatar
  const displaySubscription = useMemo(() => {
    if (!user?.subscription_plan) return subscription
    const labels: Record<string, string> = {
      standard: t("profile.free"),
      pro: "Pro",
      ultime: "Ultime",
    }
    return labels[user.subscription_plan] || user.subscription_plan
  }, [user?.subscription_plan, subscription, t])

  // Politique : seul le compte dont l'email correspond à NEXT_PUBLIC_DEV_ADMIN_EMAIL
  // voit les liens de la console développeur. Le contrôle réel se fait côté serveur,
  // ce check sert juste à cacher le lien dans l'UI.
  const isAdminRole = isDevAdminUserPublic(user)

  const menuItems: MenuItem[] = user
    ? [
        {
          label: t("profile.title"),
          href: "/dashboard/profile",
          icon: <Settings className="w-4 h-4" />,
        },
        ...(isMainAccount
          ? [
              {
                label: t("profile.subscription"),
                value: displaySubscription,
                href: "/dashboard/payments",
                icon: <CreditCard className="w-4 h-4" />,
                external: false,
              },
            ]
          : []),
        {
          label: t("profile.settings"),
          href: "/dashboard/settings",
          icon: <Settings className="w-4 h-4" />,
        },
        ...(isAdminRole
          ? [
              {
                label: "Console développeur",
                href: "/admin",
                icon: <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />,
              },
              {
                label: "Admin · Nouvelles",
                href: "/dashboard/admin/news",
                icon: <Megaphone className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
              },
            ]
          : []),
      ]
    : []

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div className="relative px-6 pt-12 pb-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="relative shrink-0">
              <div className="w-[72px] h-[72px] rounded-full ring-4 ring-white dark:ring-zinc-900 overflow-hidden bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
                {displayAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayAvatar} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <User className="h-8 w-8 text-gray-400 dark:text-zinc-500" />
                )}
              </div>
              <div className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-900" />
            </div>

            <div className="flex-1">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{displayName}</h2>
              <p className="text-zinc-600 dark:text-zinc-400">{displayRole}</p>
            </div>
          </div>
          <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-6" />
          <div className="space-y-2">
            {menuItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center justify-between p-2 
                                    hover:bg-zinc-50 dark:hover:bg-zinc-800/50 
                                    rounded-lg transition-colors duration-200"
              >
                <div className="flex items-center gap-2">
                  {item.icon}
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.label}</span>
                </div>
                <div className="flex items-center">
                  {item.value && <span className="text-sm text-zinc-500 dark:text-zinc-400 mr-2">{item.value}</span>}
                  {item.external && <MoveUpRight className="w-4 h-4" />}
                </div>
              </Link>
            ))}

            {user && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setTheme(isDark ? "light" : "dark")
                }}
                className="w-full flex items-center justify-between p-2 
                                  hover:bg-zinc-50 dark:hover:bg-zinc-800/50 
                                  rounded-lg transition-colors duration-200"
                aria-label={t("profile.theme")}
              >
                <div className="flex items-center gap-2">
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t("profile.theme")}
                  </span>
                </div>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {isDark ? t("profile.themeLight") : t("profile.themeDark")}
                </span>
              </button>
            )}

            {user ? (
              <a
                href="/api/auth/logout"
                className="w-full flex items-center justify-between p-2 
                                  hover:bg-zinc-50 dark:hover:bg-zinc-800/50 
                                  rounded-lg transition-colors duration-200"
              >
                <div className="flex items-center gap-2">
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t("profile.logout")}</span>
                </div>
              </a>
            ) : (
              <Link
                href="/login"
                className="flex items-center justify-between p-2 
                              hover:bg-zinc-50 dark:hover:bg-zinc-800/50 
                              rounded-lg transition-colors duration-200"
              >
                <div className="flex items-center gap-2">
                  <LogIn className="w-4 h-4" />
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t("profile.login")}</span>
                </div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
