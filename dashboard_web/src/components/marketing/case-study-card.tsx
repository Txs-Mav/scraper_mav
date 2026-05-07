"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { CASE_STUDIES } from "@/lib/marketing-data"
import { useLanguage } from "@/contexts/language-context"

export default function CaseStudiesGrid({ limit, vertical }: { limit?: number; vertical?: string }) {
  const { t } = useLanguage()
  let list = CASE_STUDIES
  if (vertical) list = list.filter((c) => c.vertical === vertical)
  if (limit) list = list.slice(0, limit)

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-12 max-w-2xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t("mkt.cases.title")}</h2>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {list.map((c) => (
          <Link
            key={c.slug}
            href={`/customers/${c.slug}`}
            className="group p-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] hover:border-emerald-300 dark:hover:border-emerald-800 transition-all hover:-translate-y-0.5 flex flex-col"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              {c.industry}
            </div>
            <h3 className="mt-3 text-xl font-bold text-gray-900 dark:text-white leading-snug">{c.title}</h3>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed flex-1">{c.excerpt}</p>
            {c.metrics.length > 0 && (
              <div className="mt-5 grid grid-cols-3 gap-2">
                {c.metrics.map((m, i) => (
                  <div key={i} className="rounded-lg bg-gray-50 dark:bg-white/[0.04] p-2 text-center">
                    <div className="text-sm font-bold text-gray-900 dark:text-white">{m.value}</div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 group-hover:gap-2 transition-all">
              {t("mkt.cases.read")} <ArrowRight className="h-4 w-4" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
