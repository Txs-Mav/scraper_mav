"use client"

import { useEffect, useState } from "react"
import { useLanguage } from "@/contexts/language-context"

const STORAGE_KEY = "go-data-cookie-consent"

export default function CookieBanner() {
  const [show, setShow] = useState(false)
  const { t } = useLanguage()

  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) setShow(true)
  }, [])

  function decide(value: "all" | "essential") {
    localStorage.setItem(STORAGE_KEY, value)
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md">
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] shadow-2xl p-5">
        <div className="text-sm font-bold text-gray-900 dark:text-white">{t("cookies.title")}</div>
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{t("cookies.body")}</p>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => decide("all")}
            className="px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
          >
            {t("cookies.acceptAll")}
          </button>
          <button
            type="button"
            onClick={() => decide("essential")}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
          >
            {t("cookies.rejectAll")}
          </button>
        </div>
      </div>
    </div>
  )
}
