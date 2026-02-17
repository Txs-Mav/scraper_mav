"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { Loader2 } from "lucide-react"
import Layout from "@/components/kokonutui/layout"

export default function PendingPaymentPage() {
  const { user, isLoading, refreshUser } = useAuth()
  const router = useRouter()
  const [processing, setProcessing] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Attendre un court délai pour que le auth context se charge
    const timer = setTimeout(async () => {
      if (isLoading) return

      const handlePendingPayment = async () => {
        try {
          // Récupérer le pending_plan directement depuis l'API (plus fiable)
          const checkResponse = await fetch("/api/users/get-pending-plan", {
            method: "GET",
          })

          if (!checkResponse.ok) {
            // Non authentifié, rediriger vers login
            router.push("/login")
            return
          }

          const checkData = await checkResponse.json()
          const pendingPlan = checkData.pending_plan

          if (!pendingPlan) {
            // Pas de plan en attente, rediriger vers le dashboard
            router.push("/dashboard")
            return
          }

          // Vérifier s'il y a un code promo en attente (création de compte)
          const pendingPromoCode = typeof window !== "undefined" ? sessionStorage.getItem("pending_promo_code") : null
          const baseUrl = typeof window !== "undefined" ? window.location.origin : ""

          // Créer une session Stripe pour le plan en attente
          // cancel_url = create-account car l'utilisateur vient du flux d'inscription
          const response = await fetch("/api/stripe/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              plan: pendingPlan,
              promo_code: pendingPromoCode || undefined,
              cancel_url: `${baseUrl}/create-account?payment=canceled`,
              success_url: `${baseUrl}/dashboard?payment=success`,
            }),
          })

          const data = await response.json()

          if (!response.ok) {
            setError(data.error || "Erreur lors de la création de la session de paiement")
            setProcessing(false)
            return
          }

          if (data.promo_applied) {
            sessionStorage.removeItem("pending_promo_code")
            await refreshUser()
            router.push("/dashboard?payment=success&promo=true")
          } else if (data.url) {
            // Redirection vers Stripe
            window.location.href = data.url
          } else {
            setError("Aucune URL de paiement n'a été retournée.")
            setProcessing(false)
          }
        } catch (err) {
          console.error("Error processing pending payment:", err)
          setError("Une erreur est survenue. Veuillez réessayer.")
          setProcessing(false)
        }
      }

      handlePendingPayment()
    }, 500) // Court délai pour laisser le temps au auth de se charger

    return () => clearTimeout(timer)
  }, [isLoading, router, refreshUser])

  if (isLoading || processing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-[#0F0F12] dark:via-[#0F0F12] dark:to-[#1A0F1F]">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Préparation de votre paiement...
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Vous allez être redirigé vers Stripe pour finaliser votre abonnement.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-xl">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg p-6 text-center">
            <h1 className="text-xl font-semibold text-red-800 dark:text-red-300 mb-2">
              Erreur de paiement
            </h1>
            <p className="text-red-700 dark:text-red-400 mb-4">{error}</p>
            <div className="space-x-4">
              <button
                onClick={() => {
                  setProcessing(true)
                  setError(null)
                  window.location.reload()
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Réessayer
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                Aller au dashboard
              </button>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  return null
}
