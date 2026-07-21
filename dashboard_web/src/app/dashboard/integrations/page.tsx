"use client"

import Link from "next/link"
import Layout from "@/components/kokonutui/layout"

const INTEGRATIONS = [
  { slug: "google-sheets", name: "Google Sheets", status: "à connecter" },
  { slug: "slack", name: "Slack", status: "à connecter" },
  { slug: "shopify", name: "Shopify", status: "à venir" },
  { slug: "webhook", name: "Webhook personnalisé", status: "à connecter" },
]

export default function IntegrationsPage() {
  return (
    <Layout>
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Intégrations</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Catalogue préparatoire. Ne pas présenter ces intégrations comme actives tant qu'elles ne sont pas branchées.
          </p>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {INTEGRATIONS.map((item) => (
            <Link key={item.slug} href={`/dashboard/integrations/${item.slug}`} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-5 hover:border-orange-500 transition-colors">
              <h2 className="font-semibold text-[var(--color-text-primary)]">{item.name}</h2>
              <span className="mt-3 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                {item.status}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </Layout>
  )
}
