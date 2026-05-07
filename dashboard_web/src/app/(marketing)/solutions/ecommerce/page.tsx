"use client"

import { ShoppingCart, TrendingUp, Bell, Boxes, FileBarChart, Brain } from "lucide-react"
import VerticalHero from "@/components/marketing/vertical-hero"
import FeatureGrid from "@/components/marketing/feature-grid"
import CaseStudiesGrid from "@/components/marketing/case-study-card"
import Testimonials from "@/components/marketing/testimonials"
import CTASection from "@/components/marketing/cta-section"
import FAQ from "@/components/marketing/faq"
import { useLanguage } from "@/contexts/language-context"

export default function EcommerceVertical() {
  const { t } = useLanguage()
  return (
    <>
      <VerticalHero
        eyebrow={t("vertical.ecommerce.eyebrow")}
        title={t("vertical.ecommerce.title")}
        subtitle={t("vertical.ecommerce.subtitle")}
        metrics={[
          { value: "À valider", label: t("vertical.ecommerce.metric1") },
          { value: "100k+", label: t("vertical.ecommerce.metric2") },
          { value: "Native", label: t("vertical.ecommerce.metric3") },
        ]}
        ctaPrimary={{ href: "/create-account?ref=ecommerce", label: t("vertical.ecommerce.cta") }}
        ctaSecondary={{ href: "/integrations", label: "Browse integrations" }}
        benefits={[
          "Native Shopify, WooCommerce, Magento integrations",
          "Track 100k+ SKUs across thousands of competitors",
          "Dynamic repricing within your margin guardrails",
          "MAP violation enforcement workflow built-in",
        ]}
        visual={
          <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-6 shadow-2xl">
            <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">Aperçu préparatoire</div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 p-3">
                <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300">À valider</div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/70">marge</div>
              </div>
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40 p-3">
                <div className="text-2xl font-black text-amber-700 dark:text-amber-300">À venir</div>
                <div className="text-[10px] uppercase tracking-wider text-amber-700/70 dark:text-amber-300/70">alertes</div>
              </div>
              <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 p-3">
                <div className="text-2xl font-black text-blue-700 dark:text-blue-300">À cadrer</div>
                <div className="text-[10px] uppercase tracking-wider text-blue-700/70 dark:text-blue-300/70">changements</div>
              </div>
              <div className="rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/40 p-3">
                <div className="text-2xl font-black text-purple-700 dark:text-purple-300">Roadmap</div>
                <div className="text-[10px] uppercase tracking-wider text-purple-700/70 dark:text-purple-300/70">stock</div>
              </div>
            </div>
          </div>
        }
      />

      <FeatureGrid
        title="Piste e-commerce à valider"
        subtitle="Cette verticale reste à présenter comme une expansion potentielle."
        items={[
          { icon: TrendingUp, title: t("vertical.ecommerce.usecase1Title"), description: t("vertical.ecommerce.usecase1Desc") },
          { icon: Bell, title: t("vertical.ecommerce.usecase2Title"), description: t("vertical.ecommerce.usecase2Desc") },
          { icon: Boxes, title: t("vertical.ecommerce.usecase3Title"), description: t("vertical.ecommerce.usecase3Desc") },
          { icon: ShoppingCart, title: "Marketplace coverage", description: "Track Amazon, eBay, Walmart, Etsy and 30+ regional marketplaces out of the box." },
          { icon: FileBarChart, title: "Catalog reports", description: "Daily PDF / Excel reports straight to your buying & merchandising team." },
          { icon: Brain, title: "AI repricing", description: "Recommendations engine that respects your floor, ceiling and brand guardrails." },
        ]}
      />

      <CaseStudiesGrid vertical="ecommerce" />
      <Testimonials />
      <FAQ
        items={[
          { q: "Cette verticale est-elle validée ?", a: "Pas encore. Elle est préparée comme piste de croissance." },
          { q: "Les intégrations Shopify / WooCommerce sont-elles actives ?", a: "Elles doivent être marquées comme à venir tant qu'elles ne sont pas connectées." },
          { q: "Peut-on promettre du repricing automatique ?", a: "Non. Il faut d'abord valider le backend, les règles et la responsabilité commerciale." },
        ]}
      />
      <CTASection primaryHref="/create-account?ref=ecommerce" primaryLabel={t("vertical.ecommerce.cta")} />
    </>
  )
}
