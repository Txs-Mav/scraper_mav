"use client"

import { useEffect, useRef, useState } from "react"
import {
  PackagePlus,
  PackageX,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

/* ── Données de démonstration ─────────────────────────── */

type ChangeType = "baisse" | "hausse" | "nouveau" | "retrait"

type Change = {
  id: number
  type: ChangeType
  product: string
  site: string
  time: string
  oldPrice?: string
  newPrice?: string
  delta?: string
}

const INITIAL_FEED: Change[] = [
  {
    id: 1,
    type: "baisse",
    product: "Sea-Doo GTX 170 2024",
    site: "mathias-sports.com",
    time: "il y a 12 min",
    oldPrice: "15 999 $",
    newPrice: "14 299 $",
    delta: "−10,6 %",
  },
  {
    id: 2,
    type: "nouveau",
    product: "Ski-Doo Summit X Expert 2026",
    site: "joliette-recreatif.com",
    time: "il y a 1 h",
    newPrice: "19 499 $",
  },
  {
    id: 3,
    type: "hausse",
    product: "Polaris Sportsman 570",
    site: "joliette-recreatif.com",
    time: "il y a 3 h",
    oldPrice: "9 499 $",
    newPrice: "9 899 $",
    delta: "+4,2 %",
  },
  {
    id: 4,
    type: "retrait",
    product: "Yamaha Grizzly 700",
    site: "mathias-sports.com",
    time: "il y a 6 h",
  },
  {
    id: 5,
    type: "baisse",
    product: "KTM 390 Duke 2024",
    site: "laval-moto.com",
    time: "il y a 9 h",
    oldPrice: "7 299 $",
    newPrice: "6 899 $",
    delta: "−5,5 %",
  },
]

const INCOMING: Omit<Change, "id" | "time">[] = [
  {
    type: "baisse",
    product: "Can-Am Outlander 700",
    site: "rive-nord-motosport.com",
    oldPrice: "11 499 $",
    newPrice: "10 999 $",
    delta: "−4,3 %",
  },
  {
    type: "nouveau",
    product: "Honda CRF250R 2025",
    site: "laval-moto.com",
    newPrice: "9 399 $",
  },
  {
    type: "hausse",
    product: "Kawasaki Ninja 650",
    site: "mathias-sports.com",
    oldPrice: "9 799 $",
    newPrice: "10 199 $",
    delta: "+4,1 %",
  },
  {
    type: "baisse",
    product: "Yamaha YZ450F 2024",
    site: "joliette-recreatif.com",
    oldPrice: "12 199 $",
    newPrice: "11 799 $",
    delta: "−3,3 %",
  },
  {
    type: "retrait",
    product: "Ski-Doo Renegade X 900",
    site: "rive-nord-motosport.com",
  },
]

const RETAILERS = [
  {
    name: "Mathias Sports",
    site: "mathias-sports.com",
    products: 128,
    gap: -2.4,
  },
  {
    name: "Joliette Récréatif",
    site: "joliette-recreatif.com",
    products: 96,
    gap: 1.8,
  },
  { name: "Laval Moto", site: "laval-moto.com", products: 74, gap: 0.6 },
  {
    name: "Rive-Nord Motosport",
    site: "rive-nord-motosport.com",
    products: 52,
    gap: 3.9,
  },
]

const OPPORTUNITIES = [
  {
    product: "Kawasaki Ninja 650",
    kind: "Sans concurrence directe",
    detail: "Seul détaillant à moins de 100 km à l'avoir en stock.",
    action: "+ 400 $ de marge possible",
    tone: "emerald" as const,
  },
  {
    product: "Ski-Doo Summit 850",
    kind: "Marge à reprendre",
    detail: "728 $ sous le prix moyen du marché.",
    action: "Remonter à 17 690 $",
    tone: "emerald" as const,
  },
  {
    product: "Sea-Doo GTX 170 2024",
    kind: "Baisse à considérer",
    detail: "mathias-sports.com vient de baisser de 10,6 %.",
    action: "Ajuster à 14 499 $",
    tone: "orange" as const,
  },
  {
    product: "Can-Am Outlander 700",
    kind: "Marge à reprendre",
    detail: "2e prix le plus bas, écart de 3,1 % avec le suivant.",
    action: "Remonter à 11 199 $",
    tone: "emerald" as const,
  },
]

const YOUR_PRICES = [54100, 54180, 54250, 54210, 54160, 54120, 54080, 54140, 54200, 54260, 54290, 54318]
const MARKET_PRICES = [55900, 55870, 55910, 55980, 56020, 55940, 55880, 55930, 56010, 56090, 56130, 56166]

const TABS = [
  { key: "changements", label: "Changements" },
  { key: "detaillants", label: "Détaillants" },
  { key: "opportunites", label: "Opportunités" },
  { key: "analytique", label: "Analytique" },
] as const

type TabKey = (typeof TABS)[number]["key"]

/* ── Sous-composants ──────────────────────────────────── */

const CHANGE_META: Record<
  ChangeType,
  { label: string; icon: typeof TrendingDown; chip: string }
> = {
  baisse: {
    label: "Baisse de prix",
    icon: TrendingDown,
    chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
  },
  hausse: {
    label: "Hausse de prix",
    icon: TrendingUp,
    chip: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
  },
  nouveau: {
    label: "Nouveau produit",
    icon: PackagePlus,
    chip: "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400",
  },
  retrait: {
    label: "Produit retiré",
    icon: PackageX,
    chip: "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  },
}

function ChangeRow({ change, fresh }: { change: Change; fresh: boolean }) {
  const meta = CHANGE_META[change.type]
  const Icon = meta.icon
  const deltaColor =
    change.type === "baisse"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400"

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-colors sm:gap-4 sm:px-5 ${
        fresh ? "bg-orange-50/70 dark:bg-orange-500/[0.06]" : ""
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.chip}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">
            {change.product}
          </span>
          {fresh && (
            <span className="shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-600 dark:bg-orange-500/15 dark:text-orange-400">
              Nouveau
            </span>
          )}
        </div>
        <div className="truncate text-xs text-gray-500 dark:text-gray-400">
          {meta.label} · {change.site} · {change.time}
        </div>
      </div>
      {change.newPrice && (
        <div className="shrink-0 text-right">
          <div className="text-[13px] font-semibold tabular-nums text-gray-900 dark:text-white">
            {change.oldPrice && (
              <span className="mr-2 hidden font-normal text-gray-400 line-through dark:text-gray-500 sm:inline">
                {change.oldPrice}
              </span>
            )}
            {change.newPrice}
          </div>
          {change.delta && (
            <div className={`text-xs font-semibold tabular-nums ${deltaColor}`}>
              {change.delta}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GapValue({ gap }: { gap: number }) {
  const cheaper = gap < 0
  return (
    <span
      className={`text-[13px] font-semibold tabular-nums ${
        cheaper
          ? "text-red-600 dark:text-red-400"
          : "text-emerald-600 dark:text-emerald-400"
      }`}
    >
      {cheaper ? "−" : "+"}
      {Math.abs(gap).toFixed(1).replace(".", ",")} %
    </span>
  )
}

function RetailersTab() {
  const max = Math.max(...RETAILERS.map((r) => Math.abs(r.gap)))
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 sm:grid-cols-[1.4fr_auto_1fr_auto] sm:px-5">
        <span>Concurrent</span>
        <span className="hidden w-24 text-right sm:block">Produits</span>
        <span className="hidden sm:block">Écart moyen</span>
        <span className="w-20 text-right">vs vous</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
        {RETAILERS.map((r) => (
          <div
            key={r.site}
            className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3.5 sm:grid-cols-[1.4fr_auto_1fr_auto] sm:px-5"
          >
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">
                {r.name}
              </div>
              <div className="truncate text-xs text-gray-400 dark:text-gray-500">
                {r.site}
              </div>
            </div>
            <div className="hidden w-24 text-right text-[13px] tabular-nums text-gray-500 dark:text-gray-400 sm:block">
              {r.products}
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-1.5 w-full max-w-32 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                <div
                  className={`h-full rounded-full ${
                    r.gap < 0 ? "bg-red-400" : "bg-emerald-500"
                  }`}
                  style={{ width: `${(Math.abs(r.gap) / max) * 100}%` }}
                />
              </div>
              <span className="whitespace-nowrap text-[11px] text-gray-400 dark:text-gray-500">
                {r.gap < 0 ? "moins cher que vous" : "plus cher que vous"}
              </span>
            </div>
            <div className="w-20 text-right">
              <GapValue gap={r.gap} />
            </div>
          </div>
        ))}
      </div>
      <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-400 dark:border-white/[0.06] dark:text-gray-500 sm:px-5">
        Écart moyen calculé sur les produits que vous avez en commun avec chaque
        concurrent.
      </p>
    </div>
  )
}

function OpportunitiesTab() {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-4 py-3.5 dark:border-white/[0.06] sm:px-5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Impact potentiel ce mois-ci
        </span>
        <span className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400 [font-family:var(--font-display)]">
          ≈ 3 280 $
        </span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
        {OPPORTUNITIES.map((o) => (
          <div
            key={o.product}
            className="flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                  {o.product}
                </span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                  {o.kind}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {o.detail}
              </div>
            </div>
            <span
              className={`shrink-0 text-[13px] font-semibold tabular-nums ${
                o.tone === "emerald"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-orange-600 dark:text-orange-400"
              }`}
            >
              {o.action}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PriceChart() {
  const w = 520
  const h = 150
  const pad = 6
  const all = [...YOUR_PRICES, ...MARKET_PRICES]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1
  const toPath = (values: number[]) =>
    values
      .map((v, i) => {
        const x = pad + (i / (values.length - 1)) * (w - pad * 2)
        const y = h - pad - ((v - min) / range) * (h - pad * 2)
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(" ")

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <path
          d={toPath(MARKET_PRICES)}
          fill="none"
          strokeWidth="1.5"
          strokeDasharray="5 5"
          className="stroke-gray-300 dark:stroke-gray-600"
        />
        <path
          d={toPath(YOUR_PRICES)}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className="stroke-orange-500"
        />
      </svg>
      <div className="mt-3 flex items-center gap-5 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full bg-orange-500" />
          Votre prix
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-px w-4 border-t border-dashed border-gray-400 dark:border-gray-500" />
          Moy. concurrents
        </span>
      </div>
    </div>
  )
}

function AnalyticsTab() {
  return (
    <div className="grid gap-px bg-gray-100 dark:bg-white/[0.06] lg:grid-cols-[0.85fr_1.15fr]">
      <div className="bg-white p-5 dark:bg-[#0f1011]">
        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Positionnement de prix
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400 [font-family:var(--font-display)]">
            −3,2 %
          </span>
          <span className="text-sm tabular-nums text-gray-500 dark:text-gray-400">
            −1 847,50 $
          </span>
        </div>
        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Écart moyen face à vos 4 concurrents suivis
        </div>
        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Classement
            </span>
            <span className="tabular-nums">
              <strong className="text-gray-900 dark:text-white">1er</strong> / 4
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 dark:bg-white/[0.06]">
            <div className="relative h-full w-full">
              <span className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-orange-500 shadow dark:border-[#0f1011]" />
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-gray-400 dark:text-gray-500">
            <span>1er · prix le plus bas</span>
            <span>4e</span>
          </div>
        </div>
      </div>
      <div className="bg-white p-5 dark:bg-[#0f1011]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Évolution des prix — 12 derniers jours
          </div>
          <div className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
            54 318 $
            <span className="ml-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
              +0,4 %
            </span>
          </div>
        </div>
        <div className="mt-4">
          <PriceChart />
        </div>
      </div>
    </div>
  )
}

/* ── Composant principal ──────────────────────────────── */

export default function DemoSimulator() {
  const [tab, setTab] = useState<TabKey>("changements")
  const [feed, setFeed] = useState<Change[]>(INITIAL_FEED)
  const [freshId, setFreshId] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [lastCheck, setLastCheck] = useState("il y a 12 min")
  const nextIndex = useRef(0)
  const nextId = useRef(INITIAL_FEED.length + 1)

  const runScan = () => {
    if (scanning) return
    setScanning(true)
    window.setTimeout(() => {
      const incoming = INCOMING[nextIndex.current % INCOMING.length]
      nextIndex.current += 1
      const change: Change = {
        ...incoming,
        id: nextId.current++,
        time: "à l'instant",
      }
      setFeed((prev) => [change, ...prev].slice(0, 6))
      setFreshId(change.id)
      setLastCheck("à l'instant")
      setScanning(false)
    }, 1400)
  }

  useEffect(() => {
    if (freshId === null) return
    const t = window.setTimeout(() => setFreshId(null), 3500)
    return () => window.clearTimeout(t)
  }, [freshId])

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_32px_80px_-32px_rgba(0,0,0,0.4)] dark:border-white/10 dark:bg-[#0f1011]">
      {/* Barre de navigateur */}
      <div className="flex items-center gap-4 border-b border-gray-200 px-4 py-3 dark:border-white/10">
        <span className="hidden flex-1 justify-center sm:flex">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-3 py-1 font-mono text-[12px] text-gray-400 dark:bg-white/[0.04] dark:text-gray-500">
            app.go-data.ca/dashboard
          </span>
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[12px] text-gray-400 dark:text-gray-500 sm:ml-0">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Surveillance active
        </span>
      </div>

      {/* Onglets + actions */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-2 dark:border-white/10 sm:px-3">
        <div className="flex overflow-x-auto scrollbar-hide">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`relative shrink-0 px-3 py-3 text-[13px] font-medium transition-colors ${
                tab === t.key
                  ? "text-gray-900 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-orange-500" />
              )}
            </button>
          ))}
        </div>
        <div className="hidden items-center gap-2 py-2 pr-1 sm:flex">
          <span className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-gray-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-500">
            <Search className="h-3.5 w-3.5" />
            <span className="text-[12px]">Rechercher…</span>
          </span>
        </div>
      </div>

      {/* Contenu */}
      {tab === "changements" && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.06] sm:px-5">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                Changements détectés
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500">
                Dernière vérification {lastCheck}
              </div>
            </div>
            <button
              type="button"
              onClick={runScan}
              disabled={scanning}
              className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-70 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`}
              />
              {scanning ? "Scan en cours…" : "Vérifier maintenant"}
            </button>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
            {feed.map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                fresh={change.id === freshId}
              />
            ))}
          </div>
        </div>
      )}
      {tab === "detaillants" && <RetailersTab />}
      {tab === "opportunites" && <OpportunitiesTab />}
      {tab === "analytique" && <AnalyticsTab />}
    </div>
  )
}
