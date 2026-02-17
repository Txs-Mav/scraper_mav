"use client"

import { useMemo } from "react"
import { LogOut, Settings, CreditCard, LogIn, MoveUpRight } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"

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
  avatar: "https://ferf1mheo22r9ira.public.blob.vercel-storage.com/avatar-02-albo9B0tWOSLXCVZh9rX9KFxXIVWMr.png",
  subscription: "Free Trial",
} satisfies Required<Profile01Props>

export default function Profile01({
  name = defaultProfile.name,
  role = defaultProfile.role,
  avatar = defaultProfile.avatar,
  subscription = defaultProfile.subscription,
}: Partial<Profile01Props> = defaultProfile) {
  const { user, logout, isMainAccount } = useAuth()
  const router = useRouter()

  const subscriptionLabels: Record<string, string> = {
    standard: "Gratuit",
    pro: "Pro",
    ultime: "Ultime",
  }

  const displayName = user?.name || name
  const displayRole = useMemo(() => {
    if (user?.role === "owner" || user?.role === "main") return "Owner"
    if (user?.role === "member") return "Membre"
    return "Utilisateur"
  }, [user?.role])
  const displayAvatar = user?.avatar_url || avatar
  const displaySubscription = user?.subscription_plan
    ? subscriptionLabels[user.subscription_plan] || user.subscription_plan
    : subscription

  const menuItems: MenuItem[] = user
    ? [
        {
          label: "Profile",
          href: "/dashboard/profile",
          icon: <Settings className="w-4 h-4" />,
        },
        ...(isMainAccount
          ? [
              {
                label: "Subscription",
                value: displaySubscription,
                href: "/dashboard/payments",
                icon: <CreditCard className="w-4 h-4" />,
                external: false,
              },
            ]
          : []),
        {
          label: "Settings",
          href: "/dashboard/settings",
          icon: <Settings className="w-4 h-4" />,
        },
      ]
    : []

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div className="relative px-6 pt-12 pb-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="relative shrink-0">
              <Image
                src={displayAvatar}
                alt={displayName}
                width={72}
                height={72}
                className="rounded-full ring-4 ring-white dark:ring-zinc-900 object-cover"
                unoptimized
              />
              <div className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-900" />
            </div>

            {/* Profile Info */}
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

            {user ? (
              <button
                type="button"
                onClick={async () => {
                  // Rediriger immédiatement
                  window.location.href = "/login"
                  // Lancer le logout en arrière-plan sans bloquer la redirection
                  logout().catch(() => {})
                  fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
                }}
                className="w-full flex items-center justify-between p-2 
                                  hover:bg-zinc-50 dark:hover:bg-zinc-800/50 
                                  rounded-lg transition-colors duration-200"
              >
                <div className="flex items-center gap-2">
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Logout</span>
                </div>
              </button>
            ) : (
              <Link
                href="/login"
                className="flex items-center justify-between p-2 
                              hover:bg-zinc-50 dark:hover:bg-zinc-800/50 
                              rounded-lg transition-colors duration-200"
              >
                <div className="flex items-center gap-2">
                  <LogIn className="w-4 h-4" />
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Login</span>
                </div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
