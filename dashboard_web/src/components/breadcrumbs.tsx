"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home } from "lucide-react"

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  analytics: "Analyse",
  alerte: "Alertes",
  payments: "Paiements",
  profile: "Profil",
  settings: "Paramètres",
  subscription: "Abonnement",
  "pending-payment": "Paiement en attente",
}

export default function Breadcrumbs() {
  const pathname = usePathname()

  if (!pathname || pathname === "/dashboard") return null

  const segments = pathname.split("/").filter(Boolean)
  if (segments.length <= 1) return null

  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/")
    const label = ROUTE_LABELS[seg] || seg
    const isLast = i === segments.length - 1
    return { href, label, isLast }
  })

  return (
    <nav className="flex items-center gap-1.5 text-sm mb-6 animate-in fade-in duration-300">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />}
          {i === 0 && <Home className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 mr-0.5" />}
          {crumb.isLast ? (
            <span className="font-medium text-gray-900 dark:text-white">{crumb.label}</span>
          ) : (
            <Link
              href={crumb.href}
              className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
