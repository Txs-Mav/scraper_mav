"use client"

import DashboardScaffold from "@/components/dashboard-scaffold"

export default function ReportsPage() {
  return (
    <DashboardScaffold
      title="Rapports planifiés"
      subtitle="Rapports email / PDF / CSV à connecter aux exports réels."
      actionLabel="Créer un rapport (UI)"
      items={["Définir formats disponibles.", "Brancher génération PDF/CSV.", "Ajouter fréquence et destinataires.", "Tracer les envois."]}
    />
  )
}
