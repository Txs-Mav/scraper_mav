"use client"

import { Check, X, Sparkles } from "lucide-react"
import { COMPARE_TABLE } from "@/lib/marketing-data"
import { useLanguage } from "@/contexts/language-context"

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <Check className="h-4 w-4 text-emerald-500 mx-auto" />
  if (v === false) return <X className="h-4 w-4 text-gray-300 dark:text-gray-700 mx-auto" />
  if (v === "soon") return <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Soon</span>
  if (v === "limited") return <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Limited</span>
  if (v === "generous") return <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">Generous</span>
  return <span className="text-xs text-gray-500 dark:text-gray-400">{String(v)}</span>
}

export default function CompareTable() {
  const { t } = useLanguage()
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-12 max-w-2xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t("mkt.compare.title")}</h2>
        <p className="mt-3 text-lg text-gray-600 dark:text-gray-400">{t("mkt.compare.subtitle")}</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-white/10">
              <th className="px-5 py-4 text-left font-semibold text-gray-700 dark:text-gray-200 w-2/5">Feature</th>
              <th className="px-5 py-4 text-center font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/20">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Go-Data
                </span>
              </th>
              <th className="px-5 py-4 text-center font-medium text-gray-600 dark:text-gray-300">Apify</th>
              <th className="px-5 py-4 text-center font-medium text-gray-600 dark:text-gray-300">Bright Data</th>
              <th className="px-5 py-4 text-center font-medium text-gray-600 dark:text-gray-300">Octoparse</th>
              <th className="px-5 py-4 text-center font-medium text-gray-600 dark:text-gray-300">ScraperAPI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {COMPARE_TABLE.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                <td className="px-5 py-3.5 text-gray-700 dark:text-gray-200">{row.feature}</td>
                <td className="px-5 py-3.5 text-center bg-emerald-50/30 dark:bg-emerald-950/10">
                  <Cell v={row.goData} />
                </td>
                <td className="px-5 py-3.5 text-center"><Cell v={row.apify} /></td>
                <td className="px-5 py-3.5 text-center"><Cell v={row.brightData} /></td>
                <td className="px-5 py-3.5 text-center"><Cell v={row.octoparse} /></td>
                <td className="px-5 py-3.5 text-center"><Cell v={row.scraperApi} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
