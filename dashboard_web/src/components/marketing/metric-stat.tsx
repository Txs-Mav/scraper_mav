"use client"

import { METRICS } from "@/lib/marketing-data"
import { useLanguage } from "@/contexts/language-context"

const labels: Record<string, string> = {
  "metrics.companies": "mkt.metrics.companies",
  "metrics.products": "mkt.metrics.products",
  "metrics.requests": "mkt.metrics.requests",
  "metrics.success": "mkt.metrics.success",
  "metrics.uptime": "mkt.metrics.uptime",
  "metrics.countries": "mkt.metrics.countries",
}

export default function MetricsRow() {
  const { t } = useLanguage()
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t("mkt.metrics.title")}</h2>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-6 lg:gap-4">
        {METRICS.map((m) => (
          <div key={m.label} className="text-center p-5 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
            <div className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-br from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              {m.value}
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-snug">{t(labels[m.label] || m.label)}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
