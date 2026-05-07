"use client"

import DashboardScaffold from "@/components/dashboard-scaffold"

export default function CompetitorsDiscoveryPage() {
  return (
    <DashboardScaffold
      title="Détection de concurrents"
      subtitle="Piste IA à valider, sans prétendre détecter automatiquement tout le marché."
      actionLabel="Analyser (UI)"
      items={["Définir les sources de découverte.", "Vérifier manuellement les suggestions.", "Éviter les faux positifs.", "Afficher la confiance seulement si calculée."]}
    />
  )
}
