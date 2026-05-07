"use client"

import { useLanguage } from "@/contexts/language-context"

const ARTICLES = [
  "Créer un premier scraper",
  "Comprendre une comparaison de prix",
  "Exporter ses données",
  "Préparer une alerte",
  "Gérer son abonnement",
]

export default function HelpPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("help.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">{t("help.subtitle")}</p>
      </section>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 grid sm:grid-cols-2 gap-4">
        {ARTICLES.map((article) => (
          <div key={article} className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-6">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Article à rédiger</div>
            <h2 className="mt-2 text-lg font-bold">{article}</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">À compléter en français avec captures d'écran réelles.</p>
          </div>
        ))}
      </section>
    </>
  )
}
