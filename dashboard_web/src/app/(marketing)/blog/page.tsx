"use client"

import { useLanguage } from "@/contexts/language-context"

const TOPICS = [
  "Comparer les prix concurrents dans le marché moto",
  "Structurer un inventaire public pour l'analyse",
  "Créer une preuve client sans inventer de métriques",
  "Préparer une stratégie SEO autour d'un vertical précis",
]

export default function BlogPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("blog.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">{t("blog.subtitle")}</p>
      </section>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid sm:grid-cols-2 gap-4">
          {TOPICS.map((topic) => (
            <div key={topic} className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Sujet à écrire</div>
              <h2 className="mt-2 text-lg font-bold">{topic}</h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Article à rédiger avec données vérifiées et exemples réels.</p>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
