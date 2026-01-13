"use client"

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ScraperDashboard from "@/components/scraper-dashboard"
import Layout from "@/components/kokonutui/layout"

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

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

  return (
    <Layout>
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
