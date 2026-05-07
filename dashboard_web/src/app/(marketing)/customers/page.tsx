"use client"

import CaseStudiesGrid from "@/components/marketing/case-study-card"
import LogoCloud from "@/components/marketing/logo-cloud"
import Testimonials from "@/components/marketing/testimonials"
import CTASection from "@/components/marketing/cta-section"
import { useLanguage } from "@/contexts/language-context"

export default function CustomersIndexPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("customers.title")}</h1>
        <p className="mt-4 text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">{t("customers.subtitle")}</p>
      </section>
      <LogoCloud />
      <CaseStudiesGrid />
      <Testimonials />
      <CTASection />
    </>
  )
}
