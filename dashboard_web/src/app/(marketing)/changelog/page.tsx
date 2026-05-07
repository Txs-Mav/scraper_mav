"use client"

import { useLanguage } from "@/contexts/language-context"

export default function ChangelogPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("changelog.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">{t("changelog.subtitle")}</p>
      </section>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-8 text-center">
          <h2 className="text-2xl font-bold">Historique à connecter</h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Aucun faux lancement n'est affiché. Le changelog sera alimenté par les releases réelles.
          </p>
        </div>
      </section>
    </>
  )
}
