import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

/**
 * Logout côté serveur — la SEULE approche fiable.
 *
 * Pourquoi pas un signOut purement client ? Parce que :
 *   - Le compte dev a des cookies httpOnly (sb-*-auth-token) que le JS du
 *     navigateur ne peut pas effacer.
 *   - Si on redirige vers /login avant que les cookies serveur soient
 *     nettoyés, le middleware Next.js voit encore la session, et la page
 *     /login redirige automatiquement vers /admin (boucle).
 *
 * Ici on laisse le serveur faire le ménage :
 *   1. supabase.auth.signOut() côté SSR → @supabase/ssr appelle setAll()
 *      avec des cookies expirés (Set-Cookie: ...; Max-Age=0).
 *   2. En backup, on supprime explicitement tout cookie qui commence par
 *      "sb-" (au cas où signOut échoue ou que des cookies orphelins traînent).
 *   3. On répond avec un 302 vers /login (pour le GET, navigation directe)
 *      ou un JSON success (pour le POST appelé via fetch).
 *
 * Le navigateur applique les Set-Cookie expirés AVANT de suivre la
 * redirection, donc à l'arrivée sur /login il n'y a plus aucune session.
 */

async function performLogout() {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()
  } catch (error) {
    console.error('[Logout] supabase.auth.signOut error (ignored):', error)
  }

  // Backup : effacer manuellement tous les cookies supabase qui pourraient
  // rester (sb-access-token, sb-refresh-token, sb-<project>-auth-token, ...)
  try {
    const cookieStore = await cookies()
    for (const cookie of cookieStore.getAll()) {
      if (cookie.name.startsWith('sb-')) {
        cookieStore.set(cookie.name, '', {
          path: '/',
          maxAge: 0,
          expires: new Date(0),
        })
      }
    }
  } catch (error) {
    console.error('[Logout] Cookie cleanup error (ignored):', error)
  }
}

export async function GET(request: Request) {
  await performLogout()
  const url = new URL('/login', request.url)
  return NextResponse.redirect(url, { status: 302 })
}

export async function POST() {
  await performLogout()
  return NextResponse.json({ success: true })
}
