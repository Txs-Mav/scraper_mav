"use client"

import { use } from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowRight, ArrowLeft } from "lucide-react"
import { CASE_STUDIES } from "@/lib/marketing-data"
import CTASection from "@/components/marketing/cta-section"

export default function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const cs = CASE_STUDIES.find((c) => c.slug === slug)
  if (!cs) return notFound()

  return (
    <>
      <article className="max-w-3xl mx-auto px-4 sm:px-6 pt-20 pb-12">
        <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400 hover:gap-2 transition-all">
          <ArrowLeft className="h-3.5 w-3.5" />
          All customers
        </Link>
        <div className="mt-6 text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
          {cs.industry}
        </div>
        <h1 className="mt-3 text-4xl md:text-5xl font-black tracking-tight leading-tight">{cs.title}</h1>
        <p className="mt-5 text-lg text-gray-600 dark:text-gray-300 leading-relaxed">{cs.excerpt}</p>

        {cs.metrics.length > 0 && (
          <div className="mt-10 grid sm:grid-cols-3 gap-3">
            {cs.metrics.map((m, i) => (
              <div key={i} className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-4 text-center">
                <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{m.value}</div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-1">{m.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-12 prose prose-sm md:prose-base dark:prose-invert max-w-none">
          <h2>Fiche client</h2>
          <p>
            {cs.customer} utilise Go-Data dans l'écosystème moto / sports motorisés.
          </p>
          <h2>Cas d'usage</h2>
          <p>
            Centraliser des données publiques, suivre les prix concurrents et rendre l'information plus simple à analyser.
          </p>
        </div>

        <Link
          href="/create-account"
          className="mt-10 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/25"
        >
          Discuter d'un cas similaire
          <ArrowRight className="h-4 w-4" />
        </Link>
      </article>
      <CTASection />
    </>
  )
}
