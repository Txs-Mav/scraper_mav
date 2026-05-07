"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

export default function CTASection({ title, subtitle, primaryHref = "/create-account", primaryLabel, secondaryHref = "/contact", secondaryLabel }: {
  title?: string
  subtitle?: string
  primaryHref?: string
  primaryLabel?: string
  secondaryHref?: string
  secondaryLabel?: string
}) {
  const { t } = useLanguage()
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-gray-900 to-emerald-950 dark:from-emerald-950 dark:to-gray-950 text-white p-10 md:p-16 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.15),transparent_50%)] pointer-events-none" />
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-48 h-48 rounded-full bg-teal-500/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <h2 className="text-3xl md:text-5xl font-black tracking-tight max-w-2xl mx-auto leading-tight">
            {title ?? t("mkt.cta.title")}
          </h2>
          <p className="mt-5 text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
            {subtitle ?? t("mkt.cta.subtitle")}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href={primaryHref}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white text-gray-900 font-semibold hover:bg-gray-100 transition-all shadow-xl shadow-black/20"
            >
              {primaryLabel ?? t("mkt.cta.primary")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={secondaryHref}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/15 transition-all border border-white/20 backdrop-blur"
            >
              {secondaryLabel ?? t("mkt.cta.secondary")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
