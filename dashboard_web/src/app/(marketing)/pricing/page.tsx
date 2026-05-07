"use client"

import Link from "next/link"
import { Check, Clock } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import { useCurrency } from "@/lib/currency"
import FAQ from "@/components/marketing/faq"

const PLANS = [
  {
    name: "Standard / Démo",
    priceCAD: 0,
    description: "Pour découvrir Go-Data sans engagement.",
    href: "/create-account?plan=standard",
    cta: "Commencer gratuitement",
    features: ["6 scrapings maximum", "2 scrapers en cache", "Support communautaire"],
  },
  {
    name: "Pro",
    priceCAD: 199.99,
    description: "Plan actuel pour les équipes qui utilisent Go-Data régulièrement.",
    href: "/create-account?plan=pro",
    cta: "Choisir Pro",
    highlighted: true,
    features: ["Scrapings illimités", "8 scrapers en cache", "Accès aux alertes", "Support prioritaire"],
  },
  {
    name: "Ultime",
    priceCAD: 274.99,
    description: "Plan actuel pour les besoins avancés.",
    href: "/create-account?plan=ultime",
    cta: "Choisir Ultime",
    features: ["Scrapings illimités", "Scrapers en cache illimités", "Accès aux alertes", "Support 24/7", "SLA garanti si contractuellement validé"],
  },
]

export default function PricingPage() {
  const { t } = useLanguage()
  const { format } = useCurrency()

  return (
    <>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("pricing.title")}</h1>
        <p className="mt-4 text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">{t("pricing.subtitle")}</p>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-16">
        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative p-7 rounded-2xl border bg-white dark:bg-[#1a1c1e] flex flex-col ${
                plan.highlighted ? "border-emerald-500 shadow-2xl shadow-emerald-600/10" : "border-gray-200 dark:border-white/10"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-emerald-600 text-white text-xs font-bold">
                  Plan actuel
                </div>
              )}
              <h3 className="text-xl font-bold">{plan.name}</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 min-h-[48px]">{plan.description}</p>
              <div className="mt-6 text-4xl font-black">
                {format(plan.priceCAD)}
                <span className="text-sm font-medium text-gray-500"> / mois</span>
              </div>
              <Link
                href={plan.href}
                className={`mt-6 block w-full text-center py-3 rounded-xl text-sm font-semibold transition-all ${
                  plan.highlighted
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100"
                }`}
              >
                {plan.cta}
              </Link>
              <ul className="mt-6 space-y-3 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <Check className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-16">
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-8">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-1" />
            <div>
              <h2 className="text-2xl font-bold">Évolution pricing à cadrer</h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                La tarification à l'usage, le plan Startup et le plan Enterprise peuvent être préparés côté UI, mais ne doivent pas être présentés comme offres actives tant que les limites, la facturation et les contrats ne sont pas prêts.
              </p>
            </div>
          </div>
        </div>
      </section>

      <FAQ
        title={t("pricing.faq.title")}
        items={[
          { q: "Quels plans sont réels aujourd'hui ?", a: "Standard / Démo, Pro et Ultime, selon les informations déjà présentes dans le produit." },
          { q: "Pourquoi ne pas afficher Enterprise tout de suite ?", a: "Parce qu'il faut d'abord préparer les contrats, le DPA, les rôles, l'audit log, le SSO et la sécurité avant de vendre une offre enterprise crédible." },
          { q: "Peut-on préparer l'usage-based ?", a: "Oui, mais comme roadmap. Les prix par requête doivent venir de coûts réels et d'une logique de marge validée." },
        ]}
      />
    </>
  )
}
