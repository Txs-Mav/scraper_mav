"use client"

import { createContext, useContext, useState, useEffect, useCallback, useSyncExternalStore, type ReactNode } from "react"
import { t as translate, LOCALES, type Locale, type TranslationKey } from "@/lib/translations"
import { tm } from "@/lib/i18n-marketing"

interface LanguageContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey | string) => string
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: "fr",
  setLocale: () => {},
  t: (key) => key,
})

const DEFAULT_LOCALE: Locale = "fr"
const LOCALE_STORAGE_KEY = "go-data-locale"
const LOCALE_CHANGE_EVENT = "go-data-locale-change"

function isSupportedLocale(locale: string | null): locale is Locale {
  return LOCALES.some((l) => l.code === locale)
}

function getStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null

  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isSupportedLocale(stored) ? stored : null
  } catch {
    return null
  }
}

function getLocaleSnapshot(): Locale {
  return getStoredLocale() ?? DEFAULT_LOCALE
}

function getServerLocaleSnapshot(): Locale {
  return DEFAULT_LOCALE
}

function subscribeToLocaleChanges(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {}

  const handleStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY) onStoreChange()
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(LOCALE_CHANGE_EVENT, onStoreChange)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(LOCALE_CHANGE_EVENT, onStoreChange)
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(
    subscribeToLocaleChanges,
    getLocaleSnapshot,
    getServerLocaleSnapshot
  )

  const setLocale = useCallback((newLocale: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale)
    } catch {}
    document.documentElement.lang = newLocale
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT))
    fetch("/api/users/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: newLocale }),
    }).catch(() => {})
  }, [])

  const t = useCallback(
    (key: TranslationKey | string) => {
      if (typeof key === "string" && (key.startsWith("mkt.") || key.startsWith("vertical.") || key.startsWith("pricing.") || key.startsWith("trust.") || key.startsWith("status.") || key.startsWith("blog.") || key.startsWith("help.") || key.startsWith("roadmap.") || key.startsWith("about.") || key.startsWith("careers.") || key.startsWith("press.") || key.startsWith("contact.") || key.startsWith("partners.") || key.startsWith("affiliate.") || key.startsWith("customers.") || key.startsWith("freetools.") || key.startsWith("integrations.") || key.startsWith("marketplace.") || key.startsWith("apikeys.") || key.startsWith("webhooks.") || key.startsWith("team.") || key.startsWith("alertsRules.") || key.startsWith("onboarding.") || key.startsWith("cookies.") || key.startsWith("exitIntent.") || key.startsWith("compare.") || key.startsWith("changelog.") || key.startsWith("resources.") || key.startsWith("glossary."))) {
        return tm(locale, key)
      }
      return translate(locale, key as TranslationKey)
    },
    [locale]
  )

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

export function LanguageToggle({ className = "", variant = "compact" }: { className?: string; variant?: "compact" | "menu" }) {
  const { locale, setLocale } = useLanguage()
  const [open, setOpen] = useState(false)

  if (variant === "compact") {
    return (
      <div className={`inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] p-0.5 ${className}`}>
        {LOCALES.slice(0, 2).map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => setLocale(l.code)}
            className={`px-2 py-1 rounded-md text-xs font-semibold transition-all ${
              locale === l.code
                ? "bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm"
                : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            }`}
          >
            {l.code.toUpperCase()}
          </button>
        ))}
      </div>
    )
  }

  const current = LOCALES.find((l) => l.code === locale) || LOCALES[0]

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/[0.08] transition-colors"
      >
        <span>{current.flag}</span>
        <span>{current.code.toUpperCase()}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="opacity-60">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] shadow-xl z-50 overflow-hidden">
            {LOCALES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  setLocale(l.code)
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-colors text-left ${
                  locale === l.code ? "bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-300 font-semibold" : "text-gray-700 dark:text-gray-200"
                }`}
              >
                <span className="text-base">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

