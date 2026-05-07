"use client"

import DashboardScaffold from "@/components/dashboard-scaffold"

export default function ApiKeysPage() {
  return (
    <DashboardScaffold
      title="Clés API"
      subtitle="Interface à préparer avant ouverture d'une API publique."
      actionLabel="Créer une clé (UI)"
      items={[
        "Définir les scopes réels.",
        "Ajouter stockage sécurisé et révocation.",
        "Créer rate limits et logs d'utilisation.",
        "Publier la documentation seulement après stabilisation.",
      ]}
    />
  )
}
