"use client"

import { use } from "react"
import DashboardScaffold from "@/components/dashboard-scaffold"

export default function AdvancedScraperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <DashboardScaffold
      title={`Configuration avancée du scraper ${id}`}
      subtitle="Options techniques à cadrer avant activation."
      items={["Rendu JavaScript à valider.", "Proxies à définir.", "Gestion captcha à documenter.", "Limiter les claims anti-bot publics."]}
    />
  )
}
