"use client"

import { Bell, BarChart3, Brain, ShieldCheck, Calendar, Users } from "lucide-react"
import VerticalHero from "@/components/marketing/vertical-hero"
import FeatureGrid from "@/components/marketing/feature-grid"
import CaseStudiesGrid from "@/components/marketing/case-study-card"
import Testimonials from "@/components/marketing/testimonials"
import CTASection from "@/components/marketing/cta-section"
import FAQ from "@/components/marketing/faq"
import { useLanguage } from "@/contexts/language-context"

export default function DealersVertical() {
  const { t } = useLanguage()
  return (
    <>
      <VerticalHero
        eyebrow={t("vertical.dealers.eyebrow")}
        title={t("vertical.dealers.title")}
        subtitle={t("vertical.dealers.subtitle")}
        metrics={[
          { value: "+7%", label: t("vertical.dealers.metric1") },
          { value: "−4h", label: t("vertical.dealers.metric2") },
          { value: "12+", label: t("vertical.dealers.metric3") },
        ]}
        ctaPrimary={{ href: "/create-account?ref=dealers", label: t("vertical.dealers.cta") }}
        ctaSecondary={{ href: "/customers/mvm-motosport", label: "Voir la fiche MVM Motosport" }}
        benefits={[
          "Focus actuel : concessionnaires moto / sports motorisés",
          "Clients réels : MVM Motosport et Moto DB",
          "Comparaison de prix publics",
          "Interface en français prioritaire",
        ]}
        visual={
          <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-6 shadow-2xl">
            <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">Exemple d'interface</div>
            <div className="mt-4 space-y-3">
              {[
                { name: "Produit exemple A", you: "Votre prix", best: "Prix concurrent", delta: "Écart", action: "À analyser" },
                { name: "Produit exemple B", you: "Votre prix", best: "Prix concurrent", delta: "Écart", action: "À analyser" },
                { name: "Produit exemple C", you: "Votre prix", best: "Prix concurrent", delta: "Écart", action: "À analyser" },
              ].map((p) => (
                <div key={p.name} className="rounded-xl border border-gray-100 dark:border-white/10 bg-gray-50/40 dark:bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{p.name}</div>
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{p.delta}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">{p.you} · {p.best}</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{p.action}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        }
      />

      <FeatureGrid
        title="Pensé pour le vertical moto"
        subtitle="Une page crédible, sans chiffres inventés."
        items={[
          { icon: BarChart3, title: t("vertical.dealers.usecase1Title"), description: t("vertical.dealers.usecase1Desc") },
          { icon: ShieldCheck, title: t("vertical.dealers.usecase2Title"), description: t("vertical.dealers.usecase2Desc") },
          { icon: Brain, title: t("vertical.dealers.usecase3Title"), description: t("vertical.dealers.usecase3Desc") },
          { icon: Bell, title: "Inventory & promo alerts", description: "Get pinged the moment a competitor lists a new unit or runs a promo." },
          { icon: Calendar, title: "Auction & trade-in benchmarks", description: "Track wholesale auction prices to optimize your trade-in offers." },
          { icon: Users, title: "Multi-sites à venir", description: "Préparer la gestion multi-sites sans afficher de volume inventé." },
        ]}
      />

      <CaseStudiesGrid vertical="dealers" />
      <Testimonials />
      <FAQ
        items={[
          { q: "Quels clients peut-on afficher ?", a: "Seulement MVM Motosport et Moto DB pour l'instant, sauf validation explicite d'autres clients." },
          { q: "Peut-on publier des résultats chiffrés ?", a: "Non, pas sans validation client et données vérifiables." },
          { q: "Le produit est-il uniquement moto ?", a: "Le positionnement prioritaire doit rester ce vertical, même si l'UI peut préparer d'autres marchés." },
          { q: "Les intégrations sont-elles déjà disponibles ?", a: "Elles doivent rester marquées comme à venir tant que le backend n'est pas branché." },
        ]}
      />
      <CTASection
        title="Tester Go-Data sur un vrai marché."
        subtitle="Pas de promesse exagérée : valider le besoin, puis construire la preuve."
        primaryHref="/create-account?ref=dealers"
        primaryLabel={t("vertical.dealers.cta")}
      />
    </>
  )
}
