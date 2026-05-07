"use client"

import { useLanguage } from "@/contexts/language-context"

const TERMS = [
  { term: "Donnée publique", desc: "Information accessible publiquement, à traiter dans un cadre légal et responsable." },
  { term: "Scraping", desc: "Collecte automatisée de données depuis des pages web." },
  { term: "Comparaison de prix", desc: "Analyse des écarts entre un prix interne et des prix concurrents observables." },
  { term: "Inventaire concurrent", desc: "Liste des produits ou véhicules visibles sur les sites concurrents." },
  { term: "Alerte", desc: "Notification déclenchée par un changement important à définir." },
  { term: "DPA", desc: "Document encadrant le traitement de données pour un client B2B." },
]

export default function GlossaryPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("glossary.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">{t("glossary.subtitle")}</p>
      </section>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 grid sm:grid-cols-2 gap-4">
        {TERMS.map((item) => (
          <div key={item.term} className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-6">
            <h2 className="text-lg font-bold">{item.term}</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </section>
    </>
  )
}
