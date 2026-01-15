/**
 * Client Supabase pour le navigateur
 * Utilise @supabase/ssr qui gère automatiquement les cookies avec le middleware
 */
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
