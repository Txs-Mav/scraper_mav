"use client"

import { Activity, CheckCircle2, Clock } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

const SERVICES = [
  { name: "Application web", status: "À connecter au monitoring" },
  { name: "API / routes backend", status: "À connecter au monitoring" },
  { name: "Scrapers", status: "À connecter au monitoring" },
  { name: "Authentification", status: "À connecter au monitoring" },
  { name: "Paiements Stripe", status: "Dépend de Stripe" },
]

export default function StatusPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-4xl md:text-6xl font-black tracking-tight">{t("status.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">{t("status.subtitle")}</p>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-10">
        <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-6 text-center">
          <div className="inline-flex items-center gap-2 text-lg font-bold text-amber-800 dark:text-amber-200">
            <Clock className="h-5 w-5" />
            {t("status.allOperational")}
          </div>
          <p className="mt-2 text-sm text-amber-800/80 dark:text-amber-200/80">
            Aucun chiffre d'uptime n'est affiché tant qu'il n'est pas alimenté par un outil réel.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-12 space-y-3">
        {SERVICES.map((s) => (
          <div key={s.name} className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{s.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Statut réel à brancher</div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-300">
                <CheckCircle2 className="h-3 w-3" />
                {s.status}
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          {t("status.incidents")}
        </h2>
        <div className="mt-5 rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-6 text-sm text-gray-600 dark:text-gray-300">
          Aucun historique public n'est affiché pour l'instant. Cette zone sera reliée au système d'incidents lorsque le monitoring sera en place.
        </div>
      </section>
    </>
  )
}
