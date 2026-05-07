"use client"

import Link from "next/link"
import Image from "next/image"
import { Menu, X } from "lucide-react"
import { useState } from "react"
import { LanguageToggle } from "@/contexts/language-context"
import { CurrencyToggle } from "./currency-toggle"

const LINKS = [
  { href: "/solutions/dealers", label: "Solution moto" },
  { href: "/pricing", label: "Tarifs" },
  { href: "/demo", label: "Démo" },
  { href: "/customers", label: "Clients" },
  { href: "/contact", label: "Contact" },
]

export default function MarketingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-white/70 dark:bg-[#0d0f10]/80 border-b border-gray-200/60 dark:border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
            <div className="relative h-9 w-9 rounded-lg bg-gradient-to-br from-white to-gray-100 dark:from-[#242628] dark:to-[#1c1e20] shadow-sm p-0.5">
              <div className="relative h-full w-full rounded-md overflow-hidden">
                <Image src="/Go-Data.svg" alt="Go-Data" fill sizes="36px" className="object-contain" />
              </div>
            </div>
            <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">GO-DATA</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2">
              <LanguageToggle variant="menu" />
              <CurrencyToggle />
            </div>
            <Link
              href="/login"
              className="hidden sm:inline-flex px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Se connecter
            </Link>
            <Link
              href="/create-account"
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold hover:bg-gray-800 dark:hover:bg-gray-100 transition-all shadow-sm"
            >
              Démarrer
            </Link>
            <button
              type="button"
              className="lg:hidden p-2 text-gray-700 dark:text-gray-300"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-gray-200 dark:border-white/10 bg-white dark:bg-[#0d0f10]">
          <div className="max-w-7xl mx-auto px-4 py-4 space-y-2">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block px-2 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              >
                {link.label}
              </Link>
            ))}
            <div className="flex items-center gap-2 pt-3 border-t border-gray-200 dark:border-white/10">
              <LanguageToggle variant="menu" />
              <CurrencyToggle />
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
