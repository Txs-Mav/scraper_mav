"use client"

import Link from "next/link"
import { ShieldCheck, Lock, Globe2, FileCheck2, Eye, Server, AlertTriangle, Download, ArrowRight, CheckCircle2 } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import TrustBadges from "@/components/marketing/trust-badges"

const SUB_PROCESSORS = [
  { name: "Supabase", purpose: "Authentification, base de données, stockage", region: "À confirmer" },
  { name: "Stripe", purpose: "Paiements et facturation", region: "Selon compte Stripe" },
  { name: "Resend", purpose: "Emails transactionnels", region: "À confirmer" },
  { name: "Vercel", purpose: "Hébergement de l'application web", region: "À confirmer" },
]

export default function TrustPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold uppercase tracking-wider border border-emerald-100 dark:border-emerald-900/40">
          <ShieldCheck className="h-3 w-3" />
          Trust center
        </span>
        <h1 className="mt-5 text-4xl md:text-6xl font-black tracking-tight">{t("trust.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">{t("trust.subtitle")}</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <button className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/25">
            <Download className="h-4 w-4" />
            {t("trust.requestReport")}
          </button>
          <Link
            href="/legal/dpa"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white dark:bg-white/[0.05] text-gray-900 dark:text-white font-semibold border border-gray-200 dark:border-white/10"
          >
            {t("trust.requestDpa")}
          </Link>
          <Link
            href="/status"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white dark:bg-white/[0.05] text-gray-900 dark:text-white font-semibold border border-gray-200 dark:border-white/10"
          >
            {t("trust.viewStatus")}
          </Link>
        </div>
      </section>

      <TrustBadges />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-10">{t("trust.compliance.title")}</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: ShieldCheck, label: "SOC 2", status: "À préparer", color: "gray" },
            { icon: ShieldCheck, label: "ISO 27001", status: "Non certifié", color: "gray" },
            { icon: Globe2, label: "RGPD", status: "Politique à valider", color: "amber" },
            { icon: Globe2, label: "CCPA / CPRA", status: "À valider", color: "gray" },
            { icon: Globe2, label: "LGPD", status: "À valider", color: "gray" },
            { icon: FileCheck2, label: "DPA", status: "À rédiger / valider", color: "amber" },
            { icon: FileCheck2, label: "PCI-DSS", status: "Géré par Stripe", color: "amber" },
            { icon: FileCheck2, label: "Loi 25 Québec", status: "À valider juridiquement", color: "amber" },
          ].map((c) => {
            const Icon = c.icon
            return (
              <div key={c.label} className="p-5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
                <Icon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                <div className="mt-3 text-base font-bold text-gray-900 dark:text-white">{c.label}</div>
                <div className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${
                  c.color === "emerald"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : c.color === "amber"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-gray-500 dark:text-gray-400"
                }`}>
                  {c.color === "emerald" && <CheckCircle2 className="h-3 w-3" />}
                  {c.status}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 grid md:grid-cols-2 gap-6">
        <div className="p-8 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
          <Lock className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-3 text-xl font-bold">{t("trust.security.title")}</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-gray-700 dark:text-gray-200">
            {[
              "Documenter le chiffrement réel utilisé par Supabase / Vercel",
              "Documenter les règles d'accès admin",
              "Ajouter une politique MFA si elle est réellement imposée",
              "Préparer une page sécurité vérifiable",
              "Éviter les promesses SSO / audit tant que non branchées",
            ].map((s) => (
              <li key={s} className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
          <Link href="/security" className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:gap-2 transition-all">
            Lire la page sécurité <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="p-8 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
          <Eye className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-3 text-xl font-bold">{t("trust.privacy.title")}</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-gray-700 dark:text-gray-200">
            {[
              "Publier une politique de confidentialité simple en français",
              "Lister les services utilisés et les régions à confirmer",
              "Conserver les exports / suppressions de données quand disponibles",
              "Préparer un DPA avant de viser des comptes enterprise",
              "Faire valider les textes par une ressource juridique",
            ].map((s) => (
              <li key={s} className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
          <Link href="/legal/privacy" className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:gap-2 transition-all">
            Lire la politique de confidentialité <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="p-8 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
          <Server className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-3 text-xl font-bold">{t("trust.uptime.title")}</h3>
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">
            La page status est prête côté UI, mais les chiffres d'uptime ne doivent pas être affichés tant que le monitoring réel n'est pas branché.
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              { v: "À venir", l: "uptime" },
              { v: "À venir", l: "latence" },
              { v: "À venir", l: "incidents" },
            ].map((m) => (
              <div key={m.l} className="rounded-lg bg-gray-50 dark:bg-white/[0.04] p-2.5 text-center">
                <div className="text-base font-bold text-gray-900 dark:text-white">{m.v}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{m.l}</div>
              </div>
            ))}
          </div>
          <Link href="/status" className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:gap-2 transition-all">
            Voir la page status <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="p-8 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
          <AlertTriangle className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-3 text-xl font-bold">Réponse aux incidents</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-gray-700 dark:text-gray-200">
            {[
              "Définir une politique d'incident réaliste",
              "Créer un modèle de post-mortem",
              "Préparer un canal de notification client",
              "Documenter les sauvegardes réelles",
              "Ajouter des objectifs RPO / RTO après validation technique",
            ].map((s) => (
              <li key={s} className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold">{t("trust.subprocessors.title")}</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Liste initiale basée sur les services visibles dans le projet. Les régions restent à confirmer.</p>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e]">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Service</th>
                <th className="px-4 py-3 text-left font-semibold">Usage</th>
                <th className="px-4 py-3 text-left font-semibold">Région</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {SUB_PROCESSORS.map((s) => (
                <tr key={s.name}>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{s.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{s.purpose}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{s.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
