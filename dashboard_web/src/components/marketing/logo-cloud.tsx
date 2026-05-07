"use client"

import Image from "next/image"
import { CUSTOMERS } from "@/lib/marketing-data"
import { useLanguage } from "@/contexts/language-context"

export default function LogoCloud() {
  const { t } = useLanguage()
  return (
    <section className="border-y border-gray-200 dark:border-white/[0.06] bg-gray-50/50 dark:bg-white/[0.015]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400 mb-8">
          {t("mkt.logos.title")}
        </p>
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
          {CUSTOMERS.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-center gap-4 h-24 px-6 rounded-2xl text-gray-600 dark:text-gray-300 bg-white/80 dark:bg-white/[0.03] border border-gray-200/60 dark:border-white/[0.05] hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors"
            >
              {c.logo ? (
                <div className="relative h-14 w-28 flex-shrink-0">
                  <Image src={c.logo} alt={c.name} fill sizes="112px" className="object-contain" />
                </div>
              ) : null}
              <span className="sr-only">{c.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
