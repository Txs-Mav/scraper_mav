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
    <section className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
        {t("mkt.cases.title")}
      </h2>
      <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 md:grid-cols-2 lg:grid-cols-3 dark:border-white/10 dark:bg-white/10">
        {list.map((c) => (
          <Link
            key={c.slug}
            href={`/customers/${c.slug}`}
            className="group flex flex-col bg-white p-6 transition-colors hover:bg-gray-50 dark:bg-[#0b0c0d] dark:hover:bg-white/[0.02]"
          >
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{c.industry}</div>
            <h3 className="mt-2 text-lg font-semibold leading-snug text-gray-900 dark:text-white">{c.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{c.excerpt}</p>
            {c.metrics.length > 0 && (
              <div className="mt-5 grid grid-cols-3 gap-4 border-t border-gray-100 pt-4 dark:border-white/10">
                {c.metrics.map((m, i) => (
                  <div key={i}>
                    <div className="text-base font-semibold tabular-nums text-gray-900 dark:text-white">{m.value}</div>
                    <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{m.label}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {t("mkt.cases.read")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
