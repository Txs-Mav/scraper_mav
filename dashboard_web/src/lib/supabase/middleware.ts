/**
 * Client Supabase pour le middleware
 * Gère la persistance de session via cookies
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

  // Routes nécessitant une authentification obligatoire
  const protectedRoutes = ['/dashboard/settings', '/dashboard/profile', '/dashboard/subscription']
  const requiresAuth = protectedRoutes.some(route => request.nextUrl.pathname.startsWith(route))

  if (!user && requiresAuth) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
