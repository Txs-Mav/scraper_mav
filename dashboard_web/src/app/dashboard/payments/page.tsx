"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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
      "6 scrapings par mois",
      "2 scrapers en cache",
      "Dashboard de base",
      "Export CSV",
    ],
    limitations: [
      "Scrapings limités à 6 par mois",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "199,99",
    period: " $ / mois",
    description: "Pour les professionnels qui veulent automatiser leur veille prix",
    icon: Zap,
    color: "from-blue-500 to-blue-600",
    features: [
      "Scrapings illimités",
      "8 scrapers en cache",
      "Analytics avancés",
      "Alertes de prix",
      "Support prioritaire",
    ],
    highlighted: true,
  },
  {
    id: "ultime",
    name: "Ultime",
    price: "274,99",
    period: " $ / mois",
    description: "Solution complète pour les équipes et entreprises exigeantes",
    icon: Crown,
    color: "from-purple-500 to-purple-600",
    features: [
      "Tout du plan Pro",
      "Scrapers en cache illimités",
      "API access",
      "Support 24/7 dédié",
      "SLA garanti 99.9%",
      "Gestion d'équipe",
    ],
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

  // Vérifier les paramètres de l'URL pour les messages de retour
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("success") === "true") {
      setSuccessMessage("Paiement réussi ! Votre abonnement a été mis à jour.")
      refreshUser()
      // Nettoyer l'URL
      router.replace("/dashboard/payments")
    } else if (params.get("canceled") === "true") {
      setError("Le paiement a été annulé. Vous pouvez réessayer à tout moment.")
      // Nettoyer l'URL
      router.replace("/dashboard/payments")
    }
  }, [router, refreshUser])

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
        </div>
      </Layout>
    )
  }

  if (!user) return null

  const handlePlanSelect = async (planId: string) => {
    // Réinitialiser les messages
    setError(null)
    setSuccessMessage(null)

    // Si code promo valide, l'appliquer
    if (promoCode.trim() && promoCodeValid && !user.promo_code_id) {
      try {
        const applyResponse = await fetch("/api/promo-codes/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: promoCode.trim(), plan: planId }),
        })

        if (applyResponse.ok) {
          await refreshUser()
          setSuccessMessage("Code promo appliqué ! Votre plan est maintenant gratuit à vie.")
          setTimeout(() => {
            router.push("/dashboard?plan=updated")
          }, 2000)
          return
        } else {
          const data = await applyResponse.json()
          setError(data.error || "Erreur lors de l'application du code promo")
          return
        }
      } catch (err) {
        console.error("Error applying promo code:", err)
        setError("Erreur lors de l'application du code promo")
        return
      }
    }

    if (planId === "standard") {
      // Plan gratuit - pas de paiement nécessaire
      setProcessingPlan(planId)
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
      return
    }

    // Plans payants - utiliser Stripe
    setProcessingPlan(planId)
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planId,
          promo_code: promoCode.trim() && promoCodeValid ? promoCode.trim() : undefined,
          cancel_url: `${baseUrl}/dashboard/payments?payment=canceled`,
          success_url: `${baseUrl}/dashboard?payment=success`,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Erreur de l'API
        setError(data.error || "Erreur lors de la création de la session de paiement")
        setProcessingPlan(null)
        return
      }

      if (data.url) {
        if (data.promo_applied) {
          await refreshUser()
        }
        window.location.href = data.url
        // Note: setProcessingPlan ne sera pas réinitialisé ici car
        // l'utilisateur sera redirigé vers Stripe
      } else {
        setError("Aucune URL de paiement n'a été retournée. Veuillez réessayer.")
        setProcessingPlan(null)
      }
    } catch (error) {
      console.error("Error creating checkout session:", error)
      setError("Erreur de connexion. Veuillez vérifier votre connexion internet et réessayer.")
      setProcessingPlan(null)
    }
  }

  const currentPlan = user.subscription_plan || "standard"
  const isCurrentPlan = (planId: string) => currentPlan === planId
  const hasConfirmedPaidPlan =
    user.subscription_source === "stripe" || user.subscription_source === "promo"

  // Si l'utilisateur a un plan payant confirmé, rediriger vers settings
  if (hasConfirmedPaidPlan) {
    return null
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white mb-4">
            Choisissez votre plan
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Sélectionnez le plan qui correspond le mieux à vos besoins
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

        {/* Code promo */}
        {!user.promo_code_id && (
          <div className="mb-8 p-6 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border border-blue-200 dark:border-blue-900 rounded-xl">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Code promo (optionnel)
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
                        setError(data.error || "Code promo invalide")
                      } else {
                        setError(null)
                      }
                    } catch (err) {
                      setPromoCodeValid(false)
                      setError("Erreur lors de la validation du code promo")
                    } finally {
                      setValidatingPromo(false)
                    }
                  }
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-[#2B2B30] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="PROMO2024-XXXXXX"
              />
              {validatingPromo && (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400 self-center" />
              )}
              {promoCodeValid === true && (
                <span className="text-green-500 self-center text-xl">✓</span>
              )}
              {promoCodeValid === false && promoCode.trim() && (
                <span className="text-red-500 self-center text-xl">✗</span>
              )}
            </div>
            {promoCodeValid === true && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                Code promo valide ! Votre plan sera gratuit à vie.
              </p>
            )}
          </div>
        )}

        {user.promo_code_id && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-300">
              ✓ Vous avez un code promo actif. Votre plan est gratuit à vie.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {PLANS.map((plan) => {
            const Icon = plan.icon
            const isCurrent = isCurrentPlan(plan.id)
            const isProcessing = processingPlan === plan.id
            // Désactiver le plan standard si l'utilisateur a un plan payant
            const isStandardDisabled = plan.id === "standard" && hasConfirmedPaidPlan

            // Définir la couleur de bordure pour chaque plan
            const getBorderColor = () => {
              if (isCurrent) {
                return plan.id === "standard"
                  ? "border-gray-500"
                  : plan.id === "pro"
                    ? "border-blue-500"
                    : "border-purple-500"
              }
              return plan.id === "standard"
                ? "border-gray-300 dark:border-gray-700"
                : plan.id === "pro"
                  ? "border-blue-300 dark:border-blue-700"
                  : "border-purple-300 dark:border-purple-700"
            }

            const getHoverBorderColor = () => {
              return plan.id === "standard"
                ? "hover:border-gray-500 dark:hover:border-gray-500"
                : plan.id === "pro"
                  ? "hover:border-blue-500 dark:hover:border-blue-500"
                  : "hover:border-purple-500 dark:hover:border-purple-500"
            }

            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border-2 transition-all duration-300 ${getBorderColor()} ${getHoverBorderColor()} ${isCurrent
                    ? "shadow-xl scale-105"
                    : "shadow-lg hover:shadow-xl hover:scale-[1.02]"
                  } bg-white dark:bg-[#0F0F12] overflow-hidden h-full flex flex-col`}
              >
                {isCurrent && (
                  <div className="absolute top-4 right-4 z-10">
                    <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-500 text-white">
                      Plan actuel
                    </span>
                  </div>
                )}

                {plan.highlighted && !isCurrent && (
                  <div className="absolute top-4 right-4 z-10">
                    <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                      Populaire
                    </span>
                  </div>
                )}

                <div className="p-8 flex flex-col flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className={`p-3 rounded-xl bg-gradient-to-br ${plan.color} text-white`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                        {plan.name}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {plan.description}
                      </p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-gray-900 dark:text-white">
                        {plan.price}
                      </span>
                      <span className="text-lg text-gray-600 dark:text-gray-400">
                        {plan.period}
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {feature}
                        </span>
                      </li>
                    ))}
                    {plan.limitations && (
                      <>
                        {plan.limitations.map((limitation, idx) => (
                          <li key={`lim-${idx}`} className="flex items-start gap-2">
                            <span className="h-5 w-5 flex-shrink-0 mt-0.5 flex items-center justify-center text-orange-500">
                              ⚠️
                            </span>
                            <span className="text-sm text-orange-600 dark:text-orange-400">
                              {limitation}
                            </span>
                          </li>
                        ))}
                      </>
                    )}
                  </ul>

                  <button
                    onClick={() => handlePlanSelect(plan.id)}
                    disabled={isCurrent || isProcessing || isStandardDisabled}
                    className={`w-full py-3 px-4 rounded-xl font-semibold transition-all duration-200 ${isCurrent || isStandardDisabled
                        ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 cursor-not-allowed"
                        : plan.highlighted
                          ? "bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
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
                    ) : plan.id === "standard" ? (
                      "Sélectionner"
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        Choisir ce plan
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="text-center text-sm text-gray-600 dark:text-gray-400">
          <p>
            Tous les plans incluent un support par email. Les paiements sont sécurisés via{" "}
            <span className="font-semibold">Stripe</span>.
          </p>
        </div>
      </div>
    </Layout>
  )
}
