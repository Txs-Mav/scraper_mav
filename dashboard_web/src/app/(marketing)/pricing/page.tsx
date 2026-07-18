import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check, Minus, Sparkles } from "lucide-react"
import Reveal from "@/components/marketing/reveal"

export const metadata: Metadata = {
  title: "Tarifs",
  description:
    "Trois plans simples. Le gratuit se crée en ligne, sans carte de crédit. Les plans payants s'activent en parlant à l'équipe Go-Data — ou avec un code magique.",
}

const PLANS = [
  {
    id: "gratuit",
    name: "Gratuit",
    price: "0 $",
    tagline: "Pour évaluer l'outil. Sans limite de temps.",
    cta: { label: "Créer un compte gratuit", href: "/create-account" },
    included: [
      "6 scrapings d'essai",
      "Comparaison de prix et tableau de bord",
      "Export CSV",
      "Sans carte de crédit",
    ],
    excluded: ["Pas d'analytics", "Pas de sites surveillés ni d'alertes"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "200 $",
    tagline: "Pour surveiller votre marché au quotidien.",
    highlighted: true,
    cta: { label: "Nous contacter", href: "/contact?topic=sales" },
    included: [
      "Scrapings illimités",
      "Analytics complet : positionnement, opportunités",
      "3 sites surveillés en continu",
      "Alertes courriel quand un prix bouge",
      "Support prioritaire",
    ],
    excluded: [],
  },
  {
    id: "ultime",
    name: "Ultime",
    price: "275 $",
    tagline: "Pour couvrir tout votre marché, sans plafond.",
    cta: { label: "Nous contacter", href: "/contact?topic=sales" },
    included: [
      "Tout du plan Pro",
      "Sites surveillés illimités",
      "Alertes illimitées",
      "Accompagnement dédié et onboarding",
      "Accès direct à l'équipe",
    ],
    excluded: [],
  },
]

const STEPS = [
  {
    n: "01",
    title: "Créez un compte gratuit.",
    text: "En ligne, en deux minutes. 6 scrapings pour vous faire une idée avec vos vrais concurrents.",
  },
  {
    n: "02",
    title: "Parlez-nous.",
    text: "Un courriel ou un appel. On configure votre plan Pro ou Ultime et la facturation, directement avec vous.",
  },
  {
    n: "03",
    title: "Ou entrez un code magique.",
    text: "Un code en main ? Entrez-le à la création de compte : le plan s'active instantanément. Aucun paiement en ligne.",
  },
]

const FAQ = [
  {
    q: "Comment payer un plan Pro ou Ultime ?",
    a: "Il n'y a pas de paiement en ligne. Vous nous écrivez, on active votre compte et on convient de la facturation directement avec vous. Simple, sans intermédiaire.",
  },
  {
    q: "C'est quoi, un code magique ?",
    a: "Un code remis par l'équipe Go-Data — partenaires, clients pilotes, ententes particulières. Entré à la création de compte, il active le plan associé instantanément, sans paiement.",
  },
  {
    q: "Le plan gratuit expire-t-il ?",
    a: "Non. 6 scrapings pour évaluer l'outil, sans limite de temps et sans carte de crédit.",
  },
  {
    q: "Puis-je changer de plan ou annuler ?",
    a: "Oui, en tout temps. Un courriel suffit — pas de contrat à long terme imposé.",
  },
]

export default function PricingPage() {
  return (
    <>
      {/* ── En-tête ─────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-20 sm:pt-28">
        <Reveal>
          <p className="flex items-center gap-2 text-[13px] font-medium text-gray-500 dark:text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            Tarifs
          </p>
          <h1 className="mt-5 max-w-2xl text-4xl font-bold leading-[1.06] tracking-tight text-gray-900 sm:text-5xl md:text-6xl dark:text-white [font-family:var(--font-display)]">
            Trois plans.
            <br />
            <span className="text-orange-600 dark:text-orange-400">Zéro carte de crédit.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600 dark:text-gray-400">
            Le gratuit se crée en ligne. Les plans payants s&apos;activent en parlant à un
            humain — ou avec un code magique.
          </p>
        </Reveal>
      </section>

      {/* ── Plans ───────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 100} className="h-full">
              <div
                className={`relative flex h-full flex-col rounded-2xl border p-7 ${
                  plan.highlighted
                    ? "border-orange-500/60 bg-white shadow-2xl shadow-orange-600/10 dark:border-orange-400/40 dark:bg-white/[0.03]"
                    : "border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.02]"
                }`}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-6 rounded-full bg-orange-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white dark:bg-orange-500 dark:text-black">
                    Le plus populaire
                  </span>
                )}

                <h2 className="text-xl font-bold text-gray-900 dark:text-white [font-family:var(--font-display)]">
                  {plan.name}
                </h2>
                <p className="mt-1.5 min-h-10 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                  {plan.tagline}
                </p>

                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-5xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white [font-family:var(--font-display)]">
                    {plan.price}
                  </span>
                  <span className="text-sm text-gray-400 dark:text-gray-500">CAD / mois</span>
                </div>

                <Link
                  href={plan.cta.href}
                  className={`group mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold transition-colors ${
                    plan.highlighted
                      ? "bg-orange-600 text-white hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
                      : "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/[0.04]"
                  }`}
                >
                  {plan.cta.label}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>

                <ul className="mt-7 flex-1 space-y-2.5">
                  {plan.included.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[14px] text-gray-700 dark:text-gray-300">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                      {f}
                    </li>
                  ))}
                  {plan.excluded.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[14px] text-gray-400 dark:text-gray-500">
                      <Minus className="mt-0.5 h-4 w-4 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={150}>
          <p className="mt-5 text-center text-[13px] text-gray-400 dark:text-gray-500">
            Prix en dollars canadiens. Annulable en tout temps — un courriel suffit.
          </p>
        </Reveal>
      </section>

      {/* ── Comment ça marche ───────────────────────────── */}
      <section className="border-y border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
              Pas de paiement en ligne. Volontairement.
            </h2>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">
              Un plan payant, c&apos;est une relation de travail. On préfère la commencer par
              une conversation plutôt que par un formulaire de carte de crédit.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} delay={i * 100}>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">
                    {step.n}
                  </span>
                  <span className="h-px w-8 bg-orange-600/40 dark:bg-orange-400/40" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-gray-900 dark:text-white [font-family:var(--font-display)]">
                  {step.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {step.text}
                </p>
              </Reveal>
            ))}
          </div>

          <Reveal delay={200}>
            <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl border border-orange-600/25 bg-orange-50 p-6 sm:flex-row sm:items-center dark:border-orange-400/20 dark:bg-orange-400/[0.06]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white dark:bg-orange-500 dark:text-black">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-gray-900 dark:text-white">
                  Vous avez un code magique ?
                </p>
                <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                  Entrez-le à la création de compte : votre plan s&apos;active
                  instantanément, sans paiement.
                </p>
              </div>
              <Link
                href="/create-account"
                className="group inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-orange-700 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300"
              >
                Créer mon compte
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-20">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
            Questions fréquentes
          </h2>
        </Reveal>
        <div className="mt-8 divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/10 dark:border-white/10">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delay={i * 60}>
              <details className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-gray-900 dark:text-white">
                  {item.q}
                  <span className="text-orange-600 transition-transform group-open:rotate-45 dark:text-orange-400">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── CTA final ───────────────────────────────────── */}
      <section className="border-t border-gray-200 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
              Commencez gratuitement.
              <br />
              <span className="text-orange-600 dark:text-orange-400">Le reste, on en parle.</span>
            </h2>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/create-account"
                className="group inline-flex items-center gap-2 rounded-lg bg-orange-600 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
              >
                Créer un compte gratuit
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contact?topic=sales"
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-6 py-3.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/[0.04]"
              >
                Parler à Go-Data
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  )
}
