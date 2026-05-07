"use client"

import Link from "next/link"
import Image from "next/image"
import { LanguageToggle } from "@/contexts/language-context"
import { CurrencyToggle } from "./currency-toggle"

const LINKS = [
  { href: "/solutions/dealers", label: "Solution moto" },
  { href: "/pricing", label: "Tarifs" },
  { href: "/demo", label: "Démo" },
  { href: "/customers", label: "Clients" },
  { href: "/contact", label: "Contact" },
  { href: "/legal/privacy", label: "Confidentialité" },
  { href: "/legal/terms", label: "Conditions" },
]

export default function MarketingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative border-t border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#0d0f10]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
          <div>
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="relative h-9 w-9 rounded-lg bg-gradient-to-br from-white to-gray-100 dark:from-[#242628] dark:to-[#1c1e20] shadow-sm p-0.5">
                <div className="relative h-full w-full rounded-md overflow-hidden">
                  <Image src="/Go-Data.svg" alt="Go-Data" fill sizes="36px" className="object-contain" />
                </div>
              </div>
              <span className="text-base font-bold tracking-tight text-gray-900 dark:text-white">GO-DATA</span>
            </Link>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Veille de prix et données concurrentielles pour le marché moto.
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <LanguageToggle variant="menu" />
            <CurrencyToggle />
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-500">
            © {year} Go-Data. Tous droits réservés.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            <a href="mailto:gestion@go-data.co" className="hover:text-gray-900 dark:hover:text-white">gestion@go-data.co</a>
            {" · "}819-448-2882
          </p>
        </div>
      </div>
    </footer>
  )
}
