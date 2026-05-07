"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { Briefcase, Headphones, Newspaper, Users, MapPin, Phone, Mail } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

const TOPICS = [
  { id: "sales", labelKey: "contact.sales", icon: Briefcase, email: "sales@go-data.co" },
  { id: "support", labelKey: "contact.support", icon: Headphones, email: "support@go-data.co" },
  { id: "press", labelKey: "contact.press", icon: Newspaper, email: "press@go-data.co" },
  { id: "partnerships", labelKey: "contact.partnerships", icon: Users, email: "partners@go-data.co" },
] as const

const OFFICES = [
  { city: "Go-Data", country: "Canada", address: "gestion@go-data.co · 819-448-2882" },
]

function ContactForm() {
  const { t } = useLanguage()
  const params = useSearchParams()
  const initialTopic = (params.get("topic") || "sales") as typeof TOPICS[number]["id"]
  const [topic, setTopic] = useState<typeof TOPICS[number]["id"]>(initialTopic)
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="grid lg:grid-cols-5 gap-8">
      <div className="lg:col-span-2 space-y-3">
        {TOPICS.map((tp) => {
          const Icon = tp.icon
          return (
            <button
              key={tp.id}
              type="button"
              onClick={() => setTopic(tp.id)}
              className={`w-full text-left p-4 rounded-2xl border transition-all ${
                topic === tp.id
                  ? "border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20"
                  : "border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] hover:border-emerald-300 dark:hover:border-emerald-800"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 ${
                  topic === tp.id ? "bg-emerald-600 text-white" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
                }`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{t(`contact.${tp.id === "sales" ? "sales" : tp.id === "support" ? "support" : tp.id === "press" ? "press" : "partnerships"}`)}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{tp.email}</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="lg:col-span-3">
        {submitted ? (
          <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-8 text-center">
            <div className="text-2xl font-bold">{t("contact.thanks")}</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-gray-700 dark:text-gray-200">{t("contact.fullName")}</label>
                <input type="text" required className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-gray-700 dark:text-gray-200">{t("contact.workEmail")}</label>
                <input type="email" required className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-gray-700 dark:text-gray-200">{t("contact.company")}</label>
              <input type="text" className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-gray-700 dark:text-gray-200">{t("contact.message")}</label>
              <textarea rows={5} required className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-sm" />
            </div>
            <button type="submit" className="w-full px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all">
              {t("contact.send")}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ContactPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("contact.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">{t("contact.subtitle")}</p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-12">
        <Suspense fallback={null}>
          <ContactForm />
        </Suspense>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <h2 className="text-2xl font-bold mb-6">{t("contact.offices")}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {OFFICES.map((o) => (
            <div key={o.city} className="p-5 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
              <MapPin className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div className="mt-3 text-base font-bold">{o.city}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{o.country}</div>
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">{o.address}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 grid sm:grid-cols-2 gap-4">
        <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
          <Phone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm">+1-819-448-2882</span>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
          <Mail className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <a href="mailto:gestion@go-data.co" className="text-sm hover:underline">gestion@go-data.co</a>
        </div>
      </section>
    </>
  )
}
