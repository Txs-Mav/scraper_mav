"use client"

import DashboardScaffold from "@/components/dashboard-scaffold"

export default function WebhooksPage() {
  return (
    <DashboardScaffold
      title="Webhooks"
      subtitle="Notifications HTTP à connecter aux vrais événements du produit."
      actionLabel="Créer un webhook (UI)"
      items={["Définir les événements réels.", "Signer les payloads.", "Ajouter historique de livraison.", "Ajouter bouton de test avec payload vérifié."]}
    />
  )
}
