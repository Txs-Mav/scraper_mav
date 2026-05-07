"use client"

import AlertRuleBuilder from "@/components/alert-rule-builder"
import Layout from "@/components/kokonutui/layout"

export default function AlertRulesPage() {
  return (
    <Layout>
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Règles d'alertes</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Builder UI à connecter aux vrais événements et canaux de notification.
          </p>
        </div>
        <AlertRuleBuilder />
      </section>
    </Layout>
  )
}
