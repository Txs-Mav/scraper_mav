"use client"

import type { LucideIcon } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

export type FeatureItem = {
  icon: LucideIcon
  title: string
  description: string
}

export default function FeatureGrid({ items, title, subtitle }: { items: FeatureItem[]; title?: string; subtitle?: string }) {
  const { t } = useLanguage()
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-12 max-w-2xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{title ?? t("mkt.features.title")}</h2>
        <p className="mt-3 text-lg text-gray-600 dark:text-gray-400">{subtitle ?? t("mkt.features.subtitle")}</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((it, i) => {
          const Icon = it.icon
          return (
            <div key={i} className="p-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] hover:border-emerald-300 dark:hover:border-emerald-800 transition-colors">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/30 mb-4">
                <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{it.title}</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{it.description}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
