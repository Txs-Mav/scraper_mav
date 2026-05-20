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

/**
 * Détecte une erreur de refresh token (token absent, révoqué, expiré, déjà
 * utilisé). Ces erreurs sont récupérables côté serveur en nettoyant les
 * cookies `sb-*` périmés pour casser la boucle d'auto-refresh côté browser.
 */
function isRefreshTokenError(error: unknown): boolean {
  if (!error) return false
  const code = (error as { code?: string })?.code
  if (
    code === 'refresh_token_not_found' ||
    code === 'invalid_refresh_token' ||
    code === 'refresh_token_already_used'
  ) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /refresh token/i.test(message) && /(not found|invalid|already used|expired)/i.test(message)
}

/**
 * Efface tous les cookies `sb-*` sur la réponse. À appeler quand on détecte
 * une session corrompue (refresh token mort). Sans ça, le navigateur continue
 * d'envoyer les mêmes cookies périmés à chaque requête, et le SDK retente un
 * refresh en background → spam dans la console : `AuthApiError: Invalid
 * Refresh Token: Refresh Token Not Found`.
 */
function clearSupabaseCookies(request: NextRequest, response: NextResponse): void {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-')) {
      response.cookies.set(cookie.name, '', {
        path: '/',
        maxAge: 0,
        expires: new Date(0),
      })
    }
  }
}

/**
 * Détermine si le middleware doit faire un round-trip Supabase pour cette
 * route. Le `auth.getUser()` ajoute 100-300ms de latence ; on ne le paie que
 * sur les routes qui en dépendent réellement.
 *
 * Bénéfice critique : si Supabase Auth est en panne, seules ces routes
 * échouent — la landing, les webhooks, les crons et les API publiques
 * continuent de tourner.
 */
function needsAuthCheck(pathname: string): boolean {
  // Routes protégées : on doit gate.
  if (pathname.startsWith('/dashboard')) return true
  if (pathname.startsWith('/admin')) return true
  if (pathname.startsWith('/api/admin')) return true

  // Routes d'auth : on rafraîchit les cookies/token pour que le client
  // côté browser ait toujours une session valide en mémoire.
  if (pathname === '/login' || pathname.startsWith('/login/')) return true
  if (pathname === '/create-account' || pathname.startsWith('/create-account/')) return true
  if (pathname === '/forgot-password' || pathname.startsWith('/forgot-password/')) return true
  if (pathname === '/reset-password' || pathname.startsWith('/reset-password/')) return true
  if (pathname.startsWith('/auth/')) return true

  // Tout le reste (landing, marketing, /api/cron, /api/webhook, /api/health,
  // /api/product-search, sitemap, robots, etc.) n'a pas besoin de session
  // côté middleware. Les routes API qui veulent l'user appellent
  // `getCurrentUser()` elles-mêmes.
  return false
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Fast path : routes publiques. On évite la création du client Supabase et
  // le round-trip réseau associé à `getUser()`. Gain typique : 100-300ms par
  // requête sur la landing, les crons, les webhooks, etc.
  if (!needsAuthCheck(pathname)) {
    return NextResponse.next({ request })
  }

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

  // IMPORTANT: Appeler getUser() pour rafraîchir la session et les cookies.
  // On enveloppe dans un try/catch : si Supabase est lent ou en panne, on
  // veut quand même laisser passer la requête plutôt que renvoyer 500.
  // L'authentification effective sera (re)vérifiée par le layout/page server
  // component qui appelle `getCurrentUser()` avec ses propres garanties.
  //
  // Cas spécial : refresh token mort (révoqué, expiré, absent côté Supabase).
  // Le SDK ne throw PAS — il retourne `{ data: { user: null }, error }`.
  // Si on ignore cette erreur, le browser garde ses cookies périmés et le
  // SDK browser retente un refresh en boucle → spam console
  // `AuthApiError: Invalid Refresh Token: Refresh Token Not Found`. On
  // efface donc les cookies `sb-*` pour casser la boucle.
  let user = null
  try {
    const { data, error } = await supabase.auth.getUser()
    user = data.user

    if (error && isRefreshTokenError(error)) {
      clearSupabaseCookies(request, supabaseResponse)
      user = null
    }
  } catch (error) {
    if (isRefreshTokenError(error)) {
      clearSupabaseCookies(request, supabaseResponse)
      user = null
    } else {
      console.warn(
        '[middleware] supabase.auth.getUser() a échoué — on laisse passer:',
        error instanceof Error ? error.message : String(error),
      )
      return supabaseResponse
    }
  }

  // Routes protégées nécessitant une authentification
  // /dashboard/* = utilisateur authentifié quelconque
  // /admin/*     = utilisateur authentifié + rôle main/developer (vérifié dans le
  //                layout server component pour éviter une requête DB ici)
  const isDashboardRoute = pathname.startsWith('/dashboard')
  const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  const isProtectedRoute = isDashboardRoute || isAdminRoute

  // Note: On ne redirige PAS les utilisateurs connectés depuis les routes auth
  // Le client-side gère ce cas et déconnecte si l'user n'existe pas dans notre table users
  // Cela permet de gérer les cas où l'user est supprimé de notre table mais pas de auth.users

  // Utilisateur non connecté visitant une route protégée → Rediriger vers login
  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Préserver la destination pour redirection post-login (uniquement /admin
    // côté UI ; pour /api/admin on retourne directement 401 plus bas).
    if (isAdminRoute && !pathname.startsWith('/api/')) {
      url.searchParams.set('next', pathname)
    }
    return NextResponse.redirect(url)
  }

  // 3. Routes publiques et landing page → Laisser passer
  return supabaseResponse
}
