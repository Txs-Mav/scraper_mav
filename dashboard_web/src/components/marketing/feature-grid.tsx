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
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
          {title ?? t("mkt.features.title")}
        </h2>
        <p className="mt-3 text-gray-600 dark:text-gray-400">{subtitle ?? t("mkt.features.subtitle")}</p>
      </div>

      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-white/10 dark:bg-white/10">
        {items.map((it, i) => {
          const Icon = it.icon
          return (
            <div key={i} className="bg-white p-6 dark:bg-[#0b0c0d]">
              <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h3 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">{it.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{it.description}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
