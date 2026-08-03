import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, BadgeCheck, Clock, MapPin } from "lucide-react"
import Reveal from "@/components/marketing/reveal"
import {
  CFMOTO_DEALERS,
  PROVINCE_LABELS,
  PROVINCE_ORDER,
  type CfmotoDealer,
} from "@/lib/cfmoto-dealers"

export const metadata: Metadata = {
  title: "Concessionnaires CFMOTO",
  description:
    "Le réseau CFMOTO au Canada vu par Go-Data : concessionnaires déjà surveillés et à venir, province par province. Trouvez le vôtre et comparez ses prix.",
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("")
}

function DealerLogo({ dealer }: { dealer: CfmotoDealer }) {
  if (dealer.logo) {
    return (
      <span className="flex h-16 items-center justify-center rounded-lg bg-white px-3 ring-1 ring-gray-200 dark:ring-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dealer.logo}
          alt={`Logo ${dealer.name}`}
          className="max-h-12 w-auto max-w-full object-contain"
          loading="lazy"
        />
      </span>
    )
  }
  return (
    <span className="flex h-16 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500/15 to-orange-600/5 ring-1 ring-orange-200/60 dark:from-orange-500/15 dark:to-orange-500/5 dark:ring-orange-500/20">
      <span className="text-lg font-bold tracking-wide text-orange-600 dark:text-orange-400 [font-family:var(--font-display)]">
        {initials(dealer.name)}
      </span>
    </span>
  )
}

function StatusBadge({ status }: { status: CfmotoDealer["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
        <BadgeCheck className="h-3 w-3" />
        Disponible
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-orange-200/70 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20">
      <Clock className="h-3 w-3" />
      À venir
    </span>
  )
}

function DealerCard({ dealer }: { dealer: CfmotoDealer }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-orange-200 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-orange-500/30">
      <DealerLogo dealer={dealer} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white" title={dealer.name}>
          {dealer.name}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500 dark:text-gray-400">
          <MapPin className="h-3 w-3 shrink-0" />
          {dealer.city}
        </p>
      </div>
      <div className="mt-auto">
        <StatusBadge status={dealer.status} />
      </div>
    </div>
  )
}

export default function ConcessionnairesPage() {
  const total = CFMOTO_DEALERS.length
  const activeCount = CFMOTO_DEALERS.filter((d) => d.status === "active").length
  const provinces = PROVINCE_ORDER.map((code) => ({
    code,
    label: PROVINCE_LABELS[code],
    dealers: CFMOTO_DEALERS.filter((d) => d.province === code),
  })).filter((p) => p.dealers.length > 0)

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="border-b border-gray-200 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-6 pb-14 pt-20">
          <Reveal>
            <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-orange-600 dark:text-orange-400">
              Réseau CFMOTO — Canada
            </p>
            <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl dark:text-white [font-family:var(--font-display)]">
              Votre marché CFMOTO, province par province.
            </h1>
            <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">
              Go-Data surveille les inventaires et les prix du réseau CFMOTO partout au
              Canada. Les concessionnaires « disponibles » sont déjà scannés chaque jour —
              les autres s&apos;ajoutent progressivement.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
              {[
                { value: String(total), label: "concessionnaires répertoriés" },
                { value: String(activeCount), label: "déjà surveillés" },
                { value: String(provinces.length), label: "provinces couvertes" },
              ].map((stat) => (
                <div key={stat.label} className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-gray-900 dark:text-white [font-family:var(--font-display)]">
                    {stat.value}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Répertoire par province ──────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="space-y-14">
          {provinces.map((province) => (
            <Reveal key={province.code}>
              <div className="mb-5 flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white [font-family:var(--font-display)]">
                  {province.label}
                </h2>
                <span className="text-sm text-gray-400 dark:text-gray-500">
                  {province.dealers.length} concessionnaire{province.dealers.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {province.dealers.map((dealer) => (
                  <DealerCard key={dealer.slug} dealer={dealer} />
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="border-t border-gray-200 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Reveal>
            <div className="rounded-2xl border border-orange-200/70 bg-orange-50/50 p-8 sm:p-10 dark:border-orange-500/20 dark:bg-orange-500/[0.05]">
              <h2 className="max-w-xl text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl dark:text-white [font-family:var(--font-display)]">
                Vous êtes concessionnaire CFMOTO&nbsp;?
              </h2>
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">
                Votre marché est déjà cartographié. Créez votre compte et voyez où se situent
                vos prix face aux concessionnaires qui vous entourent — dès aujourd&apos;hui.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/create-account"
                  className="group inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
                >
                  Créer mon compte
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/[0.04]"
                >
                  Nous contacter
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
