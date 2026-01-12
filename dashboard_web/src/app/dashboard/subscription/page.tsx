"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { Loader2, Check } from "lucide-react"

const PLANS = [
  {
    id: "free",
    name: "Gratuit",
    description: "Accès de base aux fonctionnalités",
    features: ["Scraping de base", "Jusqu'à 10 sites", "Support par email"],
  },
  {
    id: "standard",
    name: "Standard",
    description: "Fonctionnalités avancées",
    price: "À venir",
    features: ["Scraping avancé", "Sites illimités", "Support prioritaire", "Analytics avancés"],
  },
  {
    id: "premium",
    name: "Premium",
    description: "Toutes les fonctionnalités",
    price: "À venir",
    features: [
      "Toutes les fonctionnalités Standard",
      "API access",
      "Support 24/7",
      "Gestion d'équipe",
      "Analytics premium",
    ],
  },
]

export default function SubscriptionPage() {
  const { user, isLoading, isMainAccount } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [user, isLoading, router])

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
        </div>
      </Layout>
    )
  }

  if (!user) {
    return null
  }

  if (!isMainAccount) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-4">
            <p className="text-yellow-800 dark:text-yellow-300">
              L'abonnement peut être géré uniquement par le compte principal.
            </p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight mb-8">
          Abonnement
        </h1>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            L'abonnement peut être géré uniquement par le compte principal.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`bg-white dark:bg-[#0F0F12] rounded-lg border-2 p-6 ${
                user.subscription_plan === plan.id
                  ? "border-blue-500"
                  : "border-gray-200 dark:border-[#1F1F23]"
              }`}
            >
              <div className="mb-4">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {plan.name}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {plan.description}
                </p>
                {plan.price && (
                  <p className="text-lg font-bold text-gray-900 dark:text-white mt-2">
                    {plan.price}
                  </p>
                )}
              </div>

              <ul className="space-y-2 mb-6">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Check className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                  user.subscription_plan === plan.id
                    ? "bg-gray-200 dark:bg-[#1F1F23] text-gray-700 dark:text-gray-300 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
                disabled={user.subscription_plan === plan.id}
              >
                {user.subscription_plan === plan.id ? "Plan actuel" : "Sélectionner"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  )
}


