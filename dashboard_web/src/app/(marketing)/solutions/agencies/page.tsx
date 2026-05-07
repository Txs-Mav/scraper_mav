"use client"

import { Briefcase, FileBarChart, Users, Layers, DollarSign, ShieldCheck } from "lucide-react"
import VerticalHero from "@/components/marketing/vertical-hero"
import FeatureGrid from "@/components/marketing/feature-grid"
import CaseStudiesGrid from "@/components/marketing/case-study-card"
import Testimonials from "@/components/marketing/testimonials"
import CTASection from "@/components/marketing/cta-section"
import FAQ from "@/components/marketing/faq"
import { useLanguage } from "@/contexts/language-context"

export default function AgenciesVertical() {
  const { t } = useLanguage()
  return (
    <>
      <VerticalHero
        eyebrow={t("vertical.agencies.eyebrow")}
        title={t("vertical.agencies.title")}
        subtitle={t("vertical.agencies.subtitle")}
        metrics={[
          { value: "$1.4M", label: t("vertical.agencies.metric1") },
          { value: "50%", label: t("vertical.agencies.metric2") },
          { value: "PDF", label: t("vertical.agencies.metric3") },
        ]}
        ctaPrimary={{ href: "/partners", label: t("vertical.agencies.cta") }}
        ctaSecondary={{ href: "/contact?topic=partnerships", label: "Discuter du modèle partenaire" }}
        benefits={[
          "Hypothèse produit à valider avec de vraies agences",
          "Pas de chiffres de revenu inventés",
          "Programme partenaire à formaliser avant publication forte",
          "Interface préparatoire seulement",
        ]}
      />

      <FeatureGrid
        title="Programme agence à cadrer"
        subtitle="La page peut exister, mais doit rester claire sur le statut préparatoire."
        items={[
          { icon: Layers, title: t("vertical.agencies.usecase1Title"), description: t("vertical.agencies.usecase1Desc") },
          { icon: FileBarChart, title: t("vertical.agencies.usecase2Title"), description: t("vertical.agencies.usecase2Desc") },
          { icon: DollarSign, title: t("vertical.agencies.usecase3Title"), description: t("vertical.agencies.usecase3Desc") },
          { icon: Users, title: "Client portal", description: "Each client gets a branded read-only portal. No login juggling." },
          { icon: Briefcase, title: "Pitch templates", description: "Sales decks, proposal templates, ROI calculators — everything you need to close." },
          { icon: ShieldCheck, title: "Compliance pack", description: "Pre-signed DPAs, MSAs and security questionnaires you can pass straight to clients." },
        ]}
      />

      <CaseStudiesGrid vertical="agencies" />
      <Testimonials />
      <FAQ
        items={[
          { q: "Le programme partenaire existe-t-il déjà ?", a: "Non, il est à structurer avant d'être vendu publiquement." },
          { q: "Peut-on promettre du white-label ?", a: "Seulement comme roadmap tant que le produit n'est pas branché pour ça." },
          { q: "Pourquoi garder la page ?", a: "Pour tester l'intérêt et collecter des demandes, sans inventer de traction." },
        ]}
      />
      <CTASection primaryHref="/partners" primaryLabel={t("vertical.agencies.cta")} />
    </>
  )
}
