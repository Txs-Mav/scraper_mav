import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const { searchParams } = requestUrl
  const code = searchParams.get('code')
  const type = searchParams.get('type') // 'recovery' pour réinitialisation de mot de passe

  // Construire l'URL de base en préservant le host/port d'origine
  // Cela permet de fonctionner avec localhost, 172.17.2.183, ou n'importe quel host
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`

  if (!code) {
    // Pas de code : on oriente vers les pages dédiées selon le type
    if (type === 'recovery') {
      return NextResponse.redirect(`${baseUrl}/reset-password?type=recovery`)
    }
    if (type === 'signup') {
      return NextResponse.redirect(`${baseUrl}/auth/email-confirmed`)
    }
    return NextResponse.redirect(`${baseUrl}/login?message=missing_code`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Si c'est une réinitialisation, rediriger quand même vers reset-password avec erreur
    if (type === 'recovery') {
      return NextResponse.redirect(`${baseUrl}/reset-password?error=invalid_link`)
    }
    return NextResponse.redirect(`${baseUrl}/login?message=auth_error`)
  }

  // Vérifier si c'est une réinitialisation de mot de passe
  // On peut le détecter via le type dans l'URL ou via les métadonnées de la session
  const isRecovery = type === 'recovery' ||
    (data?.session?.user?.app_metadata?.action === 'recovery') ||
    requestUrl.searchParams.has('type') && requestUrl.searchParams.get('type') === 'recovery'

  // Si c'est une réinitialisation de mot de passe, rediriger vers la page de réinitialisation
  if (isRecovery) {
    return NextResponse.redirect(`${baseUrl}/reset-password?type=recovery`)
  }

  // C'est une confirmation d'email - synchroniser le pending_plan si présent
  const user = data?.session?.user
  if (user) {
    const pendingPlan = user.user_metadata?.pending_plan

    if (pendingPlan) {
      // Synchroniser le pending_plan vers la table users
      await supabase
        .from('users')
        .update({ pending_plan: pendingPlan })
        .eq('id', user.id)

      // Ne PAS supprimer le pending_plan des métadonnées auth ici
      // Le dashboard s'en chargera après avoir vérifié s'il y a un code promo
    }
  }

  // Toujours rediriger vers le dashboard
  // Le dashboard gère à la fois les codes promo ET les pending_plans
  // Cela permet d'appliquer un code promo avant de rediriger vers le paiement
  return NextResponse.redirect(`${baseUrl}/dashboard`)
}


