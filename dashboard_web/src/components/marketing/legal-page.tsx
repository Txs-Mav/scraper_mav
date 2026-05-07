"use client"

import type { ReactNode } from "react"

export default function LegalPage({ title, lastUpdated, children }: { title: string; lastUpdated: string; children: ReactNode }) {
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 pt-20 pb-24">
      <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
        Dernière mise à jour : {lastUpdated}
      </div>
      <h1 className="mt-3 text-4xl md:text-5xl font-black tracking-tight">{title}</h1>
      <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none mt-10">{children}</div>
    </article>
  )
}
