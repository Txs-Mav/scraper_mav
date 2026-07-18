"use client"

import { TESTIMONIALS } from "@/lib/marketing-data"
import { useLanguage } from "@/contexts/language-context"

export default function Testimonials() {
  const { t } = useLanguage()
  if (TESTIMONIALS.length === 0) {
    return (
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-white/15">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Témoignages clients à venir</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
            Les citations seront publiées uniquement après validation explicite des clients.
          </p>
        </div>
      </section>
    )
  }
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
          {t("mkt.testimonials.title")}
        </h2>
        <p className="mt-3 text-gray-600 dark:text-gray-400">{t("mkt.testimonials.subtitle")}</p>
      </div>
      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 md:grid-cols-2 lg:grid-cols-3 dark:border-white/10 dark:bg-white/10">
        {TESTIMONIALS.map((tt, i) => (
          <figure key={i} className="flex flex-col bg-white p-6 dark:bg-[#0b0c0d]">
            <blockquote className="flex-1 text-[15px] leading-relaxed text-gray-700 dark:text-gray-200">
              “{tt.quote}”
            </blockquote>
            {tt.metric && (
              <div className="mt-5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {tt.metric}
              </div>
            )}
            <figcaption className="mt-5 flex items-center gap-3 border-t border-gray-100 pt-4 dark:border-white/10">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700 dark:bg-white/10 dark:text-gray-200">
                {tt.author.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{tt.author}</div>
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
