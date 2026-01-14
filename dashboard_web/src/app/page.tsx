"use client"

import Link from "next/link"
import Image from "next/image"
import { ArrowRight, Check } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"

export default function Home() {
  const { user, isLoading } = useAuth()
  const isConnected = !!user && !isLoading

  return (
    <div className="min-h-screen bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white">
      <header className="px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative h-10 w-10 flex-shrink-0">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-white/80 via-white/40 to-transparent dark:from-white/20 dark:via-white/12 dark:to-transparent" />
              <Image
                src="/Go-Data.png"
                alt="GO-DATA"
                fill
                sizes="40px"
                className="relative object-contain drop-shadow-sm"
                style={{
                  WebkitMaskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                  maskImage: "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 65%, rgba(0,0,0,0) 100%)",
                }}
              />
            </div>
            <span className="text-lg font-semibold tracking-tight">GO-DATA</span>
          </Link>
          <nav className="flex items-center gap-3">
            {isConnected ? (
              <Link
                href="/dashboard"
                className="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90 transition"
              >
                Accéder au dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition"
                >
                  Se connecter
                </Link>
                <Link
                  href="/create-account"
                  className="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90 transition"
                >
                  Commencer
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="px-6">
        <section className="max-w-6xl mx-auto pt-16 pb-12 grid gap-10 lg:grid-cols-2 items-center">
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              La simplicité est la sophistication ultime.
            </p>
            <h1 className="mt-3 text-4xl md:text-5xl font-extrabold tracking-tight">
              Des données claires. Des décisions rapides.
            </h1>
            <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
              Go-Data collecte, structure et livre vos données prêtes à l’emploi. Zéro bruit, zéro
              friction, juste l’essentiel.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={isConnected ? "/dashboard" : "/create-account"}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
              >
                {isConnected ? "Ouvrir le dashboard" : "Démarrer maintenant"}
                <ArrowRight className="h-4 w-4" />
              </Link>
              {!isConnected && (
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-gray-100 dark:bg-[#1F1F23] text-sm font-semibold text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition"
                >
                  Se connecter
                </Link>
              )}
            </div>
            <div className="mt-6 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-500" />
                Données prêtes en minutes
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-500" />
                Exports propres et standardisés
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-500" />
                Zéro code, zéro complexité
              </span>
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-[#1F1F23] bg-gradient-to-br from-white to-gray-50 dark:from-[#0F0F12] dark:to-[#15151A] p-8 shadow-sm">
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Valeur immédiate</p>
            <ul className="mt-4 space-y-4 text-gray-700 dark:text-gray-300">
              <li>
                <p className="font-semibold text-gray-900 dark:text-white">Collecte intelligente</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Cibles multiples, fréquence maîtrisée, fiabilité constante.
                </p>
              </li>
              <li>
                <p className="font-semibold text-gray-900 dark:text-white">Nettoyage automatique</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Normalisation des champs et formats unifiés.
                </p>
              </li>
              <li>
                <p className="font-semibold text-gray-900 dark:text-white">Livraison claire</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  CSV, JSON, webhooks — prêt à intégrer.
                </p>
              </li>
            </ul>
          </div>
        </section>

        <section className="max-w-6xl mx-auto pb-16">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                title: "Moins d’effort",
                text: "Automatisez la collecte et éliminez les tâches manuelles.",
              },
              {
                title: "Plus de signal",
                text: "Vos données sont prêtes à décider, pas à nettoyer.",
              },
              {
                title: "Contrôle total",
                text: "Définissez vos règles et exportez comme vous voulez.",
              },
            ].map(item => (
              <div
                key={item.title}
                className="p-6 rounded-2xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12]"
              >
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{item.text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
