"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { t as translate, type Locale, type TranslationKey } from "@/lib/translations"

interface LanguageContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey) => string
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: "fr",
  setLocale: () => {},
  t: (key) => key,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("fr")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("go-data-locale") as Locale | null
    if (stored === "fr" || stored === "en") setLocaleState(stored)
    setMounted(true)
  }, [])

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    localStorage.setItem("go-data-locale", newLocale)
    document.documentElement.lang = newLocale
    fetch("/api/users/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: newLocale }),
    }).catch(() => {})
  }, [])

  const t = useCallback(
    (key: TranslationKey) => translate(locale, key),
    [locale]
  )

  useEffect(() => {
    if (mounted) document.documentElement.lang = locale
  }, [locale, mounted])

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLanguage()

  return (
    <div className={`inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] p-0.5 ${className}`}>
      <button
        type="button"
        onClick={() => setLocale("fr")}
        className={`px-2 py-1 rounded-md text-xs font-semibold transition-all ${
          locale === "fr"
            ? "bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm"
            : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
        }`}
      >
        FR
      </button>
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={`px-2 py-1 rounded-md text-xs font-semibold transition-all ${
          locale === "en"
            ? "bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm"
            : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
        }`}
      >
        EN
      </button>
    </div>
  )
}
