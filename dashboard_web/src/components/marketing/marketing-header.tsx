"use client"

import Link from "next/link"
import Image from "next/image"
import { Menu, X } from "lucide-react"
import { useState } from "react"

const LINKS = [
  { href: "/pricing", label: "Tarifs" },
  { href: "/demo", label: "Démo" },
  { href: "/contact", label: "Contact" },
]

export default function MarketingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-[#0b0c0d]/80 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
            <span className="relative h-7 w-7 overflow-hidden rounded-md ring-1 ring-gray-200 dark:ring-white/10">
              <Image src="/Go-Data.svg" alt="Go-Data" fill sizes="28px" className="object-contain" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">
              Go-Data
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <Link
              href="/login"
              className="hidden sm:inline-flex rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
            >
              Se connecter
            </Link>
            <Link
              href="/create-account"
              className="inline-flex items-center rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
            >
              Démarrer
            </Link>
            <button
              type="button"
              className="lg:hidden -mr-1 p-2 text-gray-600 dark:text-gray-300"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b0c0d]">
          <div className="mx-auto max-w-6xl px-6 py-3">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block rounded-md px-2 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="mt-1 block rounded-md px-2 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 sm:hidden"
            >
              Se connecter
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
