import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { ArrowRight, MousePointerClick } from "lucide-react"
import Reveal from "@/components/marketing/reveal"
import DemoSimulator from "@/components/marketing/demo-simulator"

export const metadata: Metadata = {
  title: "Démo — Go-Data",
  description:
    "Explorez Go-Data sans créer de compte : surveillance des prix concurrents, comparaison par détaillant et opportunités chiffrées, avec des données de démonstration.",
}

const GUIDED_STEPS = [
  {
    n: "01",
    title: "Vous nommez vos concurrents",
    text: "Les sites que vous surveillez déjà à la main. Trois ou quatre suffisent pour commencer.",
  },
  {
    n: "02",
    title: "On configure la surveillance",
    text: "Go-Data scanne leurs inventaires publics et croise les produits avec les vôtres.",
  },
  {
    n: "03",
    title: "Vous voyez vos écarts réels",
    text: "Pas des données de démonstration : vos produits, vos prix, votre marché.",
  },
]

export default function DemoPage() {
  return (
    <>
      {/* ── Hero + simulateur ────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pt-16 sm:pt-20">
          <Reveal>
            <p className="flex items-center justify-center gap-2 text-[13px] font-medium text-gray-500 dark:text-gray-400">
              <MousePointerClick className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              Démo interactive · Sans compte
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mx-auto mt-6 max-w-3xl text-center text-4xl font-bold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl dark:text-white [font-family:var(--font-display)]">
              Le produit, tel quel.
              <br />
              <span className="text-orange-600 dark:text-orange-400">
                Cliquez, explorez.
              </span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-xl text-center text-lg leading-relaxed text-gray-600 dark:text-gray-400">
              Voici le tableau de bord Go-Data avec un marché simulé :
              4 concessionnaires, des vrais modèles, des écarts chiffrés.
              Lancez un scan. Changez d&apos;onglet. C&apos;est le produit.
            </p>
          </Reveal>
        </div>

        <div className="mx-auto max-w-5xl px-6 pb-10 pt-12">
          <Reveal delay={240}>
            <DemoSimulator />
            <p className="mt-3 text-center font-mono text-xs text-gray-400 dark:text-gray-500">
              Simulation interactive — concessionnaires et prix fictifs, interface réelle
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Captures réelles ─────────────────────────────── */}
      <section className="border-t border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
                Et en vrai, ça ressemble à ça.
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">
                Captures directes du produit, sans retouche.
                Ce que vous voyez ici est ce que vous ouvrez le matin.
              </p>
            </div>
          </Reveal>

          <div className="mt-10 space-y-6">
            <Reveal delay={80}>
              <figure>
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-[#111315]">
                  <Image
                    src="/landing/shot-alerts.png"
                    alt="Insights automatiques Go-Data : prix moyen du marché, heures économisées et scrapes effectués"
                    width={1720}
                    height={468}
                    className="w-full"
                  />
                </div>
                <figcaption className="mt-3 font-mono text-xs text-gray-400 dark:text-gray-500">
                  Insights automatiques — alertes et indicateurs mis à jour à chaque scan
                </figcaption>
              </figure>
            </Reveal>
            <div className="grid gap-6 lg:grid-cols-2">
              <Reveal delay={140}>
                <figure>
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-[#111315]">
                    <Image
                      src="/landing/shot-changes.png"
                      alt="Fil des changements détectés par Go-Data : baisses de prix, nouveaux produits, retraits"
                      width={1720}
                      height={916}
                      className="w-full"
                    />
                  </div>
                  <figcaption className="mt-3 font-mono text-xs text-gray-400 dark:text-gray-500">
                    Fil des changements — chaque mouvement daté et archivé
                  </figcaption>
                </figure>
              </Reveal>
              <Reveal delay={200}>
                <figure>
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-[#111315]">
                    <Image
                      src="/landing/shot-opportunities.png"
                      alt="Détection d'opportunités Go-Data : impact cumulé et recommandations de prix chiffrées"
                      width={1720}
                      height={1066}
                      className="w-full"
                    />
                  </div>
                  <figcaption className="mt-3 font-mono text-xs text-gray-400 dark:text-gray-500">
                    Opportunités — recommandations chiffrées, en dollars
                  </figcaption>
                </figure>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── Démo guidée ──────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
              La vraie démo, c&apos;est avec{" "}
              <span className="text-orange-600 dark:text-orange-400">
                vos concurrents.
              </span>
            </h2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">
              En 30 minutes, on branche Go-Data sur votre marché réel.
              Vous repartez avec vos écarts de prix, pas avec une présentation.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/contact"
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
              >
                Planifier une démo guidée
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/create-account"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/[0.04]"
              >
                Créer un compte gratuit
              </Link>
            </div>
            <p className="mt-5 text-[13px] text-gray-400 dark:text-gray-500">
              Sans engagement · Sans carte de crédit · En français
            </p>
          </Reveal>
          <div className="space-y-4">
            {GUIDED_STEPS.map((step, i) => (
              <Reveal key={step.n} delay={i * 100}>
                <div className="flex gap-5 rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.02]">
                  <span className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">
                    {step.n}
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                      {step.text}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
