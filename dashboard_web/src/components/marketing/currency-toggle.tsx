"use client"

import { useState } from "react"
import { useCurrency, CURRENCY_LIST, type CurrencyCode } from "@/lib/currency"

export function CurrencyToggle({ className = "" }: { className?: string }) {
  const { currency, setCurrency, mounted } = useCurrency()
  const [open, setOpen] = useState(false)

  if (!mounted) return null

  const current = CURRENCY_LIST.find((c) => c.code === currency) || CURRENCY_LIST[0]

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/[0.08] transition-colors"
      >
        <span>{current.flag}</span>
        <span>{current.code}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="opacity-60">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] shadow-xl z-50 overflow-hidden">
            {CURRENCY_LIST.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  setCurrency(c.code as CurrencyCode)
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-colors text-left ${
                  currency === c.code
                    ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 font-semibold"
                    : "text-gray-700 dark:text-gray-200"
                }`}
              >
                <span className="text-base">{c.flag}</span>
                <span className="font-mono text-xs w-10">{c.code}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
