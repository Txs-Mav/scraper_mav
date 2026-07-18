"use client"

import { useState, useCallback } from "react"

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

// Go-Data est un produit canadien : la devise est verrouillée sur le CAD.
export function useCurrency() {
  const [currency, setCurrencyState] = useState<CurrencyCode>("CAD")

  const setCurrency = useCallback((code: CurrencyCode) => {
    setCurrencyState(code)
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, code)
    }
  }, [])

  const format = useCallback((amountCAD: number) => formatCurrency(amountCAD, currency), [currency])

  return { currency, setCurrency, format, mounted: true }
}
