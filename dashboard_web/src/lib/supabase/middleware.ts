/**
 * Client Supabase pour le middleware
 * Gère la persistance de session via cookies et les redirections d'authentification
 * 
 * Comportements :
 * - Utilisateur connecté + quitte et revient → Dashboard (session persistante 30 jours)
 * - Pas de session → Landing page (/)
 * - Utilisateur connecté + visite /login ou /create-account → Redirigé vers /dashboard
 * - Utilisateur non connecté + visite /dashboard/* → Redirigé vers /login
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const COOKIE_OPTIONS = {
  maxAge: 60 * 60 * 24 * 30, // 30 jours
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...COOKIE_OPTIONS,
              ...options,
            })
          )
        },
      },
    }
  )

  // IMPORTANT: Appeler getUser() pour rafraîchir la session et les cookies
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Routes d'authentification (login, création de compte, etc.)
  const authRoutes = ['/login', '/create-account', '/forgot-password']
  const isAuthRoute = authRoutes.some(route => pathname === route || pathname.startsWith(route))

  // Routes protégées nécessitant une authentification
  const isProtectedRoute = pathname.startsWith('/dashboard')

  // Routes publiques (callback auth, reset password, etc.)
  const publicRoutes = ['/auth/callback', '/reset-password', '/auth/email-confirmed']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))

  // Note: On ne redirige PAS les utilisateurs connectés depuis les routes auth
  // Le client-side gère ce cas et déconnecte si l'user n'existe pas dans notre table users
  // Cela permet de gérer les cas où l'user est supprimé de notre table mais pas de auth.users

  // Utilisateur non connecté visitant une route protégée → Rediriger vers login
  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 3. Routes publiques et landing page → Laisser passer
  return supabaseResponse
}
