import { Search } from "lucide-react"

type Row = {
  product: string
  category: string
  price: string
  market: string
  delta: number
  spark: number[]
}

const ROWS: Row[] = [
  { product: "Yamaha YZ450F 2024", category: "Motocross", price: "11 999 $", market: "12 460 $", delta: -3.7, spark: [6, 5, 5, 4, 4, 3, 2] },
  { product: "Polaris Sportsman 570", category: "VTT", price: "9 499 $", market: "9 210 $", delta: 3.1, spark: [3, 3, 4, 4, 5, 5, 6] },
  { product: "Ski-Doo Summit 850", category: "Motoneige", price: "17 250 $", market: "17 980 $", delta: -4.1, spark: [7, 6, 6, 5, 4, 4, 3] },
  { product: "Sea-Doo GTX 170", category: "Sea-Doo", price: "16 799 $", market: "17 340 $", delta: -3.1, spark: [5, 5, 4, 4, 4, 3, 3] },
  { product: "Honda CRF250R 2024", category: "Motocross", price: "9 199 $", market: "9 050 $", delta: 1.6, spark: [4, 4, 4, 5, 5, 5, 6] },
  { product: "Kawasaki Ninja 650", category: "Sport", price: "9 999 $", market: "9 999 $", delta: 0, spark: [5, 5, 5, 5, 5, 5, 5] },
]

function Sparkline({ points }: { points: number[] }) {
  const w = 64
  const h = 22
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const step = w / (points.length - 1)
  const coords = points.map((p, i) => {
    const x = i * step
    const y = h - 2 - ((p - min) / range) * (h - 4)
    return [x, y] as const
  })
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  const last = coords[coords.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="1.6" fill="currentColor" />
    </svg>
  )
}

function Delta({ value }: { value: number }) {
  if (value === 0) {
    return <span className="text-gray-400 dark:text-gray-500">0,0 %</span>
  }
  const positive = value > 0
  const color = positive ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
  return (
    <span className={color}>
      {positive ? "+" : "−"}
      {Math.abs(value).toFixed(1).replace(".", ",")} %
    </span>
  )
}

const CHIPS = ["Tous", "Motos", "VTT", "Motoneiges"]

export default function HeroPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)] dark:border-white/10 dark:bg-[#0f1011]">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-white/10">
        <div className="flex items-center">
          <span className="text-[13px] font-medium text-gray-500 dark:text-gray-400">
            Surveillance de marché
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-400 dark:text-gray-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Mis à jour il y a 2 min
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-gray-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-500">
          <Search className="h-3.5 w-3.5" />
          <span className="truncate text-[13px]">Rechercher un produit…</span>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          {CHIPS.map((chip, i) => (
            <span
              key={chip}
              className={
                i === 0
                  ? "rounded-md bg-gray-900 px-2.5 py-1 text-[12px] font-medium text-white dark:bg-white dark:text-gray-900"
                  : "rounded-md px-2.5 py-1 text-[12px] text-gray-500 dark:text-gray-400"
              }
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        <span>Produit</span>
        <span className="w-20 text-right">Mon prix</span>
        <span className="hidden w-20 text-right sm:block">Marché</span>
        <span className="w-16 text-right">Écart</span>
        <span className="hidden w-16 text-right sm:block">7 j</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
        {ROWS.map((row) => (
          <div
            key={row.product}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-gray-900 dark:text-white">
                {row.product}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500">{row.category}</div>
            </div>
            <div className="w-20 text-right text-[13px] font-medium tabular-nums text-gray-900 dark:text-gray-100">
              {row.price}
            </div>
            <div className="hidden w-20 text-right text-[13px] tabular-nums text-gray-500 dark:text-gray-400 sm:block">
              {row.market}
            </div>
            <div className="w-16 text-right text-[13px] font-medium tabular-nums">
              <Delta value={row.delta} />
            </div>
            <div className="hidden w-16 justify-end text-gray-300 dark:text-gray-600 sm:flex">
              <Sparkline points={row.spark} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
