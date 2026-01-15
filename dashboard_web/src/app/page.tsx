"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Check, Zap, BarChart3, Database, Download, Shield, Clock } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"

export default function Home() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  // Redirect to dashboard if user is already logged in
  useEffect(() => {
    if (!isLoading && user) {
      router.replace("/dashboard")
    }
  }, [user, isLoading, router])

  // Show nothing while checking auth or redirecting
  if (isLoading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] dark:bg-[#0a0a0c]">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const plans = [
    {
      name: "Gratuit",
      price: "0€",
      period: "/mois",
      description: "Pour découvrir et tester",
      features: [
        "5 scrapings par mois",
        "Export CSV",
        "1 cible simultanée",
        "Support communautaire",
      ],
      cta: "Commencer gratuitement",
      href: "/create-account?plan=free",
      highlighted: false,
    },
    {
      name: "Standard",
      price: "29€",
      period: "/mois",
      description: "Pour les équipes en croissance",
      features: [
        "100 scrapings par mois",
        "Export CSV, JSON",
        "5 cibles simultanées",
        "Webhooks",
        "Support prioritaire",
      ],
      cta: "Démarrer l'essai",
      href: "/create-account?plan=standard",
      highlighted: true,
    },
    {
      name: "Premium",
      price: "99€",
      period: "/mois",
      description: "Pour les entreprises",
      features: [
        "Scrapings illimités",
        "Tous les formats d'export",
        "Cibles illimitées",
        "API dédiée",
        "Support 24/7",
        "SLA garanti",
      ],
      cta: "Contacter l'équipe",
      href: "/create-account?plan=premium",
      highlighted: false,
    },
  ]

  return (
    <div className="min-h-screen bg-[#fafbfc] dark:bg-[#0a0a0c] text-gray-900 dark:text-white overflow-hidden">
      {/* Animated Grid Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
        {/* Floating squares */}
        <div className="absolute top-20 left-[10%] w-16 h-16 border border-blue-200/30 dark:border-blue-500/10 rounded-lg animate-float-slow" />
        <div className="absolute top-40 right-[15%] w-24 h-24 border border-purple-200/20 dark:border-purple-500/10 rounded-xl animate-float-medium" />
        <div className="absolute top-[60%] left-[5%] w-20 h-20 border border-emerald-200/25 dark:border-emerald-500/10 rounded-lg animate-float-fast" />
        <div className="absolute top-[30%] right-[8%] w-12 h-12 bg-blue-100/40 dark:bg-blue-500/5 rounded-md animate-float-slow" />
        <div className="absolute bottom-[20%] left-[20%] w-28 h-28 border border-gray-200/30 dark:border-gray-500/10 rounded-2xl animate-float-medium" />
        <div className="absolute bottom-[40%] right-[25%] w-14 h-14 bg-purple-100/30 dark:bg-purple-500/5 rounded-lg animate-float-fast" />
        <div className="absolute top-[75%] right-[12%] w-20 h-20 border border-blue-200/20 dark:border-blue-500/8 rounded-xl animate-float-slow" />
        <div className="absolute top-[15%] left-[40%] w-10 h-10 bg-emerald-100/30 dark:bg-emerald-500/5 rounded-md animate-float-medium" />
        {/* Gradient overlays */}
        <div className="absolute top-0 left-0 w-full h-[50%] bg-gradient-to-b from-blue-50/50 via-transparent to-transparent dark:from-blue-950/20" />
        <div className="absolute bottom-0 left-0 w-full h-[30%] bg-gradient-to-t from-[#fafbfc] dark:from-[#0a0a0c] to-transparent" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-6 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative h-11 w-11 flex-shrink-0 rounded-xl bg-gradient-to-br from-white to-gray-100 dark:from-[#1a1a1f] dark:to-[#0f0f12] shadow-lg shadow-black/5 dark:shadow-black/20 p-0.5">
              <div className="relative h-full w-full rounded-[10px] overflow-hidden">
                <Image
                  src="/Go-Data.png"
                  alt="GO-DATA"
                  fill
                  sizes="44px"
                  className="object-contain"
                />
              </div>
            </div>
            <span className="text-xl font-bold tracking-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              GO-DATA
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/login"
              className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Se connecter
            </Link>
            <Link
              href="/create-account"
              className="px-5 py-2.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold hover:bg-gray-800 dark:hover:bg-gray-100 transition-all shadow-lg shadow-gray-900/10 dark:shadow-white/10 hover:shadow-xl hover:shadow-gray-900/15 dark:hover:shadow-white/15 hover:-translate-y-0.5"
            >
              Démarrer
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 px-6">
        {/* Hero Section */}
        <section className="max-w-5xl mx-auto pt-20 pb-24 text-center">
          <p className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-sm font-medium mb-8 border border-blue-100 dark:border-blue-900/50">
            <Zap className="h-4 w-4" />
            La simplicité est la sophistication ultime
          </p>
          <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.1] mb-6">
            Vos données.
            <br />
            <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 bg-clip-text text-transparent">
              Prêtes à l'emploi.
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Go-Data collecte, structure et livre vos données en quelques clics.
            Zéro code, zéro friction.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link
              href="/create-account"
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-blue-600 text-white text-base font-semibold hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30 hover:-translate-y-0.5"
            >
              Commencer gratuitement
              <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="#demo"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white dark:bg-[#1a1a1f] text-gray-900 dark:text-white text-base font-semibold border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 transition-all hover:-translate-y-0.5"
            >
              Voir la démo
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500" />
              Données prêtes en minutes
            </span>
            <span className="inline-flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500" />
              Exports standardisés
            </span>
            <span className="inline-flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500" />
              Aucune installation
            </span>
          </div>
        </section>

        {/* Dashboard Preview Section */}
        <section id="demo" className="max-w-6xl mx-auto pb-32">
          <div className="relative rounded-2xl border border-gray-200/80 dark:border-gray-800/80 bg-white/80 dark:bg-[#111113]/80 backdrop-blur-sm shadow-2xl shadow-gray-900/5 dark:shadow-black/30 overflow-hidden">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-[#0a0a0c]/80">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <div className="flex-1 ml-4">
                <div className="max-w-sm mx-auto px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 text-center">
                  go-data.co/dashboard
                </div>
              </div>
            </div>
            {/* Mock Dashboard Content */}
            <div className="p-6 md:p-8 bg-gradient-to-br from-gray-50 to-white dark:from-[#0f0f12] dark:to-[#111113]">
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                {[
                  { label: "Scrapings ce mois", value: "1,234", change: "+12%" },
                  { label: "Données collectées", value: "45.2K", change: "+8%" },
                  { label: "Taux de succès", value: "99.2%", change: "+0.3%" },
                ].map((stat) => (
                  <div key={stat.label} className="p-5 rounded-xl bg-white dark:bg-[#1a1a1f] border border-gray-100 dark:border-gray-800">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-bold">{stat.value}</span>
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{stat.change}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Chart placeholder */}
              <div className="p-6 rounded-xl bg-white dark:bg-[#1a1a1f] border border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Analytics en temps réel</h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">7 derniers jours</span>
                </div>
                <div className="flex items-end gap-2 h-32">
                  {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                    <div key={i} className="flex-1 bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-md" style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-400">
                  <span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-5xl mx-auto pb-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Comment ça fonctionne</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">Trois étapes. Zéro complexité.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                icon: Database,
                title: "Définissez votre cible",
                description: "Entrez l'URL et sélectionnez les données à extraire. Notre IA détecte automatiquement la structure.",
              },
              {
                step: "02",
                icon: Zap,
                title: "Lancez la collecte",
                description: "Un clic suffit. Go-Data scrape, nettoie et normalise vos données en temps réel.",
              },
              {
                step: "03",
                icon: Download,
                title: "Exportez et intégrez",
                description: "CSV, JSON, webhooks — récupérez vos données dans le format de votre choix.",
              },
            ].map((item) => (
              <div key={item.step} className="relative group">
                <div className="absolute -top-4 -left-2 text-7xl font-black text-gray-100 dark:text-gray-900 select-none group-hover:text-blue-100 dark:group-hover:text-blue-950 transition-colors">
                  {item.step}
                </div>
                <div className="relative p-6 rounded-2xl bg-white dark:bg-[#111113] border border-gray-200 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-900 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-600/5">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mb-4">
                    <item.icon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Features Grid */}
        <section className="max-w-5xl mx-auto pb-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Tout ce dont vous avez besoin</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">Des outils puissants, une expérience simple.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: BarChart3,
                title: "Analytics avancés",
                description: "Visualisez vos données, suivez les tendances et prenez des décisions éclairées avec nos tableaux de bord interactifs.",
              },
              {
                icon: Shield,
                title: "Sécurité maximale",
                description: "Vos données sont chiffrées, protégées et stockées en conformité avec le RGPD. Votre confidentialité est notre priorité.",
              },
              {
                icon: Clock,
                title: "Planification automatique",
                description: "Programmez vos scrapings à la fréquence souhaitée. Recevez vos données fraîches sans lever le petit doigt.",
              },
              {
                icon: Zap,
                title: "Performance IA",
                description: "Notre intelligence artificielle détecte et s'adapte aux changements de structure des sites automatiquement.",
              },
            ].map((feature) => (
              <div key={feature.title} className="p-6 rounded-2xl bg-white dark:bg-[#111113] border border-gray-200 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-900 transition-all group">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="max-w-5xl mx-auto pb-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Tarifs simples et transparents</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400">Commencez gratuitement, évoluez selon vos besoins.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative p-8 rounded-2xl border transition-all hover:-translate-y-1 ${plan.highlighted
                    ? "bg-gradient-to-br from-blue-600 to-blue-700 border-blue-500 text-white shadow-2xl shadow-blue-600/25"
                    : "bg-white dark:bg-[#111113] border-gray-200 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-900"
                  }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white text-blue-600 text-xs font-semibold shadow-lg">
                    Populaire
                  </div>
                )}
                <h3 className={`text-xl font-bold mb-1 ${plan.highlighted ? "text-white" : ""}`}>{plan.name}</h3>
                <p className={`text-sm mb-4 ${plan.highlighted ? "text-blue-100" : "text-gray-500 dark:text-gray-400"}`}>
                  {plan.description}
                </p>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-black">{plan.price}</span>
                  <span className={`text-sm ${plan.highlighted ? "text-blue-100" : "text-gray-500 dark:text-gray-400"}`}>
                    {plan.period}
                  </span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm">
                      <Check className={`h-4 w-4 flex-shrink-0 ${plan.highlighted ? "text-blue-200" : "text-emerald-500"}`} />
                      <span className={plan.highlighted ? "text-blue-50" : "text-gray-600 dark:text-gray-300"}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={`block w-full py-3 rounded-xl text-center text-sm font-semibold transition-all ${plan.highlighted
                      ? "bg-white text-blue-600 hover:bg-blue-50"
                      : "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100"
                    }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* CTA Section */}
        <section className="max-w-4xl mx-auto pb-32">
          <div className="relative p-12 md:p-16 rounded-3xl bg-gradient-to-br from-gray-900 to-gray-800 dark:from-[#1a1a1f] dark:to-[#111113] text-white text-center overflow-hidden">
            {/* Decorative squares */}
            <div className="absolute top-4 left-4 w-20 h-20 border border-white/10 rounded-xl" />
            <div className="absolute bottom-4 right-4 w-16 h-16 border border-white/10 rounded-lg" />
            <div className="absolute top-1/2 right-8 w-12 h-12 bg-white/5 rounded-md" />

            <h2 className="relative text-3xl md:text-4xl font-bold mb-4">
              Prêt à simplifier votre collecte de données ?
            </h2>
            <p className="relative text-lg text-gray-300 mb-8 max-w-xl mx-auto">
              Rejoignez les équipes qui font confiance à Go-Data pour leurs données.
            </p>
            <Link
              href="/create-account"
              className="relative inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-gray-900 text-base font-semibold hover:bg-gray-100 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            >
              Créer un compte gratuit
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-[#0a0a0c]/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="relative h-9 w-9 flex-shrink-0">
                <Image
                  src="/Go-Data.png"
                  alt="GO-DATA"
                  fill
                  sizes="36px"
                  className="object-contain"
                />
              </div>
              <span className="text-lg font-semibold">GO-DATA</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
              <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white transition-colors">
                Confidentialité
              </Link>
              <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white transition-colors">
                Conditions
              </Link>
              <Link href="/contact" className="hover:text-gray-900 dark:hover:text-white transition-colors">
                Contact
              </Link>
            </div>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              © {new Date().getFullYear()} Go-Data. Tous droits réservés.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
