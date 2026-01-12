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
    // Si pas de code mais qu'on a un type=recovery, rediriger quand même vers reset-password
    // (le token peut être dans le hash fragment)
    if (type === 'recovery') {
      return NextResponse.redirect(`${baseUrl}/reset-password?type=recovery`)
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

  // Sinon, c'est une confirmation d'email
  return NextResponse.redirect(`${baseUrl}/login?message=confirmed`)
}


