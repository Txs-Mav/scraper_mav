"use client"

export default function AlertRuleBuilder() {
  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6">
      <div className="grid md:grid-cols-3 gap-4">
        <label className="space-y-2">
          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Quand</span>
          <select className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-transparent px-3 py-2 text-sm">
            <option>Écart de prix détecté</option>
            <option>Produit absent</option>
            <option>Nouveau produit concurrent</option>
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Condition</span>
          <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-transparent px-3 py-2 text-sm" placeholder="Ex. écart supérieur à..." />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Notifier</span>
          <select className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-transparent px-3 py-2 text-sm">
            <option>Email</option>
            <option>Webhook (à venir)</option>
            <option>Slack (à venir)</option>
          </select>
        </label>
      </div>
      <p className="mt-4 text-xs text-[var(--color-text-secondary)]">
        UI seulement : les règles doivent être persistées et exécutées côté serveur avant activation.
      </p>
    </div>
  )
}
