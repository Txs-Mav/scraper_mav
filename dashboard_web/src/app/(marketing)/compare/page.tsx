"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { COMPETITORS_FOR_COMPARE } from "@/lib/marketing-data"
import CompareTable from "@/components/marketing/compare-table"

export default function ComparePage() {
  return (
    <>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-4xl md:text-6xl font-black tracking-tight">Compare Go-Data</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">See how Go-Data stacks against the major scraping & price intelligence platforms.</p>
      </section>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {COMPETITORS_FOR_COMPARE.map((c) => (
          <Link
            key={c.slug}
            href={`/compare/${c.slug}`}
            className="p-5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] hover:border-emerald-300 dark:hover:border-emerald-800 transition-all"
          >
            <div className="text-base font-bold">vs {c.name}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{c.positioning}</div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Read comparison <ArrowRight className="h-3 w-3" />
            </div>
          </Link>
        ))}
      </section>
      <CompareTable />
    </>
  )
}
