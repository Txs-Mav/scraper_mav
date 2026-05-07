"use client"

import Layout from "@/components/kokonutui/layout"

const TEMPLATES = [
  "Concessionnaire moto / sports motorisés",
  "Pièces et accessoires moto",
  "Comparaison de prix simple",
]

export default function DashboardOnboardingPage() {
  return (
    <Layout>
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Onboarding</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Templates en français, centrés sur les cas d'usage réellement crédibles aujourd'hui.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {TEMPLATES.map((template) => (
            <div key={template} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5">
              <h2 className="font-semibold text-[var(--color-text-primary)]">{template}</h2>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Préconfiguration à connecter au formulaire de scraper.</p>
              <button className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Utiliser ce modèle</button>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  )
}
