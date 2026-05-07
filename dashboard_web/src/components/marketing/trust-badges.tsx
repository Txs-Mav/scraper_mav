"use client"

import { ShieldCheck, Lock, Award, Globe2, FileCheck2 } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

export default function TrustBadges() {
  const { t } = useLanguage()
  const badges = [
    { icon: ShieldCheck, label: t("mkt.trust.soc2") },
    { icon: Award, label: t("mkt.trust.iso") },
    { icon: Globe2, label: t("mkt.trust.gdpr") },
    { icon: FileCheck2, label: t("mkt.trust.ccpa") },
    { icon: FileCheck2, label: t("mkt.trust.lgpd") },
    { icon: Lock, label: t("mkt.trust.encryption") },
  ]
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {badges.map((b, i) => {
          const Icon = b.icon
          return (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex-shrink-0">
                <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 leading-tight">{b.label}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
