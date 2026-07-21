"use client"

import Layout from "@/components/kokonutui/layout"

const TEMPLATES = [
  "Concessionnaires moto",
  "Pièces moto",
  "Véhicules récréatifs",
]

export default function MarketplacePage() {
  return (
    <Layout>
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Marketplace de scrapers</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Catalogue préparatoire centré sur le vertical actuel. Aucun faux scraper de grandes plateformes n'est affiché.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {TEMPLATES.map((template) => (
            <div key={template} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5">
              <h2 className="font-semibold text-[var(--color-text-primary)]">{template}</h2>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Modèle à connecter et valider avant publication.</p>
              <button className="mt-4 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white">Installer (UI)</button>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  )
}
