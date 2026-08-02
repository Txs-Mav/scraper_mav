"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Radar, Search, BarChart2, Bell, Menu, X, Lock } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import { cn } from "@/lib/utils"
import { NAV_CATEGORIES } from "./top-nav"

// Onglets directs : les 4 destinations les plus utiles au quotidien.
// Tout le reste vit dans la feuille « Menu ».
const TABS = [
  { id: "surveillance", labelKey: "tabbar.prix", href: "/dashboard/surveillance", icon: Radar },
  { id: "recherche", labelKey: "tabbar.recherche", href: "/dashboard/recherche", icon: Search },
  { id: "analyse", labelKey: "tabbar.analyse", href: "/dashboard/analytics", icon: BarChart2 },
  { id: "alertes", labelKey: "tabbar.alertes", href: "/dashboard/alerte", icon: Bell },
]

/**
 * Navigation mobile du dashboard : tab bar fixe en bas (masquée dès sm).
 * Remplace les catégories du top-nav, inutilisables au pouce sur téléphone.
 */
export default function MobileTabBar() {
  const pathname = usePathname()
  const { t } = useLanguage()
  const [menuOpen, setMenuOpen] = useState(false)

  // La feuille se referme à chaque navigation.
  useEffect(() => { setMenuOpen(false) }, [pathname])

  // Verrouille le scroll de fond quand la feuille est ouverte.
  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [menuOpen])

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname?.startsWith(href))

  return (
    <>
      <nav
        aria-label="Navigation mobile"
        className="sm:hidden fixed inset-x-0 bottom-0 z-[65] border-t border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex h-14 items-stretch">
          {TABS.map(tab => {
            const Icon = tab.icon
            const active = isActive(tab.href)
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  active
                    ? "text-orange-600 dark:text-orange-400"
                    : "text-[var(--color-text-secondary)]"
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                <span className="truncate max-w-[72px]">{t(tab.labelKey)}</span>
              </Link>
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

      {/* Feuille « Menu » : toutes les sections, groupées par catégorie. */}
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
                    if (item.locked || !item.href) {
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
                    const active = isActive(item.href)
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors",
                          active
                            ? "bg-orange-50 font-semibold text-orange-700 dark:bg-orange-400/10 dark:text-orange-300"
                            : "text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-orange-600 dark:text-orange-400" : "text-[var(--color-text-secondary)]")} />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </Link>
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
