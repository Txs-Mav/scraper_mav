"use client"

import { BarChart2, Building2, CreditCard, Users2, Settings, HelpCircle, Menu } from "lucide-react"

import { Home } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import Image from "next/image"

export default function Sidebar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  function handleNavigation() {
    setIsMobileMenuOpen(false)
  }

  function NavItem({
    href,
    icon: Icon,
    children,
  }: {
    href: string
    icon: any
    children: React.ReactNode
  }) {
    return (
      <Link
        href={href}
        onClick={handleNavigation}
        className="flex items-center px-3 py-2 text-sm rounded-md transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
      >
        <Icon className="h-4 w-4 mr-3 flex-shrink-0" />
        {children}
      </Link>
    )
  }

  return (
    <>
      <button
        type="button"
        className="lg:hidden fixed top-4 left-4 z-[70] p-2 rounded-lg bg-[var(--color-background-primary)] shadow-md"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        <Menu className="h-5 w-5 text-[var(--color-text-secondary)]" />
      </button>
      <nav
        className={`
                fixed inset-y-0 left-0 z-[70] w-64 bg-[var(--color-background-primary)] transform transition-transform duration-200 ease-in-out
                lg:translate-x-0 lg:static lg:w-64 border-r border-[var(--color-border-secondary)]
                ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
            `}
      >
        <div className="h-full flex flex-col">
          <Link href="/dashboard" className="h-16 px-6 flex items-center border-b border-[var(--color-border-secondary)]">
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 flex-shrink-0">
                <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-white/70 via-white/30 to-transparent dark:from-white/15 dark:via-white/10 dark:to-transparent" />
                <Image
                  src="/Go-Data.svg"
                  alt="Go-Data"
                  fill
                  sizes="40px"
                  className="relative object-contain drop-shadow-sm"
                  style={{
                    WebkitMaskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                    maskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                  }}
                />
              </div>
              <span className="text-lg font-semibold hover:cursor-pointer text-[var(--color-text-primary)]">
                Go-Data
              </span>
            </div>
          </Link>

          <div className="flex-1 overflow-y-auto py-4 px-4">
            <div className="space-y-6">
              <div />
            </div>
          </div>

          <div className="px-4 py-4 border-t border-[var(--color-border-secondary)]">
            <div className="space-y-1">
              <NavItem href="#" icon={Settings}>
                Settings
              </NavItem>
              <NavItem href="#" icon={HelpCircle}>
                Help
              </NavItem>
            </div>
          </div>
        </div>
      </nav>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-[65] lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  )
}
