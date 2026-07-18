import Link from "next/link"
import { ArrowRight } from "lucide-react"

export default function CTASection({
  title = "Prêt à simplifier votre veille de prix ?",
  subtitle = "Commencez avec un cas concret : vos concurrents, vos produits, votre marché.",
  primaryHref = "/create-account",
  primaryLabel = "Créer un compte",
  secondaryHref = "/contact",
  secondaryLabel = "Parler à Go-Data",
}: {
  title?: string
  subtitle?: string
  primaryHref?: string
  primaryLabel?: string
  secondaryHref?: string
  secondaryLabel?: string
}) {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-14 text-center dark:border-white/10 dark:bg-[#0f1011]">
        <h2 className="mx-auto max-w-xl text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
          {title}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-gray-600 dark:text-gray-400">{subtitle}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={primaryHref}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 sm:w-auto"
          >
            {primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href={secondaryHref}
            className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 sm:w-auto dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/[0.04]"
          >
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  )
}
