/**
 * Client Supabase pour le navigateur
 */
import { createBrowserClient } from '@supabase/ssr'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 jours

function getCookieValue(name: string) {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split('; ')
    .find(part => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.split('=')[1]) : null
}

function setCookieValue(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`
}

function removeCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage:
          typeof window !== 'undefined'
            ? {
                getItem: (key: string) => getCookieValue(key),
                setItem: (key: string, value: string) => setCookieValue(key, value, COOKIE_MAX_AGE),
                removeItem: (key: string) => removeCookie(key),
              }
            : undefined,
      },
    }
  )
}


