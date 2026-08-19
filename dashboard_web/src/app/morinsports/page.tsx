import type { Metadata } from "next"
import { DEALER_CAMPAIGNS, isCampaignActive, loadCampaignData } from "@/lib/campaign-demo"
import CampaignDemoClient from "@/components/campaign-demo/campaign-demo-client"
import CampaignClosed from "@/components/campaign-demo/campaign-closed"

const config = DEALER_CAMPAIGNS.morinsports

// Page privée envoyée par courriel : jamais indexée, et le gate campagne
// est réévalué à chaque requête pour que le toggle admin agisse tout de suite.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Go-Data × Morin Sports",
  description:
    "Démo privée Go-Data pour Morin Sports : surveillance de prix, analyse et stratégie de pricing sur l'inventaire réel.",
  robots: { index: false, follow: false },
}

export default async function MorinSportsPage() {
  const active = await isCampaignActive(config.code)
  if (!active) return <CampaignClosed dealerName={config.reference.name} />

  const data = await loadCampaignData(config)
  if (!data) return <CampaignClosed dealerName={config.reference.name} noData />

  return <CampaignDemoClient config={config} data={data} />
}
