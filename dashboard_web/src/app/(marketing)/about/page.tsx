"use client"

import { Compass, Heart, ShieldCheck, Users } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import CTASection from "@/components/marketing/cta-section"

const PRINCIPES = [
  {
    icon: ShieldCheck,
    title: "Preuves avant promesses",
    body: "Aucun chiffre, témoignage ou logo ne doit être affiché sans validation.",
  },
  {
    icon: Compass,
    title: "Focus vertical",
    body: "Le marché moto / sports motorisés reste le point de départ le plus clair.",
  },
  {
    icon: Heart,
    title: "Produit utile avant storytelling",
    body: "Le narratif doit servir le produit réel, pas masquer ce qui reste à construire.",
  },
  {
    icon: Users,
    title: "Clients réels",
    body: "MVM Motosport et Moto DB sont les références publiques actuelles à garder visibles.",
  },
]

export default function AboutPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-12 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("about.title")}</h1>
        <p className="mt-5 text-lg md:text-xl text-gray-600 dark:text-gray-300 leading-relaxed">{t("about.subtitle")}</p>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-3xl border border-gray-200 dark:border-white/10 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/20 dark:to-[#1a1c1e] p-10 text-center">
          <h2 className="text-3xl font-bold">{t("about.mission.title")}</h2>
          <p className="mt-4 text-lg text-gray-700 dark:text-gray-200 max-w-2xl mx-auto">{t("about.mission.body")}</p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-10">{t("about.values.title")}</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          {PRINCIPES.map((v) => {
            const Icon = v.icon
            return (
              <div key={v.title} className="p-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
                <Icon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                <h3 className="mt-3 text-lg font-bold">{v.title}</h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{v.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-8">{t("about.timeline.title")}</h2>
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-6 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          Le parcours public doit rester simple : Go-Data travaille aujourd'hui avec des clients réels dans le marché moto / sports motorisés.
          Les jalons comme une levée de fonds, une certification ou une expansion internationale ne doivent pas être affichés tant qu'ils ne sont pas factuels.
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-8">{t("about.team.title")}</h2>
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-6 text-center text-sm text-gray-600 dark:text-gray-300">
          L'équipe publique sera présentée lorsque les profils à afficher seront confirmés.
        </div>
      </section>

      <CTASection
        title="Faire grandir Go-Data sans perdre la crédibilité."
        subtitle="La prochaine étape est de transformer les vrais cas clients en preuves publiables."
        primaryHref="/contact"
        primaryLabel="Nous contacter"
      />
    </>
  )
}
