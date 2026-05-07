"use client"

import { AlertTriangle, FileCheck2, KeyRound, Lock, ShieldCheck } from "lucide-react"
import Link from "next/link"
import TrustBadges from "@/components/marketing/trust-badges"

const SECTIONS = [
  {
    icon: Lock,
    title: "Ce qui doit être documenté",
    body: "Lister précisément le chiffrement, les sauvegardes, la rétention, les accès admin et les fournisseurs utilisés. Ne rien annoncer sans preuve technique.",
  },
  {
    icon: KeyRound,
    title: "Accès et comptes",
    body: "Décrire les mécanismes réellement disponibles : connexion Supabase, rôles existants, administrateurs développeur, et futures permissions d'équipe.",
  },
  {
    icon: ShieldCheck,
    title: "Certifications",
    body: "Go-Data ne doit pas afficher SOC 2, ISO 27001 ou SLA enterprise comme acquis. Ces éléments doivent rester en roadmap tant qu'ils ne sont pas certifiés.",
  },
  {
    icon: FileCheck2,
    title: "Documents légaux",
    body: "Les pages Confidentialité, CGU, DPA et SLA peuvent être préparées comme brouillons, mais elles doivent être relues légalement avant publication commerciale.",
  },
  {
    icon: AlertTriangle,
    title: "Incidents",
    body: "Préparer un modèle de communication d'incident et une page status, sans inventer d'historique ni de chiffres d'uptime.",
  },
]

export default function SecurityPage() {
  return (
    <>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">Sécurité</h1>
        <p className="mt-4 text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
          Une page honnête : ce qui est connu, ce qui doit être documenté, et ce qui ne doit pas être promis trop tôt.
        </p>
      </section>

      <TrustBadges />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid md:grid-cols-2 gap-5">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.title} className="p-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
                <Icon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{s.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <h2 className="text-3xl font-bold">Besoin d'un document de sécurité ?</h2>
        <p className="mt-3 text-base text-gray-600 dark:text-gray-300">
          Pour l'instant, répondre manuellement avec les informations vérifiées.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/trust" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all">
            Centre de confiance
          </Link>
          <Link href="/contact?topic=security" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white dark:bg-white/[0.05] text-gray-900 dark:text-white font-semibold border border-gray-200 dark:border-white/10">
            Contacter Go-Data
          </Link>
        </div>
      </section>
    </>
  )
}
