"use client"

import Layout from "@/components/kokonutui/layout"

export default function DashboardScaffold({
  title,
  subtitle,
  items,
  actionLabel,
}: {
  title: string
  subtitle: string
  items?: string[]
  actionLabel?: string
}) {
  return (
    <Layout>
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{title}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{subtitle}</p>
        </div>
        <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Écran préparatoire</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Cette interface est prête côté UI, mais doit être branchée au backend et validée commercialement avant d'être présentée comme livrée.
          </p>
          {items && (
            <ul className="mt-5 space-y-2 text-sm text-[var(--color-text-secondary)] list-disc pl-5">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {actionLabel && (
            <button className="mt-5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
              {actionLabel}
            </button>
          )}
        </div>
      </section>
    </Layout>
  )
}
