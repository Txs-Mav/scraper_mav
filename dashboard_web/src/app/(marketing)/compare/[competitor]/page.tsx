"use client"

import { use } from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowRight, Sparkles } from "lucide-react"
import { COMPETITORS_FOR_COMPARE } from "@/lib/marketing-data"
import CompareTable from "@/components/marketing/compare-table"
import CTASection from "@/components/marketing/cta-section"

export default function ComparePage({ params }: { params: Promise<{ competitor: string }> }) {
  const { competitor } = use(params)
  const comp = COMPETITORS_FOR_COMPARE.find((c) => c.slug === competitor)
  if (!comp) return notFound()

  return (
    <>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold uppercase tracking-wider border border-emerald-100 dark:border-emerald-900/40">
          <Sparkles className="h-3 w-3" />
          Competitor comparison
        </span>
        <h1 className="mt-5 text-4xl md:text-6xl font-black tracking-tight leading-tight">
          Go-Data <span className="text-gray-400">vs</span> {comp.name}
        </h1>
        <p className="mt-5 text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">{comp.oneLiner}</p>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid md:grid-cols-2 gap-5">
        <div className="p-6 rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Go-Data</div>
          <h3 className="mt-2 text-xl font-bold">Positionnement à défendre</h3>
          <ul className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-200 list-disc pl-5">
            <li>Dashboard métier déjà plus proche des opérateurs.</li>
            <li>Focus actuel sur la comparaison de prix et le vertical moto.</li>
            <li>API, webhooks et intégrations à présenter comme roadmap.</li>
            <li>Crédibilité à bâtir avec des preuves client validées.</li>
          </ul>
        </div>
        <div className="p-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{comp.name}</div>
          <h3 className="mt-2 text-xl font-bold">{comp.positioning}</h3>
          <ul className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-200 list-disc pl-5">
            <li>Acteur plus mature ou plus spécialisé selon le cas.</li>
            <li>Comparer sans prétendre être déjà au même niveau enterprise.</li>
            <li>Identifier l'angle de différenciation utile pour Go-Data.</li>
          </ul>
        </div>
      </section>

      <CompareTable />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
        <p className="text-lg text-gray-700 dark:text-gray-200">
          Cette page doit servir à clarifier le positionnement, pas à inventer des résultats de migration depuis <strong>{comp.name}</strong>.
        </p>
        <Link
          href="/create-account"
          className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/25"
        >
          Discuter de votre besoin
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <CTASection />
    </>
  )
}
