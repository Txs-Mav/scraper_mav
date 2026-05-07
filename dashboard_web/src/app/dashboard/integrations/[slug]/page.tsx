"use client"

import { use } from "react"
import DashboardScaffold from "@/components/dashboard-scaffold"

export default function IntegrationDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  return (
    <DashboardScaffold
      title={`Intégration : ${slug}`}
      subtitle="Détail préparatoire de l'intégration."
      actionLabel="Connecter (désactivé tant que non branché)"
      items={["Ajouter OAuth ou clé API réelle.", "Définir les permissions.", "Tester les exports.", "Documenter le statut avant publication."]}
    />
  )
}
