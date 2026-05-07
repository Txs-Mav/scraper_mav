"use client"

import { useLanguage } from "@/contexts/language-context"

export default function CareersPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-12 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("careers.title")}</h1>
        <p className="mt-5 text-lg md:text-xl text-gray-600 dark:text-gray-300 leading-relaxed">{t("careers.subtitle")}</p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-8 text-center">
          <h2 className="text-2xl font-bold">{t("careers.openRoles")}</h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Aucun poste public n'est annoncé pour le moment. Cette page est prête pour de futures ouvertures réelles.
          </p>
        </div>
      </section>
    </>
  )
}
