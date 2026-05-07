"use client"

import { useEffect, useState, useCallback } from "react"

export type CurrencyCode = "CAD" | "USD" | "EUR" | "GBP" | "MXN" | "BRL"

export type Currency = {
  code: CurrencyCode
  symbol: string
  name: string
  flag: string
  rateFromCAD: number
  decimals: number
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  CAD: { code: "CAD", symbol: "$", name: "Canadian Dollar", flag: "🇨🇦", rateFromCAD: 1, decimals: 2 },
  USD: { code: "USD", symbol: "$", name: "US Dollar", flag: "🇺🇸", rateFromCAD: 0.74, decimals: 2 },
  EUR: { code: "EUR", symbol: "€", name: "Euro", flag: "🇪🇺", rateFromCAD: 0.68, decimals: 2 },
  GBP: { code: "GBP", symbol: "£", name: "British Pound", flag: "🇬🇧", rateFromCAD: 0.58, decimals: 2 },
  MXN: { code: "MXN", symbol: "$", name: "Mexican Peso", flag: "🇲🇽", rateFromCAD: 13.6, decimals: 0 },
  BRL: { code: "BRL", symbol: "R$", name: "Brazilian Real", flag: "🇧🇷", rateFromCAD: 4.2, decimals: 2 },
}

export const CURRENCY_LIST: Currency[] = Object.values(CURRENCIES)

export function convertFromCAD(amountCAD: number, target: CurrencyCode): number {
  return amountCAD * CURRENCIES[target].rateFromCAD
}

export function formatCurrency(amountCAD: number, target: CurrencyCode): string {
  const value = convertFromCAD(amountCAD, target)
  const c = CURRENCIES[target]
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  })
  return target === "EUR" ? `${formatted} ${c.symbol}` : `${c.symbol}${formatted}`
}

const STORAGE_KEY = "go-data-currency"

function detectInitialCurrency(): CurrencyCode {
  if (typeof window === "undefined") return "CAD"
  const stored = localStorage.getItem(STORAGE_KEY) as CurrencyCode | null
  if (stored && stored in CURRENCIES) return stored
  const lang = (navigator.language || "en").toLowerCase()
  if (lang.startsWith("fr-ca") || lang.startsWith("en-ca")) return "CAD"
  if (lang.startsWith("en-gb")) return "GBP"
  if (lang.startsWith("es-mx") || lang.startsWith("es")) return "MXN"
  if (lang.startsWith("pt-br") || lang.startsWith("pt")) return "BRL"
  if (lang.startsWith("de") || lang.startsWith("fr") || lang.startsWith("it") || lang.startsWith("nl")) return "EUR"
  return "USD"
}

export function useCurrency() {
  const [currency, setCurrencyState] = useState<CurrencyCode>("CAD")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setCurrencyState(detectInitialCurrency())
    setMounted(true)
  }, [])

  const setCurrency = useCallback((code: CurrencyCode) => {
    setCurrencyState(code)
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, code)
    }
  }, [])

  const format = useCallback((amountCAD: number) => formatCurrency(amountCAD, currency), [currency])

  return { currency, setCurrency, format, mounted }
}
