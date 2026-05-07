"use client"

import { useLanguage } from "@/contexts/language-context"
import CTASection from "@/components/marketing/cta-section"

export default function PartnersPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("partners.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">{t("partners.subtitle")}</p>
      </section>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-8 text-center">
          <h2 className="text-2xl font-bold">Programme à structurer</h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Cette page permet de capter l'intérêt, sans afficher de commissions, revenus ou partenaires non confirmés.
          </p>
        </div>
      </section>
      <CTASection primaryHref="/contact?topic=partnerships" primaryLabel={t("partners.apply")} />
    </>
  )
}
