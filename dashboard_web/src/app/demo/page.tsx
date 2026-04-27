"use client"

import Link from "next/link"
import Image from "next/image"
import { useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Lock,
  Home,
  BarChart2,
  Activity,
  CreditCard,
  User,
  Radar,
  TrendingUp,
  TrendingDown,
  Bell,
  Mail,
  Package,
  Star,
  Eye,
  Pause,
  Trash2,
  Globe,
  CheckCheck,
  Sparkles,
} from "lucide-react"

import PricePositioningCard from "@/components/analytics/price-positioning"
import PriceEvolutionChart from "@/components/analytics/price-evolution"
import OpportunitiesDetection from "@/components/analytics/opportunities"
import AlertsAndInsights from "@/components/analytics/alerts-insights"
import RetailerAnalysis from "@/components/analytics/retailer-analysis"

type Tab = "analyse" | "comparaison" | "alertes"

/* ───────────────── MOCK DATA ───────────────── */

const MOCK_POSITIONING = {
  position: "lowest" as const,
  ecartPourcentage: -3.2,
  ecartValeur: -1847.5,
  classement: 1,
  totalDetailleurs: 4,
  message:
    "Votre inventaire est le plus agressif du marché régional : vous êtes en moyenne 3.2% sous vos concurrents directs.",
}

const MOCK_EVOLUTION = Array.from({ length: 14 }).map((_, i) => {
  const day = new Date()
  day.setDate(day.getDate() - (13 - i))
  const base = 52500 + Math.sin(i / 2) * 1200 + i * 120
  return {
    date: day.toISOString().slice(0, 10),
    prixReference: Math.round(base),
    prixMoyenMarche: Math.round(base + 1500 + Math.cos(i / 3) * 800),
    prixConcurrents: {},
  }
})

const MOCK_OPPORTUNITIES = [
  {
    type: "marge" as const,
    produit: "Ford Escape Titanium 2024",
    recommandation:
      "Prix 4.2 % sous la moyenne du marché — marge potentielle de +1 240 $ sans perdre en compétitivité.",
    impactPotentiel: 1240,
    categorie: "VUS",
  },
  {
    type: "augmentation" as const,
    produit: "Ford Ranger Lariat 2023",
    recommandation:
      "Aucun concurrent direct sur ce modèle dans un rayon de 50 km — opportunité premium.",
    impactPotentiel: 2100,
    categorie: "Camion",
  },
  {
    type: "baisse" as const,
    produit: "Sea-Doo Spark Trixx 2024",
    recommandation:
      "Concurrence 8.1 % plus agressive chez Mathias Sports — réviser pour protéger le volume.",
    impactPotentiel: 720,
    categorie: "Nautique",
  },
  {
    type: "marge" as const,
    produit: "Ford Bronco Sport 2024",
    recommandation:
      "Marge moyenne de 6.8 % détectée vs le marché — potentiel d'optimisation sur 14 unités.",
    impactPotentiel: 980,
    categorie: "VUS",
  },
]

const MOCK_DETAILLEURS = [
  {
    site: "st-onge-ford.com",
    prixMoyen: 54280,
    agressivite: -3.2,
    frequencePromotions: 12,
    nombreProduits: 182,
    produitsComparables: 88,
    isReference: true,
    categorieStats: [
      { categorie: "vus", prixMoyen: 42850, agressivite: -4.1, nombreProduits: 54 },
      { categorie: "moto", prixMoyen: 58200, agressivite: -2.8, nombreProduits: 22 },
      { categorie: "quad", prixMoyen: 15400, agressivite: -1.2, nombreProduits: 12 },
    ],
  },
  {
    site: "joliette-recreatif.com",
    prixMoyen: 18450,
    agressivite: 2.4,
    frequencePromotions: 9,
    nombreProduits: 94,
    produitsComparables: 41,
    isReference: false,
    categorieStats: [
      { categorie: "vtt", prixMoyen: 16900, agressivite: 3.1, nombreProduits: 38 },
      { categorie: "motoneige", prixMoyen: 19800, agressivite: 1.8, nombreProduits: 31 },
    ],
  },
  {
    site: "mathias-sports.com",
    prixMoyen: 14920,
    agressivite: -5.6,
    frequencePromotions: 18,
    nombreProduits: 128,
    produitsComparables: 62,
    isReference: false,
    categorieStats: [
      { categorie: "moto", prixMoyen: 11200, agressivite: -6.2, nombreProduits: 42 },
      { categorie: "vtt", prixMoyen: 15800, agressivite: -4.9, nombreProduits: 48 },
    ],
  },
  {
    site: "laval-moto.com",
    prixMoyen: 16780,
    agressivite: 6.4,
    frequencePromotions: 4,
    nombreProduits: 76,
    produitsComparables: 38,
    isReference: false,
    categorieStats: [
      { categorie: "moto", prixMoyen: 17100, agressivite: 7.2, nombreProduits: 54 },
      { categorie: "scooter", prixMoyen: 4950, agressivite: 3.8, nombreProduits: 14 },
    ],
  },
]

const MOCK_ALERTS_STATS = {
  prixMoyen: 54280,
  heuresEconomisees: 24.5,
  nombreScrapes: 1842,
  scrapesParJour: [],
}

const MOCK_ALERTES_INSIGHT = [
  {
    type: "ecart" as const,
    message:
      "Écart de prix > 10 % détecté sur 5 véhicules par rapport à Mathias Sports",
    severite: "high" as const,
    date: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    type: "nouveau" as const,
    message: "4 nouveaux véhicules ajoutés aujourd'hui chez St-Onge Ford",
    severite: "medium" as const,
    date: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
]

const MOCK_MONITORED = [
  {
    id: "1",
    hostname: "st-onge-ford.com",
    cached: true,
    competitors: ["mathias-sports.com", "laval-moto.com"],
    productCount: 182,
    lastRun: "il y a 12 min",
    active: true,
    email: true,
  },
  {
    id: "2",
    hostname: "joliette-recreatif.com",
    cached: true,
    competitors: ["mathias-sports.com"],
    productCount: 94,
    lastRun: "il y a 41 min",
    active: true,
    email: true,
  },
  {
    id: "3",
    hostname: "mathias-sports.com",
    cached: true,
    competitors: ["laval-moto.com", "joliette-recreatif.com"],
    productCount: 128,
    lastRun: "il y a 1 h",
    active: true,
    email: true,
  },
]

type ChangeType =
  | "price_decrease"
  | "price_increase"
  | "new_product"
  | "removed_product"

const MOCK_CHANGES: Array<{
  id: string
  type: ChangeType
  productName: string
  site: string
  oldValue?: string
  newValue?: string
  diff?: number
  time: string
  unread: boolean
}> = [
  {
    id: "c1",
    type: "price_decrease",
    productName: "Sea-Doo GTX 170 2024",
    site: "mathias-sports.com",
    oldValue: "15 999 $",
    newValue: "14 299 $",
    diff: -10.6,
    time: "il y a 12 min",
    unread: true,
  },
  {
    id: "c2",
    type: "new_product",
    productName: "Ford Bronco Wildtrak 2026",
    site: "st-onge-ford.com",
    time: "il y a 1 h",
    unread: true,
  },
  {
    id: "c3",
    type: "price_increase",
    productName: "Polaris Sportsman 570",
    site: "joliette-recreatif.com",
    oldValue: "9 499 $",
    newValue: "9 899 $",
    diff: 4.2,
    time: "il y a 3 h",
    unread: false,
  },
  {
    id: "c4",
    type: "removed_product",
    productName: "Yamaha Grizzly 700 (Démo)",
    site: "mathias-sports.com",
    time: "il y a 6 h",
    unread: false,
  },
  {
    id: "c5",
    type: "price_decrease",
    productName: "Ford F-150 XLT 2023",
    site: "st-onge-ford.com",
    oldValue: "52 995 $",
    newValue: "49 899 $",
    diff: -5.8,
    time: "il y a 9 h",
    unread: false,
  },
]

/* ───────────────── COMPONENTS ───────────────── */

function LockedOverlay({ message = "Débloquez pour voir plus" }: { message?: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl backdrop-blur-md bg-[#1c1e20]/60">
      <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-[#242628]/95 border border-white/[0.08] shadow-2xl max-w-sm mx-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-600/30">
          <Lock className="h-5 w-5 text-white" />
        </div>
        <p className="text-sm font-semibold text-white text-center">{message}</p>
        <Link
          href="/create-account"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
        >
          Débloquer gratuitement
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

function DashboardTopNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const navItems: Array<{ id: Tab | "home" | "payments"; label: string; icon: typeof Home; demo: boolean }> = [
    { id: "home", label: "Tableau de bord", icon: Home, demo: false },
    { id: "analyse", label: "Analyse", icon: BarChart2, demo: true },
    { id: "alertes", label: "Alertes", icon: Activity, demo: true },
    { id: "payments", label: "Paiements", icon: CreditCard, demo: false },
  ]

  const activeId: string = tab === "comparaison" ? "analyse" : tab

  return (
    <nav className="h-16 px-3 sm:px-6 flex items-center justify-between bg-[var(--color-background-primary)] border-b border-[var(--color-border-secondary)]">
      <Link href="/" className="flex items-center hover:opacity-90 transition-opacity">
        <span className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
          GO-DATA
        </span>
      </Link>

      <div className="flex-1 flex justify-center">
        <div className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeId === item.id
            const handleClick = () => {
              if (item.id === "analyse") setTab("analyse")
              else if (item.id === "alertes") setTab("alertes")
            }
            return (
              <button
                key={item.id}
                onClick={handleClick}
                disabled={!item.demo}
                className={`group relative flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "text-[var(--color-text-primary)] font-semibold"
                    : item.demo
                      ? "text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-tertiary)] font-medium cursor-not-allowed opacity-60"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${
                    isActive ? "text-emerald-600 dark:text-emerald-400" : ""
                  }`}
                />
                <span className="hidden sm:inline">{item.label}</span>
                <span
                  className={`absolute bottom-0 left-2 right-2 h-[2px] rounded-full transition-all duration-200 ${
                    isActive
                      ? "opacity-100 bg-emerald-600 dark:bg-emerald-400"
                      : "opacity-0"
                  }`}
                />
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-full ring-2 ring-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
          <User className="h-4 w-4 text-[var(--color-text-secondary)]" />
        </div>
      </div>
    </nav>
  )
}

/* ───────────────── PAGE ───────────────── */

export default function DemoPage() {
  const [tab, setTab] = useState<Tab>("analyse")

  return (
    <div className="min-h-screen bg-[#111314] text-white">
      {/* Landing page header (above dashboard frame) */}
      <header className="relative z-20 px-4 sm:px-6 py-5 border-b border-white/[0.06]">
        <div className="max-w-[1800px] mx-auto flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative h-10 w-10 flex-shrink-0 rounded-xl bg-gradient-to-br from-[#242628] to-[#1c1e20] shadow-lg shadow-black/20 p-0.5">
              <div className="relative h-full w-full rounded-[10px] overflow-hidden">
                <Image src="/Go-Data.svg" alt="GO-DATA" fill sizes="40px" className="object-contain" />
              </div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-emerald-400/90 font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" />
                Démo interactive
              </p>
              <p className="text-sm font-semibold text-white">Aperçu du tableau de bord</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Retour</span>
            </Link>
            <Link
              href="/create-account"
              className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/25"
            >
              <span className="hidden sm:inline">Commencer gratuitement</span>
              <span className="sm:hidden">Commencer</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Segmented tab selector (landing style) */}
      <div className="px-4 sm:px-6 pt-6 pb-4">
        <div className="max-w-[1800px] mx-auto flex flex-wrap items-center gap-3 justify-between">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#1c1e20] border border-white/[0.06]">
            {(
              [
                { id: "analyse" as const, label: "Analyse" },
                { id: "comparaison" as const, label: "Comparaison" },
                { id: "alertes" as const, label: "Alertes" },
              ]
            ).map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    active
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-gray-500">
            Données mockées — reproduit fidèlement l'interface réelle
          </p>
        </div>
      </div>

      {/* Dashboard frame — reproduit le vrai Layout */}
      <div className="px-4 sm:px-6 pb-12">
        <div className="max-w-[1800px] mx-auto rounded-2xl overflow-hidden border border-[var(--color-border-secondary)] shadow-2xl shadow-black/40">
          <DashboardTopNav tab={tab} setTab={setTab} />
          <div className="background-template p-4 sm:p-6 min-h-[600px]">
            <div className="w-full">
              {tab === "analyse" && <AnalyseView />}
              {tab === "comparaison" && <ComparaisonView />}
              {tab === "alertes" && <AlertesView />}
            </div>
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <section className="px-4 sm:px-6 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="relative p-8 md:p-12 rounded-3xl bg-gradient-to-br from-[#242628] to-[#1c1e20] border border-white/[0.06] text-center overflow-hidden">
            <h2 className="relative text-2xl md:text-3xl font-bold mb-3">
              Envie de vraies données, sans flou&nbsp;?
            </h2>
            <p className="relative text-sm md:text-base text-gray-400 mb-6 max-w-xl mx-auto">
              Créez un compte gratuit en 30 secondes et connectez votre premier scraper.
            </p>
            <div className="relative flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/create-account"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-gray-900 text-sm font-semibold hover:bg-gray-100 transition-all shadow-lg"
              >
                Créer un compte gratuit
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/#pricing"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 backdrop-blur border border-white/20 text-white text-sm font-semibold hover:bg-white/15 transition-all"
              >
                Voir les tarifs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

/* ───────────────── ANALYSE VIEW (reproduction /dashboard/analytics) ───────────────── */

function AnalyseView() {
  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
            Analyse du marché
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Positionnement, évolution et opportunités détectées automatiquement
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-900/40">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-medium text-emerald-300">Mis à jour il y a 2 min</span>
        </div>
      </div>

      {/* Positionnement + Évolution des prix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <PricePositioningCard positionnement={MOCK_POSITIONING} />
        </div>
        <div className="lg:col-span-2">
          <PriceEvolutionChart evolutionPrix={MOCK_EVOLUTION} scrapesParJour={[]} />
        </div>
      </div>

      {/* Opportunités (la 1ère visible, le reste flouté) + Alertes/insights flouté */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="relative">
          <div className="pointer-events-none select-none">
            <OpportunitiesDetection opportunites={MOCK_OPPORTUNITIES} />
          </div>
          {/* Dégradé + lock sur la moitié inférieure */}
          <div className="absolute inset-x-0 bottom-0 h-[55%] rounded-b-2xl backdrop-blur-md bg-gradient-to-b from-[#1c1e20]/30 via-[#1c1e20]/80 to-[#1c1e20]/95 flex items-end justify-center pb-6 border-b border-x border-[#2a2c2e]">
            <div className="flex flex-col items-center gap-3 px-5 py-4 rounded-2xl bg-[#242628]/95 border border-white/[0.08] shadow-2xl">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-600/30">
                <Lock className="h-4 w-4 text-white" />
              </div>
              <p className="text-sm font-semibold text-white">9 opportunités détectées</p>
              <Link
                href="/create-account"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
              >
                Débloquer gratuitement
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="pointer-events-none select-none filter blur-[2px] opacity-80">
            <AlertsAndInsights
              alertes={MOCK_ALERTES_INSIGHT}
              stats={MOCK_ALERTS_STATS}
            />
          </div>
          <LockedOverlay message="Stats détaillées : heures économisées, scrapes, anomalies IA" />
        </div>
      </div>
    </div>
  )
}

/* ───────────────── COMPARAISON VIEW ───────────────── */

function ComparaisonView() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
            Benchmark concurrentiel
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            4 concessionnaires suivis — écart de prix moyen et répartition par catégorie
          </p>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Concessionnaires", value: 4 },
          { label: "Produits comparés", value: 229 },
          { label: "Votre position", value: "1er/4" },
          { label: "Écart moyen", value: "-3.2%" },
        ].map((s, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] backdrop-blur-sm p-5 flex flex-col justify-between"
          >
            <p className="text-xs font-medium text-[var(--color-text-secondary)] tracking-wide mb-2">
              {s.label}
            </p>
            <p className="text-2xl font-extrabold leading-none tabular-nums tracking-tight text-[var(--color-text-primary)]">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Vrai composant RetailerAnalysis */}
      <RetailerAnalysis detailleurs={MOCK_DETAILLEURS} />

      {/* Graphique détaillé flouté */}
      <div className="relative">
        <div className="pointer-events-none select-none filter blur-[3px] opacity-80">
          <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Analyse par catégorie × concessionnaire
            </h3>
            <p className="text-sm text-gray-500 dark:text-[#B0B0B0] mb-6">
              Heatmap des écarts de prix par catégorie de produit pour chaque concurrent
            </p>
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 30 }).map((_, i) => {
                const intensity = Math.abs(Math.sin(i)) * 0.5 + 0.2
                const isRed = i % 3 === 0
                return (
                  <div
                    key={i}
                    className="h-14 rounded-md"
                    style={{
                      backgroundColor: isRed
                        ? `rgba(163, 45, 45, ${intensity})`
                        : `rgba(59, 109, 17, ${intensity})`,
                    }}
                  />
                )
              })}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-gray-50 dark:bg-[#242628] rounded-lg p-3 h-16"
                />
              ))}
            </div>
          </div>
        </div>
        <LockedOverlay message="Heatmap complète, export PDF et insights IA" />
      </div>
    </div>
  )
}

/* ───────────────── ALERTES VIEW (reproduction /dashboard/alerte) ───────────────── */

function AlertesView() {
  const unreadCount = MOCK_CHANGES.filter((c) => c.unread).length
  const priceIncreases = MOCK_CHANGES.filter((c) => c.type === "price_increase" && c.unread).length
  const priceDecreases = MOCK_CHANGES.filter((c) => c.type === "price_decrease" && c.unread).length
  const activeAlerts = MOCK_MONITORED.filter((a) => a.active).length

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
            Alertes
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Surveillance continue de vos concurrents
          </p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Alertes actives", value: activeAlerts, icon: Radar },
          { label: "Non lus", value: unreadCount, icon: Activity },
          { label: "Hausses détectées", value: priceIncreases, icon: TrendingUp },
          { label: "Baisses détectées", value: priceDecreases, icon: TrendingDown },
        ].map((s, i) => {
          const Icon = s.icon
          return (
            <div
              key={i}
              className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] backdrop-blur-sm p-5 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-[var(--color-text-secondary)] tracking-wide">
                  {s.label}
                </p>
                <Icon className="h-3.5 w-3.5 text-[var(--color-text-secondary)] opacity-50" />
              </div>
              <p className="text-3xl font-extrabold leading-none tabular-nums tracking-tight text-[var(--color-text-primary)]">
                {s.value}
              </p>
            </div>
          )
        })}
      </div>

      {/* Sites surveillés */}
      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden shadow-lg shadow-black/20">
        <div className="px-5 py-4 border-b border-[var(--color-border-tertiary)]">
          <h2 className="text-base font-extrabold text-[var(--color-text-primary)] tracking-tight">
            Sites surveillés
            <span className="ml-2 px-1.5 py-0.5 rounded-md bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] text-[11px] font-semibold tabular-nums">
              {MOCK_MONITORED.length}
            </span>
          </h2>
        </div>
        <div className="divide-y divide-[var(--color-border-tertiary)]">
          {MOCK_MONITORED.map((alert) => (
            <div
              key={alert.id}
              className="px-5 py-3.5 hover:bg-[var(--color-background-hover)] transition"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Star className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                      {alert.hostname}
                    </span>
                    {alert.cached && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-green-900/30 text-green-300 font-medium">
                        En cache
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 mt-1 text-[11px] text-[var(--color-text-secondary)]">
                    <span className="flex items-center gap-1">
                      <Radar className="h-3 w-3" /> Auto
                    </span>
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" /> Email
                    </span>
                    {alert.competitors.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3" /> {alert.competitors.length} concurrent(s)
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Package className="h-3 w-3" /> {alert.productCount} prod.
                    </span>
                    <span>{alert.lastRun}</span>
                  </div>
                  {alert.competitors.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {alert.competitors.map((u, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--color-background-secondary)] text-[10px] font-medium text-[var(--color-text-secondary)]"
                        >
                          <Globe className="h-2.5 w-2.5" /> {u}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="p-1.5 text-gray-400 hover:text-emerald-400 hover:bg-emerald-900/20 rounded-lg transition">
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-yellow-900/20 rounded-lg transition">
                    <Pause className="h-3.5 w-3.5" />
                  </button>
                  <button className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Feed d'activité */}
      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden shadow-lg shadow-black/20">
        <div className="px-5 py-4 border-b border-[var(--color-border-tertiary)] flex items-center justify-between">
          <h2 className="text-base font-extrabold text-[var(--color-text-primary)] tracking-tight">
            Changements détectés
            <span className="ml-2 px-1.5 py-0.5 rounded-md bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] text-[11px] font-semibold tabular-nums">
              {unreadCount}
            </span>
          </h2>
          <button className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold">
            <CheckCheck className="h-3 w-3" /> Tout marquer comme lu
          </button>
        </div>

        <div className="p-3 space-y-2.5 relative">
          {MOCK_CHANGES.slice(0, 2).map((change) => (
            <AlertRow key={change.id} change={change} />
          ))}
          <div className="relative">
            <div className="pointer-events-none select-none filter blur-[2px] opacity-80 space-y-2.5">
              {MOCK_CHANGES.slice(2).map((change) => (
                <AlertRow key={change.id} change={change} />
              ))}
            </div>
            <LockedOverlay message="Recevez toutes vos alertes par email, SMS et Slack" />
          </div>
        </div>
      </div>
    </div>
  )
}

function AlertRow({ change }: { change: (typeof MOCK_CHANGES)[number] }) {
  const isPriceChange = change.type === "price_increase" || change.type === "price_decrease"
  const isIncrease = change.type === "price_increase"

  const deltaColor = isIncrease
    ? "text-[#3B6D11] bg-[#3B6D11]/15"
    : "text-[#A32D2D] bg-[#A32D2D]/15"

  const changeLabel: Record<ChangeType, string> = {
    price_decrease: "Baisse de prix",
    price_increase: "Hausse de prix",
    new_product: "Nouveau produit",
    removed_product: "Produit retiré",
  }

  const iconByType: Record<ChangeType, typeof TrendingDown> = {
    price_decrease: TrendingDown,
    price_increase: TrendingUp,
    new_product: Sparkles,
    removed_product: Package,
  }
  const Icon = iconByType[change.type]

  const iconBg: Record<ChangeType, string> = {
    price_decrease: "bg-[#A32D2D]/15 text-[#A32D2D]",
    price_increase: "bg-[#3B6D11]/15 text-[#3B6D11]",
    new_product: "bg-emerald-900/30 text-emerald-400",
    removed_product: "bg-[#242628] text-[var(--color-text-secondary)]",
  }

  return (
    <div
      className={`group rounded-xl border transition-all ${
        change.unread
          ? "border-emerald-800/30 bg-emerald-950/5"
          : "border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)]"
      } hover:shadow-sm`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${iconBg[change.type]}`}
          >
            <Icon className="h-5 w-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                {change.productName}
              </h4>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] font-medium">
                {changeLabel[change.type]}
              </span>
              {change.unread && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-900/30 text-emerald-300 font-semibold">
                  Nouveau
                </span>
              )}
            </div>

            {isPriceChange && change.oldValue && change.newValue && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] mb-1.5">
                <span className="line-through">{change.oldValue}</span>
                <ArrowRight className="h-3 w-3" />
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {change.newValue}
                </span>
                {typeof change.diff === "number" && (
                  <span
                    className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums ${deltaColor}`}
                  >
                    {change.diff > 0 ? "+" : ""}
                    {change.diff.toFixed(1)}%
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--color-text-secondary)]">
              <span className="inline-flex items-center gap-1">
                <Globe className="h-3 w-3" /> {change.site}
              </span>
              <span>•</span>
              <span>{change.time}</span>
            </div>
          </div>

          <Bell className="h-3.5 w-3.5 text-[var(--color-text-secondary)] opacity-60 shrink-0 mt-1" />
        </div>
      </div>
    </div>
  )
}
