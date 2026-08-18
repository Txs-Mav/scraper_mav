import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { isFalardeauCampaignActive, loadFalardeauData } from "@/lib/falardeau-campaign"
import FalardeauClient from "./falardeau-client"

// Page privée envoyée par courriel : jamais indexée, et le gate campagne
// est réévalué à chaque requête pour que le toggle admin agisse tout de suite.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Go-Data × Moto Falardeau",
  description:
    "Démo privée Go-Data pour Moto Falardeau : surveillance de prix, analyse et stratégie de pricing sur l'inventaire réel.",
  robots: { index: false, follow: false },
}

export default async function FalardeauPage() {
  const active = await isFalardeauCampaignActive()
  if (!active) return <ClosedScreen />

  const data = await loadFalardeauData()
  if (!data) return <ClosedScreen noData />

  return <FalardeauClient data={data} />
}

/** Écran affiché quand la campagne est désactivée depuis /admin/campagnes
    (ou que les données référence ne sont pas encore disponibles). */
function ClosedScreen({ noData = false }: { noData?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#fafafa] px-6 text-center dark:bg-[#0b0c0d]">
      <span className="relative h-12 w-12 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 dark:ring-white/10">
        <Image src="/Go-Data.svg" alt="Go-Data" fill sizes="48px" className="object-contain p-1.5" />
      </span>
      <div>
        <p className="text-[16px] font-semibold text-gray-900 dark:text-white">
          {noData
            ? "Cette page est en cours de préparation."
            : "Cette page privée n'est plus active."}
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
          {noData
            ? "Les données de Moto Falardeau seront disponibles très bientôt. Revenez dans quelques minutes."
            : "La démonstration Moto Falardeau a été fermée par l'équipe Go-Data."}
        </p>
      </div>
      <Link
        href="/contact"
        className="flex h-11 items-center gap-2 rounded-xl bg-orange-600 px-5 text-[14px] font-semibold text-white transition-all hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
      >
        Contacter Go-Data
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
