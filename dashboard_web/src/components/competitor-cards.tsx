"use client"

import { useMemo, useState } from "react"
import { Store, TrendingUp, TrendingDown, Minus, ArrowRightLeft } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface Product {
  name: string
  prix: number
  sourceSite?: string
  prixReference?: number | null
  differencePrix?: number | null
}

interface CompetitorCardsProps {
  competitorsBySite: Record<string, Product[]>
  onSelect?: (siteUrl: string) => void
  className?: string
}

const CARD_GRADIENTS = [
  "from-blue-500 to-blue-700",
  "from-emerald-500 to-emerald-700",
  "from-orange-500 to-orange-700",
  "from-purple-500 to-purple-700",
  "from-pink-500 to-pink-700",
  "from-amber-500 to-amber-700",
  "from-cyan-500 to-cyan-700",
  "from-rose-500 to-rose-700",
]

function extractDomain(url: string): string {
  if (!url) return ""
  try {
    const toParse = url.startsWith("http") ? url : "https://" + url
    return new URL(toParse).hostname.replace(/^www\./, "")
  } catch {
    const m = url.match(/(?:https?:\/\/)?(?:www\.)?([^/\s]+)/i)
    return m ? m[1].replace(/^www\./, "") : url
  }
}

function SiteLogo({ domain, gradient }: { domain: string; gradient: string }) {
  const [errored, setErrored] = useState(false)
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : ""

  if (!errored && faviconUrl) {
    return (
      <div className="w-10 h-10 rounded-lg bg-white dark:bg-[#242628] border border-gray-200/60 dark:border-[#2a2c2e] flex items-center justify-center mb-3 overflow-hidden shadow-sm flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={faviconUrl}
          alt={domain}
          width={28}
          height={28}
          className="w-7 h-7 object-contain"
          onError={() => setErrored(true)}
        />
      </div>
    )
  }

  return (
    <div
      className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center mb-3 shadow-lg flex-shrink-0`}
    >
      <Store className="h-5 w-5 text-white" />
    </div>
  )
}

function formatPrice(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return "—"
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-CA" : "fr-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${Math.round(value).toLocaleString(locale === "en" ? "en-CA" : "fr-CA")} $`
  }
}

interface CompetitorStats {
  siteUrl: string
  domain: string
  productsCount: number
  avgPrice: number
  aggressivity: number
  matchedCount: number
  priceDelta: number | null
}

function computeStats(siteUrl: string, products: Product[]): CompetitorStats {
  const valid = products.filter(p => typeof p.prix === "number" && p.prix > 0)
  const avg = valid.length ? valid.reduce((s, p) => s + p.prix, 0) / valid.length : 0

  const matched = products.filter(p => p.prixReference != null && p.prixReference !== undefined && p.prix > 0)
  let aggressivity = 0
  let priceDelta: number | null = null

  if (matched.length > 0) {
    const cheaperCount = matched.filter(p => p.prix < (p.prixReference as number)).length
    aggressivity = Math.round((cheaperCount / matched.length) * 100)
    const deltas = matched
      .map(p => {
        const ref = p.prixReference as number
        if (!ref) return null
        return ((p.prix - ref) / ref) * 100
      })
      .filter((v): v is number => v !== null && Number.isFinite(v))
    if (deltas.length) {
      priceDelta = deltas.reduce((s, v) => s + v, 0) / deltas.length
    }
  }

  return {
    siteUrl,
    domain: extractDomain(siteUrl) || siteUrl,
    productsCount: products.length,
    avgPrice: avg,
    aggressivity,
    matchedCount: matched.length,
    priceDelta,
  }
}

export default function CompetitorCards({ competitorsBySite, onSelect, className }: CompetitorCardsProps) {
  const { t, locale } = useLanguage()

  const competitors = useMemo(() => {
    return Object.entries(competitorsBySite)
      .map(([siteUrl, products]) => computeStats(siteUrl, products))
      .sort((a, b) => b.productsCount - a.productsCount)
  }, [competitorsBySite])

  if (competitors.length === 0) return null

  return (
    <div className={className}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {competitors.map((c, i) => {
          const gradient = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
          const interactive = !!onSelect
          const deltaLabel = c.priceDelta == null
            ? null
            : `${c.priceDelta >= 0 ? "+" : ""}${c.priceDelta.toFixed(1)}%`
          const deltaTrend: "up" | "down" | "flat" =
            c.priceDelta == null
              ? "flat"
              : c.priceDelta > 0.5
                ? "up"
                : c.priceDelta < -0.5
                  ? "down"
                  : "flat"

          return (
            <button
              key={c.siteUrl}
              type="button"
              onClick={() => onSelect?.(c.siteUrl)}
              disabled={!interactive}
              className={`relative text-left p-5 rounded-xl bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] transition-all group ${
                interactive
                  ? "hover:border-emerald-200 dark:hover:border-emerald-900 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-600/5 cursor-pointer"
                  : "cursor-default"
              }`}
            >
              <SiteLogo domain={c.domain} gradient={gradient} />
              <h3 className="font-bold text-sm mb-0.5 truncate text-[var(--color-text-primary)]">
                {c.domain}
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-4 truncate">
                {c.matchedCount > 0
                  ? `${c.matchedCount} ${c.matchedCount > 1 ? t("dash.compared").toLowerCase() : t("dash.compared").toLowerCase()}`
                  : t("dash.noMatchYet")}
              </p>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-secondary)]">{t("dash.products")}</span>
                  <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {c.productsCount.toLocaleString(locale === "en" ? "en-CA" : "fr-CA")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-secondary)]">{t("dash.avgPrice")}</span>
                  <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {formatPrice(c.avgPrice, locale)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-secondary)]">{t("dash.aggressivity")}</span>
                  <div className="flex items-center gap-2 flex-1 ml-3 max-w-[90px]">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all"
                        style={{ width: `${Math.max(0, Math.min(100, c.aggressivity))}%` }}
                      />
                    </div>
                    <span className="font-semibold text-[11px] text-[var(--color-text-primary)] tabular-nums">
                      {c.aggressivity}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-secondary)]">{t("dash.vsReference")}</span>
                  {deltaLabel ? (
                    <span
                      className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
                        deltaTrend === "down"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : deltaTrend === "up"
                            ? "text-orange-600 dark:text-orange-400"
                            : "text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {deltaTrend === "down" ? (
                        <TrendingDown className="h-3 w-3" />
                      ) : deltaTrend === "up" ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <Minus className="h-3 w-3" />
                      )}
                      {deltaLabel}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]">
                      <ArrowRightLeft className="h-3 w-3" />
                      {t("dash.noMatch")}
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
