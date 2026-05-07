"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import {
  LayoutDashboard, ListChecks, Activity, Users, Hammer,
  LogOut, ExternalLink, Github, ChevronRight, Mail, Cloud,
  Database, Train,
} from "lucide-react"
import type { User } from "@/types/user"
import { isDevAdminUserPublic } from "@/lib/auth/admin"
import { EXTERNAL_LINKS } from "@/lib/external-links"

const NAV: Array<{ href: string; label: string; icon: any }> = [
  { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard },
  { href: "/admin/scrapers", label: "Scrapers", icon: ListChecks },
  { href: "/admin/cron", label: "Cron", icon: Activity },
  { href: "/admin/users", label: "Clients", icon: Users },
  { href: "/admin/usine", label: "Scraper Usine", icon: Hammer },
]

interface Props {
  initialUser: User
  children: React.ReactNode
}

/**
 * UI client de la console admin — palette Stripe (blanc/gris/noir).
 *
 * Garantie de sécurité : ce composant n'est jamais rendu si le serveur n'a pas
 * déjà validé que l'email correspond à DEV_ADMIN_EMAIL (cf. layout.tsx).
 * Le client guard est en 3e ligne de défense (rétrogradation en session).
 */
export default function AdminLayoutClient({ initialUser, children }: Props) {
  const { user: clientUser, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const user = clientUser || initialUser

  useEffect(() => {
    if (isLoading) return
    if (!clientUser) {
      router.push("/login")
      return
    }
    if (!isDevAdminUserPublic(clientUser)) {
      router.push("/dashboard")
    }
  }, [isLoading, clientUser, router])

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-gray-900 flex" style={{ colorScheme: "light" }}>
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        {/* Brand */}
        <div className="px-5 h-14 flex items-center border-b border-gray-200">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-gray-900 flex items-center justify-center">
              <span className="text-white text-xs font-bold tracking-tight">G</span>
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-gray-900">Go-Data</p>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Console</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map(item => {
            const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href))
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-gray-100 text-gray-900 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-gray-900" : "text-gray-400"}`} />
                <span>{item.label}</span>
              </Link>
            )
          })}

          <div className="mt-6 pt-3 border-t border-gray-100">
            <p className="px-3 mb-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-medium">Services externes</p>
            <ExternalNavLink href={EXTERNAL_LINKS.github} icon={Github} label="GitHub Actions" />
            <ExternalNavLink href={EXTERNAL_LINKS.railway} icon={Train} label="Railway" />
            <ExternalNavLink href={EXTERNAL_LINKS.vercel} icon={Cloud} label="Vercel" />
            <ExternalNavLink href={EXTERNAL_LINKS.supabase} icon={Database} label="Supabase" />
            <ExternalNavLink href={EXTERNAL_LINKS.gmail} icon={Mail} label="Gmail" />
          </div>

          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="px-3 mb-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-medium">Navigation</p>
            <Link
              href="/dashboard/comparaisons"
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <LayoutDashboard className="h-3.5 w-3.5 text-gray-400" />
              <span>Vue client</span>
              <ChevronRight className="h-3 w-3 ml-auto text-gray-400" />
            </Link>
          </div>
        </nav>

        {/* Account */}
        <div className="border-t border-gray-200 p-3">
          <div className="flex items-center gap-2.5 px-2 py-1.5 mb-1">
            <div className="h-7 w-7 rounded-full bg-gray-900 flex items-center justify-center text-white text-[11px] font-medium">
              {(user.name || user.email || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-900 truncate">{user.name || "Dev"}</p>
              <p className="text-[10px] text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
          <a
            href="/api/auth/logout"
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
          >
            <LogOut className="h-3 w-3" />
            <span>Déconnexion</span>
          </a>
        </div>
      </aside>

      {/* Contenu principal */}
      <main className="flex-1 overflow-y-auto">
        <div className="px-10 py-8 max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}

function ExternalNavLink({
  href, icon: Icon, label,
}: {
  href: string
  icon: any
  label: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors group"
    >
      <Icon className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-700 transition-colors" />
      <span>{label}</span>
      <ExternalLink className="h-3 w-3 ml-auto text-gray-300 group-hover:text-gray-500 transition-colors" />
    </a>
  )
}
