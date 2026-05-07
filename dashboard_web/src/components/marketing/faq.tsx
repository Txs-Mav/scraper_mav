"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

type FaqItem = { q: string; a: string }

export default function FAQ({ items, title }: { items: FaqItem[]; title?: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{title ?? t("mkt.faq.title")}</h2>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full text-left rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-5 transition-all hover:border-emerald-300 dark:hover:border-emerald-800"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="text-base font-semibold text-gray-900 dark:text-white">{it.q}</span>
              <ChevronDown
                className={`h-5 w-5 text-gray-400 flex-shrink-0 transition-transform ${open === i ? "rotate-180" : ""}`}
              />
            </div>
            {open === i && (
              <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{it.a}</p>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
