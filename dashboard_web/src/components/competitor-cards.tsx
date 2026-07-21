"use client"

import { useMemo, useState } from "react"
import { Store, TrendingUp, TrendingDown, Minus, Info } from "lucide-react"
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

function SiteLogo({ domain, gradient, size = "md" }: { domain: string; gradient: string; size?: "md" | "sm" }) {
  const [errored, setErrored] = useState(false)
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : ""
  const box = size === "sm" ? "w-8 h-8 rounded-md" : "w-10 h-10 rounded-lg"
  const icon = size === "sm" ? "w-5 h-5" : "w-7 h-7"

  if (!errored && faviconUrl) {
    return (
      <div className={`${box} bg-white dark:bg-[#242628] border border-gray-200/60 dark:border-[#2a2c2e] flex items-center justify-center overflow-hidden shadow-sm flex-shrink-0`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={faviconUrl}
          alt={domain}
          width={28}
          height={28}
          className={`${icon} object-contain`}
          onError={() => setErrored(true)}
        />
      </div>
    )
  }

  return (
    <div className={`${box} bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg flex-shrink-0`}>
      <Store className={`${size === "sm" ? "h-4 w-4" : "h-5 w-5"} text-white`} />
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
  cheaperCount: number
  priceDelta: number | null
}

// Bornes de prix "réalistes" (CAD) — élimine les erreurs de scraping
// où un SKU, VIN, numéro de téléphone ou année concaténée est parsé
// comme un prix (ex. 8 443 072 833 025 $). Les produits motorsport
// les plus chers (motorhomes, bateaux premium) restent bien en-dessous
// de 500 000 $, on garde une marge à 1 000 000 $ pour être conservateur.
const PRICE_MIN = 1
const PRICE_MAX = 1_000_000

// Sous ce nombre de produits comparés, l'écart moyen et l'agressivité
// sont statistiquement fragiles — on l'affiche à l'utilisateur.
const LOW_SAMPLE_THRESHOLD = 5

function isValidPrice(value: number | null | undefined): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= PRICE_MIN
    && value <= PRICE_MAX
}

function computeStats(siteUrl: string, products: Product[]): CompetitorStats {
  const valid = products.filter(p => isValidPrice(p.prix))
  const avg = valid.length ? valid.reduce((s, p) => s + p.prix, 0) / valid.length : 0

  const matched = products.filter(p => isValidPrice(p.prix) && isValidPrice(p.prixReference))
  let aggressivity = 0
  let cheaperCount = 0
  let priceDelta: number | null = null

  if (matched.length > 0) {
    cheaperCount = matched.filter(p => p.prix < (p.prixReference as number)).length
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
    cheaperCount,
    priceDelta,
  }
}

export default function CompetitorCards({ competitorsBySite, onSelect, className }: CompetitorCardsProps) {
  const { t, locale } = useLanguage()
  const nf = (n: number) => n.toLocaleString(locale === "en" ? "en-CA" : "fr-CA")

  const { withMatches, noMatches } = useMemo(() => {
    const all = Object.entries(competitorsBySite)
      .map(([siteUrl, products]) => computeStats(siteUrl, products))
    return {
      // Les concurrents réellement comparables d'abord, du plus couvert au moins couvert.
      withMatches: all
        .filter(c => c.matchedCount > 0)
        .sort((a, b) => b.matchedCount - a.matchedCount),
      noMatches: all
        .filter(c => c.matchedCount === 0)
        .sort((a, b) => b.productsCount - a.productsCount),
    }
  }, [competitorsBySite])

  if (withMatches.length === 0 && noMatches.length === 0) return null

  const interactive = !!onSelect

  return (
    <div className={className}>
      {/* ── Concurrents comparés ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {withMatches.map((c, i) => {
          const gradient = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
          // priceDelta < 0 : le concurrent est moins cher que vous → menace (orange).
          // priceDelta > 0 : il est plus cher → position favorable (vert).
          const trend: "cheaper" | "pricier" | "aligned" =
            c.priceDelta == null || Math.abs(c.priceDelta) <= 0.5
              ? "aligned"
              : c.priceDelta < 0 ? "cheaper" : "pricier"
          const deltaLabel = c.priceDelta == null
            ? "—"
            : `${c.priceDelta >= 0 ? "+" : "−"}${Math.abs(c.priceDelta).toFixed(1).replace(".", locale === "en" ? "." : ",")} %`
          const lowSample = c.matchedCount < LOW_SAMPLE_THRESHOLD

          return (
            <button
              key={c.siteUrl}
              type="button"
              onClick={() => onSelect?.(c.siteUrl)}
              disabled={!interactive}
              className={`relative flex flex-col text-left p-5 rounded-xl bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] transition-all group ${
                interactive
                  ? "hover:border-orange-200 dark:hover:border-orange-900 hover:-translate-y-1 hover:shadow-xl hover:shadow-orange-600/5 cursor-pointer"
                  : "cursor-default"
              }`}
            >
              {/* En-tête : logo + domaine + couverture */}
              <div className="flex items-start gap-3">
                <SiteLogo domain={c.domain} gradient={gradient} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-sm truncate text-[var(--color-text-primary)]">
                    {c.domain}
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] truncate">
                    {nf(c.matchedCount)} {t("dash.comparedOf")} {nf(c.productsCount)} {t("dash.products").toLowerCase()}
                  </p>
                </div>
              </div>

              {/* Métrique principale : leur position face à vos prix */}
              <div className="mt-4 flex items-baseline justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 text-2xl font-bold tabular-nums ${
                    trend === "cheaper"
                      ? "text-orange-600 dark:text-orange-400"
                      : trend === "pricier"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {trend === "cheaper" ? (
                    <TrendingDown className="h-5 w-5" />
                  ) : trend === "pricier" ? (
                    <TrendingUp className="h-5 w-5" />
                  ) : (
                    <Minus className="h-5 w-5" />
                  )}
                  {deltaLabel}
                </span>
                {lowSample && (
                  <span
                    title={t("dash.aggressivityHint")}
                    className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                  >
                    {t("dash.lowSample")}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                {trend === "cheaper"
                  ? t("dash.cheaperThanYou")
                  : trend === "pricier"
                    ? t("dash.pricierThanYou")
                    : t("dash.alignedWithYou")}
              </p>

              {/* Détails */}
              <div className="mt-4 space-y-2.5 border-t border-[var(--color-border-tertiary)] pt-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-secondary)]">{t("dash.avgPrice")}</span>
                  <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {formatPrice(c.avgPrice, locale)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs" title={t("dash.aggressivityHint")}>
                  <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]">
                    {t("dash.aggressivity")}
                    <Info className="h-3 w-3 opacity-60" />
                  </span>
                  <div className="flex items-center gap-2 flex-1 ml-3 max-w-[110px]">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div
                        className="h-full bg-orange-500 rounded-full transition-all"
                        style={{ width: `${Math.max(0, Math.min(100, c.aggressivity))}%` }}
                      />
                    </div>
                    <span className="font-semibold text-[11px] text-[var(--color-text-primary)] tabular-nums whitespace-nowrap">
                      {c.cheaperCount}/{c.matchedCount}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Concurrents sans correspondance ── */}
      {noMatches.length > 0 && (
        <div className="mt-6">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
            {t("dash.noMatchSection")}
          </h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {noMatches.map((c, i) => {
              const gradient = CARD_GRADIENTS[(withMatches.length + i) % CARD_GRADIENTS.length]
              return (
                <button
                  key={c.siteUrl}
                  type="button"
                  onClick={() => onSelect?.(c.siteUrl)}
                  disabled={!interactive}
                  className={`flex items-center gap-3 text-left px-4 py-3 rounded-xl bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] opacity-75 transition-all ${
                    interactive ? "hover:opacity-100 hover:border-[var(--color-border-secondary)] cursor-pointer" : "cursor-default"
                  }`}
                >
                  <SiteLogo domain={c.domain} gradient={gradient} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate text-[var(--color-text-primary)]">
                      {c.domain}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-secondary)] truncate">
                      {nf(c.productsCount)} {t("dash.products").toLowerCase()} · {formatPrice(c.avgPrice, locale)}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-secondary)]">
                      {t("dash.noMatchExplain")}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
