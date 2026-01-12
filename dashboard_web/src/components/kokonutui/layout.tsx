"use client"

import type { ReactNode } from "react"
import TopNav from "./top-nav"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div className={`min-h-screen flex flex-col ${theme === "dark" ? "dark" : ""}`}>
      <header className="h-16 border-b border-gray-200 dark:border-[#1F1F23]">
        <TopNav />
      </header>
      <main className="flex-1 overflow-auto p-6 background-template">
        <div className="w-full max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  )
}
