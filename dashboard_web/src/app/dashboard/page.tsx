"use client"

import { Suspense, useEffect, useState, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ScraperDashboard from "@/components/scraper-dashboard"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { Loader2 } from "lucide-react"

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading, refreshUser } = useAuth()
  const [checkingPendingPlan, setCheckingPendingPlan] = useState(true)
  const hasCheckedRef = useRef(false)

  // Vérifier et synchroniser le pending_plan depuis les métadonnées auth
  useEffect(() => {
    // Ne pas re-vérifier si déjà fait
    if (hasCheckedRef.current) return
    if (isLoading) return

    // Marquer comme vérifié immédiatement pour éviter les doubles exécutions
    hasCheckedRef.current = true

    // Si pas d'utilisateur, rediriger vers login et arrêter le chargement
    if (!user) {
      setCheckingPendingPlan(false)
      router.push("/login")
      return
    }

    const syncAndCheckPendingPlan = async () => {
      try {
        // Ne pas vérifier si c'est un retour de paiement réussi
        const paymentStatus = searchParams.get('payment')
        if (paymentStatus === 'success') {
          try {
            await fetch("/api/users/clear-pending-plan", { method: "POST" })
            sessionStorage.removeItem("pending_promo_code")
          } catch (err) {
            console.error("Error clearing pending plan:", err)
          }
          return
        }

        // ÉTAPE 1 : Vérifier s'il y a un code promo en attente à appliquer
        // Le code promo a PRIORITÉ sur le pending_plan (pas de paiement Stripe)
        const pendingPromoCode = sessionStorage.getItem("pending_promo_code")
        if (pendingPromoCode) {
          // Récupérer le plan stocké lors de la création de compte
          const pendingPromoPlan = sessionStorage.getItem("pending_promo_plan") || "ultime"
          
          console.log("[Dashboard] Found pending promo code:", pendingPromoCode, "plan:", pendingPromoPlan)

          try {
            const applyResponse = await fetch("/api/promo-codes/apply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: pendingPromoCode, plan: pendingPromoPlan }),
            })

            const applyData = await applyResponse.json()

            if (applyResponse.ok) {
              console.log("[Dashboard] Promo code applied successfully:", applyData)
              sessionStorage.removeItem("pending_promo_code")
              sessionStorage.removeItem("pending_promo_plan")
              // Nettoyer le pending_plan si existant
              try {
                await fetch("/api/users/clear-pending-plan", { method: "POST" })
              } catch (e) { /* non critique */ }
              // Rafraîchir les données utilisateur pour refléter le plan Ultime
              await refreshUser()
              return
            } else {
              console.error("[Dashboard] Error applying promo code:", applyData)
            }
          } catch (err) {
            console.error("[Dashboard] Error applying promo code:", err)
          }
          // Nettoyer même si échec pour ne pas boucler
          sessionStorage.removeItem("pending_promo_code")
          sessionStorage.removeItem("pending_promo_plan")
        }

        // ÉTAPE 2 : Pas de code promo → vérifier le pending_plan (paiement Stripe)
        const syncResponse = await fetch("/api/users/sync-pending-plan", {
          method: "POST",
        })
        const syncData = await syncResponse.json()

        // Si un pending_plan a été synchronisé ou existe déjà, rediriger vers le paiement
        if (syncData.has_pending_plan || user.pending_plan) {
          router.push("/dashboard/pending-payment")
          return
        }
      } catch (err) {
        console.error("Error checking pending plan:", err)
      } finally {
        // TOUJOURS arrêter le chargement
        setCheckingPendingPlan(false)
      }
    }

    syncAndCheckPendingPlan()
  }, [user, isLoading, router, searchParams])

  useEffect(() => {
    // Détecter si l'utilisateur arrive avec un code de réinitialisation
    const code = searchParams.get('code')
    const type = searchParams.get('type')
    const token = searchParams.get('token')
    const accessToken = searchParams.get('access_token')

    // Vérifier s'il y a un hash fragment avec un token de réinitialisation
    const hash = window.location.hash
    const hashParams = new URLSearchParams(hash.substring(1))
    const hashType = hashParams.get('type')
    const hashAccessToken = hashParams.get('access_token')

    // Si on détecte un code/token de réinitialisation, rediriger vers la page de réinitialisation
    // On détecte aussi si c'est une réinitialisation même sans type explicite (code présent = probablement réinitialisation)
    if (code || token || accessToken || hashAccessToken) {
      // Vérifier si c'est bien une réinitialisation (type=recovery ou dans le hash)
      // Si on a un code mais pas de type, on assume que c'est une réinitialisation si on est sur /dashboard
      const isRecovery = type === 'recovery' || hashType === 'recovery' || (code && !type)

      if (isRecovery) {
        // Construire l'URL de redirection avec tous les paramètres
        // Utiliser l'URL actuelle pour préserver le host/port
        const currentOrigin = window.location.origin
        const params = new URLSearchParams()
        if (code) params.set('code', code)
        if (token) params.set('token', token)
        if (accessToken) params.set('access_token', accessToken)
        if (type) params.set('type', type)
        else params.set('type', 'recovery') // Ajouter type=recovery si absent

        const redirectUrl = `${currentOrigin}/reset-password?${params.toString()}`
        if (hash) {
          window.location.replace(`${redirectUrl}${hash}`)
        } else {
          window.location.replace(redirectUrl)
        }
        return
      }
    }
  }, [searchParams, router])

  // Afficher un loader pendant la vérification du pending_plan
  if (isLoading || checkingPendingPlan) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Chargement...</p>
        </div>
      </Layout>
    )
  }

  const restricted = searchParams.get("restricted")

  return (
    <Layout>
      {restricted === "analytics" && (
        <div className="mb-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
          L’accès à la page <strong>Analytics</strong> est réservé aux plans Pro et Ultime. Passez à un plan payant pour y accéder.
        </div>
      )}
      {restricted === "alerte" && (
        <div className="mb-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
          L’accès à la page <strong>Alerte</strong> est réservé aux plans Pro et Ultime. Passez à un plan payant pour y accéder.
        </div>
      )}
      <ScraperDashboard />
    </Layout>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-pulse">Chargement...</div>
        </div>
      </Layout>
    }>
      <DashboardContent />
    </Suspense>
  )
}
