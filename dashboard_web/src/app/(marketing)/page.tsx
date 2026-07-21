"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, BarChart3, Bell, Globe, TrendingUp } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import Reveal from "@/components/marketing/reveal"

const FLOW_SITES = ["mathias-sports.com", "joliette-moto.ca", "laval-moto.com"]

const FLOW_RESULTS = [
  { icon: BarChart3, iconClass: "bg-emerald-950/60 text-emerald-400", title: "Votre position", info: "1er sur 4" },
  { icon: Bell, iconClass: "bg-orange-950/60 text-orange-400", title: "Alerte prix", info: "−10,6 %" },
  { icon: TrendingUp, iconClass: "bg-sky-950/60 text-sky-400", title: "Opportunité", info: "+2 100 $" },
]

function FlowConnectorDown() {
  return (
    <svg viewBox="0 0 24 40" className="mx-auto h-10 w-6 text-orange-500/80 sm:hidden" aria-hidden>
      <path d="M12 2 V28" fill="none" stroke="currentColor" strokeWidth="1.5" className="flow-dash" />
      <path d="M6 26 L12 34 L18 26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* Schéma : sites concurrents → Go-Data (scan) → résultats concrets */
function FlowDiagram() {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0f1011] p-5 shadow-2xl shadow-black/40 sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
          Ce que fait Go-Data
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          Surveillance active
        </span>
      </div>

      <div className="flex flex-col items-stretch sm:h-60 sm:flex-row sm:items-center">
        {/* Sites concurrents */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 sm:h-full sm:gap-0">
          {FLOW_SITES.map((host) => (
            <div key={host} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-gray-400">
                <Globe className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-[12.5px] font-medium text-white">{host}</span>
            </div>
          ))}
        </div>

        <FlowConnectorDown />
        {/* Convergence des 3 sites vers Go-Data */}
        <svg viewBox="0 0 40 240" className="hidden h-full w-9 shrink-0 text-orange-500/80 sm:block" aria-hidden>
          <path d="M2 22 C 22 22, 16 120, 38 120" fill="none" stroke="currentColor" strokeWidth="1.5" className="flow-dash" />
          <path d="M2 120 H 38" fill="none" stroke="currentColor" strokeWidth="1.5" className="flow-dash" />
          <path d="M2 218 C 22 218, 16 120, 38 120" fill="none" stroke="currentColor" strokeWidth="1.5" className="flow-dash" />
        </svg>

        {/* Nœud Go-Data */}
        <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 py-2">
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-500/40 bg-white/[0.05]">
            <span className="absolute inset-0 -z-10 animate-ping rounded-2xl bg-orange-500/20 [animation-duration:2.5s]" />
            <Image src="/Go-Data.svg" alt="Go-Data" width={36} height={36} className="h-9 w-9 object-contain" />
          </span>
          <div className="text-center">
            <div className="text-[12.5px] font-semibold text-white">Go-Data</div>
            <div className="whitespace-nowrap text-[11px] text-gray-500">Scan quotidien</div>
          </div>
        </div>

        <FlowConnectorDown />
        {/* Vers vos résultats */}
        <svg viewBox="0 0 40 240" className="hidden h-full w-9 shrink-0 text-orange-500/80 sm:block" aria-hidden>
          <path d="M2 120 H 30" fill="none" stroke="currentColor" strokeWidth="1.5" className="flow-dash" />
          <path d="M25 113 L 34 120 L 25 127" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Résultats */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 sm:h-full sm:gap-0">
          {FLOW_RESULTS.map((r) => {
            const Icon = r.icon
            return (
              <div key={r.title} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${r.iconClass}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-white">{r.title}</div>
                  <div className="truncate text-[11px] text-gray-500">{r.info}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <p className="mt-5 text-center text-[11px] text-gray-600">
        Sites publics scannés chaque jour — comparés à votre inventaire
      </p>
    </div>
  )
}

function BrowserFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-[#111315]">
      {children}
    </div>
  )
}

function SectionNumber({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">{n}</span>
      <span className="h-px w-8 bg-orange-600/40 dark:bg-orange-400/40" />
      <span className="text-[13px] font-medium uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
        {label}
      </span>
    </div>
  )
}

export default function MarketingHomePage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user) router.replace("/dashboard")
  }, [user, isLoading, router])

  // On n'attend PAS la résolution de l'auth pour afficher la page : un
  // visiteur anonyme voit le contenu immédiatement. Un utilisateur connecté
  // voit brièvement la landing avant d'être redirigé vers /dashboard.
  if (user) return null

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 pt-16 sm:pt-20 lg:grid-cols-[1fr_1.02fr] lg:gap-12">
          <div>
            <Reveal>
              <p className="flex items-center gap-2 text-[13px] font-medium text-gray-500 dark:text-gray-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
                </span>
                Veille de prix · Moto &amp; sports motorisés
              </p>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="mt-6 text-balance text-[2.6rem] font-bold leading-[1.05] tracking-tight text-gray-900 sm:text-5xl xl:text-[3.4rem] dark:text-white [font-family:var(--font-display)]">
                Les prix de vos concurrents.
                <br />
                <span className="text-orange-600 dark:text-orange-400">Surveillés. Comparés.</span>
                <br />
                Chaque jour.
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-600 dark:text-gray-400">
                Go-Data scanne les inventaires publics des concessionnaires autour de vous.
                Chaque changement détecté. Chaque écart chiffré. Zéro copier-coller.
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/create-account"
                  className="group inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
                >
                  Démarrer gratuitement
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/demo"
                  className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/[0.04]"
                >
                  Voir la démo
                </Link>
              </div>
              <p className="mt-5 text-[13px] text-gray-400 dark:text-gray-500">
                Sans carte de crédit · Données du jour · Interface en français
              </p>
            </Reveal>
          </div>

          <Reveal delay={200} className="relative min-w-0">
            <FlowDiagram />
          </Reveal>
        </div>

        <div className="mx-auto max-w-6xl px-6 pb-8 pt-14">
          <Reveal delay={120}>
            <BrowserFrame>
              <Image
                src="/landing/shot-analytics.png"
                alt="Tableau de bord Go-Data : positionnement de prix et évolution face aux concurrents"
                width={2360}
                height={892}
                priority
                className="w-full"
              />
            </BrowserFrame>
            <p className="mt-3 text-center font-mono text-xs text-gray-400 dark:text-gray-500">
              Capture réelle du produit — données de démonstration
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Clients ──────────────────────────────────────── */}
      <section className="border-y border-gray-200 dark:border-white/10">
        <Reveal>
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-6 py-8 sm:flex-row sm:justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Des concessionnaires québécois surveillent déjà leur marché avec Go-Data
            </p>
            <div className="flex items-center gap-3">
              {[
                { src: "/logo_mvm.png", alt: "MVM Motosport", width: 225, height: 225, logoClass: "h-11" },
                { src: "/logo_moto_db.png", alt: "Moto DB", width: 350, height: 100, logoClass: "h-8" },
                { src: "/motoplex.jpg", alt: "Motoplex", width: 745, height: 328, logoClass: "h-9" },
              ].map((client) => (
                <span
                  key={client.alt}
                  className="inline-flex h-13 items-center rounded-lg bg-white px-4 ring-1 ring-gray-200 dark:ring-white/10"
                >
                  <Image
                    src={client.src}
                    alt={client.alt}
                    width={client.width}
                    height={client.height}
                    className={`${client.logoClass} w-auto object-contain`}
                  />
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── 01 Surveiller ────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <SectionNumber n="01" label="Surveiller" />
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
              Un scan. Tous les sites.
            </h2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">
              Ajoutez les sites de vos concurrents. Go-Data les visite pour vous.
              Baisses. Hausses. Nouveautés. Retraits. Tout est détecté, daté, archivé.
            </p>
            <ul className="mt-6 space-y-2.5 text-[15px] text-gray-700 dark:text-gray-300">
              <li className="flex items-center gap-2.5">
                <span className="h-1 w-4 rounded-full bg-orange-500" />
                Vérification quotidienne, automatique
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-1 w-4 rounded-full bg-orange-500" />
                Alerte courriel quand un prix bouge
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-1 w-4 rounded-full bg-orange-500" />
                Historique complet, produit par produit
              </li>
            </ul>
          </Reveal>
          <Reveal delay={120}>
            <BrowserFrame>
              <Image
                src="/landing/shot-changes.png"
                alt="Fil des changements détectés par Go-Data : baisses de prix, nouveaux produits, retraits"
                width={1720}
                height={916}
                className="w-full"
              />
            </BrowserFrame>
          </Reveal>
        </div>
      </section>

      {/* ── 02 Comparer ──────────────────────────────────── */}
      <section className="border-y border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <div className="max-w-2xl">
              <SectionNumber n="02" label="Comparer" />
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
                Votre position. Produit par produit.
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">
                Qui est le moins cher. Sur quoi. De combien.
                Le classement se met à jour tout seul.
              </p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-10">
              <BrowserFrame>
                <Image
                  src="/landing/shot-retailers.png"
                  alt="Comparaison par détaillant dans Go-Data : écart moyen et produits comparés pour chaque concurrent"
                  width={2360}
                  height={768}
                  className="w-full"
                />
              </BrowserFrame>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 03 Décider ───────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal className="order-1 lg:order-2">
            <SectionNumber n="03" label="Décider" />
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
              Des écarts en dollars. Pas des impressions.
            </h2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">
              Marge à reprendre. Baisse à faire. Modèle sans concurrence directe.
              Go-Data chiffre chaque opportunité. Vous tranchez.
            </p>
            <Link
              href="/pricing"
              className="group mt-6 inline-flex items-center gap-2 text-sm font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
            >
              Voir les tarifs
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Reveal>
          <Reveal delay={120} className="order-2 lg:order-1">
            <BrowserFrame>
              <Image
                src="/landing/shot-opportunities.png"
                alt="Détection d'opportunités Go-Data : impact cumulé et recommandations de prix chiffrées"
                width={1720}
                height={1066}
                className="w-full"
              />
            </BrowserFrame>
          </Reveal>
        </div>
      </section>

      {/* ── Bande photo ──────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <Image
          src="/landing/showroom.jpg"
          alt="Plancher d'une concession de motos"
          width={1800}
          height={1200}
          className="h-[420px] w-full object-cover sm:h-[480px]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/25" />
        <div className="absolute inset-0 flex items-center">
          <div className="mx-auto w-full max-w-6xl px-6">
            <Reveal>
              <h2 className="max-w-xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl [font-family:var(--font-display)]">
                Pensé pour le plancher de vente.
                <br />
                Pas pour un labo de données.
              </h2>
              <p className="mt-4 max-w-md text-[17px] leading-relaxed text-gray-300">
                Vous ouvrez Go-Data le matin. Vous voyez ce qui a bougé.
                Vous ajustez. C&apos;est tout.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Vertical ─────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <Reveal>
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white [font-family:var(--font-display)]">
              Un seul marché. Fait à fond.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-gray-600 dark:text-gray-400">
              Go-Data ne fait pas « tous les secteurs ». Concessionnaires moto et sports
              motorisés d&apos;abord. Le reste attendra.
            </p>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            { src: "/landing/moto-adventure.jpg", label: "Moto & scooter", alt: "Moto d'aventure en salle de montre" },
            { src: "/landing/snowmobile.jpg", label: "Motoneige & VTT", alt: "Motoneige sur sentier enneigé" },
            { src: "/landing/motocross.jpg", label: "Motocross & nautique", alt: "Course de motocross" },
          ].map((v, i) => (
            <Reveal key={v.label} delay={i * 100}>
              <figure className="group relative overflow-hidden rounded-xl">
                <Image
                  src={v.src}
                  alt={v.alt}
                  width={1800}
                  height={1200}
                  className="h-64 w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                <figcaption className="absolute bottom-4 left-4 text-[15px] font-semibold text-white">
                  {v.label}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-10 border-y border-gray-200 py-12 sm:grid-cols-3 dark:border-white/10">
          {[
            { value: "2 – 5 h", label: "de veille manuelle économisées par semaine" },
            { value: "1 endroit", label: "pour les prix et inventaires de votre marché" },
            { value: "Quotidien", label: "rythme de mise à jour des données" },
          ].map((stat, i) => (
            <Reveal key={stat.label} delay={i * 80}>
              <div className="text-4xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white [font-family:var(--font-display)]">
                {stat.value}
              </div>
              <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">{stat.label}</div>
            </Reveal>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-400 dark:text-gray-600">
          Estimations indicatives selon le volume de sites suivis et la fréquence de
          vérification manuelle actuelle.
        </p>
      </section>

      {/* ── CTA final ────────────────────────────────────── */}
      <section className="border-t border-gray-200 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl dark:text-white [font-family:var(--font-display)]">
              Le marché a bougé ce matin.
              <br />
              <span className="text-orange-600 dark:text-orange-400">Vous le sauriez avec Go-Data.</span>
            </h2>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/create-account"
                className="group inline-flex items-center gap-2 rounded-lg bg-orange-600 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
              >
                Créer un compte
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contact"
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
