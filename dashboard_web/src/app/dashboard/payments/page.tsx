"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { Loader2 } from "lucide-react"
import SubscriptionPage from "../subscription/page"

export default function PaymentsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [isLoading, user, router])

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

  // Pour les plans gratuits : afficher la même interface que /dashboard/subscription
  if (user.subscription_plan === "free") {
    return <SubscriptionPage />
  }

  // Pour les autres plans : placeholder paiements (à affiner ultérieurement)
  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 space-y-4">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight">
          Paiements
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Espace paiements / facturation (prochainement).
        </p>
      </div>
    </Layout>
  )
}

