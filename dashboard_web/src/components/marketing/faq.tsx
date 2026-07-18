"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

type FaqItem = { q: string; a: string }

export default function FAQ({ items, title }: { items: FaqItem[]; title?: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="mx-auto max-w-3xl px-6 py-20">
      <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
        {title ?? t("mkt.faq.title")}
      </h2>
      <div className="mt-8 divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/10 dark:border-white/10">
        {items.map((it, i) => (
          <div key={i}>
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between gap-4 py-5 text-left"
            >
              <span className="text-[15px] font-medium text-gray-900 dark:text-white">{it.q}</span>
              <ChevronDown
                className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open === i ? "rotate-180" : ""}`}
              />
            </button>
            {open === i && (
              <p className="-mt-1 pb-5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{it.a}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
