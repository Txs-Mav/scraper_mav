import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Clock, Mail, MapPin, Phone } from "lucide-react"
import Reveal from "@/components/marketing/reveal"

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Parlez directement au fondateur de Go-Data. Téléphone : 819-448-2882. Courriel : mavmenard@gmail.com.",
}

const CONTACTS = [
  {
    icon: Phone,
    label: "Téléphone",
    value: "819 448-2882",
    sub: "Lundi au vendredi · heures de bureau (HE)",
    href: "tel:+18194482882",
  },
  {
    icon: Mail,
    label: "Courriel",
    value: "mavmenard@gmail.com",
    sub: "Réponse en moins de 24 h ouvrables",
    href: "mailto:mavmenard@gmail.com",
  },
]

export default function ContactPage() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        {/* ── Coordonnées ── */}
        <div>
          <Reveal>
            <p className="flex items-center gap-2 text-[13px] font-medium text-gray-500 dark:text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              Contact
            </p>
            <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.06] tracking-tight text-gray-900 sm:text-5xl md:text-6xl dark:text-white [font-family:var(--font-display)]">
              Parlons-en.
              <br />
              <span className="text-orange-600 dark:text-orange-400">Directement.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-gray-600 dark:text-gray-400">
              Une question. Un plan à activer. Un marché à surveiller.
              Pas de formulaire, pas de file d&apos;attente : vous parlez au fondateur.
            </p>
          </Reveal>

          <div className="mt-10 space-y-4">
            {CONTACTS.map((c, i) => {
              const Icon = c.icon
              return (
                <Reveal key={c.label} delay={120 + i * 100}>
                  <a
                    href={c.href}
                    className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:border-orange-600/50 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-orange-400/40"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white transition-transform group-hover:scale-105 dark:bg-orange-500 dark:text-black">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-gray-500 dark:text-gray-400">
                        {c.label}
                      </span>
                      <span className="block truncate text-lg font-bold text-gray-900 dark:text-white [font-family:var(--font-display)]">
                        {c.value}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                        <Clock className="h-3 w-3" />
                        {c.sub}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-orange-600 dark:text-gray-600 dark:group-hover:text-orange-400" />
                  </a>
                </Reveal>
              )
            })}
          </div>

          <Reveal delay={320}>
            <p className="mt-8 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <MapPin className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              Basé au Québec, Canada · Français et anglais
            </p>
          </Reveal>
        </div>

        {/* ── Photo ── */}
        <Reveal delay={200} className="min-w-0">
          <div className="relative overflow-hidden rounded-2xl">
            <Image
              src="/contact/maverick.jpg"
              alt="Maverick Menard, fondateur de Go-Data"
              width={664}
              height={1560}
              priority
              className="h-[440px] w-full object-cover object-[center_22%] sm:h-[520px] lg:h-[600px]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            <div className="absolute bottom-5 left-5 right-5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/55 px-4 py-3 backdrop-blur">
                <div>
                  <div className="text-[15px] font-bold text-white [font-family:var(--font-display)]">
                    Maverick Menard
                  </div>
                  <div className="text-xs text-gray-300">Fondateur, Go-Data</div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  Disponible
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Bande plan payant ── */}
      <section className="border-t border-gray-200 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Reveal>
            <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl dark:text-white [font-family:var(--font-display)]">
                  Un plan Pro ou Ultime à activer ?
                </h2>
                <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">
                  Un courriel suffit. On configure votre compte, on convient de la
                  facturation, vous surveillez votre marché le jour même.
                </p>
              </div>
              <Link
                href="/pricing"
                className="group inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/[0.04]"
              >
                Voir les tarifs
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  )
}
