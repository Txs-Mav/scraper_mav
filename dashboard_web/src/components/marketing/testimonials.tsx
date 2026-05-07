"use client"

import { Quote } from "lucide-react"
import { TESTIMONIALS } from "@/lib/marketing-data"
import { useLanguage } from "@/contexts/language-context"

export default function Testimonials() {
  const { t } = useLanguage()
  if (TESTIMONIALS.length === 0) {
    return (
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-8 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Témoignages clients à venir</h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Les citations seront affichées seulement après validation explicite des clients.
          </p>
        </div>
      </section>
    )
  }
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-12 max-w-2xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t("mkt.testimonials.title")}</h2>
        <p className="mt-3 text-lg text-gray-600 dark:text-gray-400">{t("mkt.testimonials.subtitle")}</p>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {TESTIMONIALS.map((tt, i) => (
          <figure
            key={i}
            className="relative p-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] flex flex-col"
          >
            <Quote className="h-6 w-6 text-emerald-500/60 mb-4" />
            <blockquote className="text-base leading-relaxed text-gray-700 dark:text-gray-200 flex-1">
              "{tt.quote}"
            </blockquote>
            {tt.metric && (
              <div className="mt-5 inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/40">
                {tt.metric}
              </div>
            )}
            <figcaption className="mt-5 pt-4 border-t border-gray-100 dark:border-white/10 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-200 to-teal-200 dark:from-emerald-900/40 dark:to-teal-900/40 flex items-center justify-center text-sm font-bold text-emerald-800 dark:text-emerald-200">
                {tt.author.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{tt.author}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {tt.role}, {tt.company}
                </div>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
