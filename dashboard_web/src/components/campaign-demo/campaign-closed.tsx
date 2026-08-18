import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"

/** Écran affiché quand une campagne est désactivée depuis /admin/campagnes
    (ou que les données du référent ne sont pas encore disponibles). */
export default function CampaignClosed({
  dealerName, noData = false,
}: {
  dealerName: string
  noData?: boolean
}) {
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
            ? `Les données de ${dealerName} seront disponibles très bientôt. Revenez dans quelques minutes.`
            : `La démonstration ${dealerName} a été fermée par l'équipe Go-Data.`}
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
