"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { Loader2, Check, Sparkles, Zap, Crown, ArrowRight } from "lucide-react"

const PLANS = [
  {
    id: "standard",
    name: "Gratuit",
    price: "0",
    period: " $ / mois",
    description: "Idéal pour tester et découvrir les fonctionnalités de base",
    icon: Sparkles,
    color: "from-gray-500 to-gray-600",
    features: [
      "6 scrapings d'essai",
      "Tableau de bord et comparaisons",
      "Export CSV",
    ],
    limitations: ["Pas d'analytics ni d'alertes"],
    contactOnly: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "200",
    period: " $ / mois",
    description: "Pour surveiller votre marché au quotidien",
    icon: Zap,
    color: "from-emerald-500 to-emerald-600",
    features: [
      "Scrapings illimités",
      "Analytics complet",
      "3 sites surveillés en continu",
      "Alertes courriel de prix",
      "Support prioritaire",
    ],
    highlighted: true,
    contactOnly: true,
  },
  {
    id: "ultime",
    name: "Ultime",
    price: "275",
    period: " $ / mois",
    description: "Pour couvrir tout votre marché, sans plafond",
    icon: Crown,
    color: "from-teal-500 to-teal-600",
    features: [
      "Tout du plan Pro",
      "Sites surveillés illimités",
      "Alertes illimitées",
      "Accompagnement dédié et onboarding",
      "Accès direct à l'équipe",
    ],
    contactOnly: true,
  },
]

export default function PaymentsPage() {
  const { user, isLoading, refreshUser } = useAuth()
  const router = useRouter()
  const [processingPlan, setProcessingPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [promoCodeValid, setPromoCodeValid] = useState<boolean | null>(null)
  const [validatingPromo, setValidatingPromo] = useState(false)

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
      return
    }

    // Rediriger les utilisateurs avec un plan payant confirmé vers settings
    const hasConfirmedPaidPlan =
      user?.subscription_source === "stripe" || user?.subscription_source === "promo"
    if (user && hasConfirmedPaidPlan) {
      router.push("/dashboard/settings")
    }
  }, [isLoading, user, router])

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-text-secondary)]" />
        </div>
      </Layout>
    )
  }

  if (!user) return null

  const applyMagicCode = async () => {
    setError(null)
    setSuccessMessage(null)
    if (!promoCode.trim() || !promoCodeValid || user.promo_code_id) return

    setProcessingPlan("magic")
    try {
      const applyResponse = await fetch("/api/promo-codes/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoCode.trim(), plan: "ultime" }),
      })

      if (applyResponse.ok) {
        await refreshUser()
        setSuccessMessage("Code magique appliqué ! Votre plan est maintenant actif.")
        setTimeout(() => {
          router.push("/dashboard?plan=updated")
        }, 2000)
      } else {
        const data = await applyResponse.json()
        setError(data.error || "Erreur lors de l'application du code magique")
      }
    } catch (err) {
      console.error("Error applying magic code:", err)
      setError("Erreur lors de l'application du code magique")
    } finally {
      setProcessingPlan(null)
    }
  }

  const selectFreePlan = async () => {
    setError(null)
    setSuccessMessage(null)
    setProcessingPlan("standard")
    try {
      const response = await fetch("/api/users/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_plan: "standard" }),
      })

      if (response.ok) {
        await refreshUser()
        setSuccessMessage("Plan mis à jour avec succès !")
        setProcessingPlan(null)
        setTimeout(() => {
          router.push("/dashboard?plan=updated")
        }, 1500)
      } else {
        const data = await response.json()
        setError(data.error || "Erreur lors de la mise à jour du plan")
        setProcessingPlan(null)
      }
    } catch (error) {
      console.error("Error updating plan:", error)
      setError("Une erreur est survenue. Veuillez réessayer.")
      setProcessingPlan(null)
    }
  }

  const currentPlan = user.subscription_plan || "standard"
  const isCurrentPlan = (planId: string) => currentPlan === planId
  const hasConfirmedPaidPlan =
    user.subscription_source === "stripe" || user.subscription_source === "promo"

  if (hasConfirmedPaidPlan) {
    return null
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-extrabold text-[var(--color-text-primary)] mb-4">
            Choisissez votre plan
          </h1>
          <p className="text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Les plans payants s&apos;activent en nous contactant — ou instantanément avec un
            code magique.
          </p>
        </div>

        {/* Messages de succès/erreur */}
        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-300">{successMessage}</p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Code magique */}
        {!user.promo_code_id && (
          <div className="mb-8 p-6 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-200 dark:border-emerald-900 rounded-xl">
            <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-primary)] mb-2">
              <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Code magique
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value.toUpperCase())
                  setPromoCodeValid(null)
                }}
                onBlur={async () => {
                  if (promoCode.trim()) {
                    setValidatingPromo(true)
                    try {
                      const response = await fetch("/api/promo-codes/validate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code: promoCode.trim() }),
                      })
                      const data = await response.json()
                      setPromoCodeValid(data.valid)
                      if (!data.valid) {
                        setError(data.error || "Code magique invalide")
                      } else {
                        setError(null)
                      }
                    } catch {
                      setPromoCodeValid(false)
                      setError("Erreur lors de la validation du code magique")
                    } finally {
                      setValidatingPromo(false)
                    }
                  }
                }}
                className="flex-1 px-4 py-2 border border-[var(--color-border-secondary)] rounded-lg bg-[var(--color-background-primary)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Entrez votre code magique"
              />
              {validatingPromo && (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400 self-center" />
              )}
              {promoCodeValid === true && (
                <button
                  onClick={applyMagicCode}
                  disabled={processingPlan === "magic"}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {processingPlan === "magic" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Activer"
                  )}
                </button>
              )}
              {promoCodeValid === false && promoCode.trim() && (
                <span className="text-red-500 self-center text-xl">✗</span>
              )}
            </div>
            {promoCodeValid === true && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                Code magique valide ! Cliquez sur « Activer » pour débloquer votre plan.
              </p>
            )}
          </div>
        )}

        {user.promo_code_id && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-300">
              ✓ Vous avez un code magique actif. Votre plan est activé.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {PLANS.map((plan) => {
            const Icon = plan.icon
            const isCurrent = isCurrentPlan(plan.id)
            const isProcessing = processingPlan === plan.id
            const isStandardDisabled = plan.id === "standard" && hasConfirmedPaidPlan

            const getBorderColor = () => {
              if (isCurrent) {
                return plan.id === "standard"
                  ? "border-gray-500"
                  : plan.id === "pro"
                    ? "border-emerald-500"
                    : "border-teal-500"
              }
              return plan.id === "standard"
                ? "border-gray-300 dark:border-gray-700"
                : plan.id === "pro"
                  ? "border-emerald-300 dark:border-emerald-700"
                  : "border-teal-300 dark:border-teal-700"
            }

            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border-2 transition-all duration-300 ${getBorderColor()} ${
                  isCurrent ? "shadow-xl scale-105" : "shadow-lg hover:shadow-xl"
                } bg-[var(--color-background-primary)] overflow-hidden h-full flex flex-col`}
              >
                {isCurrent && (
                  <div className="absolute top-4 right-4 z-10">
                    <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500 text-white">
                      Plan actuel
                    </span>
                  </div>
                )}

                {plan.highlighted && !isCurrent && (
                  <div className="absolute top-4 right-4 z-10">
                    <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                      Populaire
                    </span>
                  </div>
                )}

                <div className="p-8 flex flex-col flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-3 rounded-xl bg-gradient-to-br ${plan.color} text-white`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-[var(--color-text-primary)]">
                        {plan.name}
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        {plan.description}
                      </p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-[var(--color-text-primary)]">
                        {plan.price}
                      </span>
                      <span className="text-lg text-[var(--color-text-secondary)]">
                        {plan.period}
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-[var(--color-text-primary)]">
                          {feature}
                        </span>
                      </li>
                    ))}
                    {plan.limitations?.map((limitation, idx) => (
                      <li key={`lim-${idx}`} className="flex items-start gap-2">
                        <span className="h-5 w-5 flex-shrink-0 mt-0.5 flex items-center justify-center text-orange-500">
                          ⚠️
                        </span>
                        <span className="text-sm text-orange-600 dark:text-orange-400">
                          {limitation}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {plan.contactOnly ? (
                    <div>
                      <Link
                        href="/contact?topic=sales"
                        className="w-full py-3 px-4 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100"
                      >
                        Nous contacter
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <p className="mt-2 text-center text-[11px] text-[var(--color-text-tertiary)]">
                        Activation par l&apos;équipe Go-Data — ou via code magique
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={selectFreePlan}
                      disabled={isCurrent || isProcessing || isStandardDisabled}
                      className={`w-full py-3 px-4 rounded-xl font-semibold transition-all duration-200 ${
                        isCurrent || isStandardDisabled
                          ? "bg-gray-100 dark:bg-gray-800 text-[var(--color-text-secondary)] cursor-not-allowed"
                          : "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100"
                      }`}
                    >
                      {isProcessing ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Traitement...
                        </span>
                      ) : isCurrent ? (
                        "Plan actuel"
                      ) : isStandardDisabled ? (
                        "Annuler dans les paramètres"
                      ) : (
                        "Sélectionner"
                      )}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="text-center text-sm text-[var(--color-text-secondary)]">
          <p>
            Aucun paiement en ligne. Les plans payants sont activés directement par
            l&apos;équipe Go-Data —{" "}
            <Link href="/contact?topic=sales" className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
              écrivez-nous
            </Link>
            .
          </p>
        </div>
      </div>
    </Layout>
  )
}
