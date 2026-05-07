"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, BarChart3, Check, Download, Radar, Zap } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import LogoCloud from "@/components/marketing/logo-cloud"
import CTASection from "@/components/marketing/cta-section"

export default function MarketingHomePage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user) router.replace("/dashboard")
  }, [user, isLoading, router])

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (user) return null

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.025)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-emerald-500/15 dark:bg-emerald-500/[0.07] rounded-full blur-[120px]" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-20 pb-16 text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold uppercase tracking-wider border border-emerald-100 dark:border-emerald-900/40">
            <Zap className="h-3 w-3" />
            Veille de prix pour le marché moto
          </span>

          <h1 className="mt-6 text-5xl sm:text-6xl md:text-7xl font-black tracking-tight leading-[1.05]">
            Comparez vos prix concurrents.
            <br />
            <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 bg-clip-text text-transparent">
              Sans tableurs.
            </span>
          </h1>

          <p className="mt-6 text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Go-Data aide les concessionnaires et acteurs du marché moto à collecter, structurer et comparer des données publiques de prix et d'inventaire.
          </p>

          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/create-account"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-600/25"
            >
              Commencer
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white dark:bg-white/[0.05] text-gray-900 dark:text-white font-semibold border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 transition-all"
            >
              Voir la démo
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500 dark:text-gray-400">
            {["Prix publics", "Inventaires concurrents", "Exports exploitables"].map((item) => (
              <span key={item} className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-500" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <LogoCloud />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              icon: Radar,
              title: "Surveiller le marché",
              description: "Suivez les prix et disponibilités visibles publiquement sur les sites que vous voulez comparer.",
            },
            {
              icon: BarChart3,
              title: "Comparer rapidement",
              description: "Repérez les écarts de prix et priorisez les produits à vérifier, sans refaire le travail à la main.",
            },
            {
              icon: Download,
              title: "Exporter les données",
              description: "Récupérez des données structurées pour vos analyses internes, vos suivis et vos décisions commerciales.",
            },
          ].map((item) => {
            const Icon = item.icon
            return (
              <div key={item.title} className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-6">
                <Icon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                <h2 className="mt-4 text-lg font-bold">{item.title}</h2>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{item.description}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="rounded-3xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-8 md:p-10">
          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">2 à 5 h</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">temps économisé estimé / semaine</div>
            </div>
            <div>
              <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">1 endroit</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">pour centraliser la veille</div>
            </div>
            <div>
              <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">FR</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">interface pensée en français</div>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
            Estimations indicatives selon le volume de sites suivis et la fréquence de vérification manuelle actuelle.
          </p>
        </div>
      </section>

      <CTASection
        title="Prêt à simplifier votre veille de prix ?"
        subtitle="Commencez avec un cas concret : vos concurrents, vos produits, votre marché."
        primaryHref="/create-account"
        primaryLabel="Créer un compte"
        secondaryHref="/contact"
        secondaryLabel="Parler à Go-Data"
      />
    </>
  )
}
