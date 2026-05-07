"use client"

import Layout from "@/components/kokonutui/layout"

export default function DashboardChangelogPage() {
  return (
    <Layout>
      <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Changelog</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Historique produit à alimenter uniquement avec les releases réellement livrées.
        </p>
      </section>
    </Layout>
  )
}
