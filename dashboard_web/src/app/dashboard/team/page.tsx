"use client"

import DashboardScaffold from "@/components/dashboard-scaffold"

export default function TeamPage() {
  return (
    <DashboardScaffold
      title="Équipe & rôles"
      subtitle="Gestion multi-utilisateur à préparer."
      actionLabel="Inviter un membre (UI)"
      items={["Définir rôles : propriétaire, admin, éditeur, lecteur.", "Ajouter invitations email.", "Brancher permissions côté serveur.", "Ajouter audit log réel."]}
    />
  )
}
